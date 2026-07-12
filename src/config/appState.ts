/**
 * Fail-soft, app-written runtime state for the welcome banner (ADR-005).
 *
 * User-authored config stays read-only. The first-run marker lives in the XDG state
 * tree instead, and every filesystem or validation failure degrades to "not seen"
 * so this convenience state can never block boot.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { z } from "zod"

import type { WelcomeBannerPreference } from "../core/types.ts"

const APP_STATE_SCHEMA = z.strictObject({
  firstRunSeenAt: z.iso.datetime(),
})

/** The rendered welcome-banner shape after applying preference and first-run state. */
export type BannerVariant = "full" | "quiet" | "none"

/** Injectable filesystem and clock seams used to keep failure paths deterministic. */
export interface AppStateOptions {
  /** Explicit state-file path; defaults to {@link resolveAppStatePath}. */
  path?: string
  /** Environment consulted by {@link resolveAppStatePath} when `path` is omitted. */
  env?: Record<string, string | undefined>
  /** State-file reader; defaults to a UTF-8 synchronous read. */
  readFile?: (path: string) => string
  /** State-file writer; defaults to a UTF-8 synchronous write. */
  writeFile?: (path: string, contents: string) => void
  /** Parent-directory creator; defaults to a recursive synchronous mkdir. */
  ensureDir?: (path: string) => void
  /** Timestamp source for the marker; defaults to the current time. */
  now?: () => Date
}

/** Resolve `$XDG_STATE_HOME/kitten/state.json`, falling back under the home directory. */
export function resolveAppStatePath(env: Record<string, string | undefined> = process.env): string {
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "kitten", "state.json")
}

/** Read and validate the first-run marker; any failure resets the result to "not seen". */
export function readFirstRunSeen(options: AppStateOptions = {}): boolean {
  try {
    const path = options.path ?? resolveAppStatePath(options.env)
    const source = (options.readFile ?? readUtf8)(path)
    const raw: unknown = JSON.parse(source)
    return APP_STATE_SCHEMA.safeParse(raw).success
  } catch {
    return false
  }
}

/** Persist the first-run marker; directory and write failures are intentionally ignored. */
export function markFirstRunSeen(options: AppStateOptions = {}): void {
  try {
    const path = options.path ?? resolveAppStatePath(options.env)
    const ensureDir = options.ensureDir ?? ensureDirectory
    ensureDir(dirname(path))
    const contents = `${JSON.stringify({ firstRunSeenAt: (options.now ?? currentDate)().toISOString() })}\n`
    const writeFile = options.writeFile ?? writeUtf8
    writeFile(path, contents)
  } catch {
    // Runtime state is optional. A failed marker leaves the next launch in full mode.
  }
}

/** Apply the complete preference-by-first-run truth table (full versus compact wordmark). */
export function bannerVariant(pref: WelcomeBannerPreference, seen: boolean): BannerVariant {
  if (pref === "off") return "none"
  if (pref === "always") return "full"
  return seen ? "quiet" : "full"
}

function readUtf8(path: string): string {
  return readFileSync(path, "utf8")
}

function writeUtf8(path: string, contents: string): void {
  writeFileSync(path, contents, "utf8")
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
}

function currentDate(): Date {
  return new Date()
}
