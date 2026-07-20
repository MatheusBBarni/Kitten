/**
 * Atomic write-back for the user's delta config (settings-modal ADR-004).
 *
 * The writer always re-reads the delta file before applying a patch so settings
 * owned by other surfaces survive. The exact bytes about to be written are
 * validated with the loader's strict schema before any filesystem mutation, then
 * committed with a same-directory rename so the target is never partially written.
 */

import { constants, mkdirSync } from "node:fs"
import { lstat, open, rename, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { isThemePresetId } from "../core/themeCatalog.ts"
import type { ThemePreference } from "../core/types.ts"
import {
  ConfigError,
  resolveConfigPath,
  USER_CONFIG_SCHEMA,
  type UserConfig,
} from "./configLoader.ts"

/** Explicit writes accept resolved canonical preferences, never compatibility aliases. */
export type UserConfigPatch = Omit<Partial<UserConfig>, "theme"> & {
  readonly theme?: ThemePreference
}

const BUILTIN_THEME_PREFERENCES = new Set<ThemePreference>(["auto", "light", "dark"])

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
  patch: UserConfigPatch,
  options: WriteConfigOptions = {},
): Promise<void> {
  assertCanonicalThemePatch(patch.theme)
  const path = options.path ?? resolveConfigPath(options.env)
  const current = await readUserConfig(path)
  const serialized = `${JSON.stringify(mergeUserConfig(current, patch), null, 2)}\n`

  // Validate the serialized representation itself: these are the exact bytes that
  // will become the next boot's input, not merely the pre-serialization object.
  validateUserConfig(serialized, path)

  const directory = dirname(path)
  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`)

  try {
    // Config deltas can contain provider environment variables, including access
    // tokens. Both a newly-created parent and the replacement file must therefore
    // be private regardless of the process umask or the prior target's mode.
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    await writeFile(tempPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 })
    await rejectSymlinkTarget(path, "replacing")
    await rename(tempPath, path)
  } catch (error) {
    await removeTempFile(tempPath)
    throw new ConfigError(`${path} could not be written atomically: ${errorMessage(error)}`, { cause: error })
  }
}

function mergeUserConfig(current: UserConfig, patch: UserConfigPatch): UserConfig {
  const merged = { ...current, ...patch }
  if (patch.providerDefaults === undefined) {
    merged.providerDefaults = current.providerDefaults
  } else {
    merged.providerDefaults = {
      ...current.providerDefaults,
      ...Object.fromEntries(
        Object.entries(patch.providerDefaults).map(([provider, defaults]) => [
          provider,
          { ...current.providerDefaults?.[provider as keyof NonNullable<UserConfig["providerDefaults"]>], ...defaults },
        ]),
      ),
    }
  }
  if (patch.statusline === undefined) {
    merged.statusline = current.statusline
  } else {
    merged.statusline = { ...current.statusline, ...patch.statusline }
  }
  if (patch.editor === undefined) {
    merged.editor = current.editor
  } else {
    merged.editor = patch.editor.kind === "system-default"
      ? { kind: "system-default" }
      : { ...patch.editor, args: [...patch.editor.args] }
  }
  return merged
}

function assertCanonicalThemePatch(theme: ThemePreference | undefined): void {
  if (theme === undefined || BUILTIN_THEME_PREFERENCES.has(theme) || isThemePresetId(theme)) return
  throw new ConfigError(`theme is not a canonical theme preference`)
}

async function readUserConfig(path: string): Promise<UserConfig> {
  await rejectSymlinkTarget(path, "reading")
  let source: string
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    source = await file.readFile("utf8")
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return {}
    throw new ConfigError(`${path} could not be read before writing: ${errorMessage(error)}`, { cause: error })
  } finally {
    await file?.close()
  }
  return validateUserConfig(source, path)
}

async function rejectSymlinkTarget(path: string, operation: "reading" | "replacing"): Promise<void> {
  try {
    const target = await lstat(path)
    if (target.isSymbolicLink()) {
      throw new ConfigError(`${path} is a symbolic link and cannot be used while ${operation} user config`)
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    if (isErrnoCode(error, "ENOENT")) return
    throw new ConfigError(`${path} could not be inspected before ${operation} user config: ${errorMessage(error)}`, {
      cause: error,
    })
  }
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
