import { describe, expect, it } from "bun:test"
import { chmod, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  artifactName,
  compileCommand,
  hostTarget,
  writePlatformPackage,
  type BuildTarget,
} from "../scripts/build.ts"
import {
  SELF_CHECK_DEFAULT_TOKEN,
  SELF_CHECK_EXPECTED_FIXTURES,
  SELF_CHECK_MISSING_EVIDENCE_ENV,
  SELF_CHECK_UNKNOWN_TOKEN,
  selfCheckEvidenceKey,
} from "../src/app/selfCheck.ts"
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
      const hostBuildTarget: BuildTarget = { platform: "host", bunTarget: `bun-${process.platform}-${process.arch}` }
      // Reuse the release build's own command shape, minus the cross `--target` (host build).
      const command = compileCommand(hostBuildTarget, { outDir: dir }).filter((arg) => !arg.startsWith("--target="))
      const rebuilt = command.map((arg) => (arg === `${dir}/kitten-host` ? outfile : arg))

      const build = Bun.spawnSync(rebuilt, { stdout: "pipe", stderr: "pipe" })
      expect(build.exitCode).toBe(0)

      const run = Bun.spawnSync([outfile, "--self-check"], { stdout: "pipe", stderr: "pipe" })
      const stdout = run.stdout.toString()
      const stderr = run.stderr.toString()
      if (run.exitCode !== 0) throw new Error(`compiled self-check failed:\n${stderr}`)
      expect(run.exitCode).toBe(0)
      expect(stdout).toContain("SELF-CHECK OK")
      expect(stdout).toContain(SELF_CHECK_DEFAULT_TOKEN)
      for (const { token } of SELF_CHECK_EXPECTED_FIXTURES) expect(stdout).toContain(token)
      expect(stdout).toContain(SELF_CHECK_UNKNOWN_TOKEN)

      const missingFixture = SELF_CHECK_EXPECTED_FIXTURES.find(
        ({ capability, label, source }) => capability === "rust" && label === "rust" && source === "markdown",
      )!
      const missingRun = Bun.spawnSync([outfile, "--self-check"], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          [SELF_CHECK_MISSING_EVIDENCE_ENV]: selfCheckEvidenceKey(missingFixture),
        },
      })
      const missingStderr = missingRun.stderr.toString()
      expect(missingRun.exitCode).not.toBe(0)
      expect(missingStderr).toContain('capability "rust" on markdown surface')
      expect(missingStderr).not.toContain(missingFixture.token)
      expect(missingStderr).not.toContain(missingFixture.content)

      const versionRun = Bun.spawnSync([outfile, "--version"], { stdout: "pipe", stderr: "pipe" })
      expect(versionRun.exitCode).toBe(0)
      expect(versionRun.stdout.toString()).toBe(`${pkg.version}\n`)
      expect(versionRun.stderr.toString()).toBe("")

      const helpRun = Bun.spawnSync([outfile, "--help"], { stdout: "pipe", stderr: "pipe" })
      expect(helpRun.exitCode).toBe(0)
      expect(helpRun.stdout.toString()).toStartWith("Examples:\n")
      expect(helpRun.stdout.toString()).toContain("npx @matheusbbarni/kitten")
      expect(helpRun.stdout.toString()).toContain("--self-check")
      expect(helpRun.stderr.toString()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  it("generates a resolvable host platform package with the compiled binary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-host-package-"))
    try {
      const target = hostTarget()
      const outfile = join(dir, artifactName(target))
      await Bun.write(outfile, "host-binary")
      await chmod(outfile, 0o755)

      const generated = await writePlatformPackage(
        { target, outfile, sha256: "unused" },
        pkg.version,
        join(dir, "npm"),
      )
      const manifest = (await Bun.file(join(generated.dir, "package.json")).json()) as {
        name: string
        version: string
        files: string[]
      }
      const binary = join(generated.dir, manifest.files[0]!)

      expect(manifest.name).toBe(`@matheusbbarni/kitten-${target.platform}`)
      expect(manifest.version).toBe(pkg.version)
      expect(await Bun.file(binary).exists()).toBe(true)
      expect(await Bun.file(binary).text()).toBe("host-binary")
      expect((await stat(binary)).mode & 0o777).toBe(0o755)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
