import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  resolveHostArtifact,
  resolveStandaloneRegistryPath,
  type StandaloneInstallationRegistry,
} from "../src/update.ts"
import { KITTEN_VERSION } from "../src/version.ts"

/**
 * The installer is exercised by sourcing it (its `BASH_SOURCE`/`$0` guard keeps
 * `main` from running on source) and calling its functions directly, so the
 * safety-critical checksum verification is tested without any network download.
 */
const INSTALLER = join(import.meta.dir, "..", "scripts", "install.sh")
const RECORD_MODE_FLAG = "--_kitten-record-standalone-installation"
const installerDirectories: string[] = []
let compiledFixtureRoot = ""
let compiledArtifact = ""
let hostPlatform = ""

beforeAll(async () => {
  const host = resolveHostArtifact(process.platform, process.arch)
  if (!host.ok) throw new Error(host.outcome.message)
  hostPlatform = host.value.platform
  compiledFixtureRoot = await mkdtemp(join(tmpdir(), "kitten-record-fixture-"))
  const source = join(compiledFixtureRoot, "record-fixture.ts")
  compiledArtifact = join(compiledFixtureRoot, host.value.artifact)
  const updateModule = join(import.meta.dir, "..", "src", "update.ts")
  await writeFile(source, `
import { recordStandaloneInstallation } from ${JSON.stringify(updateModule)}

const flag = ${JSON.stringify(RECORD_MODE_FLAG)}
const flagIndex = process.argv.indexOf(flag)
if (flagIndex >= 0) {
  const marker = process.env.KITTEN_TEST_RECORD_MARKER
  if (marker) await Bun.write(marker, "called\\n")
  const values = process.argv.slice(flagIndex + 1)
  if (values.length !== 3) process.exit(2)
  const [targetPath, platform, sha256] = values as [string, string, string]
  const result = await recordStandaloneInstallation({ targetPath, platform, sha256 })
  process.exit(result.ok ? 0 : 1)
}
if (process.argv.includes("--probe")) {
  process.stdout.write("fixture-runnable\\n")
  process.exit(0)
}
process.exit(2)
`)
  const compiled = Bun.spawnSync([
    "bun",
    "build",
    "--compile",
    "--outfile",
    compiledArtifact,
    source,
  ], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" })
  if (compiled.exitCode !== 0) {
    throw new Error(`could not compile installer fixture: ${compiled.stderr.toString()}`)
  }
})

afterEach(async () => {
  await Promise.all(installerDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

afterAll(async () => {
  if (compiledFixtureRoot) await rm(compiledFixtureRoot, { recursive: true, force: true })
})

/** Source the installer, then run `snippet` with `set -e` relaxed so `$?` survives. */
function inInstaller(snippet: string, env: Record<string, string> = {}): { stdout: string; exitCode: number } {
  const spawnEnv = { ...process.env }
  delete spawnEnv.KITTEN_REPO
  Object.assign(spawnEnv, env)
  const result = Bun.spawnSync(["bash", "-c", `source "${INSTALLER}"; set +e; ${snippet}`], {
    env: spawnEnv,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { stdout: result.stdout.toString(), exitCode: result.exitCode }
}

async function withTempFile(contents: string, run: (path: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-install-"))
  try {
    const file = join(dir, "kitten-linux-x64")
    await writeFile(file, contents)
    await run(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("install.sh verify_checksum", () => {
  it("succeeds when the checksum matches", async () => {
    await withTempFile("binary-bytes", (file) => {
      const expected = createHash("sha256").update("binary-bytes").digest("hex")
      const { stdout } = inInstaller(`verify_checksum "${file}" "${expected}"; echo "rc=$?"`)
      expect(stdout).toContain("rc=0")
    })
  })

  it("fails on a checksum mismatch and never installs", async () => {
    await withTempFile("binary-bytes", (file) => {
      const { stdout } = inInstaller(`verify_checksum "${file}" "deadbeef"; echo "rc=$?"`)
      expect(stdout).toContain("rc=1")
    })
  })

  it("fails when no expected checksum is supplied", async () => {
    await withTempFile("binary-bytes", (file) => {
      const { stdout } = inInstaller(`verify_checksum "${file}" ""; echo "rc=$?"`)
      expect(stdout).toContain("rc=1")
    })
  })

  it("fails when the file to verify is missing", () => {
    const { stdout } = inInstaller(`verify_checksum "/no/such/file" "deadbeef"; echo "rc=$?"`)
    expect(stdout).toContain("rc=1")
  })
})

describe("install.sh helpers", () => {
  it("defaults downloads to the public Kitten repository", () => {
    const { stdout, exitCode } = inInstaller('printf "%s" "$REPO"')
    expect(stdout).toBe("MatheusBBarni/Kitten")
    expect(exitCode).toBe(0)
  })

  it("honors a KITTEN_REPO override", () => {
    const { stdout, exitCode } = inInstaller('printf "%s" "$REPO"', {
      KITTEN_REPO: "example/kitten-fork",
    })
    expect(stdout).toBe("example/kitten-fork")
    expect(exitCode).toBe(0)
  })

  it("extracts the checksum for a named artifact from the manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-manifest-"))
    try {
      const manifest = join(dir, "SHA256SUMS")
      await writeFile(manifest, "aaa  kitten-darwin-arm64\nbbb  kitten-linux-x64\n")
      const { stdout, exitCode } = inInstaller(`checksum_for "${manifest}" kitten-linux-x64`)
      expect(stdout.trim()).toBe("bbb")
      expect(exitCode).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("honors a KITTEN_PLATFORM override for detection", () => {
    const { stdout } = inInstaller(`detect_platform`, { KITTEN_PLATFORM: "linux-arm64" })
    expect(stdout.trim()).toBe("linux-arm64")
  })

  for (const [os, arch, expected] of [
    ["Darwin", "arm64", "darwin-arm64"],
    ["Darwin", "x86_64", "darwin-x64"],
    ["Linux", "aarch64", "linux-arm64"],
    ["Linux", "amd64", "linux-x64"],
  ] as const) {
    it(`maps ${os} ${arch} to ${expected}`, () => {
      const { stdout, exitCode } = inInstaller(
        `uname() { if [ "$1" = "-s" ]; then printf '%s' "${os}"; else printf '%s' "${arch}"; fi; }; detect_platform`,
      )
      expect(stdout).toBe(expected)
      expect(exitCode).toBe(0)
    })
  }
})

describe("install.sh standalone provenance integration", () => {
  it("records exactly one canonical executable after verified installation", async () => {
    const fixture = await runInstallerFixture()

    if (fixture.result.exitCode !== 0) {
      throw new Error(fixture.result.stderr?.toString() ?? "installer failed without stderr")
    }
    expect(fixture.result.exitCode).toBe(0)
    expect(await readFile(fixture.markerPath, "utf8")).toBe("called\n")
    const probe = Bun.spawnSync([fixture.targetPath, "--probe"], { stdout: "pipe", stderr: "pipe" })
    expect(probe.exitCode).toBe(0)
    expect(probe.stdout.toString()).toBe("fixture-runnable\n")

    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    const records = Object.values(registry.installations)
    expect(registry.schemaVersion).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      schemaVersion: 1,
      canonicalPath: await realpath(fixture.targetPath),
      platform: hostPlatform,
      version: KITTEN_VERSION,
      sha256: fixture.artifactSha256,
    })
    expect(records[0]!.version).not.toBe("latest")
  })

  it("orders checksum verification, installation, and recording in that sequence", async () => {
    const source = await readFile(INSTALLER, "utf8")
    const verify = source.indexOf('verify_checksum "$bin_path" "$expected"')
    const install = source.indexOf('install -m 755 "$bin_path" "$target"')
    const record = source.indexOf('"$target" "$RECORD_MODE_FLAG" "$target" "$platform" "$expected"')
    expect(verify).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(verify)
    expect(record).toBeGreaterThan(install)
  })

  for (const scenario of [
    { name: "failed download", options: { failDownload: true } },
    { name: "missing manifest entry", options: { manifest: `${"a".repeat(64)}  kitten-not-the-host\n` } },
    { name: "checksum mismatch", options: { manifest: `${"0".repeat(64)}  HOST_ARTIFACT\n` } },
    { name: "failed install", options: { failInstall: true } },
  ] as const) {
    it(`${scenario.name} leaves no target or record and never invokes the record writer`, async () => {
      const manifest = scenario.options.manifest?.replace("HOST_ARTIFACT", `kitten-${hostPlatform}`)
      const fixture = await runInstallerFixture({ ...scenario.options, manifest })

      expect(fixture.result.exitCode).not.toBe(0)
      expect(await exists(fixture.targetPath)).toBe(false)
      expect(await exists(fixture.registryPath)).toBe(false)
      expect(await exists(fixture.markerPath)).toBe(false)
    })
  }

  it("keeps the installed executable runnable and prior registry bytes exact when recording fails", async () => {
    const priorRegistryBytes = Buffer.from("{ existing registry bytes stay exact\n")
    const fixture = await runInstallerFixture({ priorRegistryBytes })

    expect(fixture.result.exitCode).not.toBe(0)
    expect(await readFile(fixture.markerPath, "utf8")).toBe("called\n")
    expect(await readFile(fixture.registryPath)).toEqual(priorRegistryBytes)
    const probe = Bun.spawnSync([fixture.targetPath, "--probe"], { stdout: "pipe", stderr: "pipe" })
    expect(probe.exitCode).toBe(0)
    expect(probe.stdout.toString()).toBe("fixture-runnable\n")
    const stderr = fixture.result.stderr?.toString() ?? ""
    expect(stderr).toContain("installed executable is usable")
    expect(stderr).toContain("not eligible for 'kitten --update'")
  })
})

interface InstallerFixtureOptions {
  failDownload?: boolean
  failInstall?: boolean
  manifest?: string
  priorRegistryBytes?: Uint8Array
}

async function runInstallerFixture(options: InstallerFixtureOptions = {}): Promise<{
  result: ReturnType<typeof Bun.spawnSync>
  targetPath: string
  registryPath: string
  markerPath: string
  artifactSha256: string
}> {
  const root = await mkdtemp(join(tmpdir(), "kitten-installer-integration-"))
  installerDirectories.push(root)
  const assets = join(root, "assets")
  const fakeBin = join(root, "fake-bin")
  const installDirectory = join(root, "installed")
  const stateHome = join(root, "state")
  const markerPath = join(root, "record-called")
  const targetPath = join(installDirectory, "kitten")
  const registryPath = resolveStandaloneRegistryPath({ XDG_STATE_HOME: stateHome }, root)
  const artifactName = `kitten-${hostPlatform}`
  const artifactPath = join(assets, artifactName)
  await mkdir(assets, { recursive: true })
  await mkdir(fakeBin, { recursive: true })
  await writeFile(artifactPath, await readFile(compiledArtifact))
  await chmod(artifactPath, 0o755)
  const artifactSha256 = createHash("sha256").update(await readFile(artifactPath)).digest("hex")
  await writeFile(
    join(assets, "SHA256SUMS"),
    options.manifest ?? `${artifactSha256}  ${artifactName}\n`,
  )
  await writeExecutable(join(fakeBin, "curl"), `#!/bin/sh
set -eu
url="$2"
output="$4"
name="\${url##*/}"
if [ "\${KITTEN_TEST_FAIL_DOWNLOAD:-}" = "$name" ]; then
  exit 22
fi
cp "$KITTEN_TEST_ASSET_DIR/$name" "$output"
`)
  if (options.failInstall) {
    await writeExecutable(join(fakeBin, "install"), "#!/bin/sh\nexit 73\n")
  }
  if (options.priorRegistryBytes) {
    await mkdir(dirname(registryPath), { recursive: true })
    await writeFile(registryPath, options.priorRegistryBytes)
  }

  const result = Bun.spawnSync(["bash", INSTALLER], {
    env: {
      ...process.env,
      HOME: join(root, "home"),
      XDG_STATE_HOME: stateHome,
      KITTEN_BASE_URL: "https://fixture.invalid/releases/latest/download",
      KITTEN_INSTALL_DIR: installDirectory,
      KITTEN_PLATFORM: hostPlatform,
      KITTEN_VERSION: "latest",
      KITTEN_TEST_ASSET_DIR: assets,
      KITTEN_TEST_FAIL_DOWNLOAD: options.failDownload ? artifactName : "",
      KITTEN_TEST_RECORD_MARKER: markerPath,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { result, targetPath, registryPath, markerPath, artifactSha256 }
}

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source)
  await chmod(path, 0o755)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
