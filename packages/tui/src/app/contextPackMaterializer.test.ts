// Suite: bounded Context Pack workspace materialization
// Invariant: no workspace content leaves this boundary before containment, type, cap, and fence checks.
// Boundary IN: workspace-relative selection metadata plus injected filesystem/Git effects.
// Boundary OUT: candidate assembly, persistence, telemetry, and child authorization.

import { describe, expect, it } from "bun:test"

import type {
  BoundedArtifactRead,
  ContextSelection,
} from "../core/types.ts"
import {
  CONTEXT_PACK_MAX_ARTIFACT_BYTES,
  createContextPackMaterializer,
  type ContextPackMaterializerFileSystem,
  type ContextPackMaterializerSpawn,
  type ContextPackMaterializerSpawnOptions,
  type ContextPackMaterializerStat,
} from "./contextPackMaterializer.ts"

const ROOT = "/repo"
const encoder = new TextEncoder()

interface FakeEntry {
  bytes: Uint8Array
  realPath?: string
  stats?: ContextPackMaterializerStat[]
  isFile?: boolean
  dev?: number
  ino?: number
  mtimeMs?: number
}

function entry(content: string | Uint8Array, overrides: Omit<FakeEntry, "bytes"> = {}): FakeEntry {
  return {
    bytes: typeof content === "string" ? encoder.encode(content) : content,
    ...overrides,
  }
}

function fakeStat(value: FakeEntry): ContextPackMaterializerStat {
  return {
    dev: value.dev ?? 1,
    ino: value.ino ?? 2,
    size: value.bytes.byteLength,
    mtimeMs: value.mtimeMs ?? 1,
    isFile: () => value.isFile ?? true,
  }
}

function fakeFileSystem(
  entries: Record<string, FakeEntry>,
  observations: { reads?: string[]; stats?: string[]; realpaths?: string[] } = {},
): ContextPackMaterializerFileSystem {
  const statCalls = new Map<string, number>()
  return {
    async lstat(path) {
      observations.stats?.push(path)
      const value = entries[path]
      if (!value) throw missingFile()
      const index = statCalls.get(path) ?? 0
      statCalls.set(path, index + 1)
      return value.stats?.[index] ?? value.stats?.at(-1) ?? fakeStat(value)
    },
    async realpath(path) {
      observations.realpaths?.push(path)
      if (path === ROOT) return ROOT
      const value = entries[path]
      if (!value) throw missingFile()
      return value.realPath ?? path
    },
    async readPrefix(path, maxBytes) {
      const value = Object.values(entries).find(
        (candidate) => candidate.realPath === path,
      ) ?? entries[path]
      if (!value) throw missingFile()
      return value.bytes.slice(0, maxBytes)
    },
    async readBounded(path, maxBytes) {
      observations.reads?.push(path)
      const value = Object.values(entries).find(
        (candidate) => candidate.realPath === path,
      ) ?? entries[path]
      if (!value) throw missingFile()
      return value.bytes.byteLength > maxBytes
        ? { kind: "oversized" }
        : { kind: "ready", bytes: value.bytes.slice() }
    },
  }
}

function missingFile(): Error & { code: "ENOENT" } {
  return Object.assign(new Error("missing"), { code: "ENOENT" as const })
}

function processResult(
  stdout: string | Uint8Array,
  exitCode = 0,
  killed: { value: boolean } = { value: false },
) {
  const bytes = typeof stdout === "string" ? encoder.encode(stdout) : stdout
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    kill() {
      killed.value = true
    },
  }
}

function createSpawn(
  outputs: readonly (string | Uint8Array)[],
  calls: ContextPackMaterializerSpawnOptions[] = [],
  exitCode = 0,
): ContextPackMaterializerSpawn {
  let index = 0
  return (options) => {
    calls.push(options)
    const output = outputs[index] ?? ""
    index += 1
    return processResult(output, exitCode)
  }
}

async function readReady(
  materializer: ReturnType<typeof createContextPackMaterializer>,
  request: BoundedArtifactRead,
) {
  const result = await materializer.read(ROOT, request)
  if (result.kind !== "ready") throw new Error(`expected ready, received ${result.kind}`)
  return result.artifact
}

function fullSelection(
  path: string,
  source: Awaited<ReturnType<typeof readReady>>["source"],
): ContextSelection {
  return {
    kind: "full_file",
    path,
    source,
    rationale: "Needed for the task",
    relationship: "Defines the behavior under review",
  }
}

function sliceSelection(
  path: string,
  source: Awaited<ReturnType<typeof readReady>>["source"],
  startLine: number,
  endLine: number,
): ContextSelection {
  return {
    kind: "file_slice",
    path,
    range: { startLine, endLine },
    source,
    rationale: "Needed slice",
    relationship: "Selected source range",
  }
}

describe("createContextPackMaterializer", () => {
  it("rejects lexical escapes, symlinks, and realpath escapes before content reads", async () => {
    const observations = { reads: [] as string[], stats: [] as string[], realpaths: [] as string[] }
    const fileSystem = fakeFileSystem({
      [`${ROOT}/link.ts`]: entry("secret", { isFile: false }),
      [`${ROOT}/escaped.ts`]: entry("secret", { realPath: "/outside/escaped.ts" }),
    }, observations)
    const materializer = createContextPackMaterializer({ fileSystem })

    await expect(materializer.read(ROOT, { kind: "full_file", path: "../secret.ts" }))
      .resolves.toEqual({ kind: "blocked", reason: "invalid_path", path: "../secret.ts" })
    await expect(materializer.read(ROOT, { kind: "full_file", path: "link.ts" }))
      .resolves.toEqual({ kind: "blocked", reason: "ineligible_source", path: "link.ts" })
    await expect(materializer.read(ROOT, { kind: "full_file", path: "escaped.ts" }))
      .resolves.toEqual({ kind: "blocked", reason: "outside_workspace", path: "escaped.ts" })

    expect(observations.reads).toEqual([])
    expect(observations.stats).not.toContain(`${ROOT}/../secret.ts`)
  })

  it("materializes exact full files and inclusive slices without normalizing line endings", async () => {
    const fileSystem = fakeFileSystem({
      [`${ROOT}/src/a.ts`]: entry("one\r\ntwo\r\nthree"),
    })
    const materializer = createContextPackMaterializer({ fileSystem })

    const full = await readReady(materializer, { kind: "full_file", path: "src/a.ts" })
    const slice = await readReady(materializer, {
      kind: "file_slice",
      path: "src/a.ts",
      range: { startLine: 2, endLine: 3 },
    })

    expect(full.content).toBe("one\r\ntwo\r\nthree")
    expect(full.source.identity).toBe("file:1:2")
    expect(full.source.bytes).toBe(15)
    expect(slice.content).toBe("two\r\nthree")
    expect(slice.source.identity).toBe("slice:1:2:2-3")
    expect(slice.source.bytes).toBe(10)
  })

  it("returns typed denials for missing, binary, malformed, invalid-range, and oversized sources", async () => {
    const fileSystem = fakeFileSystem({
      [`${ROOT}/binary.dat`]: entry(new Uint8Array([0x61, 0, 0x62])),
      [`${ROOT}/invalid.txt`]: entry(new Uint8Array([0xc3, 0x28])),
      [`${ROOT}/small.txt`]: entry("one\ntwo\n"),
      [`${ROOT}/large.txt`]: entry("12345"),
    })
    const materializer = createContextPackMaterializer({ fileSystem })

    await expect(materializer.read(ROOT, { kind: "full_file", path: "missing.txt" }))
      .resolves.toEqual({ kind: "blocked", reason: "source_missing", path: "missing.txt" })
    await expect(materializer.read(ROOT, { kind: "full_file", path: "binary.dat" }))
      .resolves.toEqual({ kind: "blocked", reason: "binary_source", path: "binary.dat" })
    await expect(materializer.read(ROOT, { kind: "full_file", path: "invalid.txt" }))
      .resolves.toEqual({ kind: "blocked", reason: "malformed_source", path: "invalid.txt" })
    await expect(materializer.read(ROOT, {
      kind: "file_slice",
      path: "small.txt",
      range: { startLine: 3, endLine: 3 },
    })).resolves.toEqual({ kind: "blocked", reason: "invalid_range", path: "small.txt" })
    await expect(materializer.read(
      ROOT,
      { kind: "full_file", path: "large.txt" },
      { maxArtifactBytes: 4, maxTotalBytes: 8 },
    )).resolves.toEqual({ kind: "blocked", reason: "oversized_artifact", path: "large.txt" })
  })

  it("returns stale without rewriting metadata when digest, bytes, or identity changes", async () => {
    const path = `${ROOT}/source.ts`
    const value = entry("alpha\n", { ino: 2, mtimeMs: 1 })
    const materializer = createContextPackMaterializer({ fileSystem: fakeFileSystem({ [path]: value }) })
    const original = await readReady(materializer, { kind: "full_file", path: "source.ts" })
    const selection = fullSelection("source.ts", original.source)

    value.bytes = encoder.encode("omega\n")
    value.mtimeMs = 2
    const digestChanged = await materializer.materialize(ROOT, [selection])
    expect(digestChanged).toMatchObject({ kind: "stale", reason: "source_digest_changed" })
    expect(selection.source).toEqual(original.source)

    value.bytes = encoder.encode("longer content\n")
    value.mtimeMs = 3
    await expect(materializer.materialize(ROOT, [selection]))
      .resolves.toMatchObject({ kind: "stale", reason: "source_bytes_changed" })

    value.bytes = encoder.encode("alpha\n")
    value.ino = 99
    value.mtimeMs = 4
    await expect(materializer.materialize(ROOT, [selection]))
      .resolves.toMatchObject({ kind: "stale", reason: "source_identity_changed" })
  })

  it("fences a slice with the whole backing file digest", async () => {
    const path = `${ROOT}/source.ts`
    const value = entry("one\ntwo\nthree\n", { mtimeMs: 1 })
    const materializer = createContextPackMaterializer({ fileSystem: fakeFileSystem({ [path]: value }) })
    const original = await readReady(materializer, {
      kind: "file_slice",
      path: "source.ts",
      range: { startLine: 2, endLine: 2 },
    })
    const selection = sliceSelection("source.ts", original.source, 2, 2)

    value.bytes = encoder.encode("ONE\ntwo\nthree\n")
    value.mtimeMs = 2
    await expect(materializer.materialize(ROOT, [selection]))
      .resolves.toMatchObject({ kind: "stale", reason: "source_digest_changed" })
    expect(selection.source.bytes).toBe(4)
  })

  it("marks a source that changes during a read stale", async () => {
    const value = entry("content", {
      stats: [
        { ...fakeStat(entry("content", { ino: 2, mtimeMs: 1 })), isFile: () => true },
        { ...fakeStat(entry("content", { ino: 3, mtimeMs: 2 })), isFile: () => true },
      ],
    })
    const materializer = createContextPackMaterializer({
      fileSystem: fakeFileSystem({ [`${ROOT}/moving.ts`]: value }),
    })

    await expect(materializer.read(ROOT, { kind: "full_file", path: "moving.ts" }))
      .resolves.toEqual({
        kind: "stale",
        reason: "source_changed_during_read",
        path: "moving.ts",
      })
  })

  it("uses fixed staged and unstaged Git commands with one addressed path", async () => {
    const calls: ContextPackMaterializerSpawnOptions[] = []
    const materializer = createContextPackMaterializer({
      fileSystem: fakeFileSystem({ [`${ROOT}/src/a.ts`]: entry("current\n") }),
      spawn: createSpawn(["staged diff\n", "unstaged diff\n"], calls),
      env: { GIT_EXTERNAL_DIFF: "unsafe", GIT_DIFF_OPTS: "unsafe" },
    })

    const staged = await readReady(materializer, {
      kind: "diff",
      path: "src/a.ts",
      scope: "staged",
    })
    const unstaged = await readReady(materializer, {
      kind: "diff",
      path: "src/a.ts",
      scope: "unstaged",
    })

    expect(staged.content).toBe("staged diff\n")
    expect(unstaged.content).toBe("unstaged diff\n")
    expect(calls.map(({ cmd }) => cmd)).toEqual([
      [
        "git", "--no-pager", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color",
        "--cached", "--", "src/a.ts",
      ],
      [
        "git", "--no-pager", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color",
        "--", "src/a.ts",
      ],
    ])
    expect(calls.every(({ cwd }) => cwd === ROOT)).toBe(true)
    expect(calls.every(({ env }) => env.GIT_EXTERNAL_DIFF === undefined)).toBe(true)
    expect(calls.every(({ env }) => env.GIT_DIFF_OPTS === undefined)).toBe(true)
  })

  it("blocks failed, binary, and over-cap diff output", async () => {
    const fileSystem = fakeFileSystem({ [`${ROOT}/a.ts`]: entry("current\n") })
    const failed = createContextPackMaterializer({
      fileSystem,
      spawn: createSpawn([""], [], 128),
    })
    await expect(failed.read(ROOT, { kind: "diff", path: "a.ts", scope: "unstaged" }))
      .resolves.toEqual({ kind: "blocked", reason: "diff_failed", path: "a.ts" })

    const binary = createContextPackMaterializer({
      fileSystem,
      spawn: createSpawn([new Uint8Array([0x61, 0, 0x62])]),
    })
    await expect(binary.read(ROOT, { kind: "diff", path: "a.ts", scope: "unstaged" }))
      .resolves.toEqual({ kind: "blocked", reason: "binary_source", path: "a.ts" })

    const killed = { value: false }
    const oversized = createContextPackMaterializer({
      fileSystem,
      spawn: () => processResult("12345", 0, killed),
    })
    await expect(oversized.read(
      ROOT,
      { kind: "diff", path: "a.ts", scope: "unstaged" },
      { maxArtifactBytes: 4, maxTotalBytes: 8 },
    )).resolves.toEqual({ kind: "blocked", reason: "oversized_artifact", path: "a.ts" })
    expect(killed.value).toBe(true)
  })

  it("rejects a binary diff source before invoking Git", async () => {
    let spawnCalls = 0
    const materializer = createContextPackMaterializer({
      fileSystem: fakeFileSystem({
        [`${ROOT}/binary.dat`]: entry(new Uint8Array([0x61, 0, 0x62])),
      }),
      spawn: () => {
        spawnCalls += 1
        return processResult("Binary files differ\n")
      },
    })

    await expect(materializer.read(ROOT, {
      kind: "diff",
      path: "binary.dat",
      scope: "unstaged",
    })).resolves.toEqual({ kind: "blocked", reason: "binary_source", path: "binary.dat" })
    expect(spawnCalls).toBe(0)
  })

  it("enforces deterministic aggregate limits and returns no partial artifact list", async () => {
    const materializer = createContextPackMaterializer({
      fileSystem: fakeFileSystem({
        [`${ROOT}/a.ts`]: entry("aaaa", { ino: 1 }),
        [`${ROOT}/b.ts`]: entry("bbbb", { ino: 2 }),
      }),
    })
    const a = await readReady(materializer, { kind: "full_file", path: "a.ts" })
    const b = await readReady(materializer, { kind: "full_file", path: "b.ts" })
    const selections = [fullSelection("a.ts", a.source), fullSelection("b.ts", b.source)]

    const result = await materializer.materialize(ROOT, selections, {
      maxArtifactBytes: 4,
      maxTotalBytes: 7,
    })
    expect(result).toMatchObject({
      kind: "blocked",
      reason: "total_bytes_exceeded",
      path: "b.ts",
    })
    expect(result).not.toHaveProperty("artifacts")
  })

  it("rejects malformed fences, pending diffs, invalid roots, and unsafe limit overrides", async () => {
    const value = entry("content")
    const materializer = createContextPackMaterializer({
      fileSystem: fakeFileSystem({ [`${ROOT}/a.ts`]: value }),
    })
    const ready = await readReady(materializer, { kind: "full_file", path: "a.ts" })
    const malformed = fullSelection("a.ts", { ...ready.source, digest: "bad" })
    await expect(materializer.materialize(ROOT, [malformed]))
      .resolves.toMatchObject({ kind: "blocked", reason: "malformed_source" })

    const pending: ContextSelection = {
      kind: "diff",
      path: "a.ts",
      scope: "pending",
      source: ready.source,
      rationale: "Pending parent diff",
      relationship: "Captured outside Git materialization",
    }
    await expect(materializer.materialize(ROOT, [pending]))
      .resolves.toMatchObject({ kind: "blocked", reason: "unsupported_diff_scope" })
    await expect(materializer.read("relative", { kind: "full_file", path: "a.ts" }))
      .resolves.toEqual({ kind: "blocked", reason: "invalid_workspace", path: "a.ts" })
    await expect(materializer.read(
      ROOT,
      { kind: "full_file", path: "a.ts" },
      { maxArtifactBytes: CONTEXT_PACK_MAX_ARTIFACT_BYTES + 1 },
    )).resolves.toEqual({ kind: "blocked", reason: "invalid_limits", path: "a.ts" })
  })
})
