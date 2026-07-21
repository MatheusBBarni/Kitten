import { describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
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

const TUI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

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

      const build = run(compileCommand(target, { outDir: buildDir }), TUI_ROOT)
      if (build.exitCode !== 0) throw commandError("host compile", build)

      const outfile = join(buildDir, artifactName(target))
      const platformPackage = await writePlatformPackage(
        { target, outfile, sha256: "unused" },
        pkg.version,
        packageDir,
      )

      const shimTarball = pack(TUI_ROOT, tarballDir)
      const platformTarball = pack(platformPackage.dir, tarballDir)

      await Bun.write(join(installDir, "package.json"), '{"name":"kitten-local-install","private":true}\n')
      const install = run(
        ["npm", "install", "--no-audit", "--no-fund", platformTarball, shimTarball],
        installDir,
      )
      if (install.exitCode !== 0) throw commandError("local npm install", install)

      const launcher = join(installDir, "node_modules", "@matheusbbarni", "kitten", "bin", "kitten.mjs")
      const installedBins = await readdir(join(installDir, "node_modules", ".bin"))
      expect(installedBins).toContain("kitten")

      const version = run(["node", launcher, "--version"], TUI_ROOT)
      expect(version.exitCode).toBe(0)
      expect(version.stdout).toBe(`${pkg.version}\n`)
      expect(version.stderr).toBe("")

      const selfCheck = run(["node", launcher, "--self-check"], TUI_ROOT)
      if (selfCheck.exitCode !== 0) throw commandError("installed self-check", selfCheck)
      expect(selfCheck.stdout).toContain("SELF-CHECK OK")

      const fakeBin = join(dir, "help-fake-bin")
      const installLog = join(dir, "help-install.log")
      await mkdir(fakeBin)
      await writeFile(join(fakeBin, "npm"), FAKE_NPM_SOURCE)
      await chmod(join(fakeBin, "npm"), 0o755)
      const help = run(["node", launcher, "--help"], TUI_ROOT, {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        FAKE_NPM_INSTALL_LOG: installLog,
      })
      expect(help.exitCode).toBe(0)
      expect(help.stdout).toStartWith("Examples:\n")
      expect(help.stdout).toContain("kitten --update")
      expect(help.stdout).toContain("npm install --global @matheusbbarni/kitten@latest")
      expect(help.stdout).toContain(
        "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash",
      )
      expect(help.stderr).toBe("")
      expect(await readIfPresent(installLog)).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)

  it("refuses a packed local launcher without invoking fake npm install", async () => {
    const fixture = await packedUpdateFixture("local")
    try {
      const update = run(["node", fixture.launcher, "--update"], TUI_ROOT, fixture.environment)

      expect(update.exitCode).toBe(1)
      expect(update.stderr).toContain("Kitten update refused:")
      expect(update.stderr).toContain("No change occurred.")
      expect(await readIfPresent(fixture.installLog)).toBe("")
    } finally {
      await fixture.cleanup()
    }
  }, 60_000)

  it("refuses a packed npx-shaped launcher without invoking fake npm install", async () => {
    const fixture = await packedUpdateFixture("npx")
    try {
      const update = run(["node", fixture.launcher, "--update"], TUI_ROOT, fixture.environment)

      expect(update.exitCode).toBe(1)
      expect(update.stderr).toContain("Kitten update refused:")
      expect(update.stderr).toContain("npm install --global @matheusbbarni/kitten@latest")
      expect(await readIfPresent(fixture.installLog)).toBe("")
    } finally {
      await fixture.cleanup()
    }
  }, 60_000)

  it("updates a packed global launcher through only the exact npm install argv", async () => {
    const resultVersion = "9.9.9"
    const fixture = await packedUpdateFixture("global", resultVersion)
    try {
      const update = run(["node", fixture.launcher, "--update"], TUI_ROOT, fixture.environment)

      expect(update.exitCode).toBe(0)
      expect(update.stdout).toBe(`Kitten updated via npm: ${pkg.version} -> ${resultVersion}.\n`)
      expect(update.stderr).toBe("")
      expect(await readIfPresent(fixture.installLog)).toBe(
        '["install","--global","@matheusbbarni/kitten@latest"]\n',
      )
    } finally {
      await fixture.cleanup()
    }
  }, 60_000)

  it("reports an unchanged packed global launcher as already current", async () => {
    const fixture = await packedUpdateFixture("global", pkg.version)
    try {
      const update = run(["node", fixture.launcher, "--update"], TUI_ROOT, fixture.environment)

      expect(update.exitCode).toBe(0)
      expect(update.stdout).toBe(
        `Kitten is already current via npm at version ${pkg.version}.\nNo change occurred.\n`,
      )
      expect(update.stderr).toBe("")
      expect(await readIfPresent(fixture.installLog)).toBe(
        '["install","--global","@matheusbbarni/kitten@latest"]\n',
      )
    } finally {
      await fixture.cleanup()
    }
  }, 60_000)
})

type UpdateLayout = "local" | "npx" | "global"

interface PackedUpdateFixture {
  launcher: string
  installLog: string
  environment: Record<string, string | undefined>
  cleanup(): Promise<void>
}

async function packedUpdateFixture(layout: UpdateLayout, resultVersion?: string): Promise<PackedUpdateFixture> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-npm-update-"))
  try {
    const target = hostTarget()
    const buildDir = join(dir, "build")
    const packageDir = join(dir, "platform-packages")
    const tarballDir = join(dir, "tarballs")
    const fakeGlobalPrefix = join(dir, "fake-global")
    const fakeGlobalRoot = join(fakeGlobalPrefix, "lib", "node_modules")
    const fakeBin = join(dir, "fake-bin")
    const installLog = join(dir, "install.log")
    await Promise.all([
      mkdir(buildDir),
      mkdir(tarballDir),
      mkdir(fakeGlobalRoot, { recursive: true }),
      mkdir(fakeBin),
    ])

    const outfile = join(buildDir, artifactName(target))
    await writeFile(outfile, "#!/usr/bin/env node\nprocess.exit(99)\n")
    await chmod(outfile, 0o755)
    const platformPackage = await writePlatformPackage(
      { target, outfile, sha256: "unused" },
      pkg.version,
      packageDir,
    )
    const shimTarball = pack(TUI_ROOT, tarballDir)
    const platformTarball = pack(platformPackage.dir, tarballDir)

    const installDir =
      layout === "global"
        ? fakeGlobalPrefix
        : layout === "npx"
          ? join(dir, ".npm", "_npx", "fixture")
          : join(dir, "local-project")
    await mkdir(installDir, { recursive: true })

    const installArgv = layout === "global"
      ? ["npm", "install", "--global", "--prefix", installDir, "--no-audit", "--no-fund", platformTarball, shimTarball]
      : ["npm", "install", "--no-audit", "--no-fund", platformTarball, shimTarball]
    if (layout !== "global") {
      await writeFile(join(installDir, "package.json"), '{"name":"kitten-fixture","private":true}\n')
    }
    const install = run(installArgv, installDir)
    if (install.exitCode !== 0) throw commandError(`${layout} fixture install`, install)

    const packageBase = layout === "global" ? fakeGlobalRoot : join(installDir, "node_modules")
    const launcher = join(packageBase, "@matheusbbarni", "kitten", "bin", "kitten.mjs")
    const fakeNpm = join(fakeBin, "npm")
    await writeFile(fakeNpm, FAKE_NPM_SOURCE)
    await chmod(fakeNpm, 0o755)

    return {
      launcher,
      installLog,
      environment: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        FAKE_NPM_ROOT: fakeGlobalRoot,
        FAKE_NPM_INSTALL_LOG: installLog,
        FAKE_NPM_RESULT_VERSION: resultVersion,
        FAKE_NPM_PLATFORM_MANIFEST: join(
          fakeGlobalRoot,
          "@matheusbbarni",
          `kitten-${target.platform}`,
          "package.json",
        ),
      },
      cleanup: () => rm(dir, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

const FAKE_NPM_SOURCE = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
const argv = process.argv.slice(2)
if (JSON.stringify(argv) === JSON.stringify(["root", "--global"])) {
  process.stdout.write(process.env.FAKE_NPM_ROOT + "\\n")
  process.exit(0)
}
if (JSON.stringify(argv) === JSON.stringify(["install", "--global", "@matheusbbarni/kitten@latest"])) {
  appendFileSync(process.env.FAKE_NPM_INSTALL_LOG, JSON.stringify(argv) + "\\n")
  const manifestPath = join(process.env.FAKE_NPM_ROOT, "@matheusbbarni", "kitten", "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest.version = process.env.FAKE_NPM_RESULT_VERSION || manifest.version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\\n")
  const platformManifest = JSON.parse(readFileSync(process.env.FAKE_NPM_PLATFORM_MANIFEST, "utf8"))
  platformManifest.version = process.env.FAKE_NPM_RESULT_VERSION || platformManifest.version
  writeFileSync(process.env.FAKE_NPM_PLATFORM_MANIFEST, JSON.stringify(platformManifest, null, 2) + "\\n")
  process.exit(0)
}
process.exit(64)
`

async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  }
}

function pack(source: string, destination: string): string {
  const result = run(["npm", "pack", source, "--pack-destination", destination, "--json"], TUI_ROOT)
  if (result.exitCode !== 0) throw commandError(`npm pack ${source}`, result)
  const report = JSON.parse(result.stdout) as { filename: string }[]
  return join(destination, report[0]!.filename)
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

function run(argv: string[], cwd: string, env?: Record<string, string | undefined>): CommandResult {
  const result = Bun.spawnSync(argv, { cwd, env, stdout: "pipe", stderr: "pipe" })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  }
}

function commandError(label: string, result: CommandResult): Error {
  return new Error(`${label} failed (${result.exitCode}):\n${result.stderr}\n${result.stdout}`)
}
