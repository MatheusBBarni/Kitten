import { createHash } from "node:crypto"
import { lstat, open, realpath } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"

import { contextSelectionKey } from "../core/contextPack.ts"
import type {
  BoundedArtifact,
  BoundedArtifactRead,
  BoundedArtifactReadResult,
  ContextPackMaterializationLimits,
  ContextPackMaterializationResult,
  ContextPackSourceReference,
  ContextSelection,
} from "../core/types.ts"
import {
  isBinaryRepositoryFilePrefix,
  isPathContainedBy,
  isSafeRepositoryRelativePath,
  REPOSITORY_FILE_PREFIX_BYTES,
} from "./fileDiscovery.ts"

export const CONTEXT_PACK_MAX_ARTIFACT_BYTES = 1024 * 1024
export const CONTEXT_PACK_MAX_TOTAL_BYTES = 4 * 1024 * 1024

const SHA256_DIGEST = /^[a-f0-9]{64}$/u
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

export interface ContextPackMaterializerStat {
  readonly dev: number | bigint
  readonly ino: number | bigint
  readonly size: number
  readonly mtimeMs: number
  isFile(): boolean
}

export interface ContextPackMaterializerFileSystem {
  lstat(path: string): Promise<ContextPackMaterializerStat>
  realpath(path: string): Promise<string>
  readPrefix(path: string, maxBytes: number): Promise<Uint8Array>
  readBounded(path: string, maxBytes: number): Promise<BoundedBytes>
}

export interface ContextPackMaterializerProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
  kill(signal?: number): void
}

export interface ContextPackMaterializerSpawnOptions {
  readonly cmd: string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdin: "ignore"
  readonly stdout: "pipe"
  readonly stderr: "ignore"
}

export type ContextPackMaterializerSpawn = (
  options: ContextPackMaterializerSpawnOptions,
) => ContextPackMaterializerProcess

export interface CreateContextPackMaterializerOptions {
  readonly fileSystem?: ContextPackMaterializerFileSystem
  readonly spawn?: ContextPackMaterializerSpawn
  readonly env?: Record<string, string | undefined>
}

export interface ContextPackMaterializer {
  read(
    workspaceRoot: string,
    request: BoundedArtifactRead,
    limits?: Partial<ContextPackMaterializationLimits>,
  ): Promise<BoundedArtifactReadResult>
  materialize(
    workspaceRoot: string,
    selections: readonly ContextSelection[],
    limits?: Partial<ContextPackMaterializationLimits>,
  ): Promise<ContextPackMaterializationResult>
}

type BoundedBytes =
  | { readonly kind: "ready"; readonly bytes: Uint8Array }
  | { readonly kind: "oversized" }

const nodeFileSystem: ContextPackMaterializerFileSystem = {
  lstat,
  realpath,
  async readPrefix(path, maxBytes) {
    const handle = await open(path, "r")
    try {
      const bytes = new Uint8Array(maxBytes)
      const { bytesRead } = await handle.read(bytes, 0, maxBytes, 0)
      return bytes.slice(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
  async readBounded(path, maxBytes) {
    const handle = await open(path, "r")
    try {
      const bytes = new Uint8Array(maxBytes + 1)
      let offset = 0
      while (offset < bytes.byteLength) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.byteLength - offset,
          offset,
        )
        if (bytesRead === 0) break
        offset += bytesRead
      }
      return offset > maxBytes
        ? { kind: "oversized" }
        : { kind: "ready", bytes: bytes.slice(0, offset) }
    } finally {
      await handle.close()
    }
  },
}

const spawnWithBun: ContextPackMaterializerSpawn = (options) => Bun.spawn(options)

export function createContextPackMaterializer(
  options: CreateContextPackMaterializerOptions = {},
): ContextPackMaterializer {
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const spawn = options.spawn ?? spawnWithBun
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.env,
    GIT_EXTERNAL_DIFF: undefined,
    GIT_DIFF_OPTS: undefined,
    GIT_PAGER: "cat",
    NO_COLOR: "1",
    LC_ALL: "C",
  }

  const readWithLimits = async (
    workspaceRoot: string,
    request: BoundedArtifactRead,
    limits: ContextPackMaterializationLimits,
  ): Promise<BoundedArtifactReadResult> => {
    if (!isAbsolute(workspaceRoot)) return blocked(request.path, "invalid_workspace")
    if (!isSafeRepositoryRelativePath(workspaceRoot, request.path)) {
      return blocked(request.path, "invalid_path")
    }
    if (request.kind === "file_slice" && !isValidRange(request.range)) {
      return blocked(request.path, "invalid_range")
    }
    if (
      request.kind === "diff" &&
      request.scope !== "staged" &&
      request.scope !== "unstaged"
    ) {
      return blocked(request.path, "unsupported_diff_scope")
    }

    let realRoot: string
    let before: ContextPackMaterializerStat
    let realSource: string
    const absolutePath = resolve(workspaceRoot, request.path)
    try {
      realRoot = await fileSystem.realpath(workspaceRoot)
      before = await fileSystem.lstat(absolutePath)
      if (!before.isFile()) return blocked(request.path, "ineligible_source")
      realSource = await fileSystem.realpath(absolutePath)
    } catch (error) {
      return blocked(request.path, fileFailureReason(error))
    }

    if (!isPathContainedBy(realRoot, realSource)) {
      return blocked(request.path, "outside_workspace")
    }

    try {
      const prefix = await fileSystem.readPrefix(realSource, REPOSITORY_FILE_PREFIX_BYTES)
      if (isBinaryRepositoryFilePrefix(prefix)) {
        return blocked(request.path, "binary_source")
      }
    } catch (error) {
      return blocked(request.path, fileFailureReason(error))
    }

    let bytes: Extract<BoundedBytes, { kind: "ready" }>
    if (request.kind === "diff") {
      const diff = await readDiff(spawn, env, workspaceRoot, request, limits.maxArtifactBytes)
      if (diff.kind === "oversized") return blocked(request.path, "oversized_artifact")
      if ("failed" in diff) return blocked(request.path, "diff_failed")
      bytes = diff
    } else {
      let fileBytes: BoundedBytes
      try {
        fileBytes = await fileSystem.readBounded(realSource, limits.maxArtifactBytes)
      } catch (error) {
        return blocked(request.path, fileFailureReason(error))
      }
      if (fileBytes.kind === "oversized") return blocked(request.path, "oversized_artifact")
      bytes = fileBytes
    }

    let after: ContextPackMaterializerStat
    let finalRealSource: string
    try {
      after = await fileSystem.lstat(absolutePath)
      if (!after.isFile()) return stale(request.path, "source_changed_during_read")
      finalRealSource = await fileSystem.realpath(absolutePath)
    } catch (error) {
      if (isMissingFileError(error)) return stale(request.path, "source_changed_during_read")
      return blocked(request.path, "ineligible_source")
    }
    if (
      realSource !== finalRealSource ||
      !sameStatSnapshot(before, after) ||
      !isPathContainedBy(realRoot, finalRealSource)
    ) {
      return stale(request.path, "source_changed_during_read")
    }

    if (isBinaryRepositoryFilePrefix(bytes.bytes)) {
      return blocked(request.path, "binary_source")
    }

    let sourceBytes = bytes.bytes
    let content: string
    try {
      content = decoder.decode(sourceBytes)
      if (request.kind === "file_slice") {
        const sliced = sliceLines(content, request.range.startLine, request.range.endLine)
        if (sliced === null) return blocked(request.path, "invalid_range")
        content = sliced
        sourceBytes = new TextEncoder().encode(content)
      }
    } catch {
      return blocked(request.path, "malformed_source")
    }

    return {
      kind: "ready",
      artifact: {
        source: sourceReference(
          request,
          before,
          sourceBytes,
          request.kind === "file_slice" ? bytes.bytes : sourceBytes,
        ),
        content,
      },
    }
  }

  return {
    async read(workspaceRoot, request, limitOverrides) {
      const limits = resolveLimits(limitOverrides)
      return limits === null
        ? blocked(request.path, "invalid_limits")
        : readWithLimits(workspaceRoot, request, limits)
    },

    async materialize(workspaceRoot, selections, limitOverrides) {
      const limits = resolveLimits(limitOverrides)
      if (limits === null) return { kind: "blocked", reason: "invalid_limits" }
      if (!isAbsolute(workspaceRoot)) return { kind: "blocked", reason: "invalid_workspace" }

      const artifacts = []
      let totalBytes = 0
      for (const selection of selections) {
        let selectionKey: string
        try {
          selectionKey = contextSelectionKey(selection)
        } catch {
          return { kind: "blocked", reason: "malformed_source", path: selection.path }
        }
        if (!isValidSourceReference(selection.source)) {
          return {
            kind: "blocked",
            reason: "malformed_source",
            selectionKey,
            path: selection.path,
          }
        }

        const request = readRequestFor(selection)
        if (request === null) {
          return {
            kind: "blocked",
            reason: "unsupported_diff_scope",
            selectionKey,
            path: selection.path,
          }
        }
        const result = await readWithLimits(workspaceRoot, request, limits)
        if (result.kind === "blocked") {
          return { ...result, selectionKey }
        }
        if (result.kind === "stale") {
          return { ...result, selectionKey }
        }

        const actual = result.artifact.source
        const staleReason = sourceDriftReason(selection.source, actual)
        if (staleReason !== null) {
          return {
            kind: "stale",
            reason: staleReason,
            selectionKey,
            path: selection.path,
          }
        }

        if (totalBytes + actual.bytes > limits.maxTotalBytes) {
          return {
            kind: "blocked",
            reason: "total_bytes_exceeded",
            selectionKey,
            path: selection.path,
          }
        }
        totalBytes += actual.bytes
        artifacts.push({
          selectionKey,
          source: actual,
          content: result.artifact.content,
        })
      }

      return { kind: "materialized", artifacts, totalBytes }
    },
  }
}

export const contextPackMaterializer = createContextPackMaterializer()

function resolveLimits(
  overrides: Partial<ContextPackMaterializationLimits> | undefined,
): ContextPackMaterializationLimits | null {
  const maxArtifactBytes = overrides?.maxArtifactBytes ?? CONTEXT_PACK_MAX_ARTIFACT_BYTES
  const maxTotalBytes = overrides?.maxTotalBytes ?? CONTEXT_PACK_MAX_TOTAL_BYTES
  if (
    !Number.isSafeInteger(maxArtifactBytes) ||
    maxArtifactBytes <= 0 ||
    maxArtifactBytes > CONTEXT_PACK_MAX_ARTIFACT_BYTES ||
    !Number.isSafeInteger(maxTotalBytes) ||
    maxTotalBytes <= 0 ||
    maxTotalBytes > CONTEXT_PACK_MAX_TOTAL_BYTES ||
    maxTotalBytes < maxArtifactBytes
  ) {
    return null
  }
  return { maxArtifactBytes, maxTotalBytes }
}

function readRequestFor(selection: ContextSelection): BoundedArtifactRead | null {
  switch (selection.kind) {
    case "full_file":
      return { kind: selection.kind, path: selection.path }
    case "file_slice":
      return { kind: selection.kind, path: selection.path, range: selection.range }
    case "diff":
      return selection.scope === "pending"
        ? null
        : { kind: selection.kind, path: selection.path, scope: selection.scope }
  }
}

function sourceReference(
  request: BoundedArtifactRead,
  stat: ContextPackMaterializerStat,
  artifactBytes: Uint8Array,
  digestBytes: Uint8Array,
): ContextPackSourceReference {
  const fileIdentity = `${String(stat.dev)}:${String(stat.ino)}`
  const identity = request.kind === "full_file"
    ? `file:${fileIdentity}`
    : request.kind === "file_slice"
      ? `slice:${fileIdentity}:${request.range.startLine}-${request.range.endLine}`
      : `diff:${request.scope}:${fileIdentity}`
  return {
    identity,
    digest: createHash("sha256").update(digestBytes).digest("hex"),
    bytes: artifactBytes.byteLength,
  }
}

function sourceDriftReason(
  expected: ContextPackSourceReference,
  actual: ContextPackSourceReference,
): "source_identity_changed" | "source_digest_changed" | "source_bytes_changed" | null {
  if (expected.identity !== actual.identity) return "source_identity_changed"
  if (expected.bytes !== actual.bytes) return "source_bytes_changed"
  if (expected.digest !== actual.digest) return "source_digest_changed"
  return null
}

function isValidSourceReference(source: unknown): source is ContextPackSourceReference {
  if (typeof source !== "object" || source === null) return false
  const candidate = source as Partial<ContextPackSourceReference>
  return typeof candidate.identity === "string" &&
    candidate.identity.trim().length > 0 &&
    typeof candidate.digest === "string" &&
    SHA256_DIGEST.test(candidate.digest) &&
    Number.isSafeInteger(candidate.bytes) &&
    (candidate.bytes ?? -1) >= 0
}

function isValidRange(range: {
  readonly startLine: number
  readonly endLine: number
}): boolean {
  return Number.isSafeInteger(range.startLine) &&
    range.startLine >= 1 &&
    Number.isSafeInteger(range.endLine) &&
    range.endLine >= range.startLine
}

function sliceLines(content: string, startLine: number, endLine: number): string | null {
  const lines = content.match(/[^\n]*(?:\n|$)/gu) ?? []
  if (lines.at(-1) === "") lines.pop()
  if (startLine > lines.length || endLine > lines.length) return null
  return lines.slice(startLine - 1, endLine).join("")
}

function sameStatSnapshot(
  before: ContextPackMaterializerStat,
  after: ContextPackMaterializerStat,
): boolean {
  return String(before.dev) === String(after.dev) &&
    String(before.ino) === String(after.ino) &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
}

function fileFailureReason(error: unknown): "source_missing" | "ineligible_source" {
  if (isMissingFileError(error)) return "source_missing"
  return "ineligible_source"
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code
  return code === "ENOENT" || code === "ENOTDIR"
}

function blocked(
  path: string,
  reason: Extract<BoundedArtifactReadResult, { kind: "blocked" }>["reason"],
): Extract<BoundedArtifactReadResult, { kind: "blocked" }> {
  return { kind: "blocked", reason, path }
}

function stale(
  path: string,
  reason: Extract<BoundedArtifactReadResult, { kind: "stale" }>["reason"],
): Extract<BoundedArtifactReadResult, { kind: "stale" }> {
  return { kind: "stale", reason, path }
}

function buildDiffCommand(request: Extract<BoundedArtifactRead, { kind: "diff" }>): string[] {
  return request.scope === "staged"
    ? [
        "git",
        "--no-pager",
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--cached",
        "--",
        request.path,
      ]
    : [
        "git",
        "--no-pager",
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--",
        request.path,
      ]
}

type DiffReadResult = BoundedBytes | { readonly kind: "ready"; readonly failed: true }

async function readDiff(
  spawn: ContextPackMaterializerSpawn,
  env: Record<string, string | undefined>,
  workspaceRoot: string,
  request: Extract<BoundedArtifactRead, { kind: "diff" }>,
  maxBytes: number,
): Promise<DiffReadResult> {
  let process: ContextPackMaterializerProcess
  try {
    process = spawn({
      cmd: buildDiffCommand(request),
      cwd: workspaceRoot,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
  } catch {
    return { kind: "ready", failed: true }
  }

  const output = await readBoundedStream(process, maxBytes)
  if (output.kind === "oversized") return output
  let exitCode: number
  try {
    exitCode = await process.exited
  } catch {
    return { kind: "ready", failed: true }
  }
  return exitCode === 0 ? output : { kind: "ready", failed: true }
}

async function readBoundedStream(
  process: ContextPackMaterializerProcess,
  maxBytes: number,
): Promise<DiffReadResult> {
  const reader = process.stdout.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (totalBytes + value.byteLength > maxBytes) {
        try {
          process.kill()
        } catch {
          // The process may have exited between the read and the cap check.
        }
        await reader.cancel()
        await process.exited.catch(() => -1)
        return { kind: "oversized" }
      }
      chunks.push(value)
      totalBytes += value.byteLength
    }
  } catch {
    return { kind: "ready", failed: true }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { kind: "ready", bytes }
}
