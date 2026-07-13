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
import { findAgentConfig, resolveSessions } from "../config/configLoader.ts"
import { readGitBranch } from "../config/gitBranch.ts"
import { resolveMcpServers } from "../config/mcpResolver.ts"
import { DEFAULT_PROVIDER_ORDER, type AgentConfig, type AppConfig, type ClarificationCapability, type ClarificationOutcome, type ClarificationPayload, type DomainSessionEvent, type ProviderKind, type ResolvedAgentConfig, type SessionId, type SessionSeed, type SessionStatus, type WorkspaceConversationSeed } from "../core/types.ts"
import {
  migratePersistedRunV1,
  type PersistedAgent,
  type PersistedConversationV2,
  type PersistedRunRecord,
  type PersistedRunRecordV2,
} from "../persistence/runRecord.ts"
import {
  createShellRuntime as createRealShellRuntime,
  type ShellRuntime,
  type ShellRuntimeFactory,
} from "../shell/shellRuntime.ts"
import { createAppStore, type AppStore, type ApprovalOverlay, type ClarificationOverlay, type Unsubscribe } from "../store/appStore.ts"
import {
  createUsageSeenJsonlFileSink,
  logUsageSeen,
  resolveTelemetryPath,
  type ResumeLiveCount,
  type ResumeMode,
  type SessionResumedInput,
  type ClarificationCapabilityDiagnostic,
  type ClarificationSessionLossReason,
  type UsageSeenSink,
} from "../telemetry/recorder.ts"
import {
  createControllerActions,
  type ActionTelemetry,
  type AgentSession,
  type CloseChoice,
  type CloseConversationResult,
  type ControllerActions,
} from "./actions.ts"
import {
  repositoryFileSource as productionRepositoryFileSource,
  type RepositoryFileSource,
} from "./fileDiscovery.ts"

export type { CloseChoice, CloseConversationResult } from "./actions.ts"

/** The additional content-free telemetry emitted by resume orchestration. */
export interface ControllerTelemetry extends ActionTelemetry {
  resumeLoadStarted?(): void
  sessionResumed?(input: SessionResumedInput): void
  resumePaneUnavailable?(sessionId: SessionId): void
  clarificationCapabilityClassified?(
    provider: ProviderKind,
    capability: "supported" | "unsupported",
    diagnostic: ClarificationCapabilityDiagnostic,
  ): void
  clarificationPresented?(input: {
    requestId: string
    sessionId: SessionId
    capability: "supported" | "unsupported"
    focused: boolean
    hasSingle: boolean
    hasMulti: boolean
    hasText: boolean
    fieldCount: number
  }): void
  clarificationSettled?(requestId: string, terminalKind: "answered" | "cancelled"): void
  clarificationPreempted?(sessionId: SessionId, interactionKind: "permission" | "clarification"): void
  clarificationResumed?(sessionId: SessionId, interactionKind: "permission" | "clarification"): void
  clarificationCancelledOnSessionLoss?(
    sessionId: SessionId,
    lossReason: ClarificationSessionLossReason,
  ): void
}

/**
 * One session's run-time standing, as the status strip and prompt gate read it.
 * `cwd` is the session's own working directory (ADR-005): it labels approvals and
 * feeds the per-session repo check the first-run gate runs.
 */
export type AgentRuntimeState =
  | { sessionId: SessionId; providerKind: ProviderKind; displayName: string; title: string; cwd: string; ready: true; acpSessionId: string }
  | { sessionId: SessionId; providerKind: ProviderKind; displayName: string; title: string; cwd: string; ready: false; error: string }

/** The controller-owned shell boundary, including a legible degraded state. */
export type ShellRuntimeState =
  | { readonly ready: true; readonly runtime: ShellRuntime }
  | { readonly ready: false; readonly error: string }

/** Injectable seams so the controller can be driven against mock connections. */
export interface SessionControllerOptions {
  config: AppConfig
  /** The working directory each session is opened against. Defaults to `process.cwd()`. */
  cwd?: string
  /** The store to drive. Defaults to one seeded from the config's providers. */
  store?: AppStore
  /** How to build a connection for a provider. Defaults to a real spawning connection. */
  createConnection?: (config: AgentConfig) => AgentConnection
  /** How to build the persistent shell. Defaults to the real PTY-backed runtime. */
  createShellRuntime?: ShellRuntimeFactory
  /** Ids for recorded user turns. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Ids for dynamically created conversations. Defaults to a random UUID. */
  newSessionId?: () => SessionId
  /** Stable ids for controller-owned permission and clarification lifecycles. */
  newInteractionId?: () => string
  /** Where a connection failure is reported. Defaults to swallowing the failure. */
  onError?: (sessionId: SessionId, error: unknown) => void
  /** Off-render-path git branch reader. Defaults to the fail-soft production reader. */
  readBranch?: (cwd: string) => Promise<string | null>
  /** Repository file discovery source. Defaults to the fail-soft production source. */
  repositoryFileSource?: RepositoryFileSource
  /** The telemetry recorder actions report navigation and switch outcomes to. */
  recorder?: ControllerTelemetry
  /** Optional output seam for the gated, content-free usage-emission debug log. */
  usageSeenSink?: UsageSeenSink
  /** Whether configured first tasks should be sent after startup. Defaults to true. */
  sendInitialTasks?: boolean
}

/** The orchestrator the UI is handed at boot. */
export interface SessionController {
  /** The store every view subscribes to. */
  readonly store: AppStore
  /** The only surface through which the UI drives the agents. */
  readonly actions: ControllerActions
  /** Imperative shell access for the UI/hand-off, or its fail-soft startup error. */
  readonly shell: ShellRuntimeState
  /** Every session's standing, in display order. */
  runtimes(): AgentRuntimeState[]
  /** One session's standing, or `undefined` when no session has that id. */
  runtime(sessionId: SessionId): AgentRuntimeState | undefined
  /** Whether the session completed its handshake and holds a live ACP session. */
  isReady(sessionId: SessionId): boolean
  /** Replace the current sessions with the independently restored sides of one persisted run. */
  restore(record: PersistedRunRecord, mode?: ResumeMode): Promise<void>
  /** Apply one explicit close outcome without affecting any sibling conversation. */
  closeConversation(sessionId: SessionId, choice: CloseChoice): Promise<CloseConversationResult>
  /** Cancel pending agent interactions and tear every connection down. Never throws. */
  dispose(): Promise<void>
}

/** The resolver-free projection consumers may render for the currently active request. */
export type ActiveAgentInteraction =
  | {
      readonly kind: "permission"
      readonly requestId: string
      readonly sessionId: SessionId
      readonly generation: number
      readonly request: PermissionRequest
    }
  | {
      readonly kind: "clarification"
      readonly requestId: string
      readonly sessionId: SessionId
      readonly generation: number
      readonly payload: ClarificationPayload
    }

/** Outcomes remain semantically distinct even though one coordinator validates both. */
export type AgentInteractionOutcome = PermissionOutcome | ClarificationOutcome

/** Opaque lifecycle operations; pending resolvers and collections never escape the controller. */
export interface InteractionCoordinator {
  enqueuePermission(
    sessionId: SessionId,
    generation: number,
    request: PermissionRequest,
  ): Promise<PermissionOutcome>
  enqueueClarification(
    sessionId: SessionId,
    generation: number,
    payload: ClarificationPayload,
  ): Promise<ClarificationOutcome>
  resolveActive(requestId: string, generation: number, outcome: AgentInteractionOutcome): boolean
  cancelSession(
    sessionId: SessionId,
    generation: number,
    lossReason?: ClarificationSessionLossReason,
  ): void
  cancelAll(lossReason?: ClarificationSessionLossReason): void
  dispose(): void
}

export interface InteractionCoordinatorOptions {
  /** Stable ids attached at enqueue time. Defaults to a random UUID. */
  newRequestId?: () => string
  /** Receives only the resolver-free active projection. */
  onActiveChanged?: (interaction: ActiveAgentInteraction | null) => void
  /** Reports the interaction displaced by a newly active clarification. */
  onPreempted?: (interaction: ActiveAgentInteraction) => void
  /** Reports a suspended interaction when it becomes active again. */
  onResumed?: (interaction: ActiveAgentInteraction) => void
  /** Reports exactly one terminal clarification outcome and its optional loss cause. */
  onClarificationSettled?: (
    interaction: Extract<ActiveAgentInteraction, { kind: "clarification" }>,
    outcome: ClarificationOutcome,
    lossReason?: ClarificationSessionLossReason,
  ) => void
}

type InteractionLifecycle = "queued" | "active" | "suspended" | "terminal"

interface PendingInteractionBase {
  requestId: string
  sessionId: SessionId
  generation: number
  lifecycle: InteractionLifecycle
}

type PendingInteraction =
  | (PendingInteractionBase & {
      kind: "permission"
      request: PermissionRequest
      resolve: (outcome: PermissionOutcome) => void
    })
  | (PendingInteractionBase & {
      kind: "clarification"
      payload: ClarificationPayload
      resolve: (outcome: ClarificationOutcome) => void
    })

/**
 * Coordinate agent-originated interactions without exposing their blocked promises.
 *
 * Permissions retain FIFO order. A clarification immediately suspends the active
 * interaction without settling it; terminal settlement resumes the most recently
 * suspended interaction before advancing the ordinary queue. Every settlement is
 * guarded by both stable request identity and connection generation.
 */
export function createInteractionCoordinator(
  options: InteractionCoordinatorOptions = {},
): InteractionCoordinator {
  const newRequestId = options.newRequestId ?? (() => crypto.randomUUID())
  const onActiveChanged = options.onActiveChanged ?? (() => {})
  const onPreempted = options.onPreempted ?? (() => {})
  const onResumed = options.onResumed ?? (() => {})
  const onClarificationSettled = options.onClarificationSettled ?? (() => {})
  const queued: PendingInteraction[] = []
  const suspended: PendingInteraction[] = []
  let active: PendingInteraction | null = null
  let disposed = false

  function projection(entry: PendingInteraction): ActiveAgentInteraction {
    return entry.kind === "permission"
      ? {
          kind: "permission",
          requestId: entry.requestId,
          sessionId: entry.sessionId,
          generation: entry.generation,
          request: entry.request,
        }
      : {
          kind: "clarification",
          requestId: entry.requestId,
          sessionId: entry.sessionId,
          generation: entry.generation,
          payload: entry.payload,
        }
  }

  function publishActive(): void {
    onActiveChanged(active ? projection(active) : null)
  }

  function activate(entry: PendingInteraction): void {
    entry.lifecycle = "active"
    active = entry
  }

  function advance(): void {
    const next = suspended.pop() ?? queued.shift() ?? null
    if (next) {
      const wasSuspended = next.lifecycle === "suspended"
      activate(next)
      if (wasSuspended) onResumed(projection(next))
    }
    publishActive()
  }

  function cancel(
    entry: PendingInteraction,
    lossReason: ClarificationSessionLossReason,
  ): void {
    if (entry.lifecycle === "terminal") return
    entry.lifecycle = "terminal"
    if (entry.kind === "permission") entry.resolve({ outcome: "cancelled" })
    else {
      const outcome = { kind: "cancelled" } as const
      onClarificationSettled(projection(entry) as Extract<ActiveAgentInteraction, { kind: "clarification" }>, outcome, lossReason)
      entry.resolve(outcome)
    }
  }

  function removeMatching(
    entries: PendingInteraction[],
    matches: (entry: PendingInteraction) => boolean,
  ): PendingInteraction[] {
    const removed: PendingInteraction[] = []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (!entry || !matches(entry)) continue
      entries.splice(index, 1)
      removed.push(entry)
    }
    return removed
  }

  function cancelWhere(
    matches: (entry: PendingInteraction) => boolean,
    lossReason: ClarificationSessionLossReason,
  ): void {
    const activeMatched = active !== null && matches(active)
    const removed: PendingInteraction[] = []
    if (activeMatched) {
      removed.push(active!)
      active = null
    }
    removed.push(...removeMatching(queued, matches), ...removeMatching(suspended, matches))
    for (const entry of removed) cancel(entry, lossReason)
    if (activeMatched) advance()
  }

  function cancelAll(lossReason: ClarificationSessionLossReason = "controller_disposed"): void {
    const hadActive = active !== null
    const removed = [
      ...(active ? [active] : []),
      ...queued.splice(0),
      ...suspended.splice(0),
    ]
    active = null
    for (const entry of removed) cancel(entry, lossReason)
    if (hadActive) publishActive()
  }

  return {
    enqueuePermission(sessionId, generation, request) {
      if (disposed) return Promise.resolve({ outcome: "cancelled" })
      return new Promise<PermissionOutcome>((resolve) => {
        const entry: PendingInteraction = {
          kind: "permission",
          requestId: newRequestId(),
          sessionId,
          generation,
          lifecycle: active ? "queued" : "active",
          request,
          resolve,
        }
        if (active) queued.push(entry)
        else {
          activate(entry)
          publishActive()
        }
      })
    },

    enqueueClarification(sessionId, generation, payload) {
      if (disposed) return Promise.resolve({ kind: "cancelled" })
      return new Promise<ClarificationOutcome>((resolve) => {
        const entry: PendingInteraction = {
          kind: "clarification",
          requestId: newRequestId(),
          sessionId,
          generation,
          lifecycle: "active",
          payload,
          resolve,
        }
        if (active) {
          active.lifecycle = "suspended"
          suspended.push(active)
          onPreempted(projection(active))
        }
        activate(entry)
        publishActive()
      })
    },

    resolveActive(requestId, generation, outcome) {
      const current = active
      if (
        !current
        || current.requestId !== requestId
        || current.generation !== generation
        || (current.kind === "permission") !== ("outcome" in outcome)
      ) {
        return false
      }

      active = null
      current.lifecycle = "terminal"
      if (current.kind === "permission" && "outcome" in outcome) current.resolve(outcome)
      else if (current.kind === "clarification" && "kind" in outcome) {
        onClarificationSettled(projection(current) as Extract<ActiveAgentInteraction, { kind: "clarification" }>, outcome)
        current.resolve(outcome)
      }
      else return false
      advance()
      return true
    },

    cancelSession(sessionId, generation, lossReason = "connection_error") {
      cancelWhere(
        (entry) => entry.sessionId === sessionId && entry.generation === generation,
        lossReason,
      )
    },

    cancelAll,

    dispose() {
      if (disposed) return
      disposed = true
      cancelAll()
    },
  }
}

/** Everything the controller owns for one session. */
interface AgentRuntime {
  seed: SessionSeed
  config: AgentConfig | null
  state: AgentRuntimeState
  connection: AgentConnection | null
  acpSessionId: string | null
  unsubscribe: Unsubscribe | null
  closing: boolean
  acceptEvents: boolean
  cancelCompleted: boolean
  /** Monotonic identity of the connection currently owned by this runtime. */
  generation: number
}

/**
 * Build the controller: connect every configured agent, open its session, and wire
 * its streams into the store. Resolves once every agent has either come up or been
 * marked not-ready - never rejects, because a broken agent is a state, not a crash.
 */
export async function createSessionController(options: SessionControllerOptions): Promise<SessionController> {
  const cwd = options.cwd ?? process.cwd()
  const create = options.createConnection ?? defaultCreateConnection
  // Resolve once per cockpit boot so every fresh, restored, and dynamically added
  // session receives the same validated stdio server list.
  const mcpServers = resolveMcpServers(options.config.mcpServers).resolved
  const createShell = options.createShellRuntime ?? createRealShellRuntime
  const onError = options.onError ?? (() => {})
  const readBranch = options.readBranch ?? readGitBranch
  const repositoryFileSource = options.repositoryFileSource ?? productionRepositoryFileSource
  const newSessionId = options.newSessionId ?? (() => crypto.randomUUID())
  const usageSeenSink = options.config.telemetryEnabled
    ? options.usageSeenSink ?? createUsageSeenJsonlFileSink(resolveTelemetryPath())
    : undefined

  // The resolved fleet, in declared order (ADR-005): one session per configured
  // provider in the launch directory when the config declares none, else each
  // declared session with its own `cwd`/`title`/`task` and a distinct session id.
  const initialPlan: { seed: SessionSeed; config: ResolvedAgentConfig }[] = resolveSessions(options.config, { launchCwd: cwd }).map(
    (resolved) => ({ seed: resolved.seed, config: resolved.spawn }),
  )

  const store = options.store ?? createAppStore({ seeds: initialPlan.map((entry) => entry.seed) })

  const runtimes = new Map<SessionId, AgentRuntime>()
  const branchReadGenerations = new Map<SessionId, number>()
  const connectionGenerations = new Map<SessionId, number>()
  const closePromises = new Map<SessionId, Promise<CloseConversationResult>>()
  const pendingClarificationCounts = new Map<string, number>()
  let activeInteraction: ActiveAgentInteraction | null = null
  const interactionCoordinator = createInteractionCoordinator({
    newRequestId: options.newInteractionId,
    onActiveChanged(interaction) {
      activeInteraction = interaction
      if (interaction?.kind === "clarification") {
        store.openClarification(clarificationOverlay(interaction))
        const capability = clarificationCapabilityFor(runtimes.get(interaction.sessionId)?.config ?? null)
        options.recorder?.clarificationPresented?.({
          requestId: interaction.requestId,
          sessionId: interaction.sessionId,
          capability: capability.status,
          focused: store.getState().workspace.selectedVisibleId === interaction.sessionId,
          hasSingle: interaction.payload.fields.some((field) => field.mode === "single"),
          hasMulti: interaction.payload.fields.some((field) => field.mode === "multi"),
          hasText: interaction.payload.fields.some((field) => field.mode === "text"),
          fieldCount: interaction.payload.fields.length,
        })
        return
      }

      store.closeClarification()
      if (interaction?.kind === "permission") {
        if (store.getState().sessions[interaction.sessionId]?.status !== "awaiting_approval") {
          store.applyEvent(interaction.sessionId, { kind: "status", status: "awaiting_approval" })
        }
        const current = store.getState().overlays.approval
        if (current?.sessionId !== interaction.sessionId || current.request !== interaction.request) {
          store.openApproval(approvalOverlay(interaction.sessionId, interaction.request))
        }
      } else {
        store.closeApproval()
      }
    },
    onPreempted(interaction) {
      options.recorder?.clarificationPreempted?.(interaction.sessionId, interaction.kind)
    },
    onResumed(interaction) {
      options.recorder?.clarificationResumed?.(interaction.sessionId, interaction.kind)
    },
    onClarificationSettled(interaction, outcome, lossReason) {
      if (lossReason) {
        options.recorder?.clarificationCancelledOnSessionLoss?.(
          interaction.sessionId,
          lossReason,
        )
      }
      options.recorder?.clarificationSettled?.(interaction.requestId, outcome.kind)
    },
  })
  let disposed = false
  let ownedShell: ShellRuntime | null = null
  let unsubscribeShell: Unsubscribe | null = null
  let shell: ShellRuntimeState

  if (!options.config.shell.enabled) {
    shell = { ready: false, error: "The integrated shell is disabled in config" }
  } else {
    try {
      ownedShell = createShell({
        cwd,
        command: options.config.shell.command,
        scrollback: options.config.shell.scrollback,
      })
      unsubscribeShell = ownedShell.onEvent((event) => store.applyShellEvent(event))
      shell = { ready: true, runtime: ownedShell }
    } catch (error) {
      unsubscribeShell?.()
      unsubscribeShell = null
      await disposeQuietly(ownedShell ?? undefined)
      ownedShell = null
      shell = { ready: false, error: errorMessage(error) }
    }
  }

  /**
   * Schedule a fail-soft branch read for one session without making its caller wait.
   * A generation guard prevents an older, slower read from overwriting a newer
   * boundary result. Null emits a blank event that clears the optional field.
   */
  function refreshBranch(sessionId: SessionId): void {
    const seed = runtimes.get(sessionId)?.seed
    if (!seed || disposed) return
    const generation = (branchReadGenerations.get(sessionId) ?? 0) + 1
    branchReadGenerations.set(sessionId, generation)

    void (async () => {
      try {
        const branch = await readBranch(seed.cwd)
        if (disposed || branchReadGenerations.get(sessionId) !== generation) return
        store.applyEvent(sessionId, { kind: "branch", branch: branch ?? "" })
      } catch {
        // The production reader is fail-soft; keep that contract for injected readers too.
      }
    })()
  }

  /**
   * Park a permission request until the user answers it.
   *
   * The store holds a single approval slot, so concurrent requests (both agents
   * asking at once, or one agent asking twice) queue behind the one on screen and
   * surface in arrival order. The agent stays blocked on this promise meanwhile,
   * which is exactly the back-pressure ACP expects.
   */
  function acceptsRuntimeEvents(runtime: AgentRuntime): boolean {
    return !disposed && runtimes.get(runtime.seed.id) === runtime && runtime.acceptEvents && !runtime.closing
  }

  function applyRuntimeEvent(runtime: AgentRuntime, event: DomainSessionEvent): void {
    if (!acceptsRuntimeEvents(runtime)) return
    if (event.kind === "status" && event.status === "error") {
      interactionCoordinator.cancelSession(
        runtime.seed.id,
        runtime.generation,
        "connection_error",
      )
    }
    if (event.kind === "usage") {
      logUsageSeen(
        { provider: runtime.seed.providerKind, used: event.used, size: event.size },
        options.config.telemetryEnabled,
        usageSeenSink,
      )
    }
    store.applyEvent(runtime.seed.id, event)
  }

  function enqueuePermission(runtime: AgentRuntime, request: PermissionRequest): Promise<PermissionOutcome> {
    if (!acceptsRuntimeEvents(runtime)) return Promise.resolve({ outcome: "cancelled" })
    return interactionCoordinator.enqueuePermission(runtime.seed.id, runtime.generation, request)
  }

  async function enqueueClarification(
    runtime: AgentRuntime,
    payload: ClarificationPayload,
  ): Promise<ClarificationOutcome> {
    if (!acceptsRuntimeEvents(runtime)) return { kind: "cancelled" }
    const generation = runtime.generation
    const key = clarificationCountKey(runtime.seed.id, generation)
    pendingClarificationCounts.set(key, (pendingClarificationCounts.get(key) ?? 0) + 1)
    store.applyEvent(runtime.seed.id, { kind: "status", status: "awaiting_clarification" })
    try {
      return await interactionCoordinator.enqueueClarification(
        runtime.seed.id,
        generation,
        payload,
      )
    } finally {
      const remaining = (pendingClarificationCounts.get(key) ?? 1) - 1
      if (remaining > 0) pendingClarificationCounts.set(key, remaining)
      else pendingClarificationCounts.delete(key)
      if (
        remaining === 0 &&
        runtime.generation === generation &&
        acceptsRuntimeEvents(runtime) &&
        store.getState().sessions[runtime.seed.id]?.status === "awaiting_clarification"
      ) {
        store.applyEvent(runtime.seed.id, { kind: "status", status: "working" })
      }
    }
  }

  /** Settle only the coordinator request currently projected into the approval slot. */
  function resolvePermission(outcome: PermissionOutcome): void {
    if (activeInteraction?.kind !== "permission") return
    interactionCoordinator.resolveActive(
      activeInteraction.requestId,
      activeInteraction.generation,
      outcome,
    )
  }

  /** Settle only the clarification identity captured by the rendering UI. */
  function resolveClarification(
    requestId: string,
    generation: number,
    outcome: ClarificationOutcome,
  ): void {
    interactionCoordinator.resolveActive(requestId, generation, outcome)
  }

  /**
   * Label a parked approval with the session it belongs to. `title` and `cwd` come
   * from the session's seed so the prompt names which agent, in which directory, is
   * asking - the answer can never be misattributed across a multi-session fleet.
   */
  function approvalOverlay(sessionId: SessionId, request: PermissionRequest): ApprovalOverlay {
    const seed = runtimes.get(sessionId)?.seed
    return { sessionId, title: seed?.title ?? sessionId, cwd: seed?.cwd ?? "", request }
  }

  function clarificationOverlay(interaction: Extract<ActiveAgentInteraction, { kind: "clarification" }>): ClarificationOverlay {
    const seed = runtimes.get(interaction.sessionId)?.seed
    return {
      requestId: interaction.requestId,
      generation: interaction.generation,
      sessionId: interaction.sessionId,
      title: seed?.title ?? interaction.sessionId,
      cwd: seed?.cwd ?? "",
      payload: interaction.payload,
    }
  }

  function getSession(sessionId: SessionId): AgentSession | undefined {
    const runtime = runtimes.get(sessionId)
    if (
      !runtime?.state.ready ||
      !runtime.acceptEvents ||
      runtime.closing ||
      !runtime.connection ||
      runtime.acpSessionId === null
    ) {
      return undefined
    }
    return { sessionId, acpSessionId: runtime.acpSessionId, connection: runtime.connection }
  }

  function registerRuntime(seed: SessionSeed, config: AgentConfig | null): AgentRuntime {
    const runtime: AgentRuntime = {
      seed,
      config,
      state: {
        sessionId: seed.id,
        providerKind: seed.providerKind,
        displayName: config?.displayName ?? seed.title,
        title: seed.title,
        cwd: seed.cwd,
        ready: false,
        error: config ? "Starting" : "Provider unavailable",
      },
      connection: null,
      acpSessionId: null,
      unsubscribe: null,
      closing: false,
      acceptEvents: true,
      cancelCompleted: false,
      generation: 0,
    }
    runtimes.set(seed.id, runtime)
    const capability = clarificationCapabilityFor(config)
    store.setClarificationCapability(seed.id, capability)
    options.recorder?.clarificationCapabilityClassified?.(
      seed.providerKind,
      capability.status,
      capabilityDiagnostic(capability),
    )
    return runtime
  }

  /** Bring one session up, or record precisely why it did not come up. */
  async function startSession(seed: SessionSeed, config: AgentConfig): Promise<void> {
    let connection: AgentConnection | undefined
    const runtime = runtimes.get(seed.id) ?? registerRuntime(seed, config)
    runtime.generation = nextConnectionGeneration(seed.id, connectionGenerations)
    runtime.config = config
    store.setConversationAvailability(seed.id, { kind: "starting" })
    try {
      connection = create(config)
      runtime.connection = connection
      const ready = await connection.connect()
      if (!ready.ready) {
        await failSession(runtime, connection, ready.error, "connection-failed")
        return
      }
      // The agent may advertise its current model/effort in the `session/new` response,
      // which the adapter emits as a `config_options` event *during* `newSession`. The
      // permanent subscription below is bound only after `startSession` resets the slice,
      // so capture that seed here and replay it after the reset - otherwise the selector
      // starts empty and the picker is blank until the first switch (ADR-004).
      let seededConfig: DomainSessionEvent | null = null
      const captureSeed = connection.onUpdate((event) => {
        if (event.kind === "config_options") seededConfig = event
      })
      const acpSessionId = await connection.newSession(seed.cwd, mcpServers)
      captureSeed()
      // Bind the slice before subscribing: `startSession` resets the transcript, so
      // an event that arrived first would be thrown away.
      store.startSession(seed.id, acpSessionId)
      if (seededConfig) store.applyEvent(seed.id, seededConfig)
      const unsubscribe = connection.onUpdate((event) => applyRuntimeEvent(runtime, event))
      connection.onPermission((request) => enqueuePermission(runtime, request))
      connection.onClarification((payload) => enqueueClarification(runtime, payload))
      runtime.state = {
        sessionId: seed.id,
        providerKind: seed.providerKind,
        displayName: config.displayName,
        title: seed.title,
        cwd: seed.cwd,
        ready: true,
        acpSessionId,
      }
      runtime.connection = connection
      runtime.acpSessionId = acpSessionId
      runtime.unsubscribe = unsubscribe
      store.setConversationAvailability(seed.id, { kind: "ready" })
    } catch (error) {
      onError(seed.id, error)
      await failSession(runtime, connection, errorMessage(error), "connection-failed")
    }
  }

  /** Record a session as not-ready and release the connection it never got to use. */
  async function failSession(
    runtime: AgentRuntime,
    connection: AgentConnection | undefined,
    error: string,
    reasonCode: "connection-failed" | "restore-unavailable" | "provider-unavailable",
  ): Promise<void> {
    interactionCoordinator.cancelSession(
      runtime.seed.id,
      runtime.generation,
      "connection_error",
    )
    runtime.state = {
      sessionId: runtime.seed.id,
      providerKind: runtime.seed.providerKind,
      displayName: runtime.config?.displayName ?? runtime.seed.title,
      title: runtime.seed.title,
      cwd: runtime.seed.cwd,
      ready: false,
      error,
    }
    runtime.connection = null
    runtime.acpSessionId = null
    runtime.unsubscribe = null
    runtime.acceptEvents = false
    store.setConversationAvailability(runtime.seed.id, {
      kind: "unavailable",
      reasonCode,
      retryable: runtime.config !== null,
    })
    await disposeQuietly(connection)
  }

  /**
   * Open a clean ACP session while preserving the config snapshot the agent emits
   * during `session/new`. Restore fallbacks share this path so a rejected resume
   * cannot leave a partly replayed transcript or an empty model picker behind.
   */
  async function startFreshRestoredSession(
    connection: AgentConnection,
    seed: SessionSeed,
    runtime: AgentRuntime,
  ): Promise<{ acpSessionId: string; unsubscribe: Unsubscribe }> {
    let seededConfig: DomainSessionEvent | null = null
    const captureSeed = connection.onUpdate((event) => {
      if (event.kind === "config_options") seededConfig = event
    })
    let acpSessionId: string
    try {
      acpSessionId = await connection.newSession(seed.cwd, mcpServers)
    } finally {
      captureSeed()
    }
    store.startSession(seed.id, acpSessionId!)
    if (seededConfig) store.applyEvent(seed.id, seededConfig)
    const unsubscribe = connection.onUpdate((event) => applyRuntimeEvent(runtime, event))
    connection.onPermission((request) => enqueuePermission(runtime, request))
    connection.onClarification((payload) => enqueueClarification(runtime, payload))
    return { acpSessionId: acpSessionId!, unsubscribe }
  }

  /**
   * Replace one live runtime from a persisted pointer without coupling its outcome
   * to any peer. The store slice is reset and subscribed before `loadSession`, so
   * replay emitted synchronously by the adapter cannot arrive before its owner is
   * bound (ADR-004).
   */
  async function restoreSession(seed: SessionSeed, config: AgentConfig, stored: PersistedAgent | undefined): Promise<void> {
    const previous = runtimes.get(seed.id) ?? registerRuntime(seed, config)
    interactionCoordinator.cancelSession(
      seed.id,
      previous.generation,
      "session_replaced",
    )
    previous.closing = true
    previous.acceptEvents = false
    previous?.unsubscribe?.()
    previous.unsubscribe = null
    const previousConnection = previous.connection
    previous.connection = null
    previous.acpSessionId = null
    await disposeQuietly(previousConnection ?? undefined)
    previous.config = config
    previous.generation = nextConnectionGeneration(seed.id, connectionGenerations)
    previous.closing = false
    previous.acceptEvents = true
    previous.cancelCompleted = false
    store.setConversationAvailability(seed.id, { kind: "starting" })

    let connection: AgentConnection | undefined
    let unsubscribe: Unsubscribe | undefined
    try {
      connection = create(config)
      previous.connection = connection
      const ready = await connection.connect()
      if (!ready.ready) {
        store.setRestoration(seed.id, "unavailable")
        await failSession(previous, connection, ready.error, "restore-unavailable")
        return
      }

      let acpSessionId: string
      // A zero-turn record has no history to restore. Some ACP adapters (including
      // Codex) do not make that just-created session durable until its first turn,
      // so asking them to load it later only turns an otherwise usable pane into an
      // avoidable error. Start a fresh session in that case.
      if (ready.canLoadSession && stored?.sessionId && stored.messageCount > 0) {
        acpSessionId = stored.sessionId
        store.startSession(seed.id, acpSessionId, { preserveWorkspaceAttention: true })
        unsubscribe = connection.onUpdate((event) => applyRuntimeEvent(previous, event))
        connection.onPermission((request) => enqueuePermission(previous, request))
        connection.onClarification((payload) => enqueueClarification(previous, payload))
        try {
          await connection.loadSession(acpSessionId, seed.cwd, mcpServers)
          store.setRestoration(seed.id, "live")
        } catch (error) {
          unsubscribe()
          unsubscribe = undefined
          if (!isMissingCodexRollout(seed.providerKind, error)) throw error

          // Codex reports stale local threads as a generic internal error with a
          // nested "no rollout found" detail. The agent remains healthy, so recover
          // into a fresh live session rather than turning the whole pane into error.
          const fresh = await startFreshRestoredSession(connection, seed, previous)
          acpSessionId = fresh.acpSessionId
          unsubscribe = fresh.unsubscribe
          store.setRestoration(seed.id, "unavailable")
        }
      } else {
        const fresh = await startFreshRestoredSession(connection, seed, previous)
        acpSessionId = fresh.acpSessionId
        unsubscribe = fresh.unsubscribe
        store.setRestoration(seed.id, "unavailable")
      }

      previous.state = {
        sessionId: seed.id,
        providerKind: seed.providerKind,
        displayName: config.displayName,
        title: seed.title,
        cwd: seed.cwd,
        ready: true,
        acpSessionId,
      }
      previous.connection = connection
      previous.acpSessionId = acpSessionId
      previous.unsubscribe = unsubscribe
      store.setConversationAvailability(seed.id, { kind: "ready" })
    } catch (error) {
      unsubscribe?.()
      store.setRestoration(seed.id, "unavailable")
      onError(seed.id, error)
      await failSession(previous, connection, errorMessage(error), "restore-unavailable")
    }
  }

  const requestedStartupSelection = store.getState().workspace.selectedVisibleId
  store.replaceSessions(
    initialPlan.map((entry) => ({
      seed: entry.seed,
      workspace: {
        sessionId: entry.seed.id,
        displayName: entry.seed.title,
        availability: { kind: "starting" },
      },
    })),
    requestedStartupSelection,
  )
  for (const entry of initialPlan) registerRuntime(entry.seed, entry.config)
  await Promise.all(initialPlan.map((entry) => startSession(entry.seed, entry.config)))
  focusReadySession(store, runtimes)

  // Start one read per session after startup has bound/reset every store slice.
  // Do not await these: branch discovery must never extend boot or block the UI.
  for (const entry of initialPlan) refreshBranch(entry.seed.id)

  function closeConversation(
    sessionId: SessionId,
    choice: CloseChoice,
  ): Promise<CloseConversationResult> {
    const existing = closePromises.get(sessionId)
    if (existing) return existing

    const state = store.getState()
    const conversation = state.workspace.conversations[sessionId]
    const session = state.sessions[sessionId]
    const runtime = runtimes.get(sessionId)
    if (!conversation || !session || !runtime || conversation.teardownState === "closing") {
      return Promise.resolve({ outcome: "ignored" })
    }

    const active = session.status !== "idle"
    if (choice === "keep-open") {
      return Promise.resolve(active ? { outcome: "kept-open" } : { outcome: "ignored" })
    }
    if (choice === "background") {
      if (!active) return Promise.resolve({ outcome: "ignored" })
      store.backgroundConversation(sessionId)
      return Promise.resolve({ outcome: "backgrounded" })
    }
    if ((choice === "close") !== (session.status === "idle")) {
      return Promise.resolve({ outcome: "ignored" })
    }

    const promise = teardownConversation(runtime, session.status)
    closePromises.set(sessionId, promise)
    void promise.then(
      () => {
        if (closePromises.get(sessionId) === promise) closePromises.delete(sessionId)
      },
      () => {
        if (closePromises.get(sessionId) === promise) closePromises.delete(sessionId)
      },
    )
    return promise
  }

  async function teardownConversation(
    runtime: AgentRuntime,
    status: SessionStatus,
  ): Promise<CloseConversationResult> {
    const sessionId = runtime.seed.id
    runtime.closing = true
    runtime.acceptEvents = false
    store.setConversationTeardown(sessionId, "closing")
    interactionCoordinator.cancelSession(
      sessionId,
      runtime.generation,
      "conversation_closed",
    )

    try {
      if (
        (status === "working" || status === "awaiting_approval" || status === "awaiting_clarification")
        && !runtime.cancelCompleted
      ) {
        if (!runtime.connection || runtime.acpSessionId === null) {
          throw new Error("Targeted cancellation is unavailable")
        }
        await runtime.connection.cancel(runtime.acpSessionId)
        runtime.cancelCompleted = true
      }

      runtime.unsubscribe?.()
      runtime.unsubscribe = null
      if (runtime.connection) await runtime.connection.dispose()
      runtime.connection = null
      runtime.acpSessionId = null
      runtimes.delete(sessionId)
      branchReadGenerations.delete(sessionId)
      store.removeSession(sessionId)
      return { outcome: "closed" }
    } catch (error) {
      onError(sessionId, error)
      runtime.closing = false
      runtime.acceptEvents = false
      runtime.state = {
        sessionId,
        providerKind: runtime.seed.providerKind,
        displayName: runtime.config?.displayName ?? runtime.seed.title,
        title: runtime.seed.title,
        cwd: runtime.seed.cwd,
        ready: false,
        error: errorMessage(error),
      }
      store.setConversationTeardown(sessionId, "open")
      store.setConversationAvailability(sessionId, {
        kind: "unavailable",
        reasonCode: "teardown-failed",
        retryable: runtime.config !== null,
      })
      return { outcome: "teardown-failed" }
    }
  }

  async function createConversation(): Promise<SessionId | null> {
    if (disposed) return null
    const state = store.getState()
    const selectedId = state.workspace.selectedVisibleId
    const selected = selectedId ? state.sessions[selectedId] : undefined
    const providerKind = selected?.providerKind ?? DEFAULT_PROVIDER_ORDER.find(
      (kind) => findAgentConfig(options.config, kind) !== undefined,
    )
    const config = providerKind ? findAgentConfig(options.config, providerKind) : undefined
    if (!providerKind || !config) {
      store.setWorkspaceNotice({ code: "no-provider-available" })
      return null
    }

    const sessionId = newSessionId()
    if (state.workspace.conversations[sessionId] || runtimes.has(sessionId)) {
      onError(sessionId, new Error(`Conversation id already exists: ${sessionId}`))
      return null
    }
    const seed: SessionSeed = {
      id: sessionId,
      providerKind,
      title: config.displayName,
      cwd: selected?.cwd ?? cwd,
    }
    store.setWorkspaceNotice(null)
    store.addSession(seed, { displayName: seed.title, availability: { kind: "starting" } })
    registerRuntime(seed, config)
    await startSession(seed, config)
    refreshBranch(sessionId)
    return sessionId
  }

  const actions = createControllerActions({
    store,
    getSession,
    resolvePermission,
    resolveClarification,
    newMessageId: options.newMessageId,
    onError,
    refreshBranch,
    recorder: options.recorder,
    repositoryFileSource,
    createConversation,
    closeConversation,
    startNewRun: async () => {
      if (disposed) return
      store.setRestorationBundle(null)
      const entries = orderedRuntimes(store, runtimes).filter(
        (runtime): runtime is AgentRuntime & { config: AgentConfig } => runtime.config !== null,
      )
      await Promise.all(entries.map((entry) => restoreSession(entry.seed, entry.config, undefined)))
      for (const entry of entries) {
        store.setRestoration(entry.seed.id, null)
        refreshBranch(entry.seed.id)
      }
      focusReadySession(store, runtimes)
    },
    startFreshSession: async (sessionId) => {
      if (disposed) return false
      const entry = runtimes.get(sessionId)
      if (!entry?.config) return false
      await restoreSession(entry.seed, entry.config, undefined)
      const ready = getSession(sessionId) !== undefined
      if (ready) {
        store.setRestoration(sessionId, null)
        refreshBranch(sessionId)
      }
      return ready
    },
  })

  // Send each ready session its optional first task as the opening prompt (ADR-005),
  // unless boot already found a persisted run that it will restore. A restore replaces
  // these fresh ACP sessions, so sending first would duplicate configured work.
  // Fire-and-forget: the opening turn must not block boot on the agent's full reply,
  // and `sendPrompt` already records the user turn and routes failures to `onError`.
  if (options.sendInitialTasks !== false) {
    for (const entry of initialPlan) {
      const task = entry.seed.task
      if (task && runtimes.get(entry.seed.id)?.state.ready) {
        void actions.sendPrompt(task, entry.seed.id)
      }
    }
  }

  return {
    store,
    actions,
    shell,
    runtimes: () => orderedRuntimes(store, runtimes).map((runtime) => runtime.state),
    runtime: (sessionId) => runtimes.get(sessionId)?.state,
    isReady: (sessionId) => runtimes.get(sessionId)?.state.ready === true,
    closeConversation,
    async restore(record, mode = "last-run"): Promise<void> {
      if (disposed) return
      options.recorder?.resumeLoadStarted?.()
      store.setRestorationBundle(record.handoffBundle)
      const restoredRecord = record.version === 1
        ? migratePersistedRunV1(record, resolveSessions(options.config, { launchCwd: cwd }))
        : record
      interactionCoordinator.cancelAll()
      await disposeAgentRuntimes(runtimes)
      runtimes.clear()
      branchReadGenerations.clear()
      pendingClarificationCounts.clear()

      const entries = restoreEntries(restoredRecord)
      store.replaceSessions(
        entries.map((entry) => ({ seed: entry.seed, workspace: entry.workspace })),
        restoredRecord.workspace.selectedVisibleId,
      )
      for (const entry of entries) {
        const config = findAgentConfig(options.config, entry.seed.providerKind) ?? null
        const runtime = registerRuntime(entry.seed, config)
        if (!config) {
          store.setRestoration(entry.seed.id, "unavailable")
          await failSession(runtime, undefined, "Provider unavailable", "provider-unavailable")
        }
      }
      await Promise.all(
        entries.map(async (entry) => {
          const runtime = runtimes.get(entry.seed.id)!
          if (!runtime.config) return
          await restoreSession(entry.seed, runtime.config, entry.stored)
        }),
      )
      for (const entry of entries) refreshBranch(entry.seed.id)
      const restoration = store.getState().restoration
      let live = 0
      for (const entry of entries) {
        const outcome = restoration[entry.seed.id]
        if (outcome === "live") live += 1
        else if (outcome === "unavailable") options.recorder?.resumePaneUnavailable?.(entry.seed.id)
      }
      const liveCount: ResumeLiveCount = live <= 0 ? 0 : live === 1 ? 1 : 2
      options.recorder?.sessionResumed?.({ mode, liveCount })
    },
    async dispose(): Promise<void> {
      disposed = true
      interactionCoordinator.dispose()
      pendingClarificationCounts.clear()
      unsubscribeShell?.()
      unsubscribeShell = null
      const shellRuntime = ownedShell
      ownedShell = null
      await Promise.all(
        [
          disposeQuietly(shellRuntime ?? undefined),
          disposeAgentRuntimes(runtimes),
        ],
      )
    },
  }
}

/** Advance one session's connection identity without ever reusing an old generation. */
function nextConnectionGeneration(
  sessionId: SessionId,
  generations: Map<SessionId, number>,
): number {
  const generation = (generations.get(sessionId) ?? 0) + 1
  generations.set(sessionId, generation)
  return generation
}

function clarificationCountKey(sessionId: SessionId, generation: number): string {
  return `${sessionId}\u0000${generation}`
}

function clarificationCapabilityFor(config: AgentConfig | null): ClarificationCapability {
  return isResolvedAgentConfig(config)
    ? config.clarificationCapability
    : { status: "unsupported", reason: "unknown_recipe" }
}

function capabilityDiagnostic(
  capability: ClarificationCapability,
): ClarificationCapabilityDiagnostic {
  return capability.status === "supported" ? "verified_recipe" : capability.reason
}

function isResolvedAgentConfig(config: AgentConfig | null): config is ResolvedAgentConfig {
  return config !== null && "clarificationCapability" in config
}

/**
 * Keep focus on a usable session: if the session the store starts focused on failed
 * to come up, focus the first one that did. When none is ready, focus is left where
 * it was so the status strip still names a session to explain.
 */
function focusReadySession(store: AppStore, runtimes: Map<SessionId, AgentRuntime>): void {
  const focused = store.getState().workspace.selectedVisibleId
  if (focused !== null && runtimes.get(focused)?.state.ready) return
  const firstReady = orderedRuntimes(store, runtimes).find((runtime) => runtime.state.ready)
  if (firstReady) store.setFocus(firstReady.seed.id)
}

interface RestoreEntry {
  seed: SessionSeed
  workspace: WorkspaceConversationSeed
  stored: PersistedAgent
}

function restoreEntries(record: PersistedRunRecordV2): RestoreEntry[] {
  const entries: RestoreEntry[] = []
  for (const sessionId of record.workspace.order) {
    const descriptor: PersistedConversationV2 | undefined = record.conversations[sessionId]
    const workspace = record.workspace.conversations[sessionId]
    if (!descriptor || !workspace) continue
    entries.push({
      seed: {
        id: descriptor.sessionId,
        providerKind: descriptor.providerKind,
        title: descriptor.initialTitle,
        cwd: descriptor.cwd,
        acpSessionId: descriptor.acpSessionId,
      },
      workspace: {
        sessionId,
        displayName: workspace.displayName,
        lifecycle: workspace.lifecycle,
        createdOrdinal: workspace.createdOrdinal,
        availability: { kind: "starting" },
        teardownState: "open",
        attention: {
          status: descriptor.status,
          seen: workspace.attention.seen,
          sequence: workspace.attention.sequence,
        },
      },
      stored: {
        sessionId: descriptor.acpSessionId,
        lastPrompt: descriptor.lastPrompt,
        messageCount: descriptor.messageCount,
        status: descriptor.status,
      },
    })
  }
  return entries
}

function orderedRuntimes(store: AppStore, runtimes: Map<SessionId, AgentRuntime>): AgentRuntime[] {
  return store.getState().workspace.order.flatMap((sessionId) => {
    const runtime = runtimes.get(sessionId)
    return runtime ? [runtime] : []
  })
}

async function disposeAgentRuntimes(runtimes: Map<SessionId, AgentRuntime>): Promise<void> {
  await Promise.all(
    [...runtimes.values()].map(async (runtime) => {
      runtime.closing = true
      runtime.acceptEvents = false
      runtime.unsubscribe?.()
      runtime.unsubscribe = null
      const connection = runtime.connection
      runtime.connection = null
      runtime.acpSessionId = null
      await disposeQuietly(connection ?? undefined)
    }),
  )
}

function defaultCreateConnection(config: AgentConfig): AgentConnection {
  return createAgentConnection({ config })
}

/** Tear an owned runtime down; a noisy teardown must not mask the shutdown path. */
async function disposeQuietly(runtime: { dispose(): Promise<void> } | undefined): Promise<void> {
  if (!runtime) return
  try {
    await runtime.dispose()
  } catch {
    // Nothing actionable: the caller is already on an error or shutdown path.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Recover only Codex's known stale-rollout response; all other load failures remain visible. */
function isMissingCodexRollout(provider: ProviderKind, error: unknown): boolean {
  if (provider !== "codex") return false
  const details = errorDetails(error)
  return `${errorMessage(error)} ${details ?? ""}`.toLowerCase().includes("no rollout found")
}

/** Pull the JSON-RPC wrapper's actionable nested detail without importing its SDK type. */
function errorDetails(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null
  const data = (error as { data: unknown }).data
  if (typeof data !== "object" || data === null || !("details" in data)) return null
  const details = (data as { details: unknown }).details
  return typeof details === "string" && details.length > 0 ? details : null
}
