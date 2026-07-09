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
import type { AgentConfig, AppConfig, ProviderKind, SessionId, SessionSeed } from "../core/types.ts"
import { createAppStore, type AppStore, type Unsubscribe } from "../store/appStore.ts"
import { createControllerActions, type AgentSession, type ControllerActions } from "./actions.ts"

/** One session's run-time standing, as the status strip and prompt gate read it. */
export type AgentRuntimeState =
  | { sessionId: SessionId; providerKind: ProviderKind; displayName: string; title: string; ready: true; acpSessionId: string }
  | { sessionId: SessionId; providerKind: ProviderKind; displayName: string; title: string; ready: false; error: string }

/** Injectable seams so the controller can be driven against mock connections. */
export interface SessionControllerOptions {
  config: AppConfig
  /** The working directory each session is opened against. Defaults to `process.cwd()`. */
  cwd?: string
  /** The store to drive. Defaults to one seeded from the config's providers. */
  store?: AppStore
  /** How to build a connection for a provider. Defaults to a real spawning connection. */
  createConnection?: (config: AgentConfig) => AgentConnection
  /** Ids for recorded user turns. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Where a connection failure is reported. Defaults to swallowing the failure. */
  onError?: (sessionId: SessionId, error: unknown) => void
}

/** The orchestrator the UI is handed at boot. */
export interface SessionController {
  /** The store every view subscribes to. */
  readonly store: AppStore
  /** The only surface through which the UI drives the agents. */
  readonly actions: ControllerActions
  /** Every session's standing, in display order. */
  runtimes(): AgentRuntimeState[]
  /** One session's standing, or `undefined` when no session has that id. */
  runtime(sessionId: SessionId): AgentRuntimeState | undefined
  /** Whether the session completed its handshake and holds a live ACP session. */
  isReady(sessionId: SessionId): boolean
  /** Cancel pending approvals and tear every connection down. Never throws. */
  dispose(): Promise<void>
}

/** A permission request waiting on the user, and the promise the agent is blocked on. */
interface PendingPermission {
  sessionId: SessionId
  request: PermissionRequest
  resolve: (outcome: PermissionOutcome) => void
}

/** Everything the controller owns for one session. */
interface AgentRuntime {
  seed: SessionSeed
  config: AgentConfig
  state: AgentRuntimeState
  connection: AgentConnection | null
  acpSessionId: string | null
  unsubscribe: Unsubscribe | null
}

/**
 * Build the controller: connect every configured agent, open its session, and wire
 * its streams into the store. Resolves once every agent has either come up or been
 * marked not-ready - never rejects, because a broken agent is a state, not a crash.
 */
export async function createSessionController(options: SessionControllerOptions): Promise<SessionController> {
  const cwd = options.cwd ?? process.cwd()
  const create = options.createConnection ?? defaultCreateConnection
  const onError = options.onError ?? (() => {})

  // One session per configured provider, in config order. The Kitten session id is
  // seeded equal to the provider kind while there is one session per provider; the
  // config-driven sessions list (task_02) assigns distinct ids without changing this.
  const plan: { seed: SessionSeed; config: AgentConfig }[] = options.config.agents.map((config) => ({
    seed: { id: config.id, providerKind: config.id, title: config.displayName, cwd },
    config,
  }))

  const store = options.store ?? createAppStore({ seeds: plan.map((entry) => entry.seed) })

  const runtimes = new Map<SessionId, AgentRuntime>()
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
  function enqueuePermission(sessionId: SessionId, request: PermissionRequest): Promise<PermissionOutcome> {
    if (disposed) return Promise.resolve({ outcome: "cancelled" })
    return new Promise<PermissionOutcome>((resolve) => {
      pending.push({ sessionId, request, resolve })
      if (pending.length === 1) store.openApproval({ sessionId, request })
    })
  }

  /** Settle the on-screen request, then show the next queued one (or close the slot). */
  function resolvePermission(outcome: PermissionOutcome): void {
    const current = pending.shift()
    if (!current) return
    current.resolve(outcome)
    const next = pending[0]
    if (next) store.openApproval({ sessionId: next.sessionId, request: next.request })
    else store.closeApproval()
  }

  function getSession(sessionId: SessionId): AgentSession | undefined {
    const runtime = runtimes.get(sessionId)
    if (!runtime?.connection || runtime.acpSessionId === null) return undefined
    return { sessionId, acpSessionId: runtime.acpSessionId, connection: runtime.connection }
  }

  /** Bring one session up, or record precisely why it did not come up. */
  async function startSession(seed: SessionSeed, config: AgentConfig): Promise<void> {
    let connection: AgentConnection | undefined
    try {
      connection = create(config)
      const ready = await connection.connect()
      if (!ready.ready) {
        await failSession(seed, config, connection, ready.error)
        return
      }
      const acpSessionId = await connection.newSession(seed.cwd)
      // Bind the slice before subscribing: `startSession` resets the transcript, so
      // an event that arrived first would be thrown away.
      store.startSession(seed.id, acpSessionId)
      const unsubscribe = connection.onUpdate((event) => store.applyEvent(seed.id, event))
      connection.onPermission((request) => enqueuePermission(seed.id, request))
      runtimes.set(seed.id, {
        seed,
        config,
        state: {
          sessionId: seed.id,
          providerKind: seed.providerKind,
          displayName: config.displayName,
          title: seed.title,
          ready: true,
          acpSessionId,
        },
        connection,
        acpSessionId,
        unsubscribe,
      })
    } catch (error) {
      onError(seed.id, error)
      await failSession(seed, config, connection, errorMessage(error))
    }
  }

  /** Record a session as not-ready and release the connection it never got to use. */
  async function failSession(
    seed: SessionSeed,
    config: AgentConfig,
    connection: AgentConnection | undefined,
    error: string,
  ): Promise<void> {
    runtimes.set(seed.id, {
      seed,
      config,
      state: {
        sessionId: seed.id,
        providerKind: seed.providerKind,
        displayName: config.displayName,
        title: seed.title,
        ready: false,
        error,
      },
      connection: null,
      acpSessionId: null,
      unsubscribe: null,
    })
    await disposeQuietly(connection)
  }

  await Promise.all(plan.map((entry) => startSession(entry.seed, entry.config)))
  focusReadySession(store, plan, runtimes)

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
    runtimes: () => plan.map((entry) => runtimes.get(entry.seed.id)!.state),
    runtime: (sessionId) => runtimes.get(sessionId)?.state,
    isReady: (sessionId) => runtimes.get(sessionId)?.state.ready === true,
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
 * Keep focus on a usable session: if the session the store starts focused on failed
 * to come up, focus the first one that did. When none is ready, focus is left where
 * it was so the status strip still names a session to explain.
 */
function focusReadySession(
  store: AppStore,
  plan: { seed: SessionSeed }[],
  runtimes: Map<SessionId, AgentRuntime>,
): void {
  const focused = store.getState().focusedSessionId
  if (runtimes.get(focused)?.state.ready) return
  const firstReady = plan.find((entry) => runtimes.get(entry.seed.id)?.state.ready)
  if (firstReady) store.setFocus(firstReady.seed.id)
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
