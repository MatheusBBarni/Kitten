import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path"

import type {
  ManagedWorktreeBinding,
  ManagedWorktreeReason,
  SessionId,
} from "../core/types.ts"

const MANAGED_ROOT_RELATIVE = ".kitten/worktrees"
const LOCAL_EXCLUDE_ENTRY = `${MANAGED_ROOT_RELATIVE}/`
const MAX_ID_ATTEMPTS = 8
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,31}$/u
const decoder = new TextDecoder("utf-8", { fatal: true })

export interface ManagedWorktreeSpawnProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

export interface ManagedWorktreeSpawnOptions {
  readonly cmd: string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdin: "ignore"
  readonly stdout: "pipe"
  readonly stderr: "ignore"
}

export type ManagedWorktreeSpawn = (
  options: ManagedWorktreeSpawnOptions,
) => ManagedWorktreeSpawnProcess

export interface ManagedWorktreeStat {
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface ManagedWorktreeFileSystem {
  lstat(path: string): Promise<ManagedWorktreeStat | null>
  realpath(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  readdir(path: string): Promise<readonly string[]>
  readText(path: string): Promise<string>
  appendText(path: string, value: string): Promise<void>
  removeEmptyDirectory(path: string): Promise<void>
}

export interface ManagedWorktreeReservations {
  reserve(id: string): boolean
  release(id: string): void
}

export interface ProvisionManagedWorktreeInput {
  readonly parentCwd: string
  readonly ownerSessionId: SessionId
}

export type ProvisionManagedWorktreeResult =
  | { readonly kind: "provisioned"; readonly binding: ManagedWorktreeBinding }
  | { readonly kind: "failed"; readonly reason: ManagedWorktreeReason }

export type ReconcileManagedWorktreeResult =
  | { readonly kind: "available"; readonly binding: ManagedWorktreeBinding }
  | { readonly kind: "unavailable"; readonly reason: ManagedWorktreeReason }

export interface CleanupManagedWorktreeInput {
  readonly binding?: ManagedWorktreeBinding
  /** Fresh controller-owned lifecycle fact; cleanup is terminal-only. */
  readonly ownerTerminal: boolean
  /** Fresh controller-owned runtime fact; restored review bindings pass false. */
  readonly ownerLive: boolean
}

export type CleanupManagedWorktreeResult =
  | { readonly kind: "removed" }
  | { readonly kind: "refused"; readonly reason: ManagedWorktreeReason }
  | { readonly kind: "failed"; readonly reason: ManagedWorktreeReason }

export interface ManagedWorktreeProvisioner {
  provision(input: ProvisionManagedWorktreeInput): Promise<ProvisionManagedWorktreeResult>
  reconcile(binding: ManagedWorktreeBinding): Promise<ReconcileManagedWorktreeResult>
  cleanup(input: CleanupManagedWorktreeInput): Promise<CleanupManagedWorktreeResult>
}

export interface CreateManagedWorktreeProvisionerOptions {
  readonly spawn?: ManagedWorktreeSpawn
  readonly fileSystem?: ManagedWorktreeFileSystem
  readonly reservations?: ManagedWorktreeReservations
  readonly createId?: () => string
  readonly env?: Record<string, string | undefined>
}

interface GitResult {
  readonly exitCode: number
  readonly stdout: Uint8Array
}

interface ParentRepository {
  readonly repoRoot: string
  readonly commonGitDir: string
  readonly baseBranch: string
  readonly baseSha: string
}

interface WorktreeEntry {
  readonly path: string
  readonly head?: string
  readonly branch?: string
}

interface MutableWorktreeEntry {
  path?: string
  head?: string
  branch?: string
}

const spawnWithBun: ManagedWorktreeSpawn = (options) => Bun.spawn(options)

const nodeFileSystem: ManagedWorktreeFileSystem = {
  async lstat(path) {
    try {
      return await lstat(path)
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  },
  realpath,
  async mkdir(path) {
    await mkdir(path, { recursive: true })
  },
  readdir,
  async readText(path) {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if (isMissing(error)) return ""
      throw error
    }
  },
  async appendText(path, value) {
    await appendFile(path, value, "utf8")
  },
  async removeEmptyDirectory(path) {
    await rm(path, { recursive: false })
  },
}

function createReservations(): ManagedWorktreeReservations {
  const reserved = new Set<string>()
  return {
    reserve(id) {
      if (reserved.has(id)) return false
      reserved.add(id)
      return true
    },
    release(id) {
      reserved.delete(id)
    },
  }
}

function createOpaqueId(): string {
  return `kw-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`
}

export function createManagedWorktreeProvisioner(
  options: CreateManagedWorktreeProvisionerOptions = {},
): ManagedWorktreeProvisioner {
  const spawn = options.spawn ?? spawnWithBun
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const reservations = options.reservations ?? createReservations()
  const createId = options.createId ?? createOpaqueId
  const env = { ...process.env, ...options.env }

  return {
    async provision(input) {
      const parent = await inspectParent(spawn, fileSystem, env, input.parentCwd)
      if (parent.kind === "failed") return parent

      const root = await prepareManagedRoot(spawn, fileSystem, env, parent.repository)
      if (root.kind === "failed") return root

      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
        const id = createId()
        if (!ID_PATTERN.test(id) || !reservations.reserve(id)) continue

        try {
          const result = await provisionReserved(
            spawn,
            fileSystem,
            env,
            parent.repository,
            root.managedRoot,
            id,
            input.ownerSessionId,
          )
          if (result.kind === "retry") continue
          return result
        } finally {
          reservations.release(id)
        }
      }

      return failed("collision")
    },
    async reconcile(binding) {
      return reconcileBinding(spawn, fileSystem, env, binding)
    },
    async cleanup(input) {
      if (!input.binding || !isManagedBinding(input.binding)) {
        return refused("not_managed")
      }
      if (!input.ownerTerminal || input.ownerLive) return refused("live_owned")

      const reconciled = await reconcileBinding(spawn, fileSystem, env, input.binding)
      if (reconciled.kind === "unavailable") return refused(reconciled.reason)

      const binding = reconciled.binding
      try {
        const status = await runGit(spawn, binding.worktreePath, env, [
          "status",
          "--porcelain",
          "-z",
          "--untracked-files=all",
        ])
        if (status.exitCode !== 0) return refused("verification_failed")
        if (status.stdout.byteLength !== 0) return refused("dirty")

        const merged = await runGit(spawn, binding.repoRoot, env, [
          "merge-base",
          "--is-ancestor",
          binding.branch,
          binding.baseBranch,
        ])
        if (merged.exitCode === 1) return refused("unmerged")
        if (merged.exitCode !== 0) return refused("verification_failed")

        const removed = await runGit(spawn, binding.repoRoot, env, [
          "worktree",
          "remove",
          binding.worktreePath,
        ])
        if (removed.exitCode !== 0) return cleanupFailed()

        const deleted = await runGit(spawn, binding.repoRoot, env, [
          "branch",
          "-d",
          binding.branch,
        ])
        if (deleted.exitCode !== 0) return cleanupFailed()
        return { kind: "removed" }
      } catch {
        return cleanupFailed()
      }
    },
  }
}

async function reconcileBinding(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  binding: ManagedWorktreeBinding,
): Promise<ReconcileManagedWorktreeResult> {
  if (!isManagedBinding(binding)) return unavailable("not_managed")

  const managedRoot = resolve(binding.repoRoot, MANAGED_ROOT_RELATIVE)
  const expectedPath = resolve(managedRoot, binding.id)
  if (
    binding.branch !== `kitten/${binding.id}` ||
    binding.worktreePath !== expectedPath ||
    dirname(expectedPath) !== managedRoot ||
    basename(expectedPath) !== binding.id
  ) {
    return unavailable("not_managed")
  }

  try {
    const [repoStat, rootStat, worktreeStat] = await Promise.all([
      fileSystem.lstat(binding.repoRoot),
      fileSystem.lstat(managedRoot),
      fileSystem.lstat(binding.worktreePath),
    ])
    if (!repoStat || !rootStat || !worktreeStat) return unavailable("missing")
    if (
      !repoStat.isDirectory() ||
      !rootStat.isDirectory() ||
      !worktreeStat.isDirectory() ||
      repoStat.isSymbolicLink() ||
      rootStat.isSymbolicLink() ||
      worktreeStat.isSymbolicLink()
    ) {
      return unavailable("external")
    }

    const [repoRoot, canonicalRoot, worktreePath] = await Promise.all([
      fileSystem.realpath(binding.repoRoot),
      fileSystem.realpath(managedRoot),
      fileSystem.realpath(binding.worktreePath),
    ])
    if (
      repoRoot !== binding.repoRoot ||
      canonicalRoot !== managedRoot ||
      worktreePath !== binding.worktreePath ||
      dirname(worktreePath) !== canonicalRoot ||
      !isContainedBy(repoRoot, canonicalRoot) ||
      !isContainedBy(canonicalRoot, worktreePath)
    ) {
      return unavailable("external")
    }

    const [repoTopLevel, repoGitDir, worktreeTopLevel, worktreeGitDir] = await Promise.all([
      runGit(spawn, repoRoot, env, ["rev-parse", "--show-toplevel"]),
      runGit(spawn, repoRoot, env, ["rev-parse", "--git-common-dir"]),
      runGit(spawn, worktreePath, env, ["rev-parse", "--show-toplevel"]),
      runGit(spawn, worktreePath, env, ["rev-parse", "--git-common-dir"]),
    ])
    if (
      repoTopLevel.exitCode !== 0 ||
      repoGitDir.exitCode !== 0 ||
      worktreeTopLevel.exitCode !== 0 ||
      worktreeGitDir.exitCode !== 0
    ) {
      return unavailable("verification_failed")
    }

    const reportedRepoRoot = parseSingleLine(repoTopLevel.stdout)
    const reportedRepoGitDir = parseSingleLine(repoGitDir.stdout)
    const reportedWorktreeRoot = parseSingleLine(worktreeTopLevel.stdout)
    const reportedWorktreeGitDir = parseSingleLine(worktreeGitDir.stdout)
    if (
      !reportedRepoRoot ||
      !reportedRepoGitDir ||
      !reportedWorktreeRoot ||
      !reportedWorktreeGitDir
    ) {
      return unavailable("verification_failed")
    }

    const [canonicalReportedRepo, commonGitDir, canonicalWorktreeRoot, worktreeCommonGitDir] =
      await Promise.all([
        fileSystem.realpath(reportedRepoRoot),
        fileSystem.realpath(resolve(repoRoot, reportedRepoGitDir)),
        fileSystem.realpath(reportedWorktreeRoot),
        fileSystem.realpath(resolve(worktreePath, reportedWorktreeGitDir)),
      ])
    if (
      canonicalReportedRepo !== repoRoot ||
      canonicalWorktreeRoot !== worktreePath ||
      worktreeCommonGitDir !== commonGitDir
    ) {
      return unavailable("external")
    }

    const entries = await listWorktrees(spawn, repoRoot, env)
    const entry = entries?.find((candidate) => candidate.path === worktreePath)
    if (!entry || entry.branch !== binding.branch || !entry.head) {
      return unavailable("verification_failed")
    }

    const [branchHead, baseCommit, baseBranchExists, baseRelationship] = await Promise.all([
      runGit(spawn, repoRoot, env, ["rev-parse", "--verify", `${binding.branch}^{commit}`]),
      runGit(spawn, repoRoot, env, ["rev-parse", "--verify", `${binding.baseSha}^{commit}`]),
      runGit(spawn, repoRoot, env, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${binding.baseBranch}`,
      ]),
      runGit(spawn, repoRoot, env, [
        "merge-base",
        "--is-ancestor",
        binding.baseSha,
        binding.branch,
      ]),
    ])
    if (
      branchHead.exitCode !== 0 ||
      baseCommit.exitCode !== 0 ||
      baseBranchExists.exitCode !== 0 ||
      baseRelationship.exitCode !== 0 ||
      parseSha(branchHead.stdout) !== entry.head ||
      parseSha(baseCommit.stdout) !== binding.baseSha
    ) {
      return unavailable("verification_failed")
    }

    const { reason: _reason, ...identity } = binding
    return { kind: "available", binding: { ...identity, availability: "available" } }
  } catch {
    return unavailable("verification_failed")
  }
}

async function inspectParent(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<
  | { readonly kind: "ready"; readonly repository: ParentRepository }
  | { readonly kind: "failed"; readonly reason: ManagedWorktreeReason }
> {
  try {
    const rootResult = await runGit(spawn, cwd, env, ["rev-parse", "--show-toplevel"])
    if (rootResult.exitCode !== 0) return failed("not_git_repository")
    const reportedRoot = parseSingleLine(rootResult.stdout)
    if (!reportedRoot || !isAbsolute(reportedRoot)) return failed("not_git_repository")

    const [repoRoot, canonicalCwd] = await Promise.all([
      fileSystem.realpath(reportedRoot),
      fileSystem.realpath(cwd),
    ])
    if (!isContainedBy(repoRoot, canonicalCwd)) return failed("not_git_repository")

    const branchResult = await runGit(spawn, repoRoot, env, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ])
    if (branchResult.exitCode !== 0) return failed("detached_head")
    const baseBranch = parseSingleLine(branchResult.stdout)
    if (!baseBranch) return failed("detached_head")

    const shaResult = await runGit(spawn, repoRoot, env, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ])
    if (shaResult.exitCode !== 0) return failed("git_failed")
    const baseSha = parseSha(shaResult.stdout)
    if (!baseSha) return failed("git_failed")

    const submoduleResult = await runGit(spawn, repoRoot, env, ["ls-files", "--stage", "-z"])
    if (submoduleResult.exitCode !== 0) return failed("git_failed")
    if (hasGitlink(submoduleResult.stdout)) return failed("submodules_unsupported")

    const gitDirResult = await runGit(spawn, repoRoot, env, ["rev-parse", "--git-common-dir"])
    if (gitDirResult.exitCode !== 0) return failed("git_failed")
    const reportedGitDir = parseSingleLine(gitDirResult.stdout)
    if (!reportedGitDir) return failed("git_failed")
    const commonGitDir = await fileSystem.realpath(resolve(repoRoot, reportedGitDir))

    return {
      kind: "ready",
      repository: { repoRoot, commonGitDir, baseBranch, baseSha },
    }
  } catch {
    return failed("git_failed")
  }
}

async function prepareManagedRoot(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  parent: ParentRepository,
): Promise<
  | { readonly kind: "ready"; readonly managedRoot: string }
  | { readonly kind: "failed"; readonly reason: ManagedWorktreeReason }
> {
  const managedRoot = resolve(parent.repoRoot, MANAGED_ROOT_RELATIVE)
  let createdRoot = false

  try {
    const tracked = await runGit(spawn, parent.repoRoot, env, [
      "ls-files",
      "-z",
      "--",
      MANAGED_ROOT_RELATIVE,
    ])
    if (tracked.exitCode !== 0) return failed("git_failed")
    if (tracked.stdout.byteLength > 0) return failed("root_conflict")

    const excludeResult = await runGit(spawn, parent.repoRoot, env, [
      "rev-parse",
      "--git-path",
      "info/exclude",
    ])
    if (excludeResult.exitCode !== 0) return failed("git_failed")
    const excludeValue = parseSingleLine(excludeResult.stdout)
    if (!excludeValue) return failed("git_failed")
    const excludePath = resolve(parent.repoRoot, excludeValue)
    const excludeDirectory = await fileSystem.realpath(dirname(excludePath))
    if (
      excludeDirectory !== resolve(parent.commonGitDir, "info") ||
      basename(excludePath) !== "exclude"
    ) {
      return failed("root_conflict")
    }
    const excludeText = await fileSystem.readText(excludePath)
    const isExcluded = hasExcludeEntry(excludeText)

    const stat = await fileSystem.lstat(managedRoot)
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) return failed("root_conflict")
    if (stat && !isExcluded && (await fileSystem.readdir(managedRoot)).length > 0) {
      return failed("root_conflict")
    }

    if (!stat) {
      await fileSystem.mkdir(managedRoot)
      createdRoot = true
    }

    const canonicalRoot = await fileSystem.realpath(managedRoot)
    if (canonicalRoot !== managedRoot || !isContainedBy(parent.repoRoot, canonicalRoot)) {
      if (createdRoot) await removeOwnedEmptyRoot(fileSystem, managedRoot)
      return failed("root_conflict")
    }

    if (!isExcluded) {
      const separator = excludeText.length > 0 && !excludeText.endsWith("\n") ? "\n" : ""
      await fileSystem.appendText(excludePath, `${separator}${LOCAL_EXCLUDE_ENTRY}\n`)
    }

    return { kind: "ready", managedRoot: canonicalRoot }
  } catch {
    if (createdRoot) await removeOwnedEmptyRoot(fileSystem, managedRoot)
    return failed("git_failed")
  }
}

async function provisionReserved(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  parent: ParentRepository,
  managedRoot: string,
  id: string,
  ownerSessionId: SessionId,
): Promise<ProvisionManagedWorktreeResult | { readonly kind: "retry" }> {
  const worktreePath = resolve(managedRoot, id)
  const branch = `kitten/${id}`
  let addAttempted = false

  try {
    if (dirname(worktreePath) !== managedRoot || basename(worktreePath) !== id) {
      return failed("root_conflict")
    }
    if (await fileSystem.lstat(worktreePath)) return { kind: "retry" }

    const branchExists = await runGit(spawn, parent.repoRoot, env, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ])
    if (branchExists.exitCode === 0) return { kind: "retry" }
    if (branchExists.exitCode !== 1) return failed("git_failed")

    const beforeList = await listWorktrees(spawn, parent.repoRoot, env)
    if (!beforeList) return failed("git_failed")
    if (beforeList.some((entry) => entry.path === worktreePath || entry.branch === branch)) {
      return { kind: "retry" }
    }

    addAttempted = true
    const addResult = await runGit(spawn, parent.repoRoot, env, [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      parent.baseSha,
    ])
    if (addResult.exitCode !== 0) {
      await rollbackOwnedWorktree(
        spawn,
        fileSystem,
        env,
        parent.repoRoot,
        worktreePath,
        branch,
        parent.baseSha,
      )
      return failed("git_failed")
    }

    const verified = await verifyCreatedWorktree(
      spawn,
      fileSystem,
      env,
      parent,
      managedRoot,
      worktreePath,
      branch,
    )
    if (!verified) {
      await rollbackOwnedWorktree(
        spawn,
        fileSystem,
        env,
        parent.repoRoot,
        worktreePath,
        branch,
        parent.baseSha,
      )
      return failed("verification_failed")
    }

    return {
      kind: "provisioned",
      binding: {
        kind: "managed",
        id,
        repoRoot: parent.repoRoot,
        worktreePath,
        branch,
        baseBranch: parent.baseBranch,
        baseSha: parent.baseSha,
        ownerSessionId,
        availability: "available",
      },
    }
  } catch {
    if (addAttempted) {
      await rollbackOwnedWorktree(
        spawn,
        fileSystem,
        env,
        parent.repoRoot,
        worktreePath,
        branch,
        parent.baseSha,
      )
    }
    return failed("git_failed")
  }
}

async function verifyCreatedWorktree(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  parent: ParentRepository,
  managedRoot: string,
  worktreePath: string,
  branch: string,
): Promise<boolean> {
  try {
    const [canonicalRoot, canonicalPath] = await Promise.all([
      fileSystem.realpath(managedRoot),
      fileSystem.realpath(worktreePath),
    ])
    if (
      canonicalPath !== worktreePath ||
      dirname(canonicalPath) !== canonicalRoot ||
      !isContainedBy(canonicalRoot, canonicalPath)
    ) {
      return false
    }

    const entries = await listWorktrees(spawn, parent.repoRoot, env)
    const entry = entries?.find((candidate) => candidate.path === canonicalPath)
    if (entry?.branch !== branch || entry.head !== parent.baseSha) return false

    const [rootResult, gitDirResult] = await Promise.all([
      runGit(spawn, canonicalPath, env, ["rev-parse", "--show-toplevel"]),
      runGit(spawn, canonicalPath, env, ["rev-parse", "--git-common-dir"]),
    ])
    if (rootResult.exitCode !== 0 || gitDirResult.exitCode !== 0) return false
    const reportedRoot = parseSingleLine(rootResult.stdout)
    const reportedGitDir = parseSingleLine(gitDirResult.stdout)
    if (!reportedRoot || !reportedGitDir) return false

    const [verifiedRoot, verifiedGitDir] = await Promise.all([
      fileSystem.realpath(reportedRoot),
      fileSystem.realpath(resolve(canonicalPath, reportedGitDir)),
    ])
    return verifiedRoot === canonicalPath && verifiedGitDir === parent.commonGitDir
  } catch {
    return false
  }
}

async function rollbackOwnedWorktree(
  spawn: ManagedWorktreeSpawn,
  fileSystem: ManagedWorktreeFileSystem,
  env: Record<string, string | undefined>,
  repoRoot: string,
  worktreePath: string,
  branch: string,
  baseSha: string,
): Promise<void> {
  try {
    const entries = await listWorktrees(spawn, repoRoot, env)
    const ownedEntry = entries?.find(
      (entry) =>
        entry.path === worktreePath && entry.branch === branch && entry.head === baseSha,
    )
    if (!ownedEntry || !(await fileSystem.lstat(worktreePath))) return

    const status = await runGit(spawn, worktreePath, env, ["status", "--porcelain", "-z"])
    if (status.exitCode !== 0 || status.stdout.byteLength !== 0) return

    const removed = await runGit(spawn, repoRoot, env, ["worktree", "remove", worktreePath])
    if (removed.exitCode !== 0) return
    await runGit(spawn, repoRoot, env, ["branch", "-d", branch])
  } catch {
    // Rollback is fail-closed: uncertain artifacts remain for explicit review.
  }
}

async function listWorktrees(
  spawn: ManagedWorktreeSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<readonly WorktreeEntry[] | null> {
  const result = await runGit(spawn, cwd, env, ["worktree", "list", "--porcelain", "-z"])
  if (result.exitCode !== 0) return null
  return parseWorktreeList(result.stdout)
}

async function runGit(
  spawn: ManagedWorktreeSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
  args: readonly string[],
): Promise<GitResult> {
  const process = spawn({
    cmd: ["git", ...args],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
  ])
  return { exitCode, stdout: new Uint8Array(stdout) }
}

function parseWorktreeList(bytes: Uint8Array): readonly WorktreeEntry[] | null {
  try {
    if (bytes.byteLength === 0) return []
    const value = decoder.decode(bytes)
    if (!value.endsWith("\0")) return null

    const entries: WorktreeEntry[] = []
    let current: MutableWorktreeEntry = {}
    for (const field of value.slice(0, -1).split("\0")) {
      if (field === "") {
        if (!current.path) return null
        entries.push(current as WorktreeEntry)
        current = {}
      } else if (field.startsWith("worktree ")) {
        if (current.path) return null
        current.path = field.slice("worktree ".length)
      } else if (field.startsWith("HEAD ")) {
        current.head = field.slice("HEAD ".length)
      } else if (field.startsWith("branch refs/heads/")) {
        current.branch = field.slice("branch refs/heads/".length)
      }
    }
    if (current.path) entries.push(current as WorktreeEntry)
    return entries
  } catch {
    return null
  }
}

function parseSingleLine(bytes: Uint8Array): string | null {
  try {
    const value = decoder.decode(bytes).replace(/\r?\n$/u, "")
    return value && !value.includes("\n") && !value.includes("\0") ? value : null
  } catch {
    return null
  }
}

function parseSha(bytes: Uint8Array): string | null {
  const value = parseSingleLine(bytes)
  return value && /^[0-9a-f]{40,64}$/u.test(value) ? value : null
}

function hasGitlink(bytes: Uint8Array): boolean {
  try {
    const value = decoder.decode(bytes)
    return value.split("\0").some((entry) => entry.startsWith("160000 "))
  } catch {
    return true
  }
}

function hasExcludeEntry(value: string): boolean {
  return value.split(/\r?\n/u).some((line) => line.trim() === LOCAL_EXCLUDE_ENTRY)
}

function isContainedBy(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}

async function removeOwnedEmptyRoot(
  fileSystem: ManagedWorktreeFileSystem,
  path: string,
): Promise<void> {
  try {
    if ((await fileSystem.readdir(path)).length === 0) await fileSystem.removeEmptyDirectory(path)
  } catch {
    // Preserve any path whose state changed or cannot be proven empty.
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  )
}

function isManagedBinding(value: unknown): value is ManagedWorktreeBinding {
  if (typeof value !== "object" || value === null) return false
  const binding = value as Partial<ManagedWorktreeBinding>
  return (
    binding.kind === "managed" &&
    typeof binding.id === "string" &&
    ID_PATTERN.test(binding.id) &&
    typeof binding.repoRoot === "string" &&
    isAbsolute(binding.repoRoot) &&
    typeof binding.worktreePath === "string" &&
    isAbsolute(binding.worktreePath) &&
    typeof binding.branch === "string" &&
    typeof binding.baseBranch === "string" &&
    isSafeRefName(binding.baseBranch) &&
    typeof binding.baseSha === "string" &&
    /^[0-9a-f]{40,64}$/u.test(binding.baseSha) &&
    typeof binding.ownerSessionId === "string" &&
    binding.ownerSessionId.length > 0
  )
}

function isSafeRefName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[\x00-\x20\x7f~^:?*[\\]/u.test(value)
  )
}

function unavailable(reason: ManagedWorktreeReason): ReconcileManagedWorktreeResult {
  return { kind: "unavailable", reason }
}

function refused(reason: ManagedWorktreeReason): CleanupManagedWorktreeResult {
  return { kind: "refused", reason }
}

function cleanupFailed(): CleanupManagedWorktreeResult {
  return { kind: "failed", reason: "git_failed" }
}

function failed(
  reason: ManagedWorktreeReason,
): { readonly kind: "failed"; readonly reason: ManagedWorktreeReason } {
  return { kind: "failed", reason }
}
