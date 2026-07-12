// Suite: git branch reader
// Invariant: a cwd resolves to its displayable git branch identity or null without throwing.
// Boundary IN: git subprocess command selection, output parsing, and fail-soft behavior.
// Boundary OUT: store updates and refresh timing, owned by task 09.

import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readGitBranch, type GitSpawn, type GitSpawnOptions } from "./gitBranch.ts"

function processResult(stdout: string, exitCode = 0) {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(stdout).body!,
  }
}

describe("readGitBranch", () => {
  it("should return the attached branch and spawn git in the requested cwd", async () => {
    const calls: GitSpawnOptions[] = []
    const spawn: GitSpawn = (options) => {
      calls.push(options)
      return processResult("main\n")
    }

    const branch = await readGitBranch("/work/repo", {
      spawn,
      env: { KITTEN_GIT_TEST: "1" },
    })

    expect(branch).toBe("main")
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: "/work/repo",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
    expect(calls[0]?.env.KITTEN_GIT_TEST).toBe("1")
  })

  it("should return a short SHA when HEAD is detached", async () => {
    const calls: GitSpawnOptions[] = []
    const results = [processResult("HEAD\n"), processResult("a1b2c3d\n")]
    const spawn: GitSpawn = (options) => {
      calls.push(options)
      const result = results.shift()
      if (!result) throw new Error("unexpected spawn")
      return result
    }

    expect(await readGitBranch("/work/repo", { spawn })).toBe("a1b2c3d")
    expect(calls.map(({ cmd }) => cmd)).toEqual([
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      ["git", "rev-parse", "--short", "HEAD"],
    ])
  })

  it("should return null when git reports a non-repository", async () => {
    const spawn: GitSpawn = () => processResult("", 128)

    expect(await readGitBranch("/work/not-a-repo", { spawn })).toBeNull()
  })

  it("should return null when the detached-HEAD fallback exits non-zero", async () => {
    const results = [processResult("HEAD\n"), processResult("", 1)]
    const spawn: GitSpawn = () => {
      const result = results.shift()
      if (!result) throw new Error("unexpected spawn")
      return result
    }

    expect(await readGitBranch("/work/repo", { spawn })).toBeNull()
  })

  it("should return null when spawning throws", async () => {
    const spawn: GitSpawn = () => {
      throw new Error("git is unavailable")
    }

    await expect(readGitBranch("/work/repo", { spawn })).resolves.toBeNull()
  })

  it("should return null when stdout cannot be read", async () => {
    const spawn: GitSpawn = () => ({
      exited: Promise.resolve(0),
      stdout: new ReadableStream({
        start(controller) {
          controller.error(new Error("closed stream"))
        },
      }),
    })

    await expect(readGitBranch("/work/repo", { spawn })).resolves.toBeNull()
  })

  it("should report the checked-out branch in a real temporary repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kitten-git-branch-"))
    try {
      await runGit(cwd, ["init"])
      await runGit(cwd, ["checkout", "-b", "integration-branch"])
      await Bun.write(join(cwd, "README.md"), "# temporary repository\n")
      await runGit(cwd, ["add", "README.md"])
      await runGit(cwd, [
        "-c",
        "user.name=Kitten Test",
        "-c",
        "user.email=kitten@example.test",
        "commit",
        "-m",
        "initial",
      ])

      expect(await readGitBranch(cwd)).toBe("integration-branch")
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  })
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`)
}
