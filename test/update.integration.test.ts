import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  createStandaloneUpdateDependencies,
  LATEST_RELEASE_URL,
  registryKeyForCanonicalPath,
  resolveStandaloneRegistryPath,
  runStandaloneUpdate,
  type StandaloneInstallationRecord,
  type StandaloneInstallationRegistry,
  type StandaloneUpdateDependencies,
} from "../src/update.ts"
import { KITTEN_VERSION } from "../src/version.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("standalone update filesystem/release integration", () => {
  it("updates an installer-shaped target from local release responses without executing it", async () => {
    const fixture = await createFixture("9.9.9")

    expect(await runStandaloneUpdate(fixture.dependencies)).toEqual({
      kind: "updated",
      channel: "standalone",
      from: KITTEN_VERSION,
      to: "9.9.9",
    })
    expect(await readFile(fixture.targetPath)).toEqual(Buffer.from(fixture.candidateBytes))
    const registry = JSON.parse(await readFile(fixture.registryPath, "utf8")) as StandaloneInstallationRegistry
    expect(registry.installations[fixture.registryKey]).toEqual({
      ...fixture.record,
      version: "9.9.9",
      sha256: sha256(fixture.candidateBytes),
    })
    expect(fixture.requests).toEqual([
      LATEST_RELEASE_URL,
      "https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v9.9.9/kitten-linux-x64",
      "https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v9.9.9/SHA256SUMS",
    ])
    expect(await exists(fixture.executionSentinel)).toBe(false)
    await expectOnlyFixtureFiles(fixture)
  })

  it("performs no lock, file, registry, or artifact activity when already current", async () => {
    const fixture = await createFixture(KITTEN_VERSION)
    const dependencies = createStandaloneUpdateDependencies({
      ...fixture.dependencies,
      fetchBytes: async () => { throw new Error("artifact fetch must not run") },
      acquireLock: async () => { throw new Error("lock must not run") },
      writeFile: async () => { throw new Error("write must not run") },
      chmod: async () => { throw new Error("chmod must not run") },
      rename: async () => { throw new Error("rename must not run") },
      replaceExecutable: async () => { throw new Error("replacement must not run") },
      removeFile: async () => { throw new Error("cleanup must not run") },
    })

    expect(await runStandaloneUpdate(dependencies)).toEqual({
      kind: "already-current",
      channel: "standalone",
      version: KITTEN_VERSION,
    })
    expect(await readFile(fixture.targetPath)).toEqual(Buffer.from(fixture.targetBytes))
    expect(await readFile(fixture.registryPath)).toEqual(Buffer.from(fixture.registryBytes))
    expect(fixture.requests).toEqual([LATEST_RELEASE_URL])
    await expectOnlyFixtureFiles(fixture)
  })

  it("preserves exact bytes after induced target and registry publication failures", async () => {
    for (const failure of ["target", "registry"] as const) {
      const fixture = await createFixture("9.9.9")
      const base = fixture.dependencies
      const dependencies: StandaloneUpdateDependencies = createStandaloneUpdateDependencies({
        ...base,
        replaceExecutable: async (from, to) => {
          if (failure === "target") throw new Error("induced target replacement failure")
          return base.replaceExecutable(from, to)
        },
        rename: async (from, to) => {
          if (failure === "registry" && to === fixture.registryPath) {
            throw new Error("induced registry publication failure")
          }
          return base.rename(from, to)
        },
      })

      expect((await runStandaloneUpdate(dependencies)).kind, failure).toBe("failed")
      expect(await readFile(fixture.targetPath), failure).toEqual(Buffer.from(fixture.targetBytes))
      expect(await readFile(fixture.registryPath), failure).toEqual(Buffer.from(fixture.registryBytes))
      expect(await exists(fixture.executionSentinel), failure).toBe(false)
      await expectOnlyFixtureFiles(fixture)
    }
  })
})

interface Fixture {
  root: string
  targetPath: string
  registryPath: string
  registryKey: string
  record: StandaloneInstallationRecord
  targetBytes: Uint8Array
  registryBytes: Uint8Array
  candidateBytes: Uint8Array
  executionSentinel: string
  requests: string[]
  dependencies: StandaloneUpdateDependencies
}

async function createFixture(releaseVersion: string): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "kitten-update-integration-"))
  roots.push(root)
  const targetPath = join(root, "bin", "kitten")
  const stateHome = join(root, "state")
  const registryPath = resolveStandaloneRegistryPath({ XDG_STATE_HOME: stateHome }, root)
  const executionSentinel = join(root, "candidate-was-executed")
  await mkdir(dirname(targetPath), { recursive: true })
  await mkdir(dirname(registryPath), { recursive: true })
  const targetBytes = new TextEncoder().encode("installed-version")
  const candidateBytes = new TextEncoder().encode(`#!/bin/sh\ntouch ${executionSentinel}\n`)
  await writeFile(targetPath, targetBytes, { mode: 0o755 })
  await chmod(targetPath, 0o755)
  const canonicalPath = await realpath(targetPath)
  const key = registryKeyForCanonicalPath(canonicalPath, sha256)
  if (!key.ok) throw new Error("fixture canonical path did not produce a registry key")
  const record: StandaloneInstallationRecord = {
    schemaVersion: 1,
    canonicalPath,
    platform: "linux-x64",
    version: KITTEN_VERSION,
    sha256: sha256(targetBytes),
  }
  const registry: StandaloneInstallationRegistry = {
    schemaVersion: 1,
    installations: { [key.value]: record },
  }
  const registryBytes = new TextEncoder().encode(`${JSON.stringify(registry, null, 4)}\n`)
  await writeFile(registryPath, registryBytes, { mode: 0o600 })
  const requests: string[] = []
  const candidateSha256 = sha256(candidateBytes)
  const artifactUrl = `https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v${releaseVersion}/kitten-linux-x64`
  const manifestUrl = `https://github.com/MatheusBBarni/Kitten/releases/download/kitten-v${releaseVersion}/SHA256SUMS`
  const dependencies = createStandaloneUpdateDependencies({
    resolveExecutable: async () => targetPath,
    environment: () => ({ XDG_STATE_HOME: stateHome }),
    homeDirectory: () => root,
    hostPlatform: () => "linux-x64",
    fetchJson: async (url) => {
      requests.push(url)
      if (url !== LATEST_RELEASE_URL) throw new Error(`unexpected metadata URL ${url}`)
      return { draft: false, prerelease: false, tag_name: `kitten-v${releaseVersion}` }
    },
    fetchBytes: async (url) => {
      requests.push(url)
      if (url === artifactUrl) return candidateBytes
      if (url === manifestUrl) {
        return new TextEncoder().encode(`${candidateSha256}  kitten-linux-x64\n`)
      }
      throw new Error(`unexpected asset URL ${url}`)
    },
  })
  return {
    root,
    targetPath,
    registryPath,
    registryKey: key.value,
    record,
    targetBytes,
    registryBytes,
    candidateBytes,
    executionSentinel,
    requests,
    dependencies,
  }
}

async function expectOnlyFixtureFiles(fixture: Fixture): Promise<void> {
  expect(await readdir(dirname(fixture.targetPath))).toEqual(["kitten"])
  expect(await readdir(dirname(fixture.registryPath))).toEqual(["standalone-installations.json"])
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
