/**
 * Standalone-update trust primitives.
 *
 * This outer-layer module deliberately owns no ACP, core, store, app, or UI
 * concern. Task 01 keeps release, filesystem, and replacement effects behind
 * contracts while providing only pure validation and a read-only ownership load.
 */

import { createHash, randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join } from "node:path"

import { artifactName, BUILD_TARGETS, CHECKSUM_MANIFEST } from "../scripts/build.ts"
import { KITTEN_VERSION } from "./version.ts"

export const STANDALONE_REGISTRY_SCHEMA_VERSION = 1 as const
export const STANDALONE_REGISTRY_FILE = "standalone-installations.json"
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/MatheusBBarni/Kitten/releases/latest"
export const RELEASE_DOWNLOAD_BASE_URL =
  "https://github.com/MatheusBBarni/Kitten/releases/download"

export const NPM_RECOVERY_COMMAND = "npm install --global @matheusbbarni/kitten@latest"
export const STANDALONE_RECOVERY_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash"

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const STABLE_RELEASE_TAG = /^kitten-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export interface StandaloneInstallationRecord {
  schemaVersion: 1
  canonicalPath: string
  platform: string
  version: string
  sha256: string
}

export interface StandaloneInstallationRegistry {
  schemaVersion: 1
  installations: Record<string, StandaloneInstallationRecord>
}

export interface StandaloneInstallationRecordInput {
  targetPath: string
  platform: string
  sha256: string
}

export interface StableRelease {
  tag: string
  version: string
}

export interface HostArtifact {
  platform: string
  artifact: string
}

export interface ReleaseCandidate extends StableRelease, HostArtifact {
  expectedSha256: string
}

/**
 * Every effect the standalone updater will eventually need is explicit here.
 * Task 01 invokes only the read-only subset in {@link loadStandaloneInstallation}.
 */
export interface UpdateDependencies {
  fetchJson(url: string): Promise<unknown>
  fetchBytes(url: string): Promise<Uint8Array>
  sha256(bytes: Uint8Array): string
  resolveExecutable(): Promise<string>
  canonicalizePath(path: string): Promise<string>
  isRegularFile(path: string): Promise<boolean>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, bytes: Uint8Array, mode?: number): Promise<void>
  rename(from: string, to: string): Promise<void>
  replaceExecutable(candidatePath: string, targetPath: string): Promise<void>
  environment(): Record<string, string | undefined>
  homeDirectory(): string
}

export interface StandaloneTransactionPaths {
  lock: string
  candidate: string
  backup: string
  registryCandidate: string
  registrySnapshot: string
  targetRestore: string
  registryRestore: string
}

export interface StandaloneUpdateDependencies extends UpdateDependencies {
  hostPlatform(): string
  isSymbolicLink(path: string): Promise<boolean>
  fileMode(path: string): Promise<number>
  chmod(path: string, mode: number): Promise<void>
  removeFile(path: string): Promise<void>
  pathExists(path: string): Promise<boolean>
  acquireLock(path: string): Promise<void>
  releaseLock(path: string): Promise<void>
  transactionPaths(targetPath: string, registryPath: string): StandaloneTransactionPaths
}

export type UpdateOutcome =
  | { kind: "updated"; channel: "standalone"; from: string; to: string }
  | { kind: "already-current"; channel: "standalone" | "npm"; version: string }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string }

export type RefusedUpdateOutcome = Extract<UpdateOutcome, { kind: "refused" }>
export type FailedUpdateOutcome = Extract<UpdateOutcome, { kind: "failed" }>

export type PrimitiveResult<T> =
  | { ok: true; value: T }
  | { ok: false; outcome: RefusedUpdateOutcome }

export type StandaloneReadDependencies = Pick<
  UpdateDependencies,
  | "sha256"
  | "resolveExecutable"
  | "canonicalizePath"
  | "isRegularFile"
  | "readFile"
  | "environment"
  | "homeDirectory"
>

export interface StandaloneRecordWriterDependencies extends StandaloneReadDependencies {
  hostPlatform(): string
  makeDirectory(path: string): Promise<void>
  writeTemporaryFile(path: string, bytes: Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  removeFile(path: string): Promise<void>
  temporaryPath(registryPath: string): string
}

/** Resolve the standalone registry without reusing first-run `state.json`. */
export function resolveStandaloneRegistryPath(
  env: Record<string, string | undefined> = process.env,
  homeDirectory: string = homedir(),
): string {
  const stateHome = env.XDG_STATE_HOME || join(homeDirectory, ".local", "state")
  return join(stateHome, "kitten", STANDALONE_REGISTRY_FILE)
}

/** The registry key is the full lowercase SHA-256 of the canonical path bytes. */
export function registryKeyForCanonicalPath(
  canonicalPath: string,
  sha256: (bytes: Uint8Array) => string = defaultSha256,
): PrimitiveResult<string> {
  if (!isAbsolute(canonicalPath)) return refused("the standalone path is not absolute")
  const digest = sha256(new TextEncoder().encode(canonicalPath))
  if (!LOWERCASE_SHA256.test(digest)) return refused("the canonical-path digest is invalid")
  return accepted(digest)
}

/** Select only one of the platform artifacts emitted by the release build. */
export function resolveHostArtifact(platform: string, arch?: string): PrimitiveResult<HostArtifact> {
  const platformName = arch === undefined
    ? platform
    : `${platform === "win32" ? "windows" : platform}-${arch}`
  const target = BUILD_TARGETS.find((candidate) => candidate.platform === platformName)
  if (!target) return refused(`the host platform ${platformName} is not supported`)
  return accepted({ platform: target.platform, artifact: artifactName(target) })
}

/** Accept stable Kitten tags only; prerelease/build suffixes and whitespace fail. */
export function parseStableReleaseTag(tag: unknown): PrimitiveResult<StableRelease> {
  if (typeof tag !== "string") return refused("the release tag is missing or invalid")
  const match = STABLE_RELEASE_TAG.exec(tag)
  if (!match) return refused("the release tag is not a stable Kitten version")
  return accepted({ tag, version: tag.slice("kitten-v".length) })
}

/** Validate the relevant GitHub latest-release metadata without trusting extras. */
export function parseStableReleaseMetadata(metadata: unknown): PrimitiveResult<StableRelease> {
  if (!isObject(metadata)) return refused("the latest release metadata is malformed")
  if (metadata.draft !== false || metadata.prerelease !== false) {
    return refused("the latest release is a draft or prerelease")
  }
  return parseStableReleaseTag(metadata.tag_name)
}

/**
 * Parse the release manifest strictly and return the selected artifact checksum.
 * Every row must use the build contract's exact `<hash>  <artifact>` shape, every
 * artifact must be shipped, and no artifact may appear more than once.
 */
export function parseManifestChecksum(source: unknown, selectedArtifact: string): PrimitiveResult<string> {
  const supportedArtifacts = new Set(BUILD_TARGETS.map((target) => artifactName(target)))
  if (!supportedArtifacts.has(selectedArtifact)) return refused("the selected artifact is not supported")
  if (typeof source !== "string" || source.length === 0 || source.includes("\r")) {
    return refused("the checksum manifest is malformed")
  }

  const rows = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n")
  if (rows.length === 0 || rows.some((row) => row.length === 0)) {
    return refused("the checksum manifest is malformed")
  }

  const checksums = new Map<string, string>()
  for (const row of rows) {
    const match = /^([0-9a-f]{64})  (kitten-[a-z0-9-]+)$/.exec(row)
    if (!match) return refused("the checksum manifest contains a malformed row")
    const [, checksum, artifact] = match
    if (!checksum || !artifact || !supportedArtifacts.has(artifact)) {
      return refused("the checksum manifest contains an unexpected artifact")
    }
    if (checksums.has(artifact)) return refused("the checksum manifest contains a duplicate artifact")
    checksums.set(artifact, checksum)
  }

  const selectedChecksum = checksums.get(selectedArtifact)
  if (!selectedChecksum) return refused("the checksum manifest does not contain the selected artifact")
  return accepted(selectedChecksum)
}

/** Validate a parsed registry and select the one record for `canonicalPath`. */
export function validateStandaloneRegistry(
  raw: unknown,
  canonicalPath: string,
  sha256: (bytes: Uint8Array) => string,
): PrimitiveResult<StandaloneInstallationRecord> {
  const registry = validateStandaloneRegistryEnvelope(raw, sha256)
  if (!registry.ok) return registry

  const requestedKey = registryKeyForCanonicalPath(canonicalPath, sha256)
  if (!requestedKey.ok) return requestedKey
  const selected = registry.value.installations[requestedKey.value]
  if (!selected) return refused("the running executable has no standalone installation record")
  if (selected.canonicalPath !== canonicalPath) {
    return refused("the standalone installation record does not match the running executable")
  }
  return accepted(selected)
}

/** Validate every registry record without requiring one particular target to exist. */
export function validateStandaloneRegistryEnvelope(
  raw: unknown,
  sha256: (bytes: Uint8Array) => string,
): PrimitiveResult<StandaloneInstallationRegistry> {
  if (!hasExactKeys(raw, ["schemaVersion", "installations"])) {
    return refused("the standalone registry envelope is malformed")
  }
  if (raw.schemaVersion !== STANDALONE_REGISTRY_SCHEMA_VERSION || !isObject(raw.installations)) {
    return refused("the standalone registry schema is unsupported")
  }

  const canonicalPaths = new Set<string>()
  const installations: Record<string, StandaloneInstallationRecord> = {}
  for (const [key, value] of Object.entries(raw.installations)) {
    const record = validateRecord(value)
    if (!record.ok) return record
    const expectedKey = registryKeyForCanonicalPath(record.value.canonicalPath, sha256)
    if (!expectedKey.ok || expectedKey.value !== key) {
      return refused("a standalone registry key does not match its canonical path")
    }
    if (canonicalPaths.has(record.value.canonicalPath)) {
      return refused("the standalone registry contains a duplicate canonical path")
    }
    canonicalPaths.add(record.value.canonicalPath)
    installations[key] = record.value
  }
  return accepted({
    schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
    installations,
  })
}

/**
 * Record one installer-owned executable after proving the installed bytes and the
 * running compiled binary are the same canonical regular file.
 */
export async function recordStandaloneInstallation(
  input: StandaloneInstallationRecordInput,
  dependencies: StandaloneRecordWriterDependencies = createStandaloneRecordWriterDependencies(),
  embeddedVersion: string = KITTEN_VERSION,
): Promise<PrimitiveResult<StandaloneInstallationRecord>> {
  let temporaryPath: string | undefined
  try {
    const canonicalPath = await dependencies.canonicalizePath(input.targetPath)
    const executablePath = await dependencies.canonicalizePath(await dependencies.resolveExecutable())
    if (canonicalPath !== executablePath) {
      return refused("the installed target does not match the running record writer")
    }
    if (!(await dependencies.isRegularFile(canonicalPath))) {
      return refused("the installed target is not a canonical regular file")
    }
    if (input.platform !== dependencies.hostPlatform()) {
      return refused("the installed target platform does not match the running record writer")
    }

    const record = validateRecord({
      schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
      canonicalPath,
      platform: input.platform,
      version: embeddedVersion,
      sha256: input.sha256,
    })
    if (!record.ok) return record

    const executableBytes = await dependencies.readFile(canonicalPath)
    const actualSha256 = dependencies.sha256(executableBytes)
    if (!LOWERCASE_SHA256.test(actualSha256) || actualSha256 !== record.value.sha256) {
      return refused("the installed target does not match the verified SHA-256")
    }

    const registryPath = resolveStandaloneRegistryPath(
      dependencies.environment(),
      dependencies.homeDirectory(),
    )
    const existing = await readRegistryForWrite(registryPath, dependencies)
    if (!existing.ok) return existing
    const key = registryKeyForCanonicalPath(canonicalPath, dependencies.sha256)
    if (!key.ok) return key
    const registry: StandaloneInstallationRegistry = {
      schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
      installations: {
        ...existing.value.installations,
        [key.value]: record.value,
      },
    }
    const validated = validateStandaloneRegistryEnvelope(registry, dependencies.sha256)
    if (!validated.ok) return validated

    const registryBytes = new TextEncoder().encode(`${JSON.stringify(validated.value, null, 2)}\n`)
    await dependencies.makeDirectory(dirname(registryPath))
    temporaryPath = dependencies.temporaryPath(registryPath)
    await dependencies.writeTemporaryFile(temporaryPath, registryBytes)
    await dependencies.rename(temporaryPath, registryPath)
    temporaryPath = undefined
    return accepted(record.value)
  } catch {
    return refused("the standalone installation record could not be written safely")
  } finally {
    if (temporaryPath) {
      try {
        await dependencies.removeFile(temporaryPath)
      } catch {
        // Best-effort cleanup only; the canonical registry was never published.
      }
    }
  }
}

/** Built-in-only production effects for the installer-owned record path. */
export function createStandaloneRecordWriterDependencies(
  overrides: Partial<StandaloneRecordWriterDependencies> = {},
): StandaloneRecordWriterDependencies {
  return {
    sha256: defaultSha256,
    resolveExecutable: async () => process.execPath,
    canonicalizePath: realpath,
    isRegularFile: async (path) => (await stat(path)).isFile(),
    readFile,
    environment: () => process.env,
    homeDirectory: homedir,
    hostPlatform: () => `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`,
    makeDirectory: async (path) => { await mkdir(path, { recursive: true }) },
    writeTemporaryFile: async (path, bytes) => { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }) },
    rename,
    removeFile: async (path) => { await rm(path, { force: true }) },
    temporaryPath: (registryPath) => `${registryPath}.${process.pid}.${randomUUID()}.tmp`,
    ...overrides,
  }
}

/**
 * Load and positively validate standalone ownership without fetching or mutating.
 * Invalid, unreadable, changed, or stale state becomes one explicit refusal.
 */
export async function loadStandaloneInstallation(
  dependencies: StandaloneReadDependencies,
  embeddedVersion: string = KITTEN_VERSION,
): Promise<PrimitiveResult<StandaloneInstallationRecord>> {
  try {
    const executable = await dependencies.resolveExecutable()
    const canonicalPath = await dependencies.canonicalizePath(executable)
    if (!(await dependencies.isRegularFile(canonicalPath))) {
      return refused("the running executable is not a canonical regular file")
    }

    const registryPath = resolveStandaloneRegistryPath(
      dependencies.environment(),
      dependencies.homeDirectory(),
    )
    const registryBytes = await dependencies.readFile(registryPath)
    const source = new TextDecoder("utf-8", { fatal: true }).decode(registryBytes)
    const raw: unknown = JSON.parse(source)
    const selected = validateStandaloneRegistry(raw, canonicalPath, dependencies.sha256)
    if (!selected.ok) return selected
    if (selected.value.version !== embeddedVersion) {
      return refused("the standalone installation record has a stale version")
    }

    const executableBytes = await dependencies.readFile(canonicalPath)
    if (dependencies.sha256(executableBytes) !== selected.value.sha256) {
      return refused("the standalone installation record has a stale executable hash")
    }
    return selected
  } catch {
    return refused("the standalone installation record could not be read safely")
  }
}

/** Built-in production effects for the fail-closed standalone transaction. */
export function createStandaloneUpdateDependencies(
  overrides: Partial<StandaloneUpdateDependencies> = {},
): StandaloneUpdateDependencies {
  return {
    fetchJson: async (url) => {
      const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" } })
      if (!response.ok) throw new Error(`release metadata request failed with ${response.status}`)
      return response.json() as Promise<unknown>
    },
    fetchBytes: async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`release asset request failed with ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    sha256: defaultSha256,
    resolveExecutable: async () => process.execPath,
    canonicalizePath: realpath,
    isRegularFile: async (path) => (await stat(path)).isFile(),
    isSymbolicLink: async (path) => (await lstat(path)).isSymbolicLink(),
    fileMode: async (path) => (await stat(path)).mode & 0o777,
    readFile,
    writeFile: async (path, bytes, mode = 0o600) => {
      await writeFile(path, bytes, { flag: "wx", mode })
    },
    chmod,
    rename,
    replaceExecutable: rename,
    removeFile: async (path) => { await rm(path, { force: true }) },
    pathExists: async (path) => {
      try {
        await lstat(path)
        return true
      } catch (error) {
        if (isMissingFileError(error)) return false
        throw error
      }
    },
    acquireLock: async (path) => {
      await writeFile(path, new Uint8Array(), { flag: "wx", mode: 0o600 })
    },
    releaseLock: async (path) => { await rm(path) },
    transactionPaths: defaultTransactionPaths,
    environment: () => process.env,
    homeDirectory: homedir,
    hostPlatform: () => `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`,
    ...overrides,
  }
}

/**
 * Update one installer-proven standalone executable without ever selecting npm.
 * Ownership and candidate validation finish before the transaction writes a byte.
 */
export async function runStandaloneUpdate(
  dependencies: StandaloneUpdateDependencies = createStandaloneUpdateDependencies(),
  embeddedVersion: string = KITTEN_VERSION,
): Promise<UpdateOutcome> {
  const ownership = await loadStandaloneOwnership(dependencies, embeddedVersion)
  if (!ownership.ok) return ownership.outcome

  let releaseMetadata: unknown
  try {
    releaseMetadata = await dependencies.fetchJson(LATEST_RELEASE_URL)
  } catch {
    return failed("the latest standalone release metadata could not be retrieved safely")
  }
  const release = parseStableReleaseMetadata(releaseMetadata)
  if (!release.ok) return release.outcome
  if (release.value.version === embeddedVersion) {
    return { kind: "already-current", channel: "standalone", version: embeddedVersion }
  }

  const artifactUrl = releaseAssetUrl(release.value.tag, ownership.value.host.artifact)
  const manifestUrl = releaseAssetUrl(release.value.tag, CHECKSUM_MANIFEST)
  let candidateBytes: Uint8Array
  let manifestBytes: Uint8Array
  try {
    candidateBytes = await dependencies.fetchBytes(artifactUrl)
  } catch {
    return failed("the standalone release artifact could not be retrieved safely")
  }
  try {
    manifestBytes = await dependencies.fetchBytes(manifestUrl)
  } catch {
    return failed("the standalone checksum manifest could not be retrieved safely")
  }

  let manifestSource: string
  try {
    manifestSource = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)
  } catch {
    return { kind: "refused", message: "the checksum manifest is malformed" }
  }
  const expectedChecksum = parseManifestChecksum(manifestSource, ownership.value.host.artifact)
  if (!expectedChecksum.ok) return expectedChecksum.outcome
  const candidateSha256 = dependencies.sha256(candidateBytes)
  if (!LOWERCASE_SHA256.test(candidateSha256) || candidateSha256 !== expectedChecksum.value) {
    return { kind: "refused", message: "the standalone release artifact does not match its published SHA-256" }
  }

  const nextRegistry = updateRegistryRecord(
    ownership.value.registry,
    ownership.value.record,
    release.value.version,
    candidateSha256,
    dependencies.sha256,
  )
  if (!nextRegistry.ok) return nextRegistry.outcome
  const nextRegistryBytes = new TextEncoder().encode(`${JSON.stringify(nextRegistry.value, null, 2)}\n`)
  return commitStandaloneUpdate(
    ownership.value,
    candidateBytes,
    nextRegistryBytes,
    release.value.version,
    dependencies,
  )
}

/** Deterministic terminal text shared by all structured update outcomes. */
export function formatUpdateOutcome(outcome: UpdateOutcome): string {
  switch (outcome.kind) {
    case "updated":
      return `Kitten updated via ${outcome.channel}: ${outcome.from} -> ${outcome.to}.`
    case "already-current":
      return `Kitten is already current via ${outcome.channel} at version ${outcome.version}.\nNo change occurred.`
    case "refused":
      return formatNoChangeOutcome("refused", outcome.message)
    case "failed":
      return formatNoChangeOutcome("failed", outcome.message)
  }
}

interface StandaloneOwnership {
  canonicalPath: string
  registryPath: string
  record: StandaloneInstallationRecord
  registry: StandaloneInstallationRegistry
  targetBytes: Uint8Array
  registryBytes: Uint8Array
  targetMode: number
  host: HostArtifact
}

async function loadStandaloneOwnership(
  dependencies: StandaloneUpdateDependencies,
  embeddedVersion: string,
): Promise<PrimitiveResult<StandaloneOwnership>> {
  try {
    const executablePath = await dependencies.resolveExecutable()
    if (await dependencies.isSymbolicLink(executablePath)) {
      return refused("the running executable path is a symbolic link")
    }
    const canonicalPath = await dependencies.canonicalizePath(executablePath)
    if (!(await dependencies.isRegularFile(canonicalPath))) {
      return refused("the running executable is not a canonical regular file")
    }
    const targetMode = await dependencies.fileMode(canonicalPath)
    if ((targetMode & 0o111) === 0) {
      return refused("the recorded standalone target is not executable")
    }

    const host = resolveHostArtifact(dependencies.hostPlatform())
    if (!host.ok) return host
    const registryPath = resolveStandaloneRegistryPath(
      dependencies.environment(),
      dependencies.homeDirectory(),
    )
    const registryBytes = await dependencies.readFile(registryPath)
    const registrySource = new TextDecoder("utf-8", { fatal: true }).decode(registryBytes)
    const rawRegistry: unknown = JSON.parse(registrySource)
    const registry = validateStandaloneRegistryEnvelope(rawRegistry, dependencies.sha256)
    if (!registry.ok) return registry
    const selected = validateStandaloneRegistry(rawRegistry, canonicalPath, dependencies.sha256)
    if (!selected.ok) return selected
    if (selected.value.platform !== host.value.platform) {
      return refused("the standalone installation record does not match the host platform")
    }
    if (selected.value.version !== embeddedVersion) {
      return refused("the standalone installation record has a stale version")
    }

    const targetBytes = await dependencies.readFile(canonicalPath)
    const targetSha256 = dependencies.sha256(targetBytes)
    if (!LOWERCASE_SHA256.test(targetSha256) || targetSha256 !== selected.value.sha256) {
      return refused("the standalone installation record has a stale executable hash")
    }
    return accepted({
      canonicalPath,
      registryPath,
      record: selected.value,
      registry: registry.value,
      targetBytes,
      registryBytes,
      targetMode,
      host: host.value,
    })
  } catch {
    return refused("standalone ownership could not be validated safely")
  }
}

function updateRegistryRecord(
  registry: StandaloneInstallationRegistry,
  current: StandaloneInstallationRecord,
  version: string,
  sha256: string,
  hash: (bytes: Uint8Array) => string,
): PrimitiveResult<StandaloneInstallationRegistry> {
  const key = registryKeyForCanonicalPath(current.canonicalPath, hash)
  if (!key.ok) return key
  const next: StandaloneInstallationRegistry = {
    schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
    installations: {
      ...registry.installations,
      [key.value]: { ...current, version, sha256 },
    },
  }
  return validateStandaloneRegistryEnvelope(next, hash)
}

async function commitStandaloneUpdate(
  ownership: StandaloneOwnership,
  candidateBytes: Uint8Array,
  nextRegistryBytes: Uint8Array,
  candidateVersion: string,
  dependencies: StandaloneUpdateDependencies,
): Promise<UpdateOutcome> {
  const paths = dependencies.transactionPaths(ownership.canonicalPath, ownership.registryPath)
  try {
    await dependencies.acquireLock(paths.lock)
  } catch {
    return { kind: "refused", message: "the standalone target is locked or could not be locked safely" }
  }

  const stillOwned = await ownershipSnapshotMatches(ownership, dependencies)
  if (!stillOwned) {
    try {
      await dependencies.releaseLock(paths.lock)
      return { kind: "refused", message: "the standalone target or registry changed before replacement" }
    } catch {
      return failed("the standalone target changed and its update lock could not be cleaned safely")
    }
  }

  try {
    if (await anyPathExists(paths, dependencies)) {
      throw new Error("transaction path collision")
    }
    await dependencies.writeFile(paths.candidate, candidateBytes, 0o600)
    await dependencies.chmod(paths.candidate, 0o700)
    await dependencies.writeFile(paths.registryCandidate, nextRegistryBytes, 0o600)
    await dependencies.writeFile(paths.registrySnapshot, ownership.registryBytes, 0o600)

    await dependencies.rename(ownership.canonicalPath, paths.backup)
    await dependencies.chmod(paths.backup, 0o600)
    await dependencies.replaceExecutable(paths.candidate, ownership.canonicalPath)
    await dependencies.chmod(ownership.canonicalPath, ownership.targetMode)
    await dependencies.rename(paths.registryCandidate, ownership.registryPath)

    await dependencies.removeFile(paths.registrySnapshot)
    await dependencies.removeFile(paths.backup)
    await dependencies.releaseLock(paths.lock)
    return {
      kind: "updated",
      channel: "standalone",
      from: ownership.record.version,
      to: candidateVersion,
    }
  } catch {
    const restored = await rollbackStandaloneUpdate(ownership, paths, dependencies)
    const cleaned = await cleanupTransactionPaths(paths, dependencies, !restored)
    let lockReleased = true
    try {
      await dependencies.releaseLock(paths.lock)
    } catch {
      lockReleased = false
    }
    return failed(
      restored && cleaned && lockReleased
        ? "the standalone update transaction failed; the previous executable and registry were restored"
        : "the standalone update transaction failed and recovery evidence is inconclusive",
    )
  }
}

async function ownershipSnapshotMatches(
  ownership: StandaloneOwnership,
  dependencies: StandaloneUpdateDependencies,
): Promise<boolean> {
  try {
    const executablePath = await dependencies.resolveExecutable()
    if (await dependencies.isSymbolicLink(executablePath)) return false
    if (await dependencies.canonicalizePath(executablePath) !== ownership.canonicalPath) return false
    if (!(await dependencies.isRegularFile(ownership.canonicalPath))) return false
    if ((await dependencies.fileMode(ownership.canonicalPath)) !== ownership.targetMode) return false
    const [targetBytes, registryBytes] = await Promise.all([
      dependencies.readFile(ownership.canonicalPath),
      dependencies.readFile(ownership.registryPath),
    ])
    return bytesEqual(targetBytes, ownership.targetBytes) && bytesEqual(registryBytes, ownership.registryBytes)
  } catch {
    return false
  }
}

async function rollbackStandaloneUpdate(
  ownership: StandaloneOwnership,
  paths: StandaloneTransactionPaths,
  dependencies: StandaloneUpdateDependencies,
): Promise<boolean> {
  let targetRestored = false
  let registryRestored = false

  try {
    if (await dependencies.pathExists(paths.backup)) {
      try {
        await dependencies.chmod(paths.backup, ownership.targetMode)
      } finally {
        await dependencies.rename(paths.backup, ownership.canonicalPath)
      }
    } else {
      const current = await readFileOrUndefined(ownership.canonicalPath, dependencies)
      if (!current || !bytesEqual(current, ownership.targetBytes)) {
        await dependencies.writeFile(paths.targetRestore, ownership.targetBytes, 0o600)
        await dependencies.chmod(paths.targetRestore, ownership.targetMode)
        await dependencies.replaceExecutable(paths.targetRestore, ownership.canonicalPath)
      }
    }
    const restoredBytes = await dependencies.readFile(ownership.canonicalPath)
    const restoredMode = await dependencies.fileMode(ownership.canonicalPath)
    targetRestored = bytesEqual(restoredBytes, ownership.targetBytes) && restoredMode === ownership.targetMode
  } catch {
    targetRestored = false
  }

  try {
    const currentRegistry = await readFileOrUndefined(ownership.registryPath, dependencies)
    if (!currentRegistry || !bytesEqual(currentRegistry, ownership.registryBytes)) {
      if (await dependencies.pathExists(paths.registrySnapshot)) {
        await dependencies.rename(paths.registrySnapshot, ownership.registryPath)
      } else {
        await dependencies.writeFile(paths.registryRestore, ownership.registryBytes, 0o600)
        await dependencies.rename(paths.registryRestore, ownership.registryPath)
      }
    }
    const restoredRegistry = await dependencies.readFile(ownership.registryPath)
    registryRestored = bytesEqual(restoredRegistry, ownership.registryBytes)
  } catch {
    registryRestored = false
  }
  return targetRestored && registryRestored
}

async function cleanupTransactionPaths(
  paths: StandaloneTransactionPaths,
  dependencies: StandaloneUpdateDependencies,
  preserveRecoveryEvidence: boolean,
): Promise<boolean> {
  let cleaned = true
  const disposablePaths = [
    paths.candidate,
    paths.registryCandidate,
    paths.targetRestore,
    paths.registryRestore,
  ]
  if (!preserveRecoveryEvidence) {
    disposablePaths.push(paths.backup, paths.registrySnapshot)
  }
  for (const path of disposablePaths) {
    try {
      await dependencies.removeFile(path)
    } catch {
      cleaned = false
    }
  }
  return cleaned
}

async function anyPathExists(
  paths: StandaloneTransactionPaths,
  dependencies: StandaloneUpdateDependencies,
): Promise<boolean> {
  for (const path of [
    paths.candidate,
    paths.backup,
    paths.registryCandidate,
    paths.registrySnapshot,
    paths.targetRestore,
    paths.registryRestore,
  ]) {
    if (await dependencies.pathExists(path)) return true
  }
  return false
}

async function readFileOrUndefined(
  path: string,
  dependencies: StandaloneUpdateDependencies,
): Promise<Uint8Array | undefined> {
  try {
    return await dependencies.readFile(path)
  } catch (error) {
    if (isMissingFileError(error)) return undefined
    throw error
  }
}

function releaseAssetUrl(tag: string, asset: string): string {
  return `${RELEASE_DOWNLOAD_BASE_URL}/${tag}/${asset}`
}

function defaultTransactionPaths(targetPath: string, registryPath: string): StandaloneTransactionPaths {
  const transactionId = `${process.pid}.${randomUUID()}`
  const targetPrefix = join(dirname(targetPath), `.${basename(targetPath)}.${transactionId}`)
  const registryPrefix = join(dirname(registryPath), `.${basename(registryPath)}.${transactionId}`)
  return {
    lock: join(dirname(targetPath), `.${basename(targetPath)}.update.lock`),
    candidate: `${targetPrefix}.candidate`,
    backup: `${targetPrefix}.backup`,
    registryCandidate: `${registryPrefix}.candidate`,
    registrySnapshot: `${registryPrefix}.snapshot`,
    targetRestore: `${targetPrefix}.restore`,
    registryRestore: `${registryPrefix}.restore`,
  }
}

async function readRegistryForWrite(
  registryPath: string,
  dependencies: StandaloneRecordWriterDependencies,
): Promise<PrimitiveResult<StandaloneInstallationRegistry>> {
  try {
    const bytes = await dependencies.readFile(registryPath)
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return validateStandaloneRegistryEnvelope(JSON.parse(source) as unknown, dependencies.sha256)
  } catch (error) {
    if (isMissingFileError(error)) {
      return accepted({
        schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
        installations: {},
      })
    }
    return refused("the existing standalone installation registry is unreadable")
  }
}

function validateRecord(raw: unknown): PrimitiveResult<StandaloneInstallationRecord> {
  if (!hasExactKeys(raw, ["schemaVersion", "canonicalPath", "platform", "version", "sha256"])) {
    return refused("a standalone installation record is malformed")
  }
  if (raw.schemaVersion !== STANDALONE_REGISTRY_SCHEMA_VERSION) {
    return refused("a standalone installation record has an unsupported schema")
  }
  if (typeof raw.canonicalPath !== "string" || !isAbsolute(raw.canonicalPath)) {
    return refused("a standalone installation record has an invalid canonical path")
  }
  if (
    typeof raw.platform !== "string" ||
    !BUILD_TARGETS.some((target) => target.platform === raw.platform)
  ) {
    return refused("a standalone installation record has an unsupported platform")
  }
  if (typeof raw.version !== "string" || !STABLE_VERSION.test(raw.version)) {
    return refused("a standalone installation record has an invalid stable version")
  }
  if (typeof raw.sha256 !== "string" || !LOWERCASE_SHA256.test(raw.sha256)) {
    return refused("a standalone installation record has an invalid SHA-256")
  }
  return accepted({
    schemaVersion: STANDALONE_REGISTRY_SCHEMA_VERSION,
    canonicalPath: raw.canonicalPath,
    platform: raw.platform,
    version: raw.version,
    sha256: raw.sha256,
  })
}

function formatNoChangeOutcome(kind: "refused" | "failed", message: string): string {
  return [
    `Kitten update ${kind}: ${message}`,
    "No change occurred.",
    "Supported recovery commands:",
    NPM_RECOVERY_COMMAND,
    STANDALONE_RECOVERY_COMMAND,
  ].join("\n")
}

function defaultSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function accepted<T>(value: T): PrimitiveResult<T> {
  return { ok: true, value }
}

function refused(message: string): PrimitiveResult<never> {
  return { ok: false, outcome: { kind: "refused", message } }
}

function failed(message: string): FailedUpdateOutcome {
  return { kind: "failed", message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (!isObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isMissingFileError(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT"
}
