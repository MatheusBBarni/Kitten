/**
 * Prepare OpenTUI's embedded tree-sitter worker for standalone executables.
 *
 * Bun can bundle a Worker as a second `--compile` entrypoint, but OpenTUI 0.4.3
 * computes its worker URL at runtime and therefore cannot discover that entry on its
 * own. The release build gives the entry a stable BunFS name; startup copies it to a
 * content-addressed user cache and points OpenTUI at that real path before any
 * renderer can create the singleton tree-sitter client.
 */

import { createHash, randomUUID } from "node:crypto"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"

/** Stable name assigned to the worker entry by `scripts/build.ts`. */
export const TREE_SITTER_WORKER_NAME = "parser.worker.js"

/** OpenTUI's supported environment seam for overriding the worker entry script. */
export const TREE_SITTER_WORKER_ENV = "OTUI_TREE_SITTER_WORKER_PATH"

/** Injectable seams for deterministic extraction tests. */
export interface TreeSitterWorkerDeps {
  env?: NodeJS.ProcessEnv
  cacheRoot?: string
  loadEmbeddedWorker?: () => Promise<Blob | null>
}

/**
 * Extract the compiled worker once and configure OpenTUI to use it.
 *
 * Source runs have no embedded worker and retain OpenTUI's normal package-relative
 * resolution. An explicit user override wins unchanged. Compiled runs copy the
 * worker to a digest-named cache file, making repeated boots idempotent while a
 * dependency upgrade naturally selects a new path.
 */
export async function configureTreeSitterWorker(deps: TreeSitterWorkerDeps = {}): Promise<string | null> {
  const env = deps.env ?? process.env
  const configured = env[TREE_SITTER_WORKER_ENV]
  if (configured) return configured

  const worker = await (deps.loadEmbeddedWorker ?? loadEmbeddedWorker)()
  if (!worker) return null

  const bytes = Buffer.from(await worker.arrayBuffer())
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16)
  const cacheRoot = deps.cacheRoot ?? defaultCacheRoot(env)
  const target = join(cacheRoot, `parser.worker-${digest}.js`)

  await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
  if (!(await hasExpectedSize(target, bytes.byteLength))) {
    const temporary = join(cacheRoot, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  env[TREE_SITTER_WORKER_ENV] = target
  return target
}

function defaultCacheRoot(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "kitten", "tree-sitter")
}

async function hasExpectedSize(path: string, expectedSize: number): Promise<boolean> {
  try {
    return (await stat(path)).size === expectedSize
  } catch {
    return false
  }
}

/** Locate the worker entry inside a Bun standalone executable. */
async function loadEmbeddedWorker(): Promise<Blob | null> {
  const named = Bun.embeddedFiles.find(
    (file) => basename((file as Blob & { name?: string }).name ?? "") === TREE_SITTER_WORKER_NAME,
  )
  if (named) return named

  const bunfsRoot = process.platform === "win32" ? "B:\\~BUN\\root" : "/$bunfs/root"
  const candidate = Bun.file(join(bunfsRoot, TREE_SITTER_WORKER_NAME))
  return (await candidate.exists()) ? candidate : null
}
