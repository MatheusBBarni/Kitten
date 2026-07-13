import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  artifactName,
  compileCommand,
  hostTarget,
  writePlatformPackage,
} from "../scripts/build.ts"
import pkg from "../package.json" with { type: "json" }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

describe("local npm launcher install", () => {
  it("packs the shim and host package, installs them, and runs under Node without Bun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-npm-launcher-"))
    try {
      const target = hostTarget()
      const buildDir = join(dir, "build")
      const packageDir = join(dir, "platform-packages")
      const tarballDir = join(dir, "tarballs")
      const installDir = join(dir, "install")
      await Promise.all([mkdir(buildDir), mkdir(tarballDir), mkdir(installDir)])

      const build = run(compileCommand(target, { outDir: buildDir }), REPO_ROOT)
      if (build.exitCode !== 0) throw commandError("host compile", build)

      const outfile = join(buildDir, artifactName(target))
      const platformPackage = await writePlatformPackage(
        { target, outfile, sha256: "unused" },
        pkg.version,
        packageDir,
      )

      const shimTarball = pack(REPO_ROOT, tarballDir)
      const platformTarball = pack(platformPackage.dir, tarballDir)

      await Bun.write(join(installDir, "package.json"), '{"name":"kitten-local-install","private":true}\n')
      const install = run(
        ["npm", "install", "--no-audit", "--no-fund", platformTarball, shimTarball],
        installDir,
      )
      if (install.exitCode !== 0) throw commandError("local npm install", install)

      const launcher = join(installDir, "node_modules", "kitten", "bin", "kitten.mjs")
      const installedBins = await readdir(join(installDir, "node_modules", ".bin"))
      expect(installedBins).toContain("kitten")

      const version = run(["node", launcher, "--version"], REPO_ROOT)
      expect(version.exitCode).toBe(0)
      expect(version.stdout).toBe(`${pkg.version}\n`)
      expect(version.stderr).toBe("")

      const selfCheck = run(["node", launcher, "--self-check"], REPO_ROOT)
      if (selfCheck.exitCode !== 0) throw commandError("installed self-check", selfCheck)
      expect(selfCheck.stdout).toContain("SELF-CHECK OK")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})

function pack(source: string, destination: string): string {
  const result = run(["npm", "pack", source, "--pack-destination", destination, "--json"], REPO_ROOT)
  if (result.exitCode !== 0) throw commandError(`npm pack ${source}`, result)
  const report = JSON.parse(result.stdout) as { filename: string }[]
  return join(destination, report[0]!.filename)
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function run(argv: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  }
}

function commandError(label: string, result: CommandResult): Error {
  return new Error(`${label} failed (${result.exitCode}):\n${result.stderr}\n${result.stdout}`)
}
