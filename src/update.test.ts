import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { KITTEN_VERSION } from "./version.ts"
import {
  createStandaloneRecordWriterDependencies,
  formatUpdateOutcome,
  loadStandaloneInstallation,
  NPM_RECOVERY_COMMAND,
  parseManifestChecksum,
  parseStableReleaseMetadata,
  parseStableReleaseTag,
  recordStandaloneInstallation,
  registryKeyForCanonicalPath,
  resolveHostArtifact,
  resolveStandaloneRegistryPath,
  STANDALONE_RECOVERY_COMMAND,
  type StandaloneInstallationRecord,
  type StandaloneInstallationRegistry,
  type StandaloneRecordWriterDependencies,
  type UpdateDependencies,
  validateStandaloneRegistry,
} from "./update.ts"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("standalone registry primitives", () => {
  it("resolves the dedicated XDG registry and home fallback without using state.json", () => {
    expect(resolveStandaloneRegistryPath({ XDG_STATE_HOME: "/state" }, "/home/kitten")).toBe(
      "/state/kitten/standalone-installations.json",
    )
    expect(resolveStandaloneRegistryPath({}, "/home/kitten")).toBe(
      "/home/kitten/.local/state/kitten/standalone-installations.json",
    )
    expect(resolveStandaloneRegistryPath({})).toBe(join(homedir(), ".local/state/kitten/standalone-installations.json"))
  })

  it("derives deterministic lowercase SHA-256 keys from canonical paths", () => {
    const path = "/usr/local/bin/kitten"
    const result = registryKeyForCanonicalPath(path, hashBytes)
    expect(result).toEqual({ ok: true, value: hashText(path) })
    expect(registryKeyForCanonicalPath(path)).toEqual(result)
    expect(registryKeyForCanonicalPath("relative/kitten", hashBytes).ok).toBe(false)
    expect(registryKeyForCanonicalPath(path, () => "A".repeat(64)).ok).toBe(false)
  })

  it("accepts one exact schema-v1 record selected by its canonical-path key", () => {
    const record = validRecord()
    expect(validateStandaloneRegistry(registryFor(record), record.canonicalPath, hashBytes)).toEqual({
      ok: true,
      value: record,
    })
  })

  it.each([
    ["mismatched key", (record: StandaloneInstallationRecord) => registryFor(record, HASH_B)],
    ["unknown envelope schema", (record: StandaloneInstallationRecord) => ({ ...registryFor(record), schemaVersion: 2 })],
    [
      "unknown record schema",
      (record: StandaloneInstallationRecord) => registryFor({ ...record, schemaVersion: 2 as unknown as 1 }),
    ],
    ["unsupported platform", (record: StandaloneInstallationRecord) => registryFor({ ...record, platform: "windows-x64" })],
    ["non-semver version", (record: StandaloneInstallationRecord) => registryFor({ ...record, version: "1.2" })],
    ["uppercase hash", (record: StandaloneInstallationRecord) => registryFor({ ...record, sha256: "A".repeat(64) })],
    ["malformed hash", (record: StandaloneInstallationRecord) => registryFor({ ...record, sha256: "abc" })],
  ])("rejects %s", (_name, mutate) => {
    const record = validRecord()
    expect(validateStandaloneRegistry(mutate(record), record.canonicalPath, hashBytes).ok).toBe(false)
  })

  it("rejects malformed envelopes, missing records, invalid paths, and extra record fields", () => {
    const record = validRecord()
    expect(validateStandaloneRegistry(null, record.canonicalPath, hashBytes).ok).toBe(false)
    expect(validateStandaloneRegistry({ schemaVersion: 1, installations: {} }, record.canonicalPath, hashBytes).ok).toBe(
      false,
    )
    expect(
      validateStandaloneRegistry(registryFor({ ...record, canonicalPath: "relative" }), record.canonicalPath, hashBytes).ok,
    ).toBe(false)
    expect(
      validateStandaloneRegistry(
        registryFor({ ...record, extra: true } as StandaloneInstallationRecord),
        record.canonicalPath,
        hashBytes,
      ).ok,
    ).toBe(false)
  })
})

describe("release primitives", () => {
  it("accepts a stable Kitten release tag", () => {
    expect(parseStableReleaseTag("kitten-v1.2.3")).toEqual({
      ok: true,
      value: { tag: "kitten-v1.2.3", version: "1.2.3" },
    })
    expect(parseStableReleaseTag("kitten-v0.0.0").ok).toBe(true)
  })

  it.each([
    "v1.2.3",
    "kitten-1.2.3",
    "kitten-v1.2",
    "kitten-v1.2.3-beta.1",
    "kitten-v1.2.3+build.1",
    " kitten-v1.2.3",
    "kitten-v1.2.3 ",
    "kitten-v1.2.3/latest",
    "kitten-v01.2.3",
  ])("rejects invalid stable tag %s", (tag) => {
    expect(parseStableReleaseTag(tag).ok).toBe(false)
  })

  it("rejects draft, prerelease, and malformed latest-release metadata", () => {
    expect(parseStableReleaseMetadata({ tag_name: "kitten-v1.2.3", draft: false, prerelease: false }).ok).toBe(true)
    expect(parseStableReleaseMetadata({ tag_name: "kitten-v1.2.3", draft: true, prerelease: false }).ok).toBe(false)
    expect(parseStableReleaseMetadata({ tag_name: "kitten-v1.2.3", draft: false, prerelease: true }).ok).toBe(false)
    expect(parseStableReleaseMetadata({ tag_name: "kitten-v1.2.3" }).ok).toBe(false)
    expect(parseStableReleaseMetadata([]).ok).toBe(false)
  })

  it("selects only the four shipped host artifacts", () => {
    expect(resolveHostArtifact("darwin", "arm64")).toEqual({
      ok: true,
      value: { platform: "darwin-arm64", artifact: "kitten-darwin-arm64" },
    })
    expect(resolveHostArtifact("linux", "x64").ok).toBe(true)
    expect(resolveHostArtifact("linux-arm64")).toEqual({
      ok: true,
      value: { platform: "linux-arm64", artifact: "kitten-linux-arm64" },
    })
    expect(resolveHostArtifact("win32", "x64").ok).toBe(false)
    expect(resolveHostArtifact("freebsd", "x64").ok).toBe(false)
  })

  it("accepts exactly one strict lowercase checksum row for the selected artifact", () => {
    const source = `${HASH_A}  kitten-darwin-arm64\n${HASH_B}  kitten-linux-x64\n`
    expect(parseManifestChecksum(source, "kitten-linux-x64")).toEqual({ ok: true, value: HASH_B })
    expect(parseManifestChecksum(`${HASH_A}  kitten-linux-x64`, "kitten-linux-x64")).toEqual({
      ok: true,
      value: HASH_A,
    })
  })

  it.each([
    ["missing", `${HASH_A}  kitten-darwin-arm64\n`],
    ["duplicate", `${HASH_A}  kitten-linux-x64\n${HASH_B}  kitten-linux-x64\n`],
    ["tab-separated", `${HASH_A}\tkitten-linux-x64\n`],
    ["one-space", `${HASH_A} kitten-linux-x64\n`],
    ["traversal", `${HASH_A}  ../../kitten-linux-x64\n`],
    ["uppercase hash", `${"A".repeat(64)}  kitten-linux-x64\n`],
    ["short hash", `abc  kitten-linux-x64\n`],
    ["unexpected artifact", `${HASH_A}  kitten-windows-x64\n`],
    ["blank row", `${HASH_A}  kitten-linux-x64\n\n`],
    ["CRLF", `${HASH_A}  kitten-linux-x64\r\n`],
  ])("rejects a %s manifest", (_name, source) => {
    expect(parseManifestChecksum(source, "kitten-linux-x64").ok).toBe(false)
  })

  it("rejects invalid manifest values and unsupported selected artifacts", () => {
    expect(parseManifestChecksum(null, "kitten-linux-x64").ok).toBe(false)
    expect(parseManifestChecksum("", "kitten-linux-x64").ok).toBe(false)
    expect(parseManifestChecksum(`${HASH_A}  kitten-linux-x64\n`, "kitten-windows-x64").ok).toBe(false)
  })
})

describe("outcome formatting", () => {
  it("formats updated and already-current outcomes with channel and versions", () => {
    expect(formatUpdateOutcome({ kind: "updated", channel: "standalone", from: "1.2.3", to: "1.3.0" })).toBe(
      "Kitten updated via standalone: 1.2.3 -> 1.3.0.",
    )
    expect(formatUpdateOutcome({ kind: "already-current", channel: "npm", version: "1.3.0" })).toBe(
      "Kitten is already current via npm at version 1.3.0.\nNo change occurred.",
    )
  })

  it.each(["refused", "failed"] as const)("formats %s with no-change and both recovery commands", (kind) => {
    const output = formatUpdateOutcome({ kind, message: "ownership was not proven" })
    expect(output).toContain(`Kitten update ${kind}: ownership was not proven`)
    expect(output).toContain("No change occurred.")
    expect(output).toContain(NPM_RECOVERY_COMMAND)
    expect(output).toContain(STANDALONE_RECOVERY_COMMAND)
  })
})

describe("read-only standalone registry boundary", () => {
  it("loads a valid temporary-XDG record and never changes malformed or stale registry bytes", async () => {
    const root = await temporaryDirectory()
    const executable = join(root, "bin", "kitten")
    const stateHome = join(root, "state")
    const registryPath = resolveStandaloneRegistryPath({ XDG_STATE_HOME: stateHome }, root)
    await mkdir(dirname(executable), { recursive: true })
    await mkdir(dirname(registryPath), { recursive: true })
    await writeFile(executable, "installed-binary")

    const canonicalPath = await realpath(executable)
    const record = validRecord({
      canonicalPath,
      version: KITTEN_VERSION,
      sha256: hashText("installed-binary"),
    })
    await writeFile(registryPath, `${JSON.stringify(registryFor(record))}\n`)
    const dependencies = readDependencies(executable, stateHome, root)

    expect(await loadStandaloneInstallation(dependencies)).toEqual({ ok: true, value: record })

    const malformedBytes = Buffer.from("{ malformed registry")
    await writeFile(registryPath, malformedBytes)
    expect((await loadStandaloneInstallation(dependencies)).ok).toBe(false)
    expect(await readFile(registryPath)).toEqual(malformedBytes)

    const staleRegistry = Buffer.from(
      `${JSON.stringify(registryFor({ ...record, sha256: HASH_A }))}\n`,
    )
    await writeFile(registryPath, staleRegistry)
    expect((await loadStandaloneInstallation(dependencies)).ok).toBe(false)
    expect(await readFile(registryPath)).toEqual(staleRegistry)
  })

  it("refuses stale versions, non-regular targets, and read errors", async () => {
    const record = validRecord({ version: "9.9.9" })
    const registry = new TextEncoder().encode(JSON.stringify(registryFor(record)))
    const base = fakeReadDependencies(record, registry)

    expect((await loadStandaloneInstallation(base, KITTEN_VERSION)).ok).toBe(false)
    expect((await loadStandaloneInstallation({ ...base, isRegularFile: async () => false })).ok).toBe(false)
    expect((await loadStandaloneInstallation({ ...base, readFile: async () => { throw new Error("denied") } })).ok).toBe(
      false,
    )
  })

  it("invalid primitive input calls no fetch, write, rename, or replacement seam", async () => {
    const calls = { fetch: 0, write: 0, rename: 0, replace: 0 }
    const record = validRecord()
    const dependencies: UpdateDependencies = {
      ...fakeReadDependencies(record, new TextEncoder().encode("{}")),
      fetchJson: async () => { calls.fetch += 1; return {} },
      fetchBytes: async () => { calls.fetch += 1; return new Uint8Array() },
      writeFile: async () => { calls.write += 1 },
      rename: async () => { calls.rename += 1 },
      replaceExecutable: async () => { calls.replace += 1 },
    }

    expect((await loadStandaloneInstallation(dependencies)).ok).toBe(false)
    expect(parseStableReleaseTag("kitten-v1.2.3-beta").ok).toBe(false)
    expect(parseManifestChecksum(`${HASH_A}\tkitten-linux-x64`, "kitten-linux-x64").ok).toBe(false)
    expect(calls).toEqual({ fetch: 0, write: 0, rename: 0, replace: 0 })
  })
})

describe("installer-owned standalone registry writer", () => {
  it("replaces one canonical-path record while preserving an unrelated installation", async () => {
    const fixture = await recordWriterFixture()
    const sibling = validRecord({
      canonicalPath: "/opt/kitten/bin/kitten",
      version: "8.8.8",
      sha256: HASH_B,
    })
    const staleTarget = validRecord({
      canonicalPath: fixture.canonicalPath,
      version: "0.1.0",
      sha256: HASH_A,
    })
    const prior = registryForRecords([staleTarget, sibling])
    await mkdir(dirname(fixture.registryPath), { recursive: true })
    await writeFile(fixture.registryPath, `${JSON.stringify(prior)}\n`)

    const result = await recordStandaloneInstallation(fixture.input, fixture.dependencies, KITTEN_VERSION)

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        canonicalPath: fixture.canonicalPath,
        platform: "linux-x64",
        version: KITTEN_VERSION,
        sha256: fixture.input.sha256,
      },
    })
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    expect(Object.keys(registry.installations)).toHaveLength(2)
    expect(registry.installations[hashText(sibling.canonicalPath)]).toEqual(sibling)
    if (!result.ok) throw new Error("expected record publication to succeed")
    expect(registry.installations[hashText(fixture.canonicalPath)]).toEqual(result.value)
  })

  it("rejects invalid target identity and record fields before registry mutation", async () => {
    const fixture = await recordWriterFixture()
    const priorBytes = Buffer.from(`${JSON.stringify(registryFor(validRecord()))}\n`)
    await mkdir(dirname(fixture.registryPath), { recursive: true })
    await writeFile(fixture.registryPath, priorBytes)

    const otherExecutable = join(fixture.root, "bin", "other-kitten")
    await writeFile(otherExecutable, "installed-binary")
    const cases: Array<{
      name: string
      input?: typeof fixture.input
      dependencies?: StandaloneRecordWriterDependencies
      embeddedVersion?: string
    }> = [
      {
        name: "invalid path type",
        dependencies: createStandaloneRecordWriterDependencies({
          ...fixture.dependencies,
          isRegularFile: async () => false,
        }),
      },
      {
        name: "canonical mismatch",
        dependencies: createStandaloneRecordWriterDependencies({
          ...fixture.dependencies,
          resolveExecutable: async () => otherExecutable,
        }),
      },
      {
        name: "unsupported platform",
        input: { ...fixture.input, platform: "windows-x64" },
        dependencies: createStandaloneRecordWriterDependencies({
          ...fixture.dependencies,
          hostPlatform: () => "windows-x64",
        }),
      },
      { name: "invalid embedded version", embeddedVersion: "latest" },
      { name: "invalid hash", input: { ...fixture.input, sha256: "A".repeat(64) } },
    ]

    for (const testCase of cases) {
      const result = await recordStandaloneInstallation(
        testCase.input ?? fixture.input,
        testCase.dependencies ?? fixture.dependencies,
        testCase.embeddedVersion ?? KITTEN_VERSION,
      )
      expect(result.ok, testCase.name).toBe(false)
      expect(await readFile(fixture.registryPath), testCase.name).toEqual(priorBytes)
    }
  })

  it("preserves exact prior bytes and removes temporary state when atomic write or publish fails", async () => {
    const fixture = await recordWriterFixture()
    const priorBytes = Buffer.from(`${JSON.stringify(registryFor(validRecord()), null, 4)}\n`)
    await mkdir(dirname(fixture.registryPath), { recursive: true })
    await writeFile(fixture.registryPath, priorBytes)
    for (const failure of ["write", "rename"] as const) {
      const dependencies = createStandaloneRecordWriterDependencies({
        ...fixture.dependencies,
        ...(failure === "write"
          ? { writeTemporaryFile: async () => { throw new Error("simulated atomic write failure") } }
          : { rename: async () => { throw new Error("simulated atomic publish failure") } }),
      })

      expect((await recordStandaloneInstallation(fixture.input, dependencies)).ok, failure).toBe(false)
      expect(await readFile(fixture.registryPath), failure).toEqual(priorBytes)
      expect((await readdir(dirname(fixture.registryPath))).filter((name) => name.includes(".tmp")), failure).toEqual([])
    }
  })

  it("refuses malformed prior registry bytes without publishing a replacement", async () => {
    const fixture = await recordWriterFixture()
    const priorBytes = Buffer.from("{ malformed registry")
    await mkdir(dirname(fixture.registryPath), { recursive: true })
    await writeFile(fixture.registryPath, priorBytes)

    expect((await recordStandaloneInstallation(fixture.input, fixture.dependencies)).ok).toBe(false)
    expect(await readFile(fixture.registryPath)).toEqual(priorBytes)
  })
})

function validRecord(overrides: Partial<StandaloneInstallationRecord> = {}): StandaloneInstallationRecord {
  return {
    schemaVersion: 1,
    canonicalPath: "/usr/local/bin/kitten",
    platform: "linux-x64",
    version: "1.2.3",
    sha256: HASH_A,
    ...overrides,
  }
}

function registryFor(
  record: StandaloneInstallationRecord,
  key: string = hashText(record.canonicalPath),
): StandaloneInstallationRegistry {
  return { schemaVersion: 1, installations: { [key]: record } }
}

function registryForRecords(records: readonly StandaloneInstallationRecord[]): StandaloneInstallationRegistry {
  return {
    schemaVersion: 1,
    installations: Object.fromEntries(records.map((record) => [hashText(record.canonicalPath), record])),
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function hashText(value: string): string {
  return hashBytes(new TextEncoder().encode(value))
}

function readDependencies(
  executable: string,
  stateHome: string,
  homeDirectory: string,
): Pick<
  UpdateDependencies,
  "sha256" | "resolveExecutable" | "canonicalizePath" | "isRegularFile" | "readFile" | "environment" | "homeDirectory"
> {
  return {
    sha256: hashBytes,
    resolveExecutable: async () => executable,
    canonicalizePath: realpath,
    isRegularFile: async (path) => (await stat(path)).isFile(),
    readFile,
    environment: () => ({ XDG_STATE_HOME: stateHome }),
    homeDirectory: () => homeDirectory,
  }
}

function fakeReadDependencies(
  record: StandaloneInstallationRecord,
  registryBytes: Uint8Array,
): Pick<
  UpdateDependencies,
  "sha256" | "resolveExecutable" | "canonicalizePath" | "isRegularFile" | "readFile" | "environment" | "homeDirectory"
> {
  return {
    sha256: hashBytes,
    resolveExecutable: async () => record.canonicalPath,
    canonicalizePath: async (path) => path,
    isRegularFile: async () => true,
    readFile: async (path) => path === record.canonicalPath ? new TextEncoder().encode("binary") : registryBytes,
    environment: () => ({ XDG_STATE_HOME: "/state" }),
    homeDirectory: () => "/home/kitten",
  }
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "kitten-update-"))
  temporaryDirectories.push(path)
  return path
}

async function recordWriterFixture(): Promise<{
  root: string
  canonicalPath: string
  registryPath: string
  input: { targetPath: string; platform: string; sha256: string }
  dependencies: StandaloneRecordWriterDependencies
}> {
  const root = await temporaryDirectory()
  const targetPath = join(root, "bin", "kitten")
  const stateHome = join(root, "state")
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, "installed-binary")
  const canonicalPath = await realpath(targetPath)
  const dependencies = createStandaloneRecordWriterDependencies({
    resolveExecutable: async () => targetPath,
    environment: () => ({ XDG_STATE_HOME: stateHome }),
    homeDirectory: () => root,
    hostPlatform: () => "linux-x64",
  })
  return {
    root,
    canonicalPath,
    registryPath: resolveStandaloneRegistryPath({ XDG_STATE_HOME: stateHome }, root),
    input: {
      targetPath,
      platform: "linux-x64",
      sha256: hashText("installed-binary"),
    },
    dependencies,
  }
}
