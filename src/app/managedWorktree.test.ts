// Suite: managed worktree provisioning
// Invariant: only a verified, contained, app-owned Git worktree may become a child binding.
// Boundary IN: injected Git/fs/id seams and temporary real repositories.
// Boundary OUT: controller registration, reconciliation, cleanup, persistence, and UI.

import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createManagedWorktreeProvisioner,
  type ManagedWorktreeSpawn,
  type ManagedWorktreeSpawnOptions,
} from "./managedWorktree.ts"

const encoder = new TextEncoder()

describe("managed worktree provisioner", () => {
  it("rejects a non-repository with a bounded reason", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kitten-worktree-nonrepo-"))
    try {
      const result = await createManagedWorktreeProvisioner().provision({
        parentCwd: cwd,
        ownerSessionId: "child-1",
      })

      expect(result).toEqual({ kind: "failed", reason: "not_git_repository" })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it("rejects detached HEAD and repositories without a committed HEAD", async () => {
    const uncommitted = await createRepository({ commit: false })
    const detached = await createRepository()
    try {
      expect(
        await provision(uncommitted.path, "kw-uncommitted"),
      ).toEqual({ kind: "failed", reason: "git_failed" })

      await runGit(detached.path, ["checkout", "--detach"])
      expect(await provision(detached.path, "kw-detached1")).toEqual({
        kind: "failed",
        reason: "detached_head",
      })
    } finally {
      await Promise.all([uncommitted.remove(), detached.remove()])
    }
  })

  it("rejects tracked gitlinks as unsupported submodules", async () => {
    const repository = await createRepository()
    try {
      const sha = await gitOutput(repository.path, ["rev-parse", "HEAD"])
      await runGit(repository.path, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${sha},vendor/child`,
      ])

      expect(await provision(repository.path, "kw-submodule")).toEqual({
        kind: "failed",
        reason: "submodules_unsupported",
      })
    } finally {
      await repository.remove()
    }
  })

  it("fails closed on a conflicting managed root", async () => {
    const repository = await createRepository()
    try {
      await mkdir(join(repository.path, ".kitten"))
      await writeFile(join(repository.path, ".kitten", "worktrees"), "user data\n")

      expect(await provision(repository.path, "kw-rootconf1")).toEqual({
        kind: "failed",
        reason: "root_conflict",
      })
      expect(await readFile(join(repository.path, ".kitten", "worktrees"), "utf8")).toBe(
        "user data\n",
      )
    } finally {
      await repository.remove()
    }
  })

  it("maps an injected worktree spawn failure without leaving a branch or path", async () => {
    const repository = await createRepository()
    const id = "kw-spawnfail"
    const spawn = interceptSpawn(({ cmd }) => {
      if (cmd[1] === "worktree" && cmd[2] === "add") throw new Error("spawn failed")
      return null
    })
    try {
      const result = await createManagedWorktreeProvisioner({ spawn, createId: () => id }).provision(
        { parentCwd: repository.path, ownerSessionId: "child-1" },
      )

      expect(result).toEqual({ kind: "failed", reason: "git_failed" })
      expect(await pathExists(join(repository.path, ".kitten", "worktrees", id))).toBe(false)
      expect(await branchExists(repository.path, `kitten/${id}`)).toBe(false)
    } finally {
      await repository.remove()
    }
  })

  it("preserves pre-existing collision artifacts and releases reservations", async () => {
    const repository = await createRepository()
    const id = "kw-collision"
    const reservations: string[] = []
    try {
      await mkdir(join(repository.path, ".kitten", "worktrees"), { recursive: true })
      await appendLocalExclude(repository.path)
      const collisionPath = join(repository.path, ".kitten", "worktrees", id)
      await writeFile(collisionPath, "pre-existing\n")

      const result = await createManagedWorktreeProvisioner({
        createId: () => id,
        reservations: {
          reserve(value) {
            reservations.push(`reserve:${value}`)
            return true
          },
          release(value) {
            reservations.push(`release:${value}`)
          },
        },
      }).provision({ parentCwd: repository.path, ownerSessionId: "child-1" })

      expect(result).toEqual({ kind: "failed", reason: "collision" })
      expect(await readFile(collisionPath, "utf8")).toBe("pre-existing\n")
      expect(reservations.filter((entry) => entry.startsWith("reserve:"))).toHaveLength(8)
      expect(reservations.filter((entry) => entry.startsWith("release:"))).toHaveLength(8)
    } finally {
      await repository.remove()
    }
  })

  it("rejects an authoritative-list mismatch and rolls back its clean owned artifacts", async () => {
    const repository = await createRepository()
    const id = "kw-badverify"
    const target = join(repository.path, ".kitten", "worktrees", id)
    let listCalls = 0
    const commands: string[][] = []
    const spawn = interceptSpawn((options) => {
      commands.push(options.cmd)
      if (options.cmd.slice(1).join(" ") === "worktree list --porcelain -z") {
        listCalls += 1
        if (listCalls === 2) {
          return processResult(
            worktreePorcelain([
              { path: repository.path, head: repository.sha, branch: "main" },
              { path: target, head: "0".repeat(40), branch: `kitten/${id}` },
            ]),
          )
        }
      }
      return null
    })
    try {
      const result = await createManagedWorktreeProvisioner({ spawn, createId: () => id }).provision(
        { parentCwd: repository.path, ownerSessionId: "child-1" },
      )

      expect(result).toEqual({ kind: "failed", reason: "verification_failed" })
      expect(await pathExists(target)).toBe(false)
      expect(await branchExists(repository.path, `kitten/${id}`)).toBe(false)
      expect(commands).toContainEqual(["git", "worktree", "remove", target])
      expect(commands).toContainEqual(["git", "branch", "-d", `kitten/${id}`])
    } finally {
      await repository.remove()
    }
  })

  it("retains owned artifacts when verification fails after the worktree becomes dirty", async () => {
    const repository = await createRepository()
    const id = "kw-dirtyfail"
    const target = join(repository.path, ".kitten", "worktrees", id)
    let listCalls = 0
    const spawn = interceptSpawn((options) => {
      if (options.cmd.slice(1).join(" ") === "worktree list --porcelain -z") {
        listCalls += 1
        if (listCalls === 2) {
          Bun.write(join(target, "dirty.txt"), "preserve me\n")
          return processResult(
            worktreePorcelain([
              { path: repository.path, head: repository.sha, branch: "main" },
              { path: target, head: "0".repeat(40), branch: `kitten/${id}` },
            ]),
          )
        }
      }
      return null
    })
    try {
      const result = await createManagedWorktreeProvisioner({ spawn, createId: () => id }).provision(
        { parentCwd: repository.path, ownerSessionId: "child-1" },
      )

      expect(result).toEqual({ kind: "failed", reason: "verification_failed" })
      expect(await readFile(join(target, "dirty.txt"), "utf8")).toBe("preserve me\n")
      expect(await branchExists(repository.path, `kitten/${id}`)).toBe(true)
    } finally {
      await repository.remove()
    }
  })

  it("creates two verified siblings without changing parent checkout or project status", async () => {
    const repository = await createRepository()
    const ids = ["kw-sibling01", "kw-sibling02"]
    let nextId = 0
    try {
      const beforeHead = await gitOutput(repository.path, ["rev-parse", "HEAD"])
      const beforeBranch = await gitOutput(repository.path, ["branch", "--show-current"])
      const provisioner = createManagedWorktreeProvisioner({
        createId: () => ids[nextId++] ?? "kw-unexpected",
      })

      const [first, second] = await Promise.all([
        provisioner.provision({ parentCwd: repository.path, ownerSessionId: "child-1" }),
        provisioner.provision({ parentCwd: repository.path, ownerSessionId: "child-2" }),
      ])

      expect(first.kind).toBe("provisioned")
      expect(second.kind).toBe("provisioned")
      if (first.kind !== "provisioned" || second.kind !== "provisioned") return

      expect(first.binding.id).not.toBe(second.binding.id)
      expect(first.binding.worktreePath).toStartWith(
        `${join(repository.path, ".kitten", "worktrees")}/`,
      )
      expect(second.binding.worktreePath).toStartWith(
        `${join(repository.path, ".kitten", "worktrees")}/`,
      )
      expect(first.binding.baseSha).toBe(beforeHead)
      expect(second.binding.baseSha).toBe(beforeHead)
      expect(await gitOutput(repository.path, ["rev-parse", "HEAD"])).toBe(beforeHead)
      expect(await gitOutput(repository.path, ["branch", "--show-current"])).toBe(beforeBranch)
      expect(await gitOutput(repository.path, ["status", "--porcelain", "--untracked-files=all"])).toBe(
        "",
      )
      expect(await gitOutput(repository.path, ["check-ignore", ".kitten/worktrees"])).toBe(
        ".kitten/worktrees",
      )

      const excludePath = await gitOutput(repository.path, [
        "rev-parse",
        "--git-path",
        "info/exclude",
      ])
      expect(await readFile(join(repository.path, excludePath), "utf8")).toContain(
        ".kitten/worktrees/",
      )
    } finally {
      await repository.remove()
    }
  })
})

async function provision(path: string, id: string) {
  return createManagedWorktreeProvisioner({ createId: () => id }).provision({
    parentCwd: path,
    ownerSessionId: "child-1",
  })
}

function interceptSpawn(
  intercept: (options: ManagedWorktreeSpawnOptions) => ReturnType<ManagedWorktreeSpawn> | null,
): ManagedWorktreeSpawn {
  return (options) => intercept(options) ?? Bun.spawn(options)
}

function processResult(stdout: string, exitCode = 0): ReturnType<ManagedWorktreeSpawn> {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(encoder.encode(stdout)).body!,
  }
}

function worktreePorcelain(
  entries: readonly { readonly path: string; readonly head: string; readonly branch: string }[],
): string {
  return entries
    .map(
      (entry) =>
        `worktree ${entry.path}\0HEAD ${entry.head}\0branch refs/heads/${entry.branch}\0\0`,
    )
    .join("")
}

async function createRepository(options: { readonly commit?: boolean } = {}): Promise<{
  readonly path: string
  readonly sha: string
  remove(): Promise<void>
}> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "kitten-managed-worktree-")))
  await runGit(path, ["init", "-b", "main"])
  let sha = ""
  if (options.commit !== false) {
    await writeFile(join(path, "README.md"), "# managed worktree fixture\n")
    await runGit(path, ["add", "README.md"])
    await runGit(path, [
      "-c",
      "user.name=Kitten Test",
      "-c",
      "user.email=kitten@example.test",
      "commit",
      "-m",
      "initial",
    ])
    sha = await gitOutput(path, ["rev-parse", "HEAD"])
  }
  return {
    path,
    sha,
    async remove() {
      await rm(path, { recursive: true, force: true })
    },
  }
}

async function appendLocalExclude(repository: string): Promise<void> {
  const excludePath = await gitOutput(repository, ["rev-parse", "--git-path", "info/exclude"])
  const current = await readFile(join(repository, excludePath), "utf8")
  await writeFile(join(repository, excludePath), `${current}\n.kitten/worktrees/\n`)
}

async function branchExists(repository: string, branch: string): Promise<boolean> {
  return runGit(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], true)
}

async function pathExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...processEnv() },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git failed: ${stderr.trim()}`)
  return stdout.trim()
}

async function runGit(cwd: string, args: readonly string[], allowFailure = false): Promise<boolean> {
  const process = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...processEnv() },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  })
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0 && !allowFailure) throw new Error(`git failed: ${stderr.trim()}`)
  return exitCode === 0
}

function processEnv(): Record<string, string | undefined> {
  return { ...process.env }
}
