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
import type { ProfileNotReadyReason, ProfileReadiness } from "@kitten/engine"
import type {
  AppConfig,
  ClarificationCapability,
  ProviderKind,
  ProviderRuntimeProfile,
  ResolvedAgentConfig,
} from "../core/types.ts"
import { PROVIDER_KINDS } from "../core/types.ts"
import { findAgentConfig } from "./configLoader.ts"

/** Why an agent is not ready. Each value maps to one distinct, actionable failure. */
export type NotReadyReason = ProfileNotReadyReason

/** One agent's startup verdict: handshake completed, or a legible reason it did not. */
export type AgentReadiness = ProfileReadiness & {
  agentId: ProviderKind
  displayName: string
  clarificationCapability: ClarificationCapability
}

/** How long to wait for `initialize` before declaring the agent unresponsive. */
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000

type CertifiedCursorRuntimeProfile = Extract<ProviderRuntimeProfile, { kind: "cursor-certified" }>

/** Content-free output from running the certified Cursor CLI's version command. */
export interface CursorVersionProbeResult {
  exitCode: number
  stdout: string
}

/** Injectable subprocess seam for `agent --version`. */
export type CursorVersionProbe = (
  profile: CertifiedCursorRuntimeProfile,
) => Promise<CursorVersionProbeResult>

/** Lightweight controller-facing result; success deliberately carries no ACP state. */
export type PreflightNotReadyReason = "binary_not_found" | "uncertified_recipe" | "version_mismatch"

export type AgentReadinessPreflight =
  | { ready: true }
  | {
      ready: false
      reason: PreflightNotReadyReason
      message: string
    }

/** Controller-facing normalized failure after the one long-lived connection attempts login/handshake. */
export type ConnectionReadinessFailure = {
  reason: "authentication_required" | "handshake_failed"
  message: string
}

/** Dependencies used by the preflight without constructing an ACP connection. */
export interface ReadinessPreflightOptions {
  /** Whether a resolved command is executable; defaults to `Bun.which`. */
  binaryExists?: (command: string) => boolean
  /** Run the certified Cursor version command; defaults to a Bun subprocess. */
  probeCursorVersion?: CursorVersionProbe
}

/** Injectable seams so readiness is testable without spawning real subprocesses. */
export interface ReadinessOptions extends ReadinessPreflightOptions {
  /** Build the connection to probe; defaults to a real spawning `AgentConnection`. */
  createConnection?: (config: ResolvedAgentConfig) => AgentConnection
  /** Handshake budget; defaults to {@link DEFAULT_HANDSHAKE_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Resolve runtime-only profile metadata for aggregate checks. */
  resolveAgentConfig?: (config: AppConfig, kind: ProviderKind) => ResolvedAgentConfig | undefined
}

/** Sentinel distinguishing "the handshake budget elapsed" from any resolved state. */
const TIMED_OUT = Symbol("timed-out")

/**
 * Validate the resolved recipe and executable without constructing an ACP
 * connection. Long-lived controller paths use this seam before their one live
 * connection; the full readiness helper below composes it with a disposable handshake.
 */
export async function preflightAgentReadiness(
  config: ResolvedAgentConfig,
  options: ReadinessPreflightOptions = {},
): Promise<AgentReadinessPreflight> {
  if (config.id === "cursor" && config.runtimeProfile.kind !== "cursor-certified") {
    return preflightNotReady(
      config,
      "uncertified_recipe",
      "this local Cursor profile has not been reviewed for support. " +
        "This is not a local repair; use another ready provider until Kitten publishes a reviewed profile.",
    )
  }

  const binaryExists = options.binaryExists ?? defaultBinaryExists
  const command = config.runtimeProfile.kind === "cursor-certified" ? config.runtimeProfile.command : config.command
  if (!binaryExists(command)) {
    if (config.id === "cursor") {
      return preflightNotReady(
        config,
        "binary_not_found",
        "the local Cursor CLI is not available. Install the Cursor CLI, then restart Kitten.",
      )
    }
    return preflightNotReady(
      config,
      "binary_not_found",
      `command "${command}" was not found on your PATH. Install it, then restart Kitten.`,
    )
  }

  if (config.runtimeProfile.kind !== "cursor-certified") return { ready: true }

  try {
    const probe = options.probeCursorVersion ?? defaultCursorVersionProbe
    const result = await probe(config.runtimeProfile)
    const version = result.stdout.trim()
    if (
      result.exitCode !== 0 ||
      !SEMANTIC_VERSION.test(version) ||
      version !== config.runtimeProfile.certifiedVersion
    ) {
      return cursorVersionMismatch(config)
    }
  } catch {
    return cursorVersionMismatch(config)
  }

  return { ready: true }
}

/**
 * Run the lightweight preflight, then spawn one disposable connection for the shared
 * `initialize` readiness handshake. The connection is disposed on every path so this
 * helper cannot leak a subprocess.
 *
 * Never throws under the production dependencies: every expected failure becomes a
 * not-ready result.
 */
export async function checkAgentReadiness(
  config: ResolvedAgentConfig,
  options: ReadinessOptions = {},
): Promise<AgentReadiness> {
  const preflight = await preflightAgentReadiness(config, options)
  if (!preflight.ready) return preflightVerdict(config, preflight)

  const create = options.createConnection ?? defaultCreateConnection
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
  let connection: AgentConnection | undefined
  try {
    connection = create(config)
    const state = await withTimeout(connection.connect(), timeoutMs)
    if (state === TIMED_OUT) {
      if (config.id === "cursor") {
        return connectionFailureVerdict(config, handshakeReadinessFailure(config))
      }
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
    if (config.id === "cursor") {
      return connectionFailureVerdict(config, handshakeReadinessFailure(config))
    }
    return notReady(
      config,
      "handshake_failed",
      `could not be started: ${errorMessage(error)}. Check the configured command \`${commandLine(config)}\`.`,
    )
  } finally {
    await disposeQuietly(connection)
  }
}

/** Normalize a failed long-lived adapter handshake without exposing ACP details upstream. */
export function connectionReadinessFailure(
  config: ResolvedAgentConfig,
  state: Extract<ReadyState, { ready: false }>,
): ConnectionReadinessFailure {
  if (config.id === "cursor" && authenticationRequired(state)) {
    return {
      reason: "authentication_required",
      message: `${config.displayName}: authentication is required. Sign in with the Cursor CLI, then restart Kitten.`,
    }
  }
  return handshakeReadinessFailure(config, state.error)
}

/** Normalize a thrown connection error without leaking raw Cursor runtime details. */
export function handshakeReadinessFailure(
  config: ResolvedAgentConfig,
  detail?: string,
): ConnectionReadinessFailure {
  if (config.id === "cursor") {
    return {
      reason: "handshake_failed",
      message: `${config.displayName}: the local ACP connection could not be established. ` +
        "Restart Kitten; if it still fails, continue with another ready provider.",
    }
  }
  return {
    reason: "handshake_failed",
    message: `${config.displayName}: the ACP \"initialize\" handshake failed: ${detail ?? "unknown failure"}. ` +
      "The agent may need authentication, or its adapter version may be incompatible.",
  }
}

/**
 * Probe every configured provider concurrently and independently.
 *
 * Each probe already absorbs its own failures, so the aggregate always resolves with
 * one verdict per provider in default order: a broken provider reports not-ready beside
 * a healthy one rather than failing the load (ADR-005 "degrade gracefully"). Readiness
 * is a property of the spawn recipe, so it is checked once per provider, not per session.
 */
export async function checkAllAgentsReadiness(
  config: AppConfig,
  options: ReadinessOptions = {},
): Promise<AgentReadiness[]> {
  const resolve = options.resolveAgentConfig ?? findAgentConfig
  return Promise.all(
    PROVIDER_KINDS.map((kind) => resolve(config, kind))
      .filter((agent): agent is ResolvedAgentConfig => agent !== undefined)
      .map((agent) => checkAgentReadiness(agent, options)),
  )
}

/** Turn a completed `connect()` into a verdict, rejecting versions we cannot speak. */
function verdict(config: ResolvedAgentConfig, state: ReadyState): AgentReadiness {
  if (!state.ready) {
    return connectionFailureVerdict(config, connectionReadinessFailure(config, state))
  }
  if (state.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    if (config.id === "cursor") {
      return connectionFailureVerdict(config, handshakeReadinessFailure(config))
    }
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
    clarificationCapability: config.clarificationCapability,
    ready: true,
    protocolVersion: state.protocolVersion,
  }
}

function connectionFailureVerdict(
  config: ResolvedAgentConfig,
  failure: ConnectionReadinessFailure,
): AgentReadiness {
  return {
    agentId: config.id,
    displayName: config.displayName,
    clarificationCapability: config.clarificationCapability,
    ready: false,
    ...failure,
  }
}

function notReady(config: ResolvedAgentConfig, reason: NotReadyReason, detail: string): AgentReadiness {
  return {
    agentId: config.id,
    displayName: config.displayName,
    clarificationCapability: config.clarificationCapability,
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

function defaultCreateConnection(config: ResolvedAgentConfig): AgentConnection {
  return createAgentConnection({ config })
}

/** `Bun.which` resolves both bare `PATH` names and absolute paths to executables. */
function defaultBinaryExists(command: string): boolean {
  return Bun.which(command) !== null
}

function commandLine(config: ResolvedAgentConfig): string {
  return [config.command, ...config.args].join(" ")
}

function preflightNotReady(
  config: ResolvedAgentConfig,
  reason: PreflightNotReadyReason,
  detail: string,
): AgentReadinessPreflight {
  return { ready: false, reason, message: `${config.displayName}: ${detail}` }
}

function preflightVerdict(
  config: ResolvedAgentConfig,
  preflight: Extract<AgentReadinessPreflight, { ready: false }>,
): AgentReadiness {
  return {
    agentId: config.id,
    displayName: config.displayName,
    clarificationCapability: config.clarificationCapability,
    ...preflight,
  }
}

function cursorVersionMismatch(config: ResolvedAgentConfig): AgentReadinessPreflight {
  return preflightNotReady(
    config,
    "version_mismatch",
    "the installed Cursor CLI version does not match Kitten's reviewed profile. " +
      "Install the Cursor CLI version supported by this Kitten release, then restart Kitten.",
  )
}

function authenticationRequired(state: Extract<ReadyState, { ready: false }>): boolean {
  return (state as { reason?: unknown }).reason === "authentication_required"
}

const SEMANTIC_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

async function defaultCursorVersionProbe(
  profile: CertifiedCursorRuntimeProfile,
): Promise<CursorVersionProbeResult> {
  const subprocess = Bun.spawn({
    cmd: [profile.command, "--version"],
    env: { ...globalThis.process.env, ...profile.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const [stdout, exitCode] = await Promise.all([new Response(subprocess.stdout).text(), subprocess.exited])
  return { exitCode, stdout }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
