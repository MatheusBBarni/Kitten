import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { KITTEN_VERSION } from "./version.ts"
import {
  createStandaloneRecordWriterDependencies,
  createStandaloneUpdateDependencies,
  formatUpdateOutcome,
  LATEST_RELEASE_URL,
  loadStandaloneInstallation,
  NPM_RECOVERY_COMMAND,
  parseManifestChecksum,
  parseStableReleaseMetadata,
  parseStableReleaseTag,
  recordStandaloneInstallation,
  registryKeyForCanonicalPath,
  resolveHostArtifact,
  resolveStandaloneRegistryPath,
  runStandaloneUpdate,
  standaloneRegistryLockPath,
  STANDALONE_RECOVERY_COMMAND,
  type StandaloneInstallationRecord,
  type StandaloneInstallationRegistry,
  type StandaloneRecordWriterDependencies,
  type StandaloneTransactionPaths,
  type StandaloneUpdateDependencies,
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

describe("fail-closed standalone update transaction", () => {
  it("refuses every inconclusive ownership shape before release or mutation seams", async () => {
    for (const failure of [
      "missing",
      "malformed",
      "stale-path",
      "symlink",
      "nonregular",
      "version",
      "platform",
      "hash",
    ] as const) {
      const fixture = await standaloneUpdateFixture()
      let dependencies = fixture.dependencies
      switch (failure) {
        case "missing":
          await rm(fixture.registryPath)
          break
        case "malformed":
          await writeFile(fixture.registryPath, "{ malformed")
          break
        case "stale-path":
          await writeFixtureRegistry(fixture, { canonicalPath: join(fixture.root, "other", "kitten") })
          break
        case "symlink": {
          const link = join(fixture.root, "bin", "kitten-link")
          await symlink(fixture.targetPath, link)
          dependencies = createStandaloneUpdateDependencies({
            ...dependencies,
            resolveExecutable: async () => link,
          })
          break
        }
        case "nonregular":
          dependencies = createStandaloneUpdateDependencies({
            ...dependencies,
            isRegularFile: async () => false,
          })
          break
        case "version":
          await writeFixtureRegistry(fixture, { version: "8.8.8" })
          break
        case "platform":
          await writeFixtureRegistry(fixture, { platform: "darwin-arm64" })
          break
        case "hash":
          await writeFile(fixture.targetPath, "changed-after-install", { mode: 0o755 })
          break
      }
      const beforeTarget = await readFile(fixture.targetPath)
      const beforeRegistry = await readFileOrMissing(fixture.registryPath)

      expect((await runStandaloneUpdate(dependencies)).kind, failure).toBe("refused")
      expect(fixture.calls.fetchJson, failure).toEqual([])
      expect(fixtureMutationCount(fixture), failure).toBe(0)
      expect(await readFile(fixture.targetPath), failure).toEqual(beforeTarget)
      expect(await readFileOrMissing(fixture.registryPath), failure).toEqual(beforeRegistry)
    }
  })

  it("rejects unsafe release, fetch, manifest, and candidate responses without writing", async () => {
    for (const failure of [
      "draft",
      "prerelease",
      "malformed",
      "missing-tag",
      "artifact-fetch",
      "manifest-fetch",
      "duplicate-row",
      "checksum-mismatch",
    ] as const) {
      const fixture = await standaloneUpdateFixture()
      let dependencies = fixture.dependencies
      if (failure === "draft" || failure === "prerelease" || failure === "malformed" || failure === "missing-tag") {
        const metadata = failure === "draft"
          ? { draft: true, prerelease: false, tag_name: "kitten-v9.9.9" }
          : failure === "prerelease"
            ? { draft: false, prerelease: true, tag_name: "kitten-v9.9.9" }
            : failure === "missing-tag"
              ? { draft: false, prerelease: false }
              : null
        dependencies = createStandaloneUpdateDependencies({
          ...dependencies,
          fetchJson: async (url) => { fixture.calls.fetchJson.push(url); return metadata },
        })
      } else if (failure === "artifact-fetch") {
        dependencies = createStandaloneUpdateDependencies({
          ...dependencies,
          fetchBytes: async (url) => { fixture.calls.fetchBytes.push(url); throw new Error("artifact unavailable") },
        })
      } else if (failure === "manifest-fetch") {
        dependencies = createStandaloneUpdateDependencies({
          ...dependencies,
          fetchBytes: async (url) => {
            fixture.calls.fetchBytes.push(url)
            if (url.endsWith("/SHA256SUMS")) throw new Error("manifest unavailable")
            return fixture.candidateBytes
          },
        })
      } else if (failure === "duplicate-row") {
        const row = `${fixture.candidateSha256}  kitten-linux-x64\n`
        dependencies = createStandaloneUpdateDependencies({
          ...dependencies,
          fetchBytes: async (url) => {
            fixture.calls.fetchBytes.push(url)
            return url.endsWith("/SHA256SUMS") ? new TextEncoder().encode(row + row) : fixture.candidateBytes
          },
        })
      } else {
        dependencies = createStandaloneUpdateDependencies({
          ...dependencies,
          fetchBytes: async (url) => {
            fixture.calls.fetchBytes.push(url)
            return url.endsWith("/SHA256SUMS")
              ? new TextEncoder().encode(`${HASH_A}  kitten-linux-x64\n`)
              : fixture.candidateBytes
          },
        })
      }
      const beforeTarget = await readFile(fixture.targetPath)
      const beforeRegistry = await readFile(fixture.registryPath)

      const outcome = await runStandaloneUpdate(dependencies)

      expect(["refused", "failed"], failure).toContain(outcome.kind)
      expect(fixtureMutationCount(fixture), failure).toBe(0)
      expect(await readFile(fixture.targetPath), failure).toEqual(beforeTarget)
      expect(await readFile(fixture.registryPath), failure).toEqual(beforeRegistry)
    }
  })

  it("reports already-current after metadata validation with no artifact or write activity", async () => {
    const fixture = await standaloneUpdateFixture()
    const dependencies = createStandaloneUpdateDependencies({
      ...fixture.dependencies,
      fetchJson: async (url) => {
        fixture.calls.fetchJson.push(url)
        return { draft: false, prerelease: false, tag_name: `kitten-v${KITTEN_VERSION}` }
      },
    })
    const beforeTarget = await readFile(fixture.targetPath)
    const beforeRegistry = await readFile(fixture.registryPath)

    expect(await runStandaloneUpdate(dependencies)).toEqual({
      kind: "already-current",
      channel: "standalone",
      version: KITTEN_VERSION,
    })
    expect(fixture.calls.fetchJson).toEqual([LATEST_RELEASE_URL])
    expect(fixture.calls.fetchBytes).toEqual([])
    expect(fixtureMutationCount(fixture)).toBe(0)
    expect(await readFile(fixture.targetPath)).toEqual(beforeTarget)
    expect(await readFile(fixture.registryPath)).toEqual(beforeRegistry)
    await expectNoTransactionArtifacts(fixture)
  })

  it("updates the exact tag-scoped artifact and registry while preserving sibling records", async () => {
    const fixture = await standaloneUpdateFixture()
    const sibling = validRecord({ canonicalPath: "/opt/kitten/bin/kitten", version: "7.7.7", sha256: HASH_B })
    await writeFile(fixture.registryPath, `${JSON.stringify(registryForRecords([fixture.record, sibling]), null, 4)}\n`)

    expect(await runStandaloneUpdate(fixture.dependencies)).toEqual({
      kind: "updated",
      channel: "standalone",
      from: KITTEN_VERSION,
      to: "9.9.9",
    })
    expect(fixture.calls.fetchJson).toEqual([LATEST_RELEASE_URL])
    expect(fixture.calls.fetchBytes).toEqual([
      "https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v9.9.9/kitten-linux-x64",
      "https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v9.9.9/SHA256SUMS",
    ])
    expect(await readFile(fixture.targetPath)).toEqual(Buffer.from(fixture.candidateBytes))
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    expect(registry.installations[hashText(fixture.canonicalPath)]).toEqual({
      ...fixture.record,
      version: "9.9.9",
      sha256: fixture.candidateSha256,
    })
    expect(registry.installations[hashText(sibling.canonicalPath)]).toEqual(sibling)
    await expectNoTransactionArtifacts(fixture)
  })

  it("refuses rather than overwrite a registry publication observed under the shared registry lock", async () => {
    const fixture = await standaloneUpdateFixture()
    const sibling = validRecord({ canonicalPath: "/opt/kitten/bin/kitten", version: "7.7.7", sha256: HASH_B })
    const base = fixture.dependencies
    let published = false
    const dependencies = createStandaloneUpdateDependencies({
      ...base,
      acquireLock: async (path) => {
        if (path === fixture.paths.registryLock && !published) {
          published = true
          await writeFile(fixture.registryPath, `${JSON.stringify(registryForRecords([fixture.record, sibling]))}\n`)
        }
        return base.acquireLock(path)
      },
    })

    expect(await runStandaloneUpdate(dependencies)).toEqual(expect.objectContaining({ kind: "refused" }))
    expect(await readFile(fixture.targetPath)).toEqual(Buffer.from(fixture.targetBytes))
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    expect(registry.installations[hashText(sibling.canonicalPath)]).toEqual(sibling)
    await expectNoTransactionArtifacts(fixture)
  })

  it("restores byte-identical target and registry state across the transaction failure matrix", async () => {
    for (const failure of [
      "lock",
      "temp-write",
      "temp-chmod",
      "target-chmod",
      "backup-rename",
      "candidate-rename",
      "registry-publish",
      "cleanup",
    ] as const) {
      const fixture = await standaloneUpdateFixture()
      const base = fixture.dependencies
      let cleanupFailed = false
      const dependencies = createStandaloneUpdateDependencies({
        ...base,
        acquireLock: async (path) => {
          if (failure === "lock") throw new Error("injected lock failure")
          return base.acquireLock(path)
        },
        writeFile: async (path, bytes, mode) => {
          if (failure === "temp-write" && path === fixture.paths.candidate) throw new Error("injected write failure")
          return base.writeFile(path, bytes, mode)
        },
        chmod: async (path, mode) => {
          if (failure === "temp-chmod" && path === fixture.paths.candidate) throw new Error("injected chmod failure")
          if (failure === "target-chmod" && path === fixture.canonicalPath) throw new Error("injected target chmod failure")
          return base.chmod(path, mode)
        },
        rename: async (from, to) => {
          if (failure === "backup-rename" && from === fixture.canonicalPath) throw new Error("injected backup failure")
          if (failure === "registry-publish" && from === fixture.paths.registryCandidate) {
            throw new Error("injected registry publish failure")
          }
          return base.rename(from, to)
        },
        replaceExecutable: async (from, to) => {
          if (failure === "candidate-rename") throw new Error("injected candidate failure")
          return base.replaceExecutable(from, to)
        },
        removeFile: async (path) => {
          if (failure === "cleanup" && path === fixture.paths.registrySnapshot && !cleanupFailed) {
            cleanupFailed = true
            throw new Error("injected cleanup failure")
          }
          return base.removeFile(path)
        },
      })
      const beforeTarget = await readFile(fixture.targetPath)
      const beforeRegistry = await readFile(fixture.registryPath)

      const outcome = await runStandaloneUpdate(dependencies)

      expect(outcome.kind, failure).toBe(failure === "lock" ? "refused" : "failed")
      expect(await readFile(fixture.targetPath), failure).toEqual(beforeTarget)
      expect(await readFile(fixture.registryPath), failure).toEqual(beforeRegistry)
      await expectNoTransactionArtifacts(fixture)
    }
  })

  it("returns an inconclusive failure and retains recovery evidence when rollback itself fails", async () => {
    const fixture = await standaloneUpdateFixture()
    const base = fixture.dependencies
    let publishFailed = false
    const dependencies = createStandaloneUpdateDependencies({
      ...base,
      rename: async (from, to) => {
        if (from === fixture.paths.registryCandidate) {
          publishFailed = true
          throw new Error("injected registry publish failure")
        }
        if (publishFailed && from === fixture.paths.backup && to === fixture.canonicalPath) {
          throw new Error("injected rollback failure")
        }
        return base.rename(from, to)
      },
    })

    const outcome = await runStandaloneUpdate(dependencies)

    expect(outcome.kind).toBe("failed")
    expect(outcome.kind === "failed" ? outcome.message : "").toContain("inconclusive")
    expect(await readFile(fixture.registryPath)).toEqual(Buffer.from(fixture.registryBytes))
    expect(await readFile(fixture.paths.backup)).toEqual(Buffer.from(fixture.targetBytes))
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

  it("locks, reloads, and merges the registry after another writer publishes", async () => {
    const fixture = await recordWriterFixture()
    const sibling = validRecord({ canonicalPath: "/opt/kitten/bin/kitten", version: "8.8.8", sha256: HASH_B })
    const base = fixture.dependencies
    let published = false
    const dependencies = createStandaloneRecordWriterDependencies({
      ...base,
      acquireLock: async (path) => {
        expect(path).toBe(standaloneRegistryLockPath(fixture.registryPath))
        if (!published) {
          published = true
          await mkdir(dirname(fixture.registryPath), { recursive: true })
          await writeFile(fixture.registryPath, `${JSON.stringify(registryFor(sibling))}\n`)
        }
        return base.acquireLock(path)
      },
    })

    expect((await recordStandaloneInstallation(fixture.input, dependencies)).ok).toBe(true)
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    expect(registry.installations[hashText(sibling.canonicalPath)]).toEqual(sibling)
    expect(registry.installations[hashText(fixture.canonicalPath)]).toMatchObject({
      version: KITTEN_VERSION,
      sha256: fixture.input.sha256,
    })
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

interface StandaloneUpdateCalls {
  fetchJson: string[]
  fetchBytes: string[]
  writes: string[]
  chmods: string[]
  renames: string[]
  replacements: string[]
  removals: string[]
  locks: string[]
  releases: string[]
}

interface StandaloneUpdateFixture {
  root: string
  targetPath: string
  canonicalPath: string
  registryPath: string
  record: StandaloneInstallationRecord
  targetBytes: Uint8Array
  registryBytes: Uint8Array
  candidateBytes: Uint8Array
  candidateSha256: string
  paths: StandaloneTransactionPaths
  calls: StandaloneUpdateCalls
  dependencies: StandaloneUpdateDependencies
}

async function standaloneUpdateFixture(): Promise<StandaloneUpdateFixture> {
  const root = await temporaryDirectory()
  const targetPath = join(root, "bin", "kitten")
  const stateHome = join(root, "state")
  const registryPath = resolveStandaloneRegistryPath({ XDG_STATE_HOME: stateHome }, root)
  await mkdir(dirname(targetPath), { recursive: true })
  await mkdir(dirname(registryPath), { recursive: true })
  const targetBytes = new TextEncoder().encode("installed-binary")
  const candidateBytes = new TextEncoder().encode("#!/bin/sh\ntouch must-not-exist\n")
  await writeFile(targetPath, targetBytes, { mode: 0o755 })
  await chmod(targetPath, 0o755)
  const canonicalPath = await realpath(targetPath)
  const record = validRecord({
    canonicalPath,
    version: KITTEN_VERSION,
    sha256: hashBytes(targetBytes),
  })
  const registryBytes = new TextEncoder().encode(`${JSON.stringify(registryFor(record), null, 4)}\n`)
  await writeFile(registryPath, registryBytes, { mode: 0o600 })
  const paths: StandaloneTransactionPaths = {
    lock: join(dirname(targetPath), ".kitten.update.lock"),
    registryLock: standaloneRegistryLockPath(registryPath),
    candidate: join(dirname(targetPath), ".kitten.candidate"),
    backup: join(dirname(targetPath), ".kitten.backup"),
    registryCandidate: join(dirname(registryPath), ".standalone-installations.candidate"),
    registrySnapshot: join(dirname(registryPath), ".standalone-installations.snapshot"),
    targetRestore: join(dirname(targetPath), ".kitten.restore"),
    registryRestore: join(dirname(registryPath), ".standalone-installations.restore"),
  }
  const calls: StandaloneUpdateCalls = {
    fetchJson: [],
    fetchBytes: [],
    writes: [],
    chmods: [],
    renames: [],
    replacements: [],
    removals: [],
    locks: [],
    releases: [],
  }
  const candidateSha256 = hashBytes(candidateBytes)
  const production = createStandaloneUpdateDependencies({
    resolveExecutable: async () => targetPath,
    environment: () => ({ XDG_STATE_HOME: stateHome }),
    homeDirectory: () => root,
    hostPlatform: () => "linux-x64",
    transactionPaths: () => paths,
    fetchJson: async (url) => {
      calls.fetchJson.push(url)
      return { draft: false, prerelease: false, tag_name: "kitten-v9.9.9" }
    },
    fetchBytes: async (url) => {
      calls.fetchBytes.push(url)
      if (url.endsWith("/kitten-linux-x64")) return candidateBytes
      if (url.endsWith("/SHA256SUMS")) {
        return new TextEncoder().encode(`${candidateSha256}  kitten-linux-x64\n`)
      }
      throw new Error(`unexpected release URL: ${url}`)
    },
  })
  const dependencies = createStandaloneUpdateDependencies({
    ...production,
    writeFile: async (path, bytes, mode) => {
      calls.writes.push(path)
      return production.writeFile(path, bytes, mode)
    },
    chmod: async (path, mode) => {
      calls.chmods.push(path)
      return production.chmod(path, mode)
    },
    rename: async (from, to) => {
      calls.renames.push(`${from}->${to}`)
      return production.rename(from, to)
    },
    replaceExecutable: async (from, to) => {
      calls.replacements.push(`${from}->${to}`)
      return production.replaceExecutable(from, to)
    },
    removeFile: async (path) => {
      calls.removals.push(path)
      return production.removeFile(path)
    },
    acquireLock: async (path) => {
      calls.locks.push(path)
      return production.acquireLock(path)
    },
    releaseLock: async (path) => {
      calls.releases.push(path)
      return production.releaseLock(path)
    },
  })
  return {
    root,
    targetPath,
    canonicalPath,
    registryPath,
    record,
    targetBytes,
    registryBytes,
    candidateBytes,
    candidateSha256,
    paths,
    calls,
    dependencies,
  }
}

async function writeFixtureRegistry(
  fixture: StandaloneUpdateFixture,
  overrides: Partial<StandaloneInstallationRecord>,
): Promise<void> {
  const record = { ...fixture.record, ...overrides }
  await writeFile(fixture.registryPath, `${JSON.stringify(registryFor(record), null, 4)}\n`)
}

async function readFileOrMissing(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

function fixtureMutationCount(fixture: StandaloneUpdateFixture): number {
  return fixture.calls.writes.length
    + fixture.calls.chmods.length
    + fixture.calls.renames.length
    + fixture.calls.replacements.length
    + fixture.calls.removals.length
    + fixture.calls.locks.length
    + fixture.calls.releases.length
}

async function expectNoTransactionArtifacts(fixture: StandaloneUpdateFixture): Promise<void> {
  for (const path of Object.values(fixture.paths)) {
    expect(await readFileOrMissing(path), path).toBeNull()
  }
}

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
