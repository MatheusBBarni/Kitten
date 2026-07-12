import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  configureTreeSitterWorker,
  TREE_SITTER_WORKER_ENV,
  TREE_SITTER_WORKER_NAME,
} from "./treeSitterWorker.ts"

describe("configureTreeSitterWorker", () => {
  it("extracts an embedded worker once and sets OpenTUI's supported env seam", async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), "kitten-tree-sitter-"))
    const env: NodeJS.ProcessEnv = {}
    const worker = new File(["postMessage('ready')"], TREE_SITTER_WORKER_NAME)
    try {
      const first = await configureTreeSitterWorker({ env, cacheRoot, loadEmbeddedWorker: async () => worker })
      expect(first).not.toBeNull()
      if (!first) throw new Error("expected an extracted worker path")
      expect(env[TREE_SITTER_WORKER_ENV]).toBe(first)
      expect(await readFile(first, "utf8")).toBe("postMessage('ready')")

      const firstMtime = (await stat(first)).mtimeMs
      delete env[TREE_SITTER_WORKER_ENV]
      const second = await configureTreeSitterWorker({ env, cacheRoot, loadEmbeddedWorker: async () => worker })
      expect(second).toBe(first)
      if (!second) throw new Error("expected the cached worker path")
      expect((await stat(second)).mtimeMs).toBe(firstMtime)
    } finally {
      await rm(cacheRoot, { recursive: true, force: true })
    }
  })

  it("preserves an explicit worker override without reading embedded assets", async () => {
    const env: NodeJS.ProcessEnv = { [TREE_SITTER_WORKER_ENV]: "/custom/parser.worker.js" }
    let loaded = false

    expect(
      await configureTreeSitterWorker({
        env,
        loadEmbeddedWorker: async () => {
          loaded = true
          return null
        },
      }),
    ).toBe("/custom/parser.worker.js")
    expect(loaded).toBe(false)
  })

  it("leaves source runs on OpenTUI's package-relative worker resolution", async () => {
    const env: NodeJS.ProcessEnv = {}
    expect(await configureTreeSitterWorker({ env })).toBeNull()
    expect(env[TREE_SITTER_WORKER_ENV]).toBeUndefined()
  })

  it("uses XDG_CACHE_HOME for the compiled worker cache", async () => {
    const xdgRoot = await mkdtemp(join(tmpdir(), "kitten-xdg-cache-"))
    const env: NodeJS.ProcessEnv = { XDG_CACHE_HOME: xdgRoot }
    const worker = new File(["postMessage('ready')"], TREE_SITTER_WORKER_NAME)
    try {
      const extracted = await configureTreeSitterWorker({ env, loadEmbeddedWorker: async () => worker })
      expect(extracted).toStartWith(join(xdgRoot, "kitten", "tree-sitter"))
    } finally {
      await rm(xdgRoot, { recursive: true, force: true })
    }
  })
})
