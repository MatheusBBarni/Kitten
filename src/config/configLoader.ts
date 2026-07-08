/**
 * Application configuration loading (ADR-005).
 *
 * Kitten ships working defaults for the two V1 agents and never owns their
 * binaries or auth: each agent is spawned from a `command`/`args`/`env` triple
 * that the user may override. The defaults point at the published ACP adapters,
 * pinned to a known-good version so an adapter release cannot silently change
 * the handshake under a running install.
 *
 * A user config file is optional. When absent, {@link defaultAppConfig} is the
 * whole configuration. When present, it is validated with zod and merged
 * per-agent and per-field over the defaults, so overriding one agent's command
 * leaves the other agent - and that agent's other fields - untouched.
 */

import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import type { AgentConfig, AgentId, AppConfig } from "../core/types.ts"

/**
 * The pinned ACP adapter packages the default config launches through `npx`.
 *
 * Claude Code speaks ACP only through its adapter; Codex likewise. Pinning the
 * exact version is the ADR-005 mitigation against an adapter changing its flags
 * or handshake behavior beneath us.
 */
export const CLAUDE_CODE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.57.0"
export const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp@1.1.0"

/** The default spawn recipe for each V1 agent, in cockpit display order. */
const DEFAULT_AGENTS: readonly AgentConfig[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    command: "npx",
    args: ["-y", CLAUDE_CODE_ACP_PACKAGE],
    env: {},
  },
  {
    id: "codex",
    displayName: "Codex",
    command: "npx",
    args: ["-y", CODEX_ACP_PACKAGE],
    env: {},
  },
]

/** Telemetry is opt-in and off until the user says otherwise (PRD privacy stance). */
const DEFAULT_TELEMETRY_ENABLED = false

/** A configuration file that is missing, malformed, or fails validation. */
export class ConfigError extends Error {
  override readonly name = "ConfigError"

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** The environment variable that overrides the config file location outright. */
export const CONFIG_PATH_ENV_VAR = "KITTEN_CONFIG"

const AGENT_OVERRIDE_SCHEMA = z
  .object({
    displayName: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

/**
 * The shape of the on-disk config file. Every field is optional: the file only
 * ever expresses deltas from {@link defaultAppConfig}. `strict()` rejects unknown
 * keys so a typo surfaces as an error instead of being silently ignored.
 */
const USER_CONFIG_SCHEMA = z
  .object({
    telemetryEnabled: z.boolean().optional(),
    agents: z
      .object({
        "claude-code": AGENT_OVERRIDE_SCHEMA.optional(),
        codex: AGENT_OVERRIDE_SCHEMA.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** The validated deltas a user config file may express. */
export type UserConfig = z.infer<typeof USER_CONFIG_SCHEMA>

/** A per-agent override block from the user config file. */
export type AgentOverride = z.infer<typeof AGENT_OVERRIDE_SCHEMA>

/**
 * A fresh, fully-populated default configuration.
 *
 * Returns a new object graph on every call so a caller mutating the result (or a
 * merge writing into it) can never corrupt the defaults for the next load.
 */
export function defaultAppConfig(): AppConfig {
  return {
    agents: DEFAULT_AGENTS.map((agent) => ({ ...agent, args: [...agent.args], env: { ...agent.env } })),
    telemetryEnabled: DEFAULT_TELEMETRY_ENABLED,
  }
}

/**
 * Merge validated user deltas over the defaults.
 *
 * Field-level: a provided `command`/`args`/`displayName` replaces the default for
 * that agent alone. `env` is shallow-merged over the default env so an override
 * adds variables rather than dropping any the default may later carry.
 */
export function mergeAppConfig(user: UserConfig): AppConfig {
  const config = defaultAppConfig()
  return {
    telemetryEnabled: user.telemetryEnabled ?? config.telemetryEnabled,
    agents: config.agents.map((agent) => applyOverride(agent, user.agents?.[agent.id])),
  }
}

function applyOverride(agent: AgentConfig, override: AgentOverride | undefined): AgentConfig {
  if (!override) return agent
  return {
    id: agent.id,
    displayName: override.displayName ?? agent.displayName,
    command: override.command ?? agent.command,
    args: override.args ? [...override.args] : agent.args,
    env: { ...agent.env, ...override.env },
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

/** Look one agent up by id. Returns `undefined` when the config omits it. */
export function findAgentConfig(config: AppConfig, id: AgentId): AgentConfig | undefined {
  return config.agents.find((agent) => agent.id === id)
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
