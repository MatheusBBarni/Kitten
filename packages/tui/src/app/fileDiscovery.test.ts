// Suite: repository file discovery source
// Invariant: only safe, normal repository-relative files cross the application boundary.
// Boundary IN: injected Git processes and filesystem operations.
// Boundary OUT: controller wiring and prompt-local filtering, owned by later tasks.

import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createRepositoryFileSource,
  isBinaryRepositoryFilePrefix,
  isPathContainedBy,
  isSafeRepositoryRelativePath,
  REPOSITORY_FILE_CHECK_CONCURRENCY,
  REPOSITORY_FILE_PREFIX_BYTES,
  type RepositoryFileSpawn,
  type RepositoryFileSpawnOptions,
  type RepositoryFileSystem,
} from "./fileDiscovery.ts"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function processResult(stdout: string | Uint8Array, exitCode = 0) {
  const body = typeof stdout === "string" ? encoder.encode(stdout) : stdout
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    }),
  }
}

function nulList(paths: readonly string[]): string {
  return paths.length === 0 ? "" : `${paths.join("\0")}\0`
}

type AttributeOverrides = Record<
  string,
  Partial<Record<"linguist-generated" | "text", string>>
>

function attributeOutput(paths: readonly string[], overrides: AttributeOverrides = {}): string {
  const fields: string[] = []
  for (const path of paths) {
    fields.push(
      path,
      "linguist-generated",
      overrides[path]?.["linguist-generated"] ?? "unspecified",
      path,
      "text",
      overrides[path]?.text ?? "unspecified",
    )
  }
  return nulList(fields)
}

function createSpawn(
  root: string,
  paths: readonly string[],
  options: {
    ignored?: readonly string[]
    attributes?: AttributeOverrides
    calls?: RepositoryFileSpawnOptions[]
  } = {},
): RepositoryFileSpawn {
  return (spawnOptions) => {
    options.calls?.push(spawnOptions)
    const command = spawnOptions.cmd.slice(1).join(" ")
    switch (command) {
      case "rev-parse --show-toplevel":
        return processResult(`${root}\n`)
      case "ls-files --cached --others --exclude-standard -z":
        return processResult(nulList(paths))
      case "check-ignore --no-index -z --stdin":
        return options.ignored?.length
          ? processResult(nulList(options.ignored))
          : processResult("", 1)
      case "check-attr -z --stdin linguist-generated text": {
        const input = decodeStdin(spawnOptions.stdin)
        return processResult(attributeOutput(input, options.attributes))
      }
      default:
        throw new Error(`unexpected command: ${command}`)
    }
  }
}

function decodeStdin(stdin: "ignore" | Uint8Array): string[] {
  if (stdin === "ignore") throw new Error("expected NUL-delimited stdin")
  const value = decoder.decode(stdin)
  if (!value) return []
  return value.slice(0, -1).split("\0")
}

function safeFileSystem(overrides: Partial<RepositoryFileSystem> = {}): RepositoryFileSystem {
  return {
    async lstat() {
      return { isFile: () => true }
    },
    async realpath(path) {
      return path
    },
    async readPrefix() {
      return new Uint8Array()
    },
    ...overrides,
  }
}

describe("createRepositoryFileSource", () => {
  it("exports one containment and binary policy for bounded workspace readers", () => {
    expect(isSafeRepositoryRelativePath("/repo", "src/safe.ts")).toBe(true)
    expect(isSafeRepositoryRelativePath("/repo", "../escape.ts")).toBe(false)
    expect(isSafeRepositoryRelativePath("/repo", "src/../escape.ts")).toBe(false)
    expect(isSafeRepositoryRelativePath("/repo", "bad\0path.ts")).toBe(false)
    expect(isSafeRepositoryRelativePath("/repo", ".git/config")).toBe(false)
    expect(isSafeRepositoryRelativePath("/repo", ".gitignore")).toBe(true)
    expect(isPathContainedBy("/repo", "/repo/src/safe.ts")).toBe(true)
    expect(isPathContainedBy("/repo", "/repository/not-contained.ts")).toBe(false)
    expect(isBinaryRepositoryFilePrefix(new Uint8Array([0x61, 0, 0x62]))).toBe(true)
    expect(isBinaryRepositoryFilePrefix(encoder.encode("plain text"))).toBe(false)
  })

  it("resolves the root, preserves NUL-delimited paths, and returns lexical order", async () => {
    const calls: RepositoryFileSpawnOptions[] = []
    const paths = ["z-last.ts", "src/My File.ts", "a-first.ts"]
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo root", paths, { calls }),
      fileSystem: safeFileSystem(),
      env: { KITTEN_FILE_TEST: "1" },
    })

    await expect(source.list("/repo root")).resolves.toEqual({
      kind: "ready",
      paths: ["a-first.ts", "src/My File.ts", "z-last.ts"],
    })

    expect(calls.map(({ cmd }) => cmd)).toEqual([
      ["git", "rev-parse", "--show-toplevel"],
      ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      ["git", "check-ignore", "--no-index", "-z", "--stdin"],
      ["git", "check-attr", "-z", "--stdin", "linguist-generated", "text"],
    ])
    expect(calls[0]).toMatchObject({
      cwd: "/repo root",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
    expect(calls.slice(1).every(({ cwd }) => cwd === "/repo root")).toBeTrue()
    expect(calls[0]?.env.KITTEN_FILE_TEST).toBe("1")
    expect(decodeStdin(calls[2]!.stdin)).toEqual(paths)
    expect(decodeStdin(calls[3]!.stdin)).toEqual(paths)
  })

  it("returns only safe paths relative to a session launched below the repository root", async () => {
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo", [
        "README.md",
        "packages/app/src/current.ts",
        "packages/library/src/other.ts",
      ]),
      fileSystem: safeFileSystem(),
    })

    await expect(source.list("/repo/packages/app")).resolves.toEqual({
      kind: "ready",
      paths: ["src/current.ts"],
    })
  })

  it("subtracts every ignored path, including a tracked path matching current rules", async () => {
    const calls: RepositoryFileSpawnOptions[] = []
    const paths = ["tracked-but-ignored.log", "src/kept.ts"]
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo", paths, {
        ignored: ["tracked-but-ignored.log"],
        calls,
      }),
      fileSystem: safeFileSystem(),
    })

    await expect(source.list("/repo")).resolves.toEqual({
      kind: "ready",
      paths: ["src/kept.ts"],
    })
    expect(decodeStdin(calls[2]!.stdin)).toEqual(paths)
    expect(decodeStdin(calls[3]!.stdin)).toEqual(["src/kept.ts"])
  })

  it("excludes generated and non-text attribute values conservatively", async () => {
    const paths = [
      "generated-set.ts",
      "generated-custom.ts",
      "generated-false.ts",
      "generated-unset.ts",
      "text-unset.dat",
      "text-false.dat",
      "text-set.ts",
      "text-auto.ts",
      "plain.ts",
    ]
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo", paths, {
        attributes: {
          "generated-set.ts": { "linguist-generated": "set" },
          "generated-custom.ts": { "linguist-generated": "vendored" },
          "generated-false.ts": { "linguist-generated": "false" },
          "generated-unset.ts": { "linguist-generated": "unset" },
          "text-unset.dat": { text: "unset" },
          "text-false.dat": { text: "false" },
          "text-set.ts": { text: "set" },
          "text-auto.ts": { text: "auto" },
        },
      }),
      fileSystem: safeFileSystem(),
    })

    await expect(source.list("/repo")).resolves.toEqual({
      kind: "ready",
      paths: [
        "generated-false.ts",
        "generated-unset.ts",
        "plain.ts",
        "text-auto.ts",
        "text-set.ts",
      ],
    })
  })

  it("returns unavailable for malformed attribute triples", async () => {
    const spawn: RepositoryFileSpawn = (options) => {
      const command = options.cmd.slice(1).join(" ")
      if (command === "rev-parse --show-toplevel") return processResult("/repo\n")
      if (command === "ls-files --cached --others --exclude-standard -z") {
        return processResult("safe.ts\0")
      }
      if (command === "check-ignore --no-index -z --stdin") return processResult("", 1)
      return processResult("safe.ts\0text\0")
    }
    const source = createRepositoryFileSource({ spawn, fileSystem: safeFileSystem() })

    await expect(source.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })
  })

  it("returns unavailable for failed or inconsistent policy commands", async () => {
    const failedCommand = (target: "ls-files" | "check-ignore" | "check-attr") =>
      createRepositoryFileSource({
        spawn: (options) => {
          const command = options.cmd[1]
          if (command === "rev-parse") return processResult("/repo\n")
          if (command === "ls-files") {
            return target === "ls-files" ? processResult("", 2) : processResult("safe.ts\0")
          }
          if (command === "check-ignore") {
            return target === "check-ignore" ? processResult("", 2) : processResult("", 1)
          }
          if (command === "check-attr") {
            return target === "check-attr"
              ? processResult("", 2)
              : processResult(attributeOutput(["safe.ts"]))
          }
          throw new Error(`unexpected command: ${options.cmd.join(" ")}`)
        },
        fileSystem: safeFileSystem(),
      })

    for (const command of ["ls-files", "check-ignore", "check-attr"] as const) {
      await expect(failedCommand(command).list("/repo")).resolves.toEqual({
        kind: "unavailable",
        reason: "discovery_failed",
      })
    }

    const inconsistentIgnore = createRepositoryFileSource({
      spawn: (options) => {
        const command = options.cmd[1]
        if (command === "rev-parse") return processResult("/repo\n")
        if (command === "ls-files") return processResult("safe.ts\0")
        if (command === "check-ignore") return processResult("foreign.ts\0")
        throw new Error(`unexpected command: ${options.cmd.join(" ")}`)
      },
      fileSystem: safeFileSystem(),
    })
    await expect(inconsistentIgnore.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })
  })

  it("removes control paths, escapes, non-regular files, realpath escapes, and binaries", async () => {
    const paths = [
      "safe.ts",
      "line\nfeed.ts",
      "tab\tpath.ts",
      `escape-${String.fromCharCode(0x1b)}.ts`,
      `c1-${String.fromCharCode(0x85)}.ts`,
      "../syntactic-escape.ts",
      "./not-normal.ts",
      "symlink.ts",
      "directory",
      "realpath-escape.ts",
      "binary.dat",
    ]
    const checked: string[] = []
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo", paths),
      fileSystem: safeFileSystem({
        async lstat(path) {
          checked.push(path)
          return { isFile: () => !path.endsWith("symlink.ts") && !path.endsWith("directory") }
        },
        async realpath(path) {
          if (path.endsWith("realpath-escape.ts")) return "/outside/escaped.ts"
          return path
        },
        async readPrefix(path) {
          return path.endsWith("binary.dat")
            ? new Uint8Array([0x42, 0, 0x43])
            : encoder.encode("text")
        },
      }),
    })

    await expect(source.list("/repo")).resolves.toEqual({ kind: "ready", paths: ["safe.ts"] })
    expect(checked).toHaveLength(5)
    expect(checked.every((path) => path.startsWith("/repo/"))).toBeTrue()
  })

  it("limits prefix reads and worker concurrency without truncating candidates", async () => {
    const paths = Array.from({ length: REPOSITORY_FILE_CHECK_CONCURRENCY * 5 + 3 }, (_, index) =>
      `src/file-${String(index).padStart(3, "0")}.ts`,
    )
    const readLimits: number[] = []
    let active = 0
    let maximumActive = 0
    const source = createRepositoryFileSource({
      spawn: createSpawn("/repo", paths),
      fileSystem: safeFileSystem({
        async readPrefix(_path, maxBytes) {
          readLimits.push(maxBytes)
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await Bun.sleep(1)
          active -= 1
          return encoder.encode("text")
        },
      }),
    })

    const result = await source.list("/repo")

    expect(result).toEqual({ kind: "ready", paths })
    expect(readLimits).toHaveLength(paths.length)
    expect(readLimits.every((limit) => limit === REPOSITORY_FILE_PREFIX_BYTES)).toBeTrue()
    expect(maximumActive).toBe(REPOSITORY_FILE_CHECK_CONCURRENCY)
  })

  it("converts non-repository, process, stream, Git output, and filesystem failures", async () => {
    const nonRepository = createRepositoryFileSource({
      spawn: () => processResult("", 128),
      fileSystem: safeFileSystem(),
    })
    await expect(nonRepository.list("/not-repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "not_repository",
    })

    const throwingProcess = createRepositoryFileSource({
      spawn: () => {
        throw new Error("git unavailable")
      },
      fileSystem: safeFileSystem(),
    })
    await expect(throwingProcess.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })

    const streamFailure = createRepositoryFileSource({
      spawn: () => ({
        exited: Promise.resolve(0),
        stdout: new ReadableStream({
          start(controller) {
            controller.error(new Error("stream closed"))
          },
        }),
      }),
      fileSystem: safeFileSystem(),
    })
    await expect(streamFailure.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })

    const malformedList = createRepositoryFileSource({
      spawn: (options) => {
        const command = options.cmd.slice(1).join(" ")
        if (command === "rev-parse --show-toplevel") return processResult("/repo\n")
        return processResult("missing-nul.ts")
      },
      fileSystem: safeFileSystem(),
    })
    await expect(malformedList.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })

    const fileSystemFailure = createRepositoryFileSource({
      spawn: createSpawn("/repo", ["safe.ts"]),
      fileSystem: safeFileSystem({
        async lstat() {
          throw new Error("permission denied")
        },
      }),
    })
    await expect(fileSystemFailure.list("/repo")).resolves.toEqual({
      kind: "unavailable",
      reason: "discovery_failed",
    })
  })

  it("integrates injected Git policy with a real repository-shaped filesystem fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "kitten-file-discovery-"))
    const paths = [
      "src/safe.ts",
      "src/My File.ts",
      "one/index.ts",
      "two/index.ts",
      "ignored.log",
      "generated.ts",
      "binary.dat",
    ]
    try {
      await Promise.all([
        mkdir(join(root, "src"), { recursive: true }),
        mkdir(join(root, "one"), { recursive: true }),
        mkdir(join(root, "two"), { recursive: true }),
      ])
      await Promise.all(
        paths.map((path) =>
          Bun.write(
            join(root, path),
            path === "binary.dat" ? new Uint8Array([0x42, 0, 0x43]) : `content for ${path}\n`,
          ),
        ),
      )

      const source = createRepositoryFileSource({
        spawn: createSpawn(root, paths, {
          ignored: ["ignored.log"],
          attributes: { "generated.ts": { "linguist-generated": "set" } },
        }),
      })

      await expect(source.list(join(root, "src"))).resolves.toEqual({
        kind: "ready",
        paths: ["My File.ts", "safe.ts"],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
