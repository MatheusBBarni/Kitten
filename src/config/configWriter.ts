/**
 * Atomic write-back for the user's delta config (settings-modal ADR-004).
 *
 * The writer always re-reads the delta file before applying a patch so settings
 * owned by other surfaces survive. The exact bytes about to be written are
 * validated with the loader's strict schema before any filesystem mutation, then
 * committed with a same-directory rename so the target is never partially written.
 */

import { mkdirSync } from "node:fs"
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import {
  ConfigError,
  resolveConfigPath,
  USER_CONFIG_SCHEMA,
  type UserConfig,
} from "./configLoader.ts"

/** Path-resolution seams for callers and real-filesystem tests. */
export interface WriteConfigOptions {
  /** Explicit config-file path; defaults to {@link resolveConfigPath}. */
  path?: string
  /** Environment consulted by {@link resolveConfigPath} when `path` is omitted. */
  env?: Record<string, string | undefined>
}

/**
 * Merge user-config deltas into the latest on-disk file and replace it atomically.
 *
 * Validation happens before creating the parent directory or a temp file. Once the
 * bytes are known-valid, they are written beside the target and renamed over it in
 * one filesystem operation. Ordinary write/rename failures attempt to remove the
 * temp file and leave the previous target untouched.
 */
export async function persistUserConfig(
  patch: Partial<UserConfig>,
  options: WriteConfigOptions = {},
): Promise<void> {
  const path = options.path ?? resolveConfigPath(options.env)
  const current = await readUserConfig(path)
  const serialized = `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`

  // Validate the serialized representation itself: these are the exact bytes that
  // will become the next boot's input, not merely the pre-serialization object.
  validateUserConfig(serialized, path)

  const directory = dirname(path)
  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`)

  try {
    mkdirSync(directory, { recursive: true })
    await writeFile(tempPath, serialized, { encoding: "utf8", flag: "wx" })
    await rename(tempPath, path)
  } catch (error) {
    await removeTempFile(tempPath)
    throw new ConfigError(`${path} could not be written atomically: ${errorMessage(error)}`, { cause: error })
  }
}

async function readUserConfig(path: string): Promise<UserConfig> {
  let source: string
  try {
    source = await readFile(path, "utf8")
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return {}
    throw new ConfigError(`${path} could not be read before writing: ${errorMessage(error)}`, { cause: error })
  }
  return validateUserConfig(source, path)
}

function validateUserConfig(source: string, path: string): UserConfig {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }

  const result = USER_CONFIG_SCHEMA.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ")
    throw new ConfigError(`${path} is not a valid Kitten config: ${issues}`, { cause: result.error })
  }
  return result.data
}

async function removeTempFile(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // The original write error remains the actionable failure. A best-effort
    // cleanup must not replace it with a secondary unlink error.
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
