import { appendFile, lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import { MANAGED_WORKTREE_ROOT_RELATIVE } from "./contracts.ts";
import type { CardWorktreeBinding, WorktreeUnavailableReason } from "./contracts.ts";

const LOCAL_EXCLUDE_ENTRY = ".kitten/worktrees/";
const MAX_ID_ATTEMPTS = 8;
const BINDING_ID_PATTERN = /^kw-[a-z0-9]{12,32}$/u;
const SHA_PATTERN = /^[0-9a-f]{40,64}$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface GitWorktreeSpawnProcess {
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
}

export interface GitWorktreeSpawnOptions {
  readonly cmd: string[];
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly stdin: "ignore";
  readonly stdout: "pipe";
  readonly stderr: "ignore";
}

export type GitWorktreeSpawn = (options: GitWorktreeSpawnOptions) => GitWorktreeSpawnProcess;

export interface GitWorktreeStat {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface GitWorktreeFileSystem {
  lstat(path: string): Promise<GitWorktreeStat | null>;
  realpath(path: string): Promise<string>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readText(path: string): Promise<string>;
  appendText(path: string, value: string): Promise<void>;
  removeEmptyDirectory(path: string): Promise<void>;
}

export interface GitWorktreeReservations {
  reserve(id: string): boolean;
  release(id: string): void;
}

export interface ProvisionGitWorktreeInput {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly trustedRepositoryPath: string;
  readonly createdAt: number;
}

export type ProvisionGitWorktreeResult =
  | { readonly status: "provisioned"; readonly binding: CardWorktreeBinding }
  | { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason };

export type ReconcileGitWorktreeResult =
  | { readonly status: "available"; readonly binding: CardWorktreeBinding }
  | { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason };

export type RemoveGitWorktreeResult =
  | { readonly status: "removed" }
  | { readonly status: "refused" | "failed"; readonly reason: WorktreeUnavailableReason };

export interface CardGitWorktrees {
  provision(input: ProvisionGitWorktreeInput): Promise<ProvisionGitWorktreeResult>;
  reconcile(
    binding: CardWorktreeBinding,
    trustedRepositoryPath: string,
  ): Promise<ReconcileGitWorktreeResult>;
  removeExplicit(
    binding: CardWorktreeBinding,
    trustedRepositoryPath: string,
  ): Promise<RemoveGitWorktreeResult>;
  rollbackProvision(binding: CardWorktreeBinding): Promise<void>;
}

export interface CreateCardGitWorktreesOptions {
  readonly spawn?: GitWorktreeSpawn;
  readonly fileSystem?: GitWorktreeFileSystem;
  readonly reservations?: GitWorktreeReservations;
  readonly createBindingId?: () => string;
  readonly env?: Record<string, string | undefined>;
}

interface GitResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

interface RepositoryIdentity {
  readonly root: string;
  readonly gitDir: string;
  readonly branch: string;
  readonly head: string;
}

interface ParentSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly status: Uint8Array;
}

interface WorktreeEntry {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached: boolean;
}

interface MutableWorktreeEntry {
  path?: string;
  head?: string;
  branch?: string;
  detached?: boolean;
}

const spawnWithBun: GitWorktreeSpawn = (options) => Bun.spawn(options);

const nodeFileSystem: GitWorktreeFileSystem = {
  async lstat(path) {
    try {
      return await lstat(path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  realpath,
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  readdir,
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error)) return "";
      throw error;
    }
  },
  async appendText(path, value) {
    await appendFile(path, value, "utf8");
  },
  async removeEmptyDirectory(path) {
    await rm(path, { recursive: false });
  },
};

function createReservations(): GitWorktreeReservations {
  const reserved = new Set<string>();
  return {
    reserve(id) {
      if (reserved.has(id)) return false;
      reserved.add(id);
      return true;
    },
    release(id) {
      reserved.delete(id);
    },
  };
}

function createOpaqueBindingId(): string {
  return `kw-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function createCardGitWorktrees(
  options: CreateCardGitWorktreesOptions = {},
): CardGitWorktrees {
  const spawn = options.spawn ?? spawnWithBun;
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const reservations = options.reservations ?? createReservations();
  const createBindingId = options.createBindingId ?? createOpaqueBindingId;
  const env = { ...process.env, ...options.env };

  return {
    async provision(input) {
      const inspected = await inspectRepository(
        spawn,
        fileSystem,
        env,
        input.trustedRepositoryPath,
      );
      if (inspected.status === "unavailable") return inspected;
      const prepared = await prepareManagedRoot(spawn, fileSystem, env, inspected.repository);
      if (prepared.status === "unavailable") return prepared;

      const parentBefore = await readParentSnapshot(spawn, env, inspected.repository.root);
      if (parentBefore === null) return unavailable("git_failed");

      for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
        const bindingId = createBindingId();
        if (!BINDING_ID_PATTERN.test(bindingId) || !reservations.reserve(bindingId)) continue;
        try {
          const result = await provisionReserved(
            spawn,
            fileSystem,
            env,
            inspected.repository,
            prepared.managedRoot,
            parentBefore,
            bindingId,
            input,
          );
          if (result.status === "collision") continue;
          return result;
        } finally {
          reservations.release(bindingId);
        }
      }
      return unavailable("collision");
    },

    async reconcile(binding, trustedRepositoryPath) {
      return verifyBinding(spawn, fileSystem, env, binding, trustedRepositoryPath);
    },

    async removeExplicit(binding, trustedRepositoryPath) {
      const verified = await verifyBinding(
        spawn,
        fileSystem,
        env,
        binding,
        trustedRepositoryPath,
      );
      if (verified.status === "unavailable") {
        return { status: "refused", reason: verified.reason };
      }
      try {
        const merged = await runGit(spawn, binding.repositoryRoot, env, [
          "merge-base",
          "--is-ancestor",
          binding.branch,
          binding.baselineBranch,
        ]);
        if (merged.exitCode === 1) return { status: "refused", reason: "unmerged" };
        if (merged.exitCode !== 0) return { status: "refused", reason: "unverified" };

        const removed = await runGit(spawn, binding.repositoryRoot, env, [
          "worktree",
          "remove",
          binding.worktreePath,
        ]);
        if (removed.exitCode !== 0) return { status: "failed", reason: "git_failed" };
        const deleted = await runGit(spawn, binding.repositoryRoot, env, [
          "branch",
          "-d",
          binding.branch,
        ]);
        return deleted.exitCode === 0
          ? { status: "removed" }
          : { status: "failed", reason: "git_failed" };
      } catch {
        return { status: "failed", reason: "git_failed" };
      }
    },

    async rollbackProvision(binding) {
      await rollbackOwnedWorktree(spawn, fileSystem, env, binding);
    },
  };
}

async function provisionReserved(
  spawn: GitWorktreeSpawn,
  fileSystem: GitWorktreeFileSystem,
  env: Record<string, string | undefined>,
  repository: RepositoryIdentity,
  managedRoot: string,
  parentBefore: ParentSnapshot,
  bindingId: string,
  input: ProvisionGitWorktreeInput,
): Promise<ProvisionGitWorktreeResult | { readonly status: "collision" }> {
  const worktreePath = resolve(managedRoot, bindingId);
  const branch = `kitten/card/${bindingId}`;
  const binding: CardWorktreeBinding = {
    bindingVersion: 1,
    bindingId,
    boardId: input.boardId,
    cardId: input.cardId,
    repositoryRoot: repository.root,
    repositoryGitDir: repository.gitDir,
    managedRoot,
    worktreePath,
    branch,
    baselineBranch: repository.branch,
    baselineCommit: repository.head,
    lifecycle: "active",
    reason: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  let addAttempted = false;

  try {
    if (dirname(worktreePath) !== managedRoot || basename(worktreePath) !== bindingId) {
      return unavailable("managed_root_invalid");
    }
    if (await fileSystem.lstat(worktreePath)) return { status: "collision" };

    const branchExists = await runGit(spawn, repository.root, env, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    if (branchExists.exitCode === 0) return { status: "collision" };
    if (branchExists.exitCode !== 1) return unavailable("git_failed");
    const beforeList = await listWorktrees(spawn, repository.root, env);
    if (beforeList === null) return unavailable("git_failed");
    if (beforeList.some((entry) => entry.path === worktreePath || entry.branch === branch)) {
      return { status: "collision" };
    }

    addAttempted = true;
    const added = await runGit(spawn, repository.root, env, [
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      repository.head,
    ]);
    if (added.exitCode !== 0) {
      await rollbackOwnedWorktree(spawn, fileSystem, env, binding);
      return unavailable("git_failed");
    }

    const verified = await verifyBinding(spawn, fileSystem, env, binding, repository.root);
    if (verified.status === "unavailable") {
      await rollbackOwnedWorktree(spawn, fileSystem, env, binding);
      return verified;
    }
    const parentAfter = await readParentSnapshot(spawn, env, repository.root);
    if (parentAfter === null || !sameParentSnapshot(parentBefore, parentAfter)) {
      await rollbackOwnedWorktree(spawn, fileSystem, env, binding);
      return unavailable("parent_changed");
    }
    return { status: "provisioned", binding };
  } catch {
    if (addAttempted) await rollbackOwnedWorktree(spawn, fileSystem, env, binding);
    return unavailable("git_failed");
  }
}

async function verifyBinding(
  spawn: GitWorktreeSpawn,
  fileSystem: GitWorktreeFileSystem,
  env: Record<string, string | undefined>,
  binding: CardWorktreeBinding,
  trustedRepositoryPath: string,
): Promise<ReconcileGitWorktreeResult> {
  if (!isBindingShape(binding)) return unavailable("unverified");
  if (binding.lifecycle === "removed") return unavailable("removed");

  const expectedRoot = resolve(binding.repositoryRoot, MANAGED_WORKTREE_ROOT_RELATIVE);
  const expectedPath = resolve(expectedRoot, binding.bindingId);
  if (binding.managedRoot !== expectedRoot || binding.worktreePath !== expectedPath) {
    return unavailable("external");
  }
  if (binding.branch !== `kitten/card/${binding.bindingId}`) {
    return unavailable("branch_mismatch");
  }

  try {
    const repository = await inspectRepository(spawn, fileSystem, env, trustedRepositoryPath);
    if (repository.status === "unavailable") return repository;
    if (
      repository.repository.root !== binding.repositoryRoot
      || repository.repository.gitDir !== binding.repositoryGitDir
    ) {
      return unavailable("repository_mismatch");
    }
    const pathSafety = await verifyPathSafety(
      fileSystem,
      binding.repositoryRoot,
      binding.worktreePath,
    );
    if (pathSafety !== null) return unavailable(pathSafety);

    const [canonicalRoot, canonicalManagedRoot, canonicalWorktree] = await Promise.all([
      fileSystem.realpath(binding.repositoryRoot),
      fileSystem.realpath(binding.managedRoot),
      fileSystem.realpath(binding.worktreePath),
    ]);
    if (
      canonicalRoot !== binding.repositoryRoot
      || canonicalManagedRoot !== binding.managedRoot
      || canonicalWorktree !== binding.worktreePath
      || !isContainedBy(canonicalRoot, canonicalManagedRoot)
      || !isContainedBy(canonicalManagedRoot, canonicalWorktree)
    ) {
      return unavailable("external");
    }

    const [repoTop, repoGitDir, treeTop, treeGitDir] = await Promise.all([
      runGit(spawn, binding.repositoryRoot, env, ["rev-parse", "--show-toplevel"]),
      runGit(spawn, binding.repositoryRoot, env, ["rev-parse", "--git-common-dir"]),
      runGit(spawn, binding.worktreePath, env, ["rev-parse", "--show-toplevel"]),
      runGit(spawn, binding.worktreePath, env, ["rev-parse", "--git-common-dir"]),
    ]);
    if ([repoTop, repoGitDir, treeTop, treeGitDir].some(({ exitCode }) => exitCode !== 0)) {
      return unavailable("unverified");
    }
    const reportedRepo = parseSingleLine(repoTop.stdout);
    const reportedRepoGitDir = parseSingleLine(repoGitDir.stdout);
    const reportedTree = parseSingleLine(treeTop.stdout);
    const reportedTreeGitDir = parseSingleLine(treeGitDir.stdout);
    if (!reportedRepo || !reportedRepoGitDir || !reportedTree || !reportedTreeGitDir) {
      return unavailable("unverified");
    }
    const [verifiedRepo, verifiedRepoGitDir, verifiedTree, verifiedTreeGitDir] = await Promise.all([
      fileSystem.realpath(reportedRepo),
      fileSystem.realpath(resolve(binding.repositoryRoot, reportedRepoGitDir)),
      fileSystem.realpath(reportedTree),
      fileSystem.realpath(resolve(binding.worktreePath, reportedTreeGitDir)),
    ]);
    if (
      verifiedRepo !== binding.repositoryRoot
      || verifiedTree !== binding.worktreePath
      || verifiedRepoGitDir !== binding.repositoryGitDir
      || verifiedTreeGitDir !== binding.repositoryGitDir
    ) {
      return unavailable("repository_mismatch");
    }

    const entries = await listWorktrees(spawn, binding.repositoryRoot, env);
    if (entries === null) return unavailable("unverified");
    const parentEntry = entries.find((entry) => entry.path === binding.repositoryRoot);
    const worktreeEntry = entries.find((entry) => entry.path === binding.worktreePath);
    if (!parentEntry || !worktreeEntry) return unavailable("missing");
    if (worktreeEntry.detached) return unavailable("detached");
    if (worktreeEntry.branch !== binding.branch) return unavailable("branch_mismatch");

    const [symbolicBranch, actualHead, branchHead, baselineCommit, baselineBranch, ancestry] =
      await Promise.all([
        runGit(spawn, binding.worktreePath, env, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
        runGit(spawn, binding.worktreePath, env, ["rev-parse", "--verify", "HEAD^{commit}"]),
        runGit(spawn, binding.repositoryRoot, env, [
          "rev-parse",
          "--verify",
          `${binding.branch}^{commit}`,
        ]),
        runGit(spawn, binding.repositoryRoot, env, [
          "rev-parse",
          "--verify",
          `${binding.baselineCommit}^{commit}`,
        ]),
        runGit(spawn, binding.repositoryRoot, env, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${binding.baselineBranch}`,
        ]),
        runGit(spawn, binding.repositoryRoot, env, [
          "merge-base",
          "--is-ancestor",
          binding.baselineCommit,
          binding.branch,
        ]),
      ]);
    if (symbolicBranch.exitCode !== 0) return unavailable("detached");
    if (
      parseSingleLine(symbolicBranch.stdout) !== binding.branch
      || actualHead.exitCode !== 0
      || branchHead.exitCode !== 0
      || !worktreeEntry.head
      || parseSha(actualHead.stdout) !== worktreeEntry.head
      || parseSha(branchHead.stdout) !== worktreeEntry.head
    ) {
      return unavailable("branch_mismatch");
    }
    if (
      baselineCommit.exitCode !== 0
      || baselineBranch.exitCode !== 0
      || parseSha(baselineCommit.stdout) !== binding.baselineCommit
    ) {
      return unavailable("baseline_mismatch");
    }
    if (ancestry.exitCode === 1) return unavailable("divergent");
    if (ancestry.exitCode !== 0) return unavailable("unverified");

    const [repoIndex, worktreeIndex, status] = await Promise.all([
      runGit(spawn, binding.repositoryRoot, env, ["ls-files", "--stage", "-z"]),
      runGit(spawn, binding.worktreePath, env, ["ls-files", "--stage", "-z"]),
      runGit(spawn, binding.worktreePath, env, [
        "status",
        "--porcelain",
        "-z",
        "--untracked-files=all",
      ]),
    ]);
    if (repoIndex.exitCode !== 0 || worktreeIndex.exitCode !== 0 || status.exitCode !== 0) {
      return unavailable("unverified");
    }
    if (hasGitlink(repoIndex.stdout) || hasGitlink(worktreeIndex.stdout)) {
      return unavailable("gitlink");
    }
    if (status.stdout.byteLength !== 0) return unavailable("dirty");

    return {
      status: "available",
      binding: { ...binding, lifecycle: "active", reason: null },
    };
  } catch {
    return unavailable("unverified");
  }
}

async function inspectRepository(
  spawn: GitWorktreeSpawn,
  fileSystem: GitWorktreeFileSystem,
  env: Record<string, string | undefined>,
  trustedRepositoryPath: string,
): Promise<
  | { readonly status: "available"; readonly repository: RepositoryIdentity }
  | { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason }
> {
  try {
    if (!isAbsolute(trustedRepositoryPath)) return unavailable("not_git_repository");
    const top = await runGit(spawn, trustedRepositoryPath, env, ["rev-parse", "--show-toplevel"]);
    if (top.exitCode !== 0) return unavailable("not_git_repository");
    const reportedRoot = parseSingleLine(top.stdout);
    if (!reportedRoot || !isAbsolute(reportedRoot)) return unavailable("not_git_repository");
    const [root, trustedPath] = await Promise.all([
      fileSystem.realpath(reportedRoot),
      fileSystem.realpath(trustedRepositoryPath),
    ]);
    if (trustedPath !== root) return unavailable("repository_mismatch");
    const rootStat = await fileSystem.lstat(root);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return unavailable("symlink");

    const [branchResult, headResult, gitDirResult, indexResult] = await Promise.all([
      runGit(spawn, root, env, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      runGit(spawn, root, env, ["rev-parse", "--verify", "HEAD^{commit}"]),
      runGit(spawn, root, env, ["rev-parse", "--git-common-dir"]),
      runGit(spawn, root, env, ["ls-files", "--stage", "-z"]),
    ]);
    if (branchResult.exitCode !== 0) return unavailable("detached");
    if (headResult.exitCode !== 0 || gitDirResult.exitCode !== 0 || indexResult.exitCode !== 0) {
      return unavailable("git_failed");
    }
    if (hasGitlink(indexResult.stdout)) return unavailable("gitlink");
    const branch = parseSingleLine(branchResult.stdout);
    const head = parseSha(headResult.stdout);
    const reportedGitDir = parseSingleLine(gitDirResult.stdout);
    if (!branch || !isSafeRefName(branch) || !head || !reportedGitDir) {
      return unavailable("unverified");
    }
    const gitDir = await fileSystem.realpath(resolve(root, reportedGitDir));
    return { status: "available", repository: { root, gitDir, branch, head } };
  } catch {
    return unavailable("not_git_repository");
  }
}

async function prepareManagedRoot(
  spawn: GitWorktreeSpawn,
  fileSystem: GitWorktreeFileSystem,
  env: Record<string, string | undefined>,
  repository: RepositoryIdentity,
): Promise<
  | { readonly status: "available"; readonly managedRoot: string }
  | { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason }
> {
  const managedRoot = resolve(repository.root, MANAGED_WORKTREE_ROOT_RELATIVE);
  let createdRoot = false;
  try {
    const tracked = await runGit(spawn, repository.root, env, [
      "ls-files",
      "-z",
      "--",
      ".kitten/worktrees",
    ]);
    if (tracked.exitCode !== 0) return unavailable("git_failed");
    if (tracked.stdout.byteLength > 0) return unavailable("managed_root_invalid");
    const existingSafety = await verifyExistingAncestors(fileSystem, repository.root, managedRoot);
    if (existingSafety !== null) return unavailable(existingSafety);

    const excludeResult = await runGit(spawn, repository.root, env, [
      "rev-parse",
      "--git-path",
      "info/exclude",
    ]);
    const excludeValue = parseSingleLine(excludeResult.stdout);
    if (excludeResult.exitCode !== 0 || !excludeValue) return unavailable("git_failed");
    const excludePath = resolve(repository.root, excludeValue);
    const excludeDirectory = await fileSystem.realpath(dirname(excludePath));
    if (excludeDirectory !== resolve(repository.gitDir, "info") || basename(excludePath) !== "exclude") {
      return unavailable("managed_root_invalid");
    }
    const excludeText = await fileSystem.readText(excludePath);
    const excluded = hasExcludeEntry(excludeText);
    const rootStat = await fileSystem.lstat(managedRoot);
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
      return unavailable("managed_root_invalid");
    }
    if (rootStat && !excluded && (await fileSystem.readdir(managedRoot)).length > 0) {
      return unavailable("managed_root_invalid");
    }
    if (!rootStat) {
      await fileSystem.mkdir(managedRoot);
      createdRoot = true;
    }
    const safety = await verifyPathSafety(fileSystem, repository.root, managedRoot);
    if (safety !== null) {
      if (createdRoot) await removeOwnedEmptyRoot(fileSystem, managedRoot);
      return unavailable(safety);
    }
    const canonicalRoot = await fileSystem.realpath(managedRoot);
    if (canonicalRoot !== managedRoot || !isContainedBy(repository.root, canonicalRoot)) {
      if (createdRoot) await removeOwnedEmptyRoot(fileSystem, managedRoot);
      return unavailable("managed_root_invalid");
    }
    if (!excluded) {
      const separator = excludeText.length > 0 && !excludeText.endsWith("\n") ? "\n" : "";
      await fileSystem.appendText(excludePath, `${separator}${LOCAL_EXCLUDE_ENTRY}\n`);
    }
    return { status: "available", managedRoot: canonicalRoot };
  } catch {
    if (createdRoot) await removeOwnedEmptyRoot(fileSystem, managedRoot);
    return unavailable("git_failed");
  }
}

async function rollbackOwnedWorktree(
  spawn: GitWorktreeSpawn,
  fileSystem: GitWorktreeFileSystem,
  env: Record<string, string | undefined>,
  binding: CardWorktreeBinding,
): Promise<void> {
  try {
    const entries = await listWorktrees(spawn, binding.repositoryRoot, env);
    const owned = entries?.find((entry) => (
      entry.path === binding.worktreePath
      && entry.branch === binding.branch
      && entry.head === binding.baselineCommit
    ));
    if (!owned || !(await fileSystem.lstat(binding.worktreePath))) return;
    const status = await runGit(spawn, binding.worktreePath, env, [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
    ]);
    if (status.exitCode !== 0 || status.stdout.byteLength !== 0) return;
    const removed = await runGit(spawn, binding.repositoryRoot, env, [
      "worktree",
      "remove",
      binding.worktreePath,
    ]);
    if (removed.exitCode !== 0) return;
    await runGit(spawn, binding.repositoryRoot, env, ["branch", "-d", binding.branch]);
  } catch {
    // Uncertain or changed artifacts are retained for explicit operator review.
  }
}

async function readParentSnapshot(
  spawn: GitWorktreeSpawn,
  env: Record<string, string | undefined>,
  repositoryRoot: string,
): Promise<ParentSnapshot | null> {
  const [branch, head, status] = await Promise.all([
    runGit(spawn, repositoryRoot, env, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    runGit(spawn, repositoryRoot, env, ["rev-parse", "--verify", "HEAD^{commit}"]),
    runGit(spawn, repositoryRoot, env, [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
    ]),
  ]);
  const parsedBranch = parseSingleLine(branch.stdout);
  const parsedHead = parseSha(head.stdout);
  if (branch.exitCode !== 0 || head.exitCode !== 0 || status.exitCode !== 0 || !parsedBranch || !parsedHead) {
    return null;
  }
  return { branch: parsedBranch, head: parsedHead, status: status.stdout };
}

function sameParentSnapshot(left: ParentSnapshot, right: ParentSnapshot): boolean {
  return left.branch === right.branch
    && left.head === right.head
    && bytesEqual(left.status, right.status);
}

async function verifyExistingAncestors(
  fileSystem: GitWorktreeFileSystem,
  root: string,
  target: string,
): Promise<WorktreeUnavailableReason | null> {
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) return "external";
  let current = root;
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const stat = await fileSystem.lstat(current);
    if (stat === null) return null;
    if (stat.isSymbolicLink()) return "symlink";
    if (!stat.isDirectory()) return "managed_root_invalid";
  }
  return null;
}

async function verifyPathSafety(
  fileSystem: GitWorktreeFileSystem,
  root: string,
  target: string,
): Promise<WorktreeUnavailableReason | null> {
  const fromRoot = relative(root, target);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return "external";
  const rootStat = await fileSystem.lstat(root);
  if (!rootStat?.isDirectory()) return "missing";
  if (rootStat.isSymbolicLink()) return "symlink";
  let current = root;
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const stat = await fileSystem.lstat(current);
    if (stat === null) return "missing";
    if (stat.isSymbolicLink()) return "symlink";
    if (!stat.isDirectory()) return "external";
  }
  return null;
}

async function listWorktrees(
  spawn: GitWorktreeSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<readonly WorktreeEntry[] | null> {
  const result = await runGit(spawn, cwd, env, ["worktree", "list", "--porcelain", "-z"]);
  return result.exitCode === 0 ? parseWorktreeList(result.stdout) : null;
}

async function runGit(
  spawn: GitWorktreeSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
  args: readonly string[],
): Promise<GitResult> {
  const child = spawn({
    cmd: ["git", ...args],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
  ]);
  return { exitCode, stdout: new Uint8Array(stdout) };
}

function parseWorktreeList(bytes: Uint8Array): readonly WorktreeEntry[] | null {
  try {
    if (bytes.byteLength === 0) return [];
    const value = decoder.decode(bytes);
    if (!value.endsWith("\0")) return null;
    const entries: WorktreeEntry[] = [];
    let current: MutableWorktreeEntry = {};
    for (const field of value.slice(0, -1).split("\0")) {
      if (field === "") {
        if (!current.path) return null;
        entries.push({
          path: current.path,
          ...(current.head === undefined ? {} : { head: current.head }),
          ...(current.branch === undefined ? {} : { branch: current.branch }),
          detached: current.detached === true,
        });
        current = {};
      } else if (field.startsWith("worktree ")) {
        if (current.path) return null;
        current.path = field.slice("worktree ".length);
      } else if (field.startsWith("HEAD ")) {
        current.head = field.slice("HEAD ".length);
      } else if (field.startsWith("branch refs/heads/")) {
        current.branch = field.slice("branch refs/heads/".length);
      } else if (field === "detached") {
        current.detached = true;
      }
    }
    if (current.path) {
      entries.push({
        path: current.path,
        ...(current.head === undefined ? {} : { head: current.head }),
        ...(current.branch === undefined ? {} : { branch: current.branch }),
        detached: current.detached === true,
      });
    }
    return entries;
  } catch {
    return null;
  }
}

function parseSingleLine(bytes: Uint8Array): string | null {
  try {
    const value = decoder.decode(bytes).replace(/\r?\n$/u, "");
    return value && !value.includes("\n") && !value.includes("\0") ? value : null;
  } catch {
    return null;
  }
}

function parseSha(bytes: Uint8Array): string | null {
  const value = parseSingleLine(bytes);
  return value && SHA_PATTERN.test(value) ? value : null;
}

function hasGitlink(bytes: Uint8Array): boolean {
  try {
    return decoder.decode(bytes).split("\0").some((entry) => entry.startsWith("160000 "));
  } catch {
    return true;
  }
}

function hasExcludeEntry(value: string): boolean {
  return value.split(/\r?\n/u).some((line) => line.trim() === LOCAL_EXCLUDE_ENTRY);
}

function isContainedBy(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function removeOwnedEmptyRoot(
  fileSystem: GitWorktreeFileSystem,
  path: string,
): Promise<void> {
  try {
    if ((await fileSystem.readdir(path)).length === 0) await fileSystem.removeEmptyDirectory(path);
  } catch {
    // Preserve a path whose ownership or emptiness cannot be proven.
  }
}

function isBindingShape(binding: CardWorktreeBinding): boolean {
  return binding.bindingVersion === 1
    && BINDING_ID_PATTERN.test(binding.bindingId)
    && isAbsolute(binding.repositoryRoot)
    && isAbsolute(binding.repositoryGitDir)
    && isAbsolute(binding.managedRoot)
    && isAbsolute(binding.worktreePath)
    && isSafeRefName(binding.branch)
    && isSafeRefName(binding.baselineBranch)
    && SHA_PATTERN.test(binding.baselineCommit)
    && Number.isSafeInteger(binding.createdAt)
    && binding.createdAt >= 0
    && Number.isSafeInteger(binding.updatedAt)
    && binding.updatedAt >= binding.createdAt;
}

function isSafeRefName(value: string): boolean {
  return value.length > 0
    && !value.startsWith("-")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.includes("..")
    && !value.includes("@{")
    && !/[\x00-\x20\x7f~^:?*[\\]/u.test(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "ENOENT";
}

function unavailable(
  reason: WorktreeUnavailableReason,
): { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason } {
  return { status: "unavailable", reason };
}
