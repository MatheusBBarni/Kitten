import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compileCommand, type BuildTarget } from "../scripts/build.ts"
import { SELF_CHECK_DIFF_TOKEN, SELF_CHECK_MARKDOWN_TOKEN } from "../src/app/selfCheck.ts"
import pkg from "../package.json" with { type: "json" }

/**
 * The ADR-006 acceptance test: a real `bun build --compile` artifact must boot
 * headlessly, load config, and reach the cockpit frame without a native crash. It is
 * compiled for the host target (cross-targets are validated per platform in CI) and
 * driven through the `--self-check` mode, which mounts the cockpit into an in-memory
 * renderer - exercising OpenTUI's native core and its embedded tree-sitter worker end
 * to end in the compiled binary. The in-process self-check rejects unless its known
 * Markdown and diff tokens have non-default foreground spans.
 */
describe("compiled artifact self-check (ADR-006)", () => {
  it("compiles for the host and reaches the cockpit frame headlessly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-artifact-"))
    const outfile = join(dir, "kitten")
    try {
      const hostTarget: BuildTarget = { platform: "host", bunTarget: `bun-${process.platform}-${process.arch}` }
      // Reuse the release build's own command shape, minus the cross `--target` (host build).
      const command = compileCommand(hostTarget, { outDir: dir }).filter((arg) => !arg.startsWith("--target="))
      const rebuilt = command.map((arg) => (arg === `${dir}/kitten-host` ? outfile : arg))

      const build = Bun.spawnSync(rebuilt, { stdout: "pipe", stderr: "pipe" })
      expect(build.exitCode).toBe(0)

      const run = Bun.spawnSync([outfile, "--self-check"], { stdout: "pipe", stderr: "pipe" })
      const stdout = run.stdout.toString()
      const stderr = run.stderr.toString()
      if (run.exitCode !== 0) throw new Error(`compiled self-check failed:\n${stderr}`)
      expect(run.exitCode).toBe(0)
      expect(stdout).toContain("SELF-CHECK OK")
      expect(stdout).toContain("Kitten")
      expect(stdout).toContain(SELF_CHECK_MARKDOWN_TOKEN)
      expect(stdout).toContain(SELF_CHECK_DIFF_TOKEN)

      const versionRun = Bun.spawnSync([outfile, "--version"], { stdout: "pipe", stderr: "pipe" })
      expect(versionRun.exitCode).toBe(0)
      expect(versionRun.stdout.toString()).toBe(`${pkg.version}\n`)
      expect(versionRun.stderr.toString()).toBe("")

      const helpRun = Bun.spawnSync([outfile, "--help"], { stdout: "pipe", stderr: "pipe" })
      expect(helpRun.exitCode).toBe(0)
      expect(helpRun.stdout.toString()).toStartWith("Examples:\n")
      expect(helpRun.stdout.toString()).toContain("npx kitten")
      expect(helpRun.stdout.toString()).toContain("--self-check")
      expect(helpRun.stderr.toString()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
