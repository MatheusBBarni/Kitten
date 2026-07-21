import { lstat, open, realpath } from "node:fs/promises"
import { isAbsolute, posix, relative, resolve, sep } from "node:path"

export const REPOSITORY_FILE_PREFIX_BYTES = 4 * 1024
export const REPOSITORY_FILE_CHECK_CONCURRENCY = 8

export type RepositoryFileList =
  | { kind: "ready"; paths: readonly string[] }
  | {
      kind: "unavailable"
      reason: "unknown_session" | "not_repository" | "discovery_failed"
    }

export interface RepositoryFileSource {
  list(cwd: string): Promise<RepositoryFileList>
}

export interface RepositoryFileSpawnProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

export interface RepositoryFileSpawnOptions {
  readonly cmd: string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdin: "ignore" | Uint8Array
  readonly stdout: "pipe"
  readonly stderr: "ignore"
}

export type RepositoryFileSpawn = (
  options: RepositoryFileSpawnOptions,
) => RepositoryFileSpawnProcess

export interface RepositoryFileStat {
  isFile(): boolean
}

export interface RepositoryFileSystem {
  lstat(path: string): Promise<RepositoryFileStat>
  realpath(path: string): Promise<string>
  readPrefix(path: string, maxBytes: number): Promise<Uint8Array>
}

export interface CreateRepositoryFileSourceOptions {
  spawn?: RepositoryFileSpawn
  fileSystem?: RepositoryFileSystem
  env?: Record<string, string | undefined>
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const decoder = new TextDecoder("utf-8", { fatal: true })
const encoder = new TextEncoder()

const spawnWithBun: RepositoryFileSpawn = (options) => Bun.spawn(options)

const nodeFileSystem: RepositoryFileSystem = {
  lstat,
  realpath,
  async readPrefix(path, maxBytes) {
    const handle = await open(path, "r")
    try {
      const bytes = new Uint8Array(maxBytes)
      const { bytesRead } = await handle.read(bytes, 0, maxBytes, 0)
      return bytes.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  },
}

export function createRepositoryFileSource(
  options: CreateRepositoryFileSourceOptions = {},
): RepositoryFileSource {
  const spawn = options.spawn ?? spawnWithBun
  const fileSystem = options.fileSystem ?? nodeFileSystem
  const env = { ...process.env, ...options.env }

  return {
    async list(cwd) {
      try {
        const rootResult = await runGit(spawn, cwd, env, ["rev-parse", "--show-toplevel"])
        if (rootResult.exitCode !== 0) {
          return { kind: "unavailable", reason: "not_repository" }
        }

        const root = parseRepositoryRoot(rootResult.stdout)
        const realRoot = await fileSystem.realpath(root)
        const listed = await runGit(spawn, root, env, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
        ])
        if (listed.exitCode !== 0) return discoveryFailed()

        const candidates = [...new Set(parseNulList(listed.stdout))].filter((path) =>
          isSafeRepositoryRelativePath(root, path),
        )
        if (candidates.length === 0) return { kind: "ready", paths: [] }

        const ignoredResult = await runGit(
          spawn,
          root,
          env,
          ["check-ignore", "--no-index", "-z", "--stdin"],
          encodeNulList(candidates),
        )
        if (ignoredResult.exitCode !== 0 && ignoredResult.exitCode !== 1) {
          return discoveryFailed()
        }
        if (ignoredResult.exitCode === 1 && ignoredResult.stdout.byteLength !== 0) {
          return discoveryFailed()
        }

        const ignoredPaths =
          ignoredResult.exitCode === 0 ? parseNulList(ignoredResult.stdout) : []
        const candidateSet = new Set(candidates)
        if (
          ignoredResult.exitCode === 0 &&
          (ignoredPaths.length === 0 || ignoredPaths.some((path) => !candidateSet.has(path)))
        ) {
          return discoveryFailed()
        }

        const ignored = new Set(ignoredPaths)
        const unignored = candidates.filter((path) => !ignored.has(path))
        if (unignored.length === 0) return { kind: "ready", paths: [] }

        const attributesResult = await runGit(
          spawn,
          root,
          env,
          ["check-attr", "-z", "--stdin", "linguist-generated", "text"],
          encodeNulList(unignored),
        )
        if (attributesResult.exitCode !== 0) return discoveryFailed()

        const attributes = parseAttributes(attributesResult.stdout, unignored)
        const normalFiles = unignored.filter((path) => !isExcludedByAttributes(attributes.get(path)))
        const eligible = await filterWithBoundedConcurrency(normalFiles, async (path) => {
          const absolutePath = resolve(root, path)
          const stat = await fileSystem.lstat(absolutePath)
          if (!stat.isFile()) return false

          const realPath = await fileSystem.realpath(absolutePath)
          if (!isPathContainedBy(realRoot, realPath)) return false

          const prefix = await fileSystem.readPrefix(realPath, REPOSITORY_FILE_PREFIX_BYTES)
          return !isBinaryRepositoryFilePrefix(prefix)
        })

        // `git ls-files` always reports paths relative to the repository top-level,
        // while every caller resolves a selected path against the addressed session's
        // cwd. Return only safe paths below that cwd, rewritten into its coordinate
        // space, so a selection cannot miss or name a coincidental sibling file.
        const sessionRoot = resolve(cwd)
        const sessionPaths = eligible.flatMap((path) => {
          const relativePath = relative(sessionRoot, resolve(root, path)).split(sep).join("/")
          return isSafeRepositoryRelativePath(sessionRoot, relativePath) ? [relativePath] : []
        })

        return { kind: "ready", paths: sessionPaths.sort(compareLexically) }
      } catch {
        return discoveryFailed()
      }
    },
  }
}

export const repositoryFileSource = createRepositoryFileSource()

function discoveryFailed(): RepositoryFileList {
  return { kind: "unavailable", reason: "discovery_failed" }
}

async function runGit(
  spawn: RepositoryFileSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
  stdin: "ignore" | Uint8Array = "ignore",
): Promise<{ exitCode: number; stdout: Uint8Array }> {
  const process = spawn({
    cmd: ["git", ...args],
    cwd,
    env,
    stdin,
    stdout: "pipe",
    stderr: "ignore",
  })
  const [exitCode, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).arrayBuffer(),
  ])
  return { exitCode, stdout: new Uint8Array(stdout) }
}

function parseRepositoryRoot(bytes: Uint8Array): string {
  const root = decoder.decode(bytes).replace(/\r?\n$/u, "")
  if (!root || !isAbsolute(root)) throw new Error("git returned an invalid repository root")
  return root
}

function parseNulList(bytes: Uint8Array): string[] {
  if (bytes.byteLength === 0) return []

  const value = decoder.decode(bytes)
  if (!value.endsWith("\0")) throw new Error("git returned malformed NUL-delimited output")

  const paths = value.slice(0, -1).split("\0")
  if (paths.some((path) => path.length === 0)) {
    throw new Error("git returned an empty path")
  }
  return paths
}

function encodeNulList(paths: readonly string[]): Uint8Array {
  return encoder.encode(`${paths.join("\0")}\0`)
}

/** Shared lexical path policy for every workspace-relative repository read. */
export function isSafeRepositoryRelativePath(root: string, path: string): boolean {
  if (!path || CONTROL_CHARACTER.test(path) || isAbsolute(path) || posix.normalize(path) !== path) {
    return false
  }
  if (path.split("/").includes(".git")) return false

  const absolutePath = resolve(root, path)
  return isPathContainedBy(root, absolutePath)
}

/** Shared canonical containment check used after resolving real paths. */
export function isPathContainedBy(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
}

/** Existing discovery binary policy, exported so materialization cannot drift from it. */
export function isBinaryRepositoryFilePrefix(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}

type AttributeName = "linguist-generated" | "text"
type AttributeValues = Record<AttributeName, string>

function parseAttributes(
  bytes: Uint8Array,
  candidates: readonly string[],
): Map<string, AttributeValues> {
  const fields = parseNulList(bytes)
  if (fields.length % 3 !== 0) throw new Error("git returned malformed attribute triples")

  const candidateSet = new Set(candidates)
  const values = new Map<string, Partial<AttributeValues>>()
  for (let index = 0; index < fields.length; index += 3) {
    const path = fields[index]
    const attribute = fields[index + 1]
    const value = fields[index + 2]
    if (
      path === undefined ||
      value === undefined ||
      (attribute !== "linguist-generated" && attribute !== "text") ||
      !candidateSet.has(path)
    ) {
      throw new Error("git returned an unexpected attribute triple")
    }

    const pathValues = values.get(path) ?? {}
    if (pathValues[attribute] !== undefined) {
      throw new Error("git returned a duplicate attribute triple")
    }
    pathValues[attribute] = value
    values.set(path, pathValues)
  }

  const complete = new Map<string, AttributeValues>()
  for (const path of candidates) {
    const pathValues = values.get(path)
    if (pathValues?.["linguist-generated"] === undefined || pathValues.text === undefined) {
      throw new Error("git omitted an attribute triple")
    }
    complete.set(path, pathValues as AttributeValues)
  }
  return complete
}

function isExcludedByAttributes(attributes: AttributeValues | undefined): boolean {
  if (!attributes) return true

  const generated = attributes["linguist-generated"]
  const generatedFile =
    generated !== "unspecified" && generated !== "unset" && generated !== "false"
  const nonTextFile = attributes.text === "unset" || attributes.text === "false"
  return generatedFile || nonTextFile
}

async function filterWithBoundedConcurrency(
  paths: readonly string[],
  predicate: (path: string) => Promise<boolean>,
): Promise<string[]> {
  const accepted = new Array<boolean>(paths.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < paths.length) {
      const index = nextIndex
      nextIndex += 1
      const path = paths[index]
      if (path !== undefined) accepted[index] = await predicate(path)
    }
  }

  const workerCount = Math.min(REPOSITORY_FILE_CHECK_CONCURRENCY, paths.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return paths.filter((_, index) => accepted[index])
}

function compareLexically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
