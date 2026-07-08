/**
 * The session controller: the wiring between config, the agent connections, and
 * the store.
 *
 * It builds one long-lived `AgentConnection` per configured agent (ADR-005),
 * completes each handshake, opens one ACP session per agent against the working
 * directory, and keeps both sessions live and addressable for the whole run - that
 * is what makes a hand-off followed by a hand-back possible. Incoming domain
 * events are dispatched into the owning agent's store slice; incoming ACP
 * permission requests are parked in the store's approval overlay until the user
 * answers them.
 *
 * Orchestration lives here rather than in the store (a lean state container) or in
 * the UI (which only sees `ControllerActions`), keeping ADR-003's layering intact:
 * the store never learns about connections, and the views never learn about ACP.
 *
 * Startup degrades per agent. A missing binary, a rejected handshake, or a failed
 * `session/new` marks that one agent not-ready and leaves the other fully usable.
 */

import type { AgentConnection, PermissionOutcome, PermissionRequest } from "../agent/agentConnection.ts"
import { createAgentConnection } from "../agent/agentConnection.ts"
import type { AgentConfig, AgentId, AppConfig } from "../core/types.ts"
import { createAppStore, type AppStore, type Unsubscribe } from "../store/appStore.ts"
import { createControllerActions, type AgentSession, type ControllerActions } from "./actions.ts"

/** One agent's run-time standing, as the status strip and prompt gate read it. */
export type AgentRuntimeState =
  | { agentId: AgentId; displayName: string; ready: true; sessionId: string }
  | { agentId: AgentId; displayName: string; ready: false; error: string }

/** Injectable seams so the controller can be driven against mock connections. */
export interface SessionControllerOptions {
  config: AppConfig
  /** The working directory each agent session is opened against. Defaults to `process.cwd()`. */
  cwd?: string
  /** The store to drive. Defaults to a fresh one holding an empty slice per agent. */
  store?: AppStore
  /** How to build a connection for an agent. Defaults to a real spawning connection. */
  createConnection?: (config: AgentConfig) => AgentConnection
  /** Ids for recorded user turns. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Where a connection failure is reported. Defaults to swallowing the failure. */
  onError?: (agentId: AgentId, error: unknown) => void
}

/** The orchestrator the UI is handed at boot. */
export interface SessionController {
  /** The store every view subscribes to. */
  readonly store: AppStore
  /** The only surface through which the UI drives the agents. */
  readonly actions: ControllerActions
  /** Every agent's standing, in config order. */
  runtimes(): AgentRuntimeState[]
  /** One agent's standing, or `undefined` when the config does not name it. */
  runtime(agentId: AgentId): AgentRuntimeState | undefined
  /** Whether the agent completed its handshake and holds a live session. */
  isReady(agentId: AgentId): boolean
  /** Cancel pending approvals and tear every connection down. Never throws. */
  dispose(): Promise<void>
}

/** A permission request waiting on the user, and the promise the agent is blocked on. */
interface PendingPermission {
  agentId: AgentId
  request: PermissionRequest
  resolve: (outcome: PermissionOutcome) => void
}

/** Everything the controller owns for one agent. */
interface AgentRuntime {
  config: AgentConfig
  state: AgentRuntimeState
  connection: AgentConnection | null
  sessionId: string | null
  unsubscribe: Unsubscribe | null
}

/**
 * Build the controller: connect every configured agent, open its session, and wire
 * its streams into the store. Resolves once every agent has either come up or been
 * marked not-ready - never rejects, because a broken agent is a state, not a crash.
 */
export async function createSessionController(options: SessionControllerOptions): Promise<SessionController> {
  const store = options.store ?? createAppStore()
  const cwd = options.cwd ?? process.cwd()
  const create = options.createConnection ?? defaultCreateConnection
  const onError = options.onError ?? (() => {})

  const runtimes = new Map<AgentId, AgentRuntime>()
  const pending: PendingPermission[] = []
  let disposed = false

  /**
   * Park a permission request until the user answers it.
   *
   * The store holds a single approval slot, so concurrent requests (both agents
   * asking at once, or one agent asking twice) queue behind the one on screen and
   * surface in arrival order. The agent stays blocked on this promise meanwhile,
   * which is exactly the back-pressure ACP expects.
   */
  function enqueuePermission(agentId: AgentId, request: PermissionRequest): Promise<PermissionOutcome> {
    if (disposed) return Promise.resolve({ outcome: "cancelled" })
    return new Promise<PermissionOutcome>((resolve) => {
      pending.push({ agentId, request, resolve })
      if (pending.length === 1) store.openApproval({ agentId, request })
    })
  }

  /** Settle the on-screen request, then show the next queued one (or close the slot). */
  function resolvePermission(outcome: PermissionOutcome): void {
    const current = pending.shift()
    if (!current) return
    current.resolve(outcome)
    const next = pending[0]
    if (next) store.openApproval({ agentId: next.agentId, request: next.request })
    else store.closeApproval()
  }

  function getSession(agentId: AgentId): AgentSession | undefined {
    const runtime = runtimes.get(agentId)
    if (!runtime?.connection || runtime.sessionId === null) return undefined
    return { agentId, sessionId: runtime.sessionId, connection: runtime.connection }
  }

  /** Bring one agent up, or record precisely why it did not come up. */
  async function startAgent(config: AgentConfig): Promise<void> {
    let connection: AgentConnection | undefined
    try {
      connection = create(config)
      const ready = await connection.connect()
      if (!ready.ready) {
        await failAgent(config, connection, ready.error)
        return
      }
      const sessionId = await connection.newSession(cwd)
      // Bind the slice before subscribing: `startSession` resets the transcript, so
      // an event that arrived first would be thrown away.
      store.startSession(config.id, sessionId)
      const unsubscribe = connection.onUpdate((event) => store.applyEvent(config.id, event))
      connection.onPermission((request) => enqueuePermission(config.id, request))
      runtimes.set(config.id, {
        config,
        state: { agentId: config.id, displayName: config.displayName, ready: true, sessionId },
        connection,
        sessionId,
        unsubscribe,
      })
    } catch (error) {
      onError(config.id, error)
      await failAgent(config, connection, errorMessage(error))
    }
  }

  /** Record an agent as not-ready and release the connection it never got to use. */
  async function failAgent(config: AgentConfig, connection: AgentConnection | undefined, error: string): Promise<void> {
    runtimes.set(config.id, {
      config,
      state: { agentId: config.id, displayName: config.displayName, ready: false, error },
      connection: null,
      sessionId: null,
      unsubscribe: null,
    })
    await disposeQuietly(connection)
  }

  await Promise.all(options.config.agents.map(startAgent))
  focusReadyAgent(store, options.config, runtimes)

  const actions = createControllerActions({
    store,
    getSession,
    resolvePermission,
    newMessageId: options.newMessageId,
    onError,
  })

  return {
    store,
    actions,
    runtimes: () => options.config.agents.map((agent) => runtimes.get(agent.id)!.state),
    runtime: (agentId) => runtimes.get(agentId)?.state,
    isReady: (agentId) => runtimes.get(agentId)?.state.ready === true,
    async dispose(): Promise<void> {
      disposed = true
      // Nothing will ever answer these now; unblock the agents rather than leak
      // their in-flight `requestPermission` calls.
      for (const request of pending.splice(0)) request.resolve({ outcome: "cancelled" })
      store.closeApproval()
      await Promise.all(
        [...runtimes.values()].map(async (runtime) => {
          runtime.unsubscribe?.()
          runtime.unsubscribe = null
          const connection = runtime.connection
          runtime.connection = null
          await disposeQuietly(connection ?? undefined)
        }),
      )
    },
  }
}

/**
 * Keep focus on a usable agent: if the agent the store starts focused on failed to
 * come up, focus the first one that did. When neither is ready, focus is left where
 * it was so the status strip still names an agent to explain.
 */
function focusReadyAgent(store: AppStore, config: AppConfig, runtimes: Map<AgentId, AgentRuntime>): void {
  const focused = store.getState().focusedAgentId
  if (runtimes.get(focused)?.state.ready) return
  const firstReady = config.agents.find((agent) => runtimes.get(agent.id)?.state.ready)
  if (firstReady) store.setFocus(firstReady.id)
}

function defaultCreateConnection(config: AgentConfig): AgentConnection {
  return createAgentConnection({ config })
}

/** Tear a connection down; a noisy teardown must not mask why we are tearing it down. */
async function disposeQuietly(connection: AgentConnection | undefined): Promise<void> {
  if (!connection) return
  try {
    await connection.dispose()
  } catch {
    // Nothing actionable: the caller is already on an error or shutdown path.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
