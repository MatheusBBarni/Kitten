/**
 * Per-agent startup readiness (ADR-005).
 *
 * An agent counts as ready only once it has actually spawned and completed the ACP
 * `initialize` handshake at a protocol version Kitten speaks. Checking that the
 * binary exists is necessary but nowhere near sufficient: an installed-but-
 * unauthenticated agent, a wrapper whose flags moved, or an adapter from a newer
 * protocol generation all pass a `which` check and then fail to talk.
 *
 * Each failure mode maps to a distinct {@link NotReadyReason} plus a message the
 * first-run flow can show verbatim. Every check is self-contained and never throws,
 * so one agent being broken can neither block nor mask the other.
 */

import {
  createAgentConnection,
  SUPPORTED_PROTOCOL_VERSION,
  type AgentConnection,
  type ReadyState,
} from "../agent/agentConnection.ts"
import type { AgentConfig, AgentId, AppConfig } from "../core/types.ts"

/** Why an agent is not ready. Each value maps to one distinct, actionable failure. */
export type NotReadyReason =
  /** The configured `command` is not on `PATH` (or is not executable). */
  | "binary_not_found"
  /** The process started but `initialize` errored, died, or never spoke ACP. */
  | "handshake_failed"
  /** The process started but never answered `initialize` - typically a login prompt. */
  | "handshake_timeout"
  /** `initialize` succeeded at a protocol version Kitten does not speak. */
  | "capability_mismatch"

/** One agent's startup verdict: handshake completed, or a legible reason it did not. */
export type AgentReadiness =
  | { agentId: AgentId; displayName: string; ready: true; protocolVersion: number }
  | { agentId: AgentId; displayName: string; ready: false; reason: NotReadyReason; message: string }

/** How long to wait for `initialize` before declaring the agent unresponsive. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000

/** Injectable seams so readiness is testable without spawning real subprocesses. */
export interface ReadinessOptions {
  /** Build the connection to probe; defaults to a real spawning `AgentConnection`. */
  createConnection?: (config: AgentConfig) => AgentConnection
  /** Whether `command` resolves to an executable; defaults to `Bun.which`. */
  binaryExists?: (command: string) => boolean
  /** Handshake budget; defaults to {@link DEFAULT_HANDSHAKE_TIMEOUT_MS}. */
  timeoutMs?: number
}

/** Sentinel distinguishing "the handshake budget elapsed" from any resolved state. */
const TIMED_OUT = Symbol("timed-out")

/**
 * Probe one agent: resolve its binary, spawn it, run the `initialize` handshake, and
 * tear the probe connection down again. The connection is disposed on every path -
 * readiness must not leak a subprocess, and the session controller (task_07) spawns
 * its own long-lived connections afterwards.
 *
 * Never throws: every failure becomes a not-ready result.
 */
export async function checkAgentReadiness(
  config: AgentConfig,
  options: ReadinessOptions = {},
): Promise<AgentReadiness> {
  const binaryExists = options.binaryExists ?? defaultBinaryExists
  if (!binaryExists(config.command)) {
    return notReady(
      config,
      "binary_not_found",
      `command "${config.command}" was not found on your PATH. Install it, then restart Kitten.`,
    )
  }

  const create = options.createConnection ?? defaultCreateConnection
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  let connection: AgentConnection | undefined
  try {
    connection = create(config)
    const state = await withTimeout(connection.connect(), timeoutMs)
    if (state === TIMED_OUT) {
      return notReady(
        config,
        "handshake_timeout",
        `the ACP "initialize" handshake timed out after ${timeoutMs}ms. ` +
          `The agent started but never answered - it may be waiting on authentication. ` +
          `Run \`${commandLine(config)}\` yourself to see what it is asking for.`,
      )
    }
    return verdict(config, state)
  } catch (error) {
    return notReady(
      config,
      "handshake_failed",
      `could not be started: ${errorMessage(error)}. Check the configured command \`${commandLine(config)}\`.`,
    )
  } finally {
    await disposeQuietly(connection)
  }
}

/**
 * Probe every configured agent concurrently and independently.
 *
 * Each probe already absorbs its own failures, so the aggregate always resolves with
 * one verdict per agent in config order: a broken agent reports not-ready beside a
 * healthy one rather than failing the load (ADR-005 "degrade gracefully").
 */
export async function checkAllAgentsReadiness(
  config: AppConfig,
  options: ReadinessOptions = {},
): Promise<AgentReadiness[]> {
  return Promise.all(config.agents.map((agent) => checkAgentReadiness(agent, options)))
}

/** Turn a completed `connect()` into a verdict, rejecting versions we cannot speak. */
function verdict(config: AgentConfig, state: ReadyState): AgentReadiness {
  if (!state.ready) {
    return notReady(
      config,
      "handshake_failed",
      `the ACP "initialize" handshake failed: ${state.error}. ` +
        `The agent may need authentication, or its adapter version may be incompatible.`,
    )
  }
  if (state.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    return notReady(
      config,
      "capability_mismatch",
      `speaks ACP protocol version ${state.protocolVersion}, but Kitten speaks ${SUPPORTED_PROTOCOL_VERSION}. ` +
        `Update Kitten, or pin an agent adapter version that matches.`,
    )
  }
  return {
    agentId: config.id,
    displayName: config.displayName,
    ready: true,
    protocolVersion: state.protocolVersion,
  }
}

function notReady(config: AgentConfig, reason: NotReadyReason, detail: string): AgentReadiness {
  return {
    agentId: config.id,
    displayName: config.displayName,
    ready: false,
    reason,
    message: `${config.displayName}: ${detail}`,
  }
}

/** Race a promise against the handshake budget, always clearing the timer. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Tear the probe connection down; a failure to clean up must not mask the verdict. */
async function disposeQuietly(connection: AgentConnection | undefined): Promise<void> {
  if (!connection) return
  try {
    await connection.dispose()
  } catch {
    // The verdict is already decided; a noisy teardown adds nothing actionable.
  }
}

function defaultCreateConnection(config: AgentConfig): AgentConnection {
  return createAgentConnection({ config })
}

/** `Bun.which` resolves both bare `PATH` names and absolute paths to executables. */
function defaultBinaryExists(command: string): boolean {
  return Bun.which(command) !== null
}

function commandLine(config: AgentConfig): string {
  return [config.command, ...config.args].join(" ")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
