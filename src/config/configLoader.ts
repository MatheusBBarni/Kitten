/**
 * Application configuration loading (ADR-005).
 *
 * Configuration is a map of provider spawn recipes plus an ordered list of sessions
 * to open (ADR-005). Kitten ships working defaults for the two V1 providers and never
 * owns their binaries or auth: each provider is spawned from a `command`/`args`/`env`
 * triple the user may override. The defaults point at the published ACP adapters,
 * pinned to a known-good version so an adapter release cannot silently change the
 * handshake under a running install.
 *
 * A user config file is optional. When absent, {@link defaultAppConfig} is the whole
 * configuration. When present, it is validated with zod and merged per-provider and
 * per-field over the defaults, so overriding one provider's command leaves the other
 * provider - and that provider's other fields - untouched.
 *
 * {@link resolveSessions} turns the loaded config into the ordered per-session
 * spawn-plus-`cwd` inputs the controller consumes. When the file declares no
 * sessions, it seeds one session per configured provider in the launch directory,
 * which reproduces today's two-session, single-directory behavior.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"

import { z } from "zod"

import type {
  AgentConfig,
  AppConfig,
  ProviderKind,
  ProviderRecipe,
  ResolvedSession,
  SessionDescriptor,
  ThemePreference,
  WelcomeBannerPreference,
} from "../core/types.ts"
import { DEFAULT_PROVIDER_ORDER, PROVIDER_DISPLAY_NAMES, PROVIDER_KINDS } from "../core/types.ts"

/**
 * The pinned ACP adapter packages the default config launches through `npx`.
 *
 * Claude Code speaks ACP only through its adapter; Codex likewise. Pinning the
 * exact version is the ADR-005 mitigation against an adapter changing its flags
 * or handshake behavior beneath us.
 */
export const CLAUDE_CODE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.57.0"
export const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp@1.1.2"

/**
 * Codex ACP's unrestricted preset. It runs Codex with no approval prompts and
 * full filesystem/network access -- the yolo policy Kitten uses by default.
 * A user `providers.codex.env.INITIAL_AGENT_MODE` override remains authoritative.
 */
export const CODEX_YOLO_MODE = "agent-full-access"

/** The default spawn recipe for each provider kind, pinned to the known-good adapter. */
const DEFAULT_PROVIDERS: Readonly<Record<ProviderKind, ProviderRecipe>> = {
  "claude-code": {
    displayName: "Claude Code",
    command: "npx",
    args: ["-y", CLAUDE_CODE_ACP_PACKAGE],
    env: {},
  },
  codex: {
    displayName: "Codex",
    command: "npx",
    args: ["-y", CODEX_ACP_PACKAGE],
    env: { INITIAL_AGENT_MODE: CODEX_YOLO_MODE },
  },
}

/** Telemetry is opt-in and off until the user says otherwise (PRD privacy stance). */
const DEFAULT_TELEMETRY_ENABLED = false

/** Session persistence is on by default, with a user-configurable off-switch. */
export const DEFAULT_SESSION_PERSISTENCE_ENABLED = true

/** The default follows the terminal-reported theme unless the user selects an override. */
const DEFAULT_THEME: ThemePreference = "auto"

/** The welcome is full once, then quiet unless the user overrides it. */
const DEFAULT_WELCOME_BANNER: WelcomeBannerPreference = "auto"

/** Xterm's established default, now made explicit and user-configurable. */
export const DEFAULT_SHELL_SCROLLBACK = 1_000

/** Bound retained terminal history so a config typo cannot consume unbounded memory. */
export const MAX_SHELL_SCROLLBACK = 100_000

const THEME_PREFERENCES = ["auto", "light", "dark", "catppuccin-mocha", "catppuccin-latte"] as const satisfies readonly ThemePreference[]
const WELCOME_BANNER_PREFERENCES = ["auto", "always", "off"] as const satisfies readonly WelcomeBannerPreference[]

/** A configuration file that is missing, malformed, or fails validation. */
export class ConfigError extends Error {
  override readonly name = "ConfigError"

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** The environment variable that overrides the config file location outright. */
export const CONFIG_PATH_ENV_VAR = "KITTEN_CONFIG"

const PROVIDER_OVERRIDE_SCHEMA = z
  .object({
    displayName: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

/** The `providers` map: an optional override block per provider kind. */
const PROVIDERS_SCHEMA = z
  .object({
    "claude-code": PROVIDER_OVERRIDE_SCHEMA.optional(),
    codex: PROVIDER_OVERRIDE_SCHEMA.optional(),
  })
  .strict()

/**
 * One declared session. `provider` must name a known provider kind; `cwd` is
 * required and non-empty (a session with no directory has nowhere to run). `title`
 * and `task` are optional. Unknown keys are rejected so a typo surfaces as an error.
 */
const SESSION_DESCRIPTOR_SCHEMA = z
  .object({
    provider: z.enum(PROVIDER_KINDS as readonly [ProviderKind, ...ProviderKind[]]),
    cwd: z.string().min(1),
    title: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
  })
  .strict()

/** Optional user overrides for the controller-owned integrated shell. */
const SHELL_OVERRIDE_SCHEMA = z
  .object({
    enabled: z.boolean().optional(),
    command: z.string().min(1).optional(),
    scrollback: z.number().int().min(0).max(MAX_SHELL_SCROLLBACK).optional(),
  })
  .strict()

/**
 * The shape of the on-disk config file. Every field is optional: the file only ever
 * expresses deltas from {@link defaultAppConfig}. `strict()` rejects unknown keys so
 * a typo surfaces as an error instead of being silently ignored. `agents` is accepted
 * as a deprecated alias for `providers` (ADR-005 migration window); when both are
 * present, `providers` wins.
 */
export const USER_CONFIG_SCHEMA = z
  .object({
    persistenceEnabled: z.boolean().optional(),
    telemetryEnabled: z.boolean().optional(),
    theme: z.enum(THEME_PREFERENCES).optional(),
    welcomeBanner: z.enum(WELCOME_BANNER_PREFERENCES).optional(),
    providers: PROVIDERS_SCHEMA.optional(),
    /** @deprecated Use `providers`. Kept as an alias for one migration window. */
    agents: PROVIDERS_SCHEMA.optional(),
    sessions: z.array(SESSION_DESCRIPTOR_SCHEMA).optional(),
    shell: SHELL_OVERRIDE_SCHEMA.optional(),
  })
  .strict()

/** The validated deltas a user config file may express. */
export type UserConfig = z.infer<typeof USER_CONFIG_SCHEMA>

/** A per-provider override block from the user config file. */
export type ProviderOverride = z.infer<typeof PROVIDER_OVERRIDE_SCHEMA>

/** The validated `providers` map from the user config file. */
export type ProvidersOverride = z.infer<typeof PROVIDERS_SCHEMA>

/**
 * A fresh, fully-populated default configuration.
 *
 * Returns a new object graph on every call so a caller mutating the result (or a
 * merge writing into it) can never corrupt the defaults for the next load.
 */
export function defaultAppConfig(): AppConfig {
  return {
    providers: cloneProviders(DEFAULT_PROVIDERS),
    sessions: [],
    shell: {
      enabled: true,
      command: process.env.SHELL || "/bin/sh",
      scrollback: DEFAULT_SHELL_SCROLLBACK,
    },
    persistenceEnabled: DEFAULT_SESSION_PERSISTENCE_ENABLED,
    telemetryEnabled: DEFAULT_TELEMETRY_ENABLED,
    theme: DEFAULT_THEME,
    welcomeBanner: DEFAULT_WELCOME_BANNER,
  }
}

/** Deep-copy a providers map so a caller mutating the result cannot corrupt the source. */
function cloneProviders(source: Readonly<Record<ProviderKind, ProviderRecipe>>): Record<ProviderKind, ProviderRecipe> {
  const clone = {} as Record<ProviderKind, ProviderRecipe>
  for (const kind of PROVIDER_KINDS) {
    const recipe = source[kind]
    clone[kind] = { ...recipe, args: [...recipe.args], env: { ...recipe.env } }
  }
  return clone
}

/**
 * Merge validated user deltas over the defaults.
 *
 * Field-level: a provided `command`/`args`/`displayName` replaces the default for
 * that provider alone. `env` is shallow-merged over the default env so an override
 * adds variables rather than dropping any the default may later carry. `agents` is
 * honored as a deprecated alias for `providers`. `sessions` are carried through
 * verbatim; {@link resolveSessions} turns them into per-session inputs.
 */
export function mergeAppConfig(user: UserConfig): AppConfig {
  const config = defaultAppConfig()
  const overrides = user.providers ?? user.agents
  for (const kind of PROVIDER_KINDS) {
    config.providers[kind] = applyOverride(config.providers[kind], overrides?.[kind])
  }
  return {
    providers: config.providers,
    sessions: user.sessions?.map((session) => ({ ...session })) ?? [],
    shell: {
      enabled: user.shell?.enabled ?? config.shell.enabled,
      command: user.shell?.command ?? config.shell.command,
      scrollback: user.shell?.scrollback ?? config.shell.scrollback,
    },
    persistenceEnabled: user.persistenceEnabled ?? config.persistenceEnabled,
    telemetryEnabled: user.telemetryEnabled ?? config.telemetryEnabled,
    theme: user.theme ?? config.theme,
    welcomeBanner: user.welcomeBanner ?? config.welcomeBanner,
  }
}

function applyOverride(recipe: ProviderRecipe, override: ProviderOverride | undefined): ProviderRecipe {
  if (!override) return recipe
  return {
    displayName: override.displayName ?? recipe.displayName,
    command: override.command ?? recipe.command,
    args: override.args ? [...override.args] : recipe.args,
    env: { ...recipe.env, ...override.env },
  }
}

/**
 * Parse raw config-file JSON into a complete {@link AppConfig}.
 *
 * Pure: this is the whole of the loader's logic, so the file-system read stays a
 * thin shell around it. Throws {@link ConfigError} on invalid JSON or a schema
 * violation, naming the offending field.
 */
export function parseAppConfig(source: string, path = "<config>"): AppConfig {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }
  const result = USER_CONFIG_SCHEMA.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(`${path} is not a valid Kitten config: ${formatIssues(result.error)}`, { cause: result.error })
  }
  return mergeAppConfig(result.data)
}

/**
 * Resolve where the config file lives: an explicit `KITTEN_CONFIG` wins, else the
 * XDG location, else `~/.config/kitten/config.json`.
 */
export function resolveConfigPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[CONFIG_PATH_ENV_VAR]
  if (explicit) return explicit
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(configHome, "kitten", "config.json")
}

/** Where {@link loadAppConfig} looks, and how it reads. Seams exist for tests. */
export interface LoadAppConfigOptions {
  /** Explicit config-file path; defaults to {@link resolveConfigPath}. */
  path?: string
  /** Environment consulted by {@link resolveConfigPath} when `path` is omitted. */
  env?: Record<string, string | undefined>
}

/**
 * Load the application config: defaults when no file exists, defaults merged with
 * the user's deltas when one does. Throws {@link ConfigError} if a file exists but
 * cannot be read or is invalid - a broken config is louder than a silent fallback.
 */
export async function loadAppConfig(options: LoadAppConfigOptions = {}): Promise<AppConfig> {
  const path = options.path ?? resolveConfigPath(options.env)
  const file = Bun.file(path)
  if (!(await file.exists())) return defaultAppConfig()
  let source: string
  try {
    source = await file.text()
  } catch (error) {
    throw new ConfigError(`${path} could not be read: ${errorMessage(error)}`, { cause: error })
  }
  return parseAppConfig(source, path)
}

/** The spawn recipe for one provider, paired with its id. `undefined` when omitted. */
export function findAgentConfig(config: AppConfig, id: ProviderKind): AgentConfig | undefined {
  const recipe = config.providers[id]
  if (!recipe) return undefined
  return { id, ...recipe }
}

/** Seams so {@link resolveSessions} can validate `cwd` without touching the real disk. */
export interface ResolveSessionsOptions {
  /** The directory Kitten launched from; the zero-config default `cwd`. */
  launchCwd?: string
  /** Whether a resolved session `cwd` exists; defaults to {@link existsSync}. */
  dirExists?: (path: string) => boolean
}

/**
 * Resolve the config into the ordered per-session spawn-plus-`cwd` inputs the
 * controller consumes without further transformation (ADR-005).
 *
 * When no `sessions` are declared, one session per configured provider is seeded in
 * the launch directory, titled by the provider display name - today's two-session,
 * single-directory behavior as the N=2 case. A declared session's `cwd` is resolved
 * to an absolute path (relative to the launch directory), its `title` defaults to the
 * directory basename, and its identity is assigned so repeated providers still get
 * distinct {@link SessionId}s: the first session of a provider takes the provider kind
 * as its id, the next takes `${kind}-2`, and so on.
 *
 * A declared session whose `cwd` does not exist is a config error (a typo, not a
 * transient not-ready state), reported with the offending session and path. The
 * launch directory of the zero-config default is a given and is not probed.
 */
export function resolveSessions(config: AppConfig, options: ResolveSessionsOptions = {}): ResolvedSession[] {
  const launchCwd = resolve(options.launchCwd ?? process.cwd())
  const dirExists = options.dirExists ?? existsSync
  const declared = config.sessions.length > 0
  const descriptors: SessionDescriptor[] = declared
    ? config.sessions
    : DEFAULT_PROVIDER_ORDER.filter((kind) => config.providers[kind]).map((kind) => ({
        provider: kind,
        cwd: launchCwd,
        title: config.providers[kind].displayName,
      }))

  const usedIds = new Map<ProviderKind, number>()
  return descriptors.map((descriptor, index) => {
    const recipe = config.providers[descriptor.provider]
    if (!recipe) {
      throw new ConfigError(`sessions.${index}.provider: no provider "${descriptor.provider}" is configured`)
    }
    const cwd = resolve(launchCwd, descriptor.cwd)
    // Only declared sessions are probed: the launch directory of the zero-config
    // default is where Kitten is already running, so its existence is not in doubt.
    if (declared && !dirExists(cwd)) {
      throw new ConfigError(`sessions.${index}.cwd: directory does not exist or is unreadable: ${cwd}`)
    }
    return {
      seed: {
        id: assignSessionId(descriptor.provider, usedIds),
        providerKind: descriptor.provider,
        title: descriptor.title ?? basename(cwd),
        cwd,
        ...(descriptor.task !== undefined ? { task: descriptor.task } : {}),
      },
      spawn: { id: descriptor.provider, ...recipe },
    }
  })
}

/** Give the first session of a provider the kind as its id; suffix `-2`, `-3`, ... after. */
function assignSessionId(provider: ProviderKind, used: Map<ProviderKind, number>): string {
  const count = (used.get(provider) ?? 0) + 1
  used.set(provider, count)
  return count === 1 ? provider : `${provider}-${count}`
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
