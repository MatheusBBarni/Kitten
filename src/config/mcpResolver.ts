import { isAbsolute } from "node:path"

import type { McpServerConfig } from "../core/types.ts"

export interface ResolveMcpServersOptions {
  /** Runtime environment used to expand `${VAR}` references. */
  env?: Readonly<Record<string, string | undefined>>
  /** Resolve an executable name to an absolute path. */
  resolveCommand?: (command: string) => string | null
}

export interface McpResolutionResult {
  resolved: McpServerConfig[]
  skipped: { name: string; reason: string }[]
}

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Prepare MCP declarations for provisioning without letting one runtime failure
 * block the rest of the list. Inputs are never mutated.
 */
export function resolveMcpServers(
  servers: McpServerConfig[],
  options: ResolveMcpServersOptions = {},
): McpResolutionResult {
  const env = options.env ?? process.env
  const resolveCommand = options.resolveCommand ?? Bun.which
  const result: McpResolutionResult = { resolved: [], skipped: [] }

  for (const server of servers) {
    const expanded = expandServerEnv(server.env, env)
    if (!expanded.ok) {
      result.skipped.push({
        name: server.name,
        reason: `environment variable "${expanded.missing}" is not set`,
      })
      continue
    }

    const command = resolveCommandQuietly(server.command, resolveCommand)
    if (command === null || !isAbsolute(command)) {
      result.skipped.push({
        name: server.name,
        reason: `command not found: "${server.command}"`,
      })
      continue
    }

    result.resolved.push({
      ...server,
      command,
      args: [...server.args],
      env: expanded.env,
    })
  }

  return result
}

function expandServerEnv(
  values: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; env: Record<string, string> } | { ok: false; missing: string } {
  const expanded: Record<string, string> = {}

  for (const [name, value] of Object.entries(values)) {
    let missing: string | undefined
    const resolved = value.replace(ENV_REFERENCE, (reference, variable: string) => {
      const replacement = env[variable]
      if (replacement === undefined) {
        missing ??= variable
        return reference
      }
      return replacement
    })

    if (missing !== undefined) return { ok: false, missing }
    expanded[name] = resolved
  }

  return { ok: true, env: expanded }
}

function resolveCommandQuietly(
  command: string,
  resolver: (command: string) => string | null,
): string | null {
  try {
    return resolver(command)
  } catch {
    return null
  }
}
