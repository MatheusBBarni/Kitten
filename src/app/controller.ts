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

import type { AgentConnection, AgentPromptInput, PermissionOutcome, PermissionRequest, PromptBlock } from "../agent/agentConnection.ts"
import { createAgentConnection } from "../agent/agentConnection.ts"
import { CONTEXT_PACK_MCP_INSTRUCTIONS, type ContextPackMcpOperation } from "../agent/contextPackMcp.ts"
import { lstatSync, realpathSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { findAgentConfig, resolveSessions } from "../config/configLoader.ts"
import {
  CONTEXT_BUILD_OPERATIONS,
  resolveContextBuildCapability,
  resolveRecipientProfile,
} from "../config/contextPackCapability.ts"
import {
  EXPLORE_ATTESTATION_VERSION,
  resolveExploreCapability,
  type ExploreCapability,
} from "../config/exploreCapability.ts"
import {
  HARNESS_CONTRACT_SDK_VERSION,
  resolveHarnessCapability,
  type HarnessCapability,
  type HarnessRuntimeEvidence,
} from "../config/harnessCapability.ts"
import {
  connectionReadinessFailure,
  handshakeReadinessFailure,
  preflightAgentReadiness,
  type AgentReadinessPreflight,
  type ReadinessPreflightOptions,
} from "../config/readiness.ts"
import { readGitBranch } from "../config/gitBranch.ts"
import { resolveMcpServers, type McpResolutionResult } from "../config/mcpResolver.ts"
import { DEFAULT_PROVIDER_ORDER, MODEL_CATEGORY, type AgentConfig, type AppConfig, type ClarificationCapability, type ClarificationOutcome, type ClarificationPayload, type ContextBuildAvailability, type ContextBuildBinding, type ContextBuildOperation, type ContextPackMutationResult, type ContextPackReviewCandidate, type ContextPackSealedState, type ContextPackState, type DomainSessionEvent, type DraftContextPack, type DurableSealedContextPack, type HandoffBundle, type HandoffSourceIdentityIndex, type ManagedWorktreeBinding, type ManagedWorktreeReason, type ProviderKind, type ProviderModelDefault, type RecipientFit, type RecipientFitEvidence, type RecipientProfileAvailability, type ResolvedAgentConfig, type ResolvedRecipientProfile, type RevisionFencedContextPackMutation, type SessionId, type SessionSeed, type SessionState, type SessionStatus, type WorkspaceConversationSeed } from "../core/types.ts"
import { renderHarnessPrompt } from "../core/harnessPrompt.ts"
import type { ExploreDenialReason } from "../core/explorePolicy.ts"
import { countOccupiedDelegatedChildren, isDelegationSettled } from "../core/orchestration.ts"
import { assembleCandidate, assessRecipientFit, createDraft, restoreManifest, sealCandidate } from "../core/contextPack.ts"
import { createSecretRedactor, type SecretRedactor } from "../core/secretRedactor.ts"
import {
  type HarnessDeliveryCheckpoint,
  migratePersistedRunV1,
  migratePersistedRunToV4,
  type PersistedAgent,
  type PersistedContextPack,
  type PersistedConversationV2,
  type PersistedRunRecord,
  type PersistedRunRecordV4,
} from "../persistence/runRecord.ts"
import {
  createShellRuntime as createRealShellRuntime,
  type ShellRuntime,
  type ShellRuntimeFactory,
} from "../shell/shellRuntime.ts"
import { createAppStore, type AppStore, type ApprovalOverlay, type ClarificationOverlay, type ContextBuildDraftPreparation, type DelegatedChildIdentity, type DelegatedChildStatePublication, type Unsubscribe } from "../store/appStore.ts"
import {
  bucketAgentRunBatchSize,
  bucketAgentRunDuration,
  createUsageSeenJsonlFileSink,
  logUsageSeen,
  resolveTelemetryPath,
  type ResumeLiveCount,
  type ResumeMode,
  type SessionResumedInput,
  type TabRestoreInput,
  type ClarificationCapabilityDiagnostic,
  type ClarificationSessionLossReason,
  type ExploreCapacityDeniedInput,
  type ExploreLaunchDeniedInput,
  type ExploreLaunchEligibleInput,
  type ExploreStartFailedInput,
  type ExploreTerminalInput,
  type UsageSeenSink,
  type ProviderReadinessOutcome,
  type AgentRunTelemetryInput,
  type McpBridgeFailureCategory,
  type SteeringCapabilityClass,
  type SteeringTelemetryOutcome,
} from "../telemetry/recorder.ts"
import {
  createControllerActions,
  type ActionTelemetry,
  type AgentSession,
  type CloseChoice,
  type CloseConversationResult,
  type ControllerActions,
  type ContextBuildAvailabilityResult,
  type ContextBuildDenialReason,
  type ContextBuildStartResult,
  type ContextPackReviewResult,
  type ContextPackExportActionInput,
  type ContextPackExportActionResult,
  type ContextPackSealActionResult,
  type ContextPackSendHereResult,
  type ExploreAvailabilityResult,
  type ExploreLaunchResult,
  type StartDelegatedChildInput,
  type StartContextBuildInput,
  type SteeringResult,
} from "./actions.ts"
import { createSteeringCoordinator, type SteeringCoordinator } from "./steeringCoordinator.ts"
import {
  beginDispatch,
  beginFresh,
  completeDispatch,
  failBeforeDispatch,
  failIndeterminate,
  restoreHarnessDelivery,
  type HarnessDelivery,
} from "./harnessDelivery.ts"
import {
  isPathContainedBy,
  isSafeRepositoryRelativePath,
  repositoryFileSource as productionRepositoryFileSource,
  type RepositoryFileSource,
} from "./fileDiscovery.ts"
import {
  KittenMcpBridgeError,
  createKittenMcpBridge as createRealKittenMcpBridge,
  type AgentRunControl,
  type AgentRunRoute,
  type AgentRunSnapshot,
  type AgentRunTask,
  type KittenMcpBridge,
  type KittenMcpBridgeFailureReason,
  type KittenMcpBridgeOptions,
} from "./kittenMcpBridge.ts"
import {
  createContextPackBridge as createRealContextPackBridge,
  type ContextPackBridge,
  type ContextPackBridgeAuthorization,
  type ContextPackBridgeDisposalReason,
  type ContextPackBridgeFacade,
  type ContextPackBridgeRoute,
  type CreateContextPackBridgeOptions,
} from "./contextPackBridge.ts"
import {
  createContextPackMaterializer,
  type ContextPackMaterializer,
} from "./contextPackMaterializer.ts"
import {
  createContextPackExporter,
  type ContextPackExporter,
} from "./contextPackExport.ts"
import {
  createManagedWorktreeProvisioner,
  type CleanupManagedWorktreeResult,
  type ManagedWorktreeProvisioner,
} from "./managedWorktree.ts"

export type { CloseChoice, CloseConversationResult } from "./actions.ts"

/** The additional content-free telemetry emitted by resume orchestration. */
export interface ControllerTelemetry extends ActionTelemetry {
  providerReadiness?(provider: ProviderKind, outcome: ProviderReadinessOutcome): void
  resumeLoadStarted?(): void
  sessionResumed?(input: SessionResumedInput): void
  resumePaneUnavailable?(sessionId: SessionId): void
  tabRestore?(input: TabRestoreInput): void
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
  clarificationSettled?(
    requestId: string,
    terminalKind: "submitted" | "skipped" | "timed_out" | "cancelled",
  ): void
  clarificationPreempted?(sessionId: SessionId, interactionKind: "permission" | "clarification"): void
  clarificationResumed?(sessionId: SessionId, interactionKind: "permission" | "clarification"): void
  clarificationCancelledOnSessionLoss?(
    sessionId: SessionId,
    lossReason: ClarificationSessionLossReason,
  ): void
  delegatedLaunchRequested?(lifecycleKey: string): void
  delegatedLaunchSucceeded?(lifecycleKey: string): void
  delegatedLaunchFailed?(lifecycleKey: string): void
  delegatedChildTerminal?(
    lifecycleKey: string,
    status: "finished" | "failed" | "cancelled",
  ): void
  delegatedCascadeRequested?(lifecycleKey: string): void
  delegatedCascadeCompleted?(lifecycleKey: string): void
  delegatedTeardownFailed?(lifecycleKey: string): void
  exploreLaunchEligible?(lifecycleKey: string, input: ExploreLaunchEligibleInput): void
  exploreLaunchDenied?(input: ExploreLaunchDeniedInput): void
  exploreCapacityDenied?(input: ExploreCapacityDeniedInput): void
  exploreStartFailed?(lifecycleKey: string, input: ExploreStartFailedInput): void
  exploreTerminal?(lifecycleKey: string, input: ExploreTerminalInput): void
  managedWorktreeRequested?(attemptKey: string): void
  managedWorktreeProvisioned?(attemptKey: string): void
  managedWorktreeProvisionFailed?(attemptKey: string, reason: ManagedWorktreeReason): void
  managedWorktreeReconciled?(reason?: ManagedWorktreeReason): void
  managedWorktreeCleanupRefused?(reason: ManagedWorktreeReason): void
  managedWorktreeCleaned?(): void
  agentRunControl?(input: AgentRunTelemetryInput): void
  mcpBridgeFailure?(category: McpBridgeFailureCategory): void
  steeringOutcome?(
    lifecycleKey: string,
    outcome: SteeringTelemetryOutcome,
    capabilityClass: SteeringCapabilityClass,
  ): void
}

/**
 * One session's run-time standing, as the status strip and prompt gate read it.
 * `cwd` is the session's own working directory (ADR-005): it labels approvals and
 * feeds the per-session repo check the first-run gate runs.
 */
/** The declared MCP servers this runtime received and the declarations skipped at boot. */
export interface McpRuntimeReadout {
  loaded: string[]
  skipped: McpResolutionResult["skipped"]
  /** Kitten's per-session bridge is generated rather than read from user config. */
  askUser?: "loading" | "attached" | "unavailable"
}

/**
 * Runtime fixtures created outside the controller predate MCP provisioning. The
 * controller always supplies this field; optionality keeps external test doubles
 * source-compatible while they migrate.
 */
type RuntimeMcpReadout = { mcp?: McpRuntimeReadout }

export type AgentRuntimeState =
  | (RuntimeMcpReadout & {
      sessionId: SessionId
      providerKind: ProviderKind
      displayName: string
      title: string
      cwd: string
      ready: true
      acpSessionId: string
    })
  | (RuntimeMcpReadout & {
      sessionId: SessionId
      providerKind: ProviderKind
      displayName: string
      title: string
      cwd: string
      ready: false
      error: string
    })

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
  createConnection?: (config: ResolvedAgentConfig) => AgentConnection
  /** How to build the restricted Context Build child connection. Defaults to ACP filesystem disabled. */
  createContextBuildConnection?: (config: ResolvedAgentConfig) => AgentConnection
  /** Lightweight recipe/binary/version check used before every Cursor connection. */
  preflightAgentReadiness?: (
    config: ResolvedAgentConfig,
    options?: ReadinessPreflightOptions,
  ) => Promise<AgentReadinessPreflight>
  /** How to build the persistent shell. Defaults to the real PTY-backed runtime. */
  createShellRuntime?: ShellRuntimeFactory
  /** Ids for recorded user turns. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Ids for dynamically created conversations. Defaults to a random UUID. */
  newSessionId?: () => SessionId
  /** Stable ids for controller-owned permission and clarification lifecycles. */
  newInteractionId?: () => string
  /** Stable ids for active-turn and steering-request lifecycles. */
  newSteeringId?: () => string
  /** Controller-owned lifecycle clock; injectable for deterministic tests. */
  now?: () => number
  /** Where a connection failure is reported. Defaults to swallowing the failure. */
  onError?: (sessionId: SessionId, error: unknown) => void
  /** Off-render-path git branch reader. Defaults to the fail-soft production reader. */
  readBranch?: (cwd: string) => Promise<string | null>
  /** Repository file discovery source. Defaults to the fail-soft production source. */
  repositoryFileSource?: RepositoryFileSource
  /** Controller-owned managed child workspace lifecycle service. */
  managedWorktreeProvisioner?: ManagedWorktreeProvisioner
  /** The telemetry recorder actions report navigation and switch outcomes to. */
  recorder?: ControllerTelemetry
  /** Optional output seam for the gated, content-free usage-emission debug log. */
  usageSeenSink?: UsageSeenSink
  /** Whether configured first tasks should be sent after startup. Defaults to true. */
  sendInitialTasks?: boolean
  /** Whether ordinary fresh sessions should apply configured provider defaults before use. */
  applyProviderDefaultsOnFreshSession?: boolean
  /** Exact profile decision; injectable for deterministic credential-free tests. */
  resolveHarnessCapability?: (config: ResolvedAgentConfig) => HarnessCapability
  /** Closed explore attestation decision; injectable with reviewed fake evidence in tests. */
  resolveExploreCapability?: (config: ResolvedAgentConfig) => ExploreCapability
  /** Closed explore-v2 decision; called again for every Context Build launch. */
  resolveContextBuildCapability?: (config: ResolvedAgentConfig) => ContextBuildAvailability
  /** Closed Recipient Profile decision; called again for every fit or delivery decision. */
  resolveRecipientProfile?: (config: ResolvedAgentConfig) => RecipientProfileAvailability
  /** Exact payload counter for the version named by the current Recipient Profile. */
  countContextPackPayload?: (
    payload: string,
    profile: ResolvedRecipientProfile,
  ) => number | null
  /** Deterministic review redactor; injectable only for failure and race coverage. */
  contextPackRedactor?: SecretRedactor
  /** Schedule one accepted clarification timeout and return its cancellation hook. */
  scheduleClarificationTimeout?: (callback: () => void, timeoutMs: number) => () => void
  /** Schedule one bounded steering settlement wait and return its cancellation hook. */
  scheduleSteeringSettlementTimeout?: (callback: () => void, timeoutMs: number) => () => void
  /** Controller-owned bridge factory; injectable for lifecycle and composition tests. */
  createKittenMcpBridge?: (options: KittenMcpBridgeOptions) => KittenMcpBridge
  /** Dedicated Context Pack bridge factory; never shares the mixed child action surface. */
  createContextPackBridge?: (options: CreateContextPackBridgeOptions) => ContextPackBridge
  /** Bounded workspace reader used only through the dedicated Context Pack bridge. */
  contextPackMaterializer?: ContextPackMaterializer
  /** Confirmed exact-payload export boundary; injectable for no-write controller tests. */
  contextPackExporter?: ContextPackExporter
  /** Executable and optional entrypoint arguments used by generated bridge declarations. */
  kittenMcpExecutable?: { readonly command: string; readonly args?: readonly string[] }
}

/** The orchestrator the UI is handed at boot. */
export interface SessionController {
  /** The store every view subscribes to. */
  readonly store: AppStore
  /** Whether the resolved default-off transcript window presentation is enabled. */
  readonly transcriptWindowingEnabled: boolean
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
  /** Resolve exact ordinary-item source identities without granting path-only deduplication. */
  handoffSourceIdentities?(sessionId: SessionId, bundle: HandoffBundle): HandoffSourceIdentityIndex
  /** Recompute fit for one reviewed sealed attachment against the addressed target. */
  assessHandoffRecipientFit?(targetSessionId: SessionId, sealed: DurableSealedContextPack): RecipientFit
  /** Replace the controller-owned provider-default snapshot without mutating sessions. */
  updateProviderDefaults(defaults: Partial<Record<ProviderKind, ProviderModelDefault>>): void
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

/** Captured clarification identity with no access to mutable coordinator state. */
export interface ClarificationRequestHandle {
  readonly requestId: string
  readonly outcome: Promise<ClarificationOutcome>
  /** Cancel only this request for an explicit session-loss reason. */
  cancel(reason: ClarificationSessionLossReason): boolean
  /** Settle this exact request as timed out; late or duplicate attempts are inert. */
  timeout(): boolean
}

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
  ): ClarificationRequestHandle
  resolveActive(requestId: string, generation: number, outcome: AgentInteractionOutcome): boolean
  cancelSession(
    sessionId: SessionId,
    generation: number,
    lossReason?: ClarificationSessionLossReason,
  ): void
  cancelAll(lossReason?: ClarificationSessionLossReason): void
  hasPending(sessionId: SessionId, generation: number): boolean
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
    terminalize(
      entry,
      entry.kind === "permission" ? { outcome: "cancelled" } : { kind: "cancelled" },
      lossReason,
    )
  }

  function terminalize(
    entry: PendingInteraction,
    outcome: AgentInteractionOutcome,
    lossReason?: ClarificationSessionLossReason,
  ): boolean {
    if (entry.lifecycle === "terminal") return false
    if (entry.kind === "permission") {
      if (!("outcome" in outcome)) return false
      entry.lifecycle = "terminal"
      entry.resolve(outcome)
      return true
    }
    if (!("kind" in outcome)) return false
    entry.lifecycle = "terminal"
    onClarificationSettled(
      projection(entry) as Extract<ActiveAgentInteraction, { kind: "clarification" }>,
      outcome,
      lossReason,
    )
    entry.resolve(outcome)
    return true
  }

  function removeExact(entries: PendingInteraction[], target: PendingInteraction): boolean {
    const index = entries.indexOf(target)
    if (index < 0) return false
    entries.splice(index, 1)
    return true
  }

  function settleExact(
    entry: PendingInteraction,
    outcome: AgentInteractionOutcome,
    lossReason?: ClarificationSessionLossReason,
  ): boolean {
    if (entry.lifecycle === "terminal") return false
    if ((entry.kind === "permission") !== ("outcome" in outcome)) return false
    const wasActive = active === entry
    if (wasActive) active = null
    else if (!removeExact(queued, entry) && !removeExact(suspended, entry)) return false

    if (!terminalize(entry, outcome, lossReason)) return false
    if (wasActive) advance()
    return true
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
      const requestId = newRequestId()
      if (disposed) {
        return {
          requestId,
          outcome: Promise.resolve({ kind: "cancelled" }),
          cancel: () => false,
          timeout: () => false,
        }
      }

      let resolveOutcome!: (outcome: ClarificationOutcome) => void
      const outcome = new Promise<ClarificationOutcome>((resolve) => {
        resolveOutcome = resolve
      })
      const entry: Extract<PendingInteraction, { kind: "clarification" }> = {
        kind: "clarification",
        requestId,
        sessionId,
        generation,
        lifecycle: "active",
        payload,
        resolve: resolveOutcome,
      }
      if (active) {
        active.lifecycle = "suspended"
        suspended.push(active)
        onPreempted(projection(active))
      }
      activate(entry)
      publishActive()
      return {
        requestId,
        outcome,
        cancel: (reason) => settleExact(entry, { kind: "cancelled" }, reason),
        timeout: () => settleExact(entry, { kind: "timed_out" }),
      }
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

      return settleExact(current, outcome)
    },

    cancelSession(sessionId, generation, lossReason = "connection_error") {
      cancelWhere(
        (entry) => entry.sessionId === sessionId && entry.generation === generation,
        lossReason,
      )
    },

    cancelAll,

    hasPending(sessionId, generation) {
      return [active, ...suspended, ...queued].some(
        (entry) => entry?.sessionId === sessionId && entry.generation === generation,
      )
    },

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
  config: ResolvedAgentConfig | null
  state: AgentRuntimeState
  connection: AgentConnection | null
  acpSessionId: string | null
  unsubscribe: Unsubscribe | null
  closing: boolean
  acceptEvents: boolean
  cancelCompleted: boolean
  /** Monotonic identity of the connection currently owned by this runtime. */
  generation: number
  /** Delivery truth for the live ACP generation; never stores harness or user content. */
  harnessDelivery: HarnessDelivery | null
  /** Generated declaration owned by this exact live connection generation. */
  bridgeMcpServer: import("../core/types.ts").McpServerConfig | null
  bridgeGeneration: number | null
  /** Explore children receive no globally configured MCP declarations. */
  mcpScope: "ordinary" | "explore"
}

/** Controller-owned I/O handles for one store-bound, non-conversation Context Build child. */
interface ContextBuildChildRuntime {
  readonly binding: ContextBuildBinding
  readonly route: ContextPackBridgeRoute
  readonly capability: Extract<ContextBuildAvailability, { readonly status: "available" }>
  readonly clarificationHandles: Set<ClarificationRequestHandle>
  connection: AgentConnection | null
  acpSessionId: string | null
  unsubscribe: Unsubscribe | null
  settled: boolean
}

interface ContextBuildPreflight {
  readonly parentRuntime: AgentRuntime & { readonly config: ResolvedAgentConfig }
  readonly capability: Extract<ContextBuildAvailability, { readonly status: "available" }>
  readonly parentGeneration: number
  readonly workspaceRoot: string
}

interface ActivePromptLifecycle {
  readonly turnId: string
  readonly generation: number
  readonly settlement: Promise<void>
  settle(): void
}

interface SteeringRecoveryTransfer {
  readonly requestId: string
  readonly blocks: readonly PromptBlock[]
}

/**
 * Build the controller: connect every configured agent, open its session, and wire
 * its streams into the store. Resolves once every agent has either come up or been
 * marked not-ready - never rejects, because a broken agent is a state, not a crash.
 */
export async function createSessionController(options: SessionControllerOptions): Promise<SessionController> {
  const cwd = options.cwd ?? process.cwd()
  const create = options.createConnection ?? defaultCreateConnection
  const createContextBuildConnection = options.createContextBuildConnection ?? defaultCreateContextBuildConnection
  const preflight = options.preflightAgentReadiness ?? preflightAgentReadiness
  const attestExplore = options.resolveExploreCapability ?? ((config: ResolvedAgentConfig) =>
    resolveExploreCapability(config, undefined))
  const attestContextBuild = options.resolveContextBuildCapability ?? ((config: ResolvedAgentConfig) =>
    resolveContextBuildCapability(config, undefined, options.now?.() ?? Date.now()))
  // Resolve once per cockpit boot so every fresh, restored, and dynamically added
  // session receives the same validated stdio server list.
  const mcpResolution = resolveMcpServers(options.config.mcpServers)
  const mcpServers = mcpResolution.resolved
  const mcpReadout = (askUser: "loading" | "attached" | "unavailable" = "loading"): McpRuntimeReadout => ({
    loaded: mcpServers.map((server) => server.name),
    skipped: mcpResolution.skipped.map((server) => ({ ...server })),
    askUser,
  })
  const runtimeMcpReadout = (
    runtime: Pick<AgentRuntime, "mcpScope">,
    askUser: "loading" | "attached" | "unavailable",
  ): McpRuntimeReadout => runtime.mcpScope === "explore"
    ? { loaded: [], skipped: [], askUser }
    : mcpReadout(askUser)
  const createShell = options.createShellRuntime ?? createRealShellRuntime
  const onError = options.onError ?? (() => {})
  const readBranch = options.readBranch ?? readGitBranch
  const repositoryFileSource = options.repositoryFileSource ?? productionRepositoryFileSource
  const managedWorktrees = options.managedWorktreeProvisioner ?? createManagedWorktreeProvisioner()
  const resolveDeliveryCapability = options.resolveHarnessCapability ?? defaultResolveHarnessCapability
  const scheduleClarificationTimeout = options.scheduleClarificationTimeout ?? defaultScheduleClarificationTimeout
  const newSessionId = options.newSessionId ?? (() => crypto.randomUUID())
  const newSteeringId = options.newSteeringId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
  let providerDefaults = cloneProviderDefaults(options.config.providerDefaults ?? {})
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
  const activePrompts = new Map<SessionId, ActivePromptLifecycle>()
  const steeringCoordinators = new Map<SessionId, SteeringCoordinator>()
  const activeAgentRunStarts = new Set<string>()
  const pendingClarificationCounts = new Map<string, number>()
  const contextBuildChildren = new Map<SessionId, ContextBuildChildRuntime>()
  let activeInteraction: ActiveAgentInteraction | null = null
  const interactionCoordinator = createInteractionCoordinator({
    newRequestId: options.newInteractionId,
    onActiveChanged(interaction) {
      activeInteraction = interaction
      for (const coordinator of steeringCoordinators.values()) coordinator.advance()
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
  const kittenMcpExecutable = options.kittenMcpExecutable ?? defaultKittenMcpExecutable()
  const contextPackMaterializer = options.contextPackMaterializer ?? createContextPackMaterializer()
  const contextPackExporter = options.contextPackExporter ?? createContextPackExporter()
  const contextPackRedactor = options.contextPackRedactor ?? createSecretRedactor()
  const attestRecipientProfile = options.resolveRecipientProfile ?? ((config: ResolvedAgentConfig) =>
    resolveRecipientProfile(config, undefined, now()))
  const countContextPackPayload = options.countContextPackPayload ?? (() => null)
  const contextPackBridge = (options.createContextPackBridge ?? createRealContextPackBridge)({
    executablePath: kittenMcpExecutable.command,
    executableArgs: kittenMcpExecutable.args,
  })
  const agentRunControl: AgentRunControl = {
    start: startAgentRunBatch,
    poll: pollAgentRun,
  }
  const kittenMcpBridge = (options.createKittenMcpBridge ?? createRealKittenMcpBridge)({
    executablePath: kittenMcpExecutable.command,
    executableArgs: kittenMcpExecutable.args,
    agentRunControl,
    requestClarification(sessionId, generation, form) {
      const runtime = runtimes.get(sessionId)
      if (!runtime || runtime.generation !== generation || !acceptsRuntimeEvents(runtime)) {
        return cancelledClarificationHandle(options.newInteractionId?.() ?? crypto.randomUUID())
      }
      return enqueueClarificationHandle(runtime, form)
    },
    cancelClarifications(sessionId, generation, reason) {
      interactionCoordinator.cancelSession(sessionId, generation, reason)
    },
    onFailure(reason) {
      options.recorder?.mcpBridgeFailure?.(mcpBridgeFailureCategory(reason))
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

  function isCurrentGeneration(runtime: AgentRuntime, generation: number): boolean {
    return !disposed && runtimes.get(runtime.seed.id) === runtime && runtime.generation === generation
  }

  function publishHarnessDelivery(runtime: AgentRuntime, delivery: HarnessDelivery): void {
    runtime.harnessDelivery = delivery
    if (isCurrentGeneration(runtime, delivery.generation)) {
      store.setHarnessDelivery(runtime.seed.id, delivery)
    }
  }

  function beginFreshHarnessDelivery(runtime: AgentRuntime, generation: number): void {
    if (!isCurrentGeneration(runtime, generation)) return
    publishHarnessDelivery(runtime, beginFresh("v1", generation))
  }

  function restorePersistedHarnessDelivery(
    runtime: AgentRuntime,
    generation: number,
    checkpoint: HarnessDeliveryCheckpoint | undefined,
    lifecycle: "fresh" | "loaded",
  ): void {
    if (!isCurrentGeneration(runtime, generation)) return
    publishHarnessDelivery(runtime, restoreHarnessDelivery(checkpoint, "v1", generation, lifecycle))
  }

  function terminalizeHarnessDelivery(runtime: AgentRuntime, generation = runtime.generation): void {
    if (!isCurrentGeneration(runtime, generation)) return
    const delivery = runtime.harnessDelivery
    if (!delivery) return
    publishHarnessDelivery(runtime, failIndeterminate(delivery, generation))
  }

  function applyRuntimeEvent(runtime: AgentRuntime, event: DomainSessionEvent): void {
    if (!acceptsRuntimeEvents(runtime)) return
    if (event.kind === "status" && event.status === "error") {
      terminalizeSteering(runtime.seed.id)
      abandonPromptLifecycle(runtime.seed.id)
      terminalizeHarnessDelivery(runtime)
      invalidateBridge(runtime, runtime.generation, "connection_error")
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
    if (event.kind === "status") publishDelegatedRuntimeStatus(runtime, event.status)
  }

  function delegatedIdentity(childId: SessionId): DelegatedChildIdentity | null {
    const child = store.getState().delegation.children[childId]
    if (!child) return null
    return {
      parentId: child.parentId,
      childId: child.childId,
      parentGeneration: child.parentGeneration,
      childGeneration: child.childGeneration,
    }
  }

  function ownsDelegatedIdentity(identity: DelegatedChildIdentity): boolean {
    const parent = runtimes.get(identity.parentId)
    const child = runtimes.get(identity.childId)
    return !disposed &&
      parent?.generation === identity.parentGeneration &&
      child?.generation === identity.childGeneration
  }

  function delegatedTelemetryKey(identity: DelegatedChildIdentity): string {
    return `${identity.parentId}:${identity.parentGeneration}:${identity.childId}:${identity.childGeneration}`
  }

  function delegatedCascadeTelemetryKey(parentId: SessionId, parentGeneration: number): string {
    return `${parentId}:${parentGeneration}`
  }

  function publishDelegatedState(publication: DelegatedChildStatePublication): boolean {
    if (!ownsDelegatedIdentity(publication)) return false
    const before = store.getState().delegation.children[publication.childId]
    store.publishDelegatedChildState(publication)
    const after = store.getState().delegation.children[publication.childId]
    if (!before || !after || after === before) return false

    const lifecycleKey = delegatedTelemetryKey(publication)
    if (before.status === "starting" && after.status === "running") {
      options.recorder?.delegatedLaunchSucceeded?.(lifecycleKey)
    }
    if (after.terminal) {
      if (before.status === "starting" && after.terminal.status === "failed") {
        options.recorder?.delegatedLaunchFailed?.(lifecycleKey)
        if (before.policy) {
          options.recorder?.exploreStartFailed?.(lifecycleKey, {
            failureCategory: "session-start-failed",
            count: 1,
          })
        }
      } else if (before.policy) {
        options.recorder?.exploreTerminal?.(lifecycleKey, {
          terminalStatus: after.terminal.status,
          count: 1,
        })
      }
      options.recorder?.delegatedChildTerminal?.(lifecycleKey, after.terminal.status)
    }
    return true
  }

  /**
   * A delegated child has one bounded task, unlike an ordinary conversation that
   * may accept another prompt after a turn finishes. Keep its terminal snapshot
   * registered for polling and review, but release the completed ACP transport so
   * its managed worktree is no longer considered live-owned.
   */
  function releaseCompletedDelegatedRuntime(runtime: AgentRuntime): void {
    const connection = runtime.connection
    terminalizeSteering(runtime.seed.id)
    abandonPromptLifecycle(runtime.seed.id)
    terminalizeHarnessDelivery(runtime)
    invalidateBridge(runtime, runtime.generation, "conversation_closed")
    interactionCoordinator.cancelSession(
      runtime.seed.id,
      runtime.generation,
      "conversation_closed",
    )
    runtime.acceptEvents = false
    runtime.unsubscribe?.()
    runtime.unsubscribe = null
    runtime.connection = null
    runtime.acpSessionId = null
    runtime.state = {
      sessionId: runtime.seed.id,
      providerKind: runtime.seed.providerKind,
      displayName: runtime.config?.displayName ?? runtime.seed.title,
      title: runtime.seed.title,
      cwd: runtime.seed.cwd,
      ready: false,
      error: "Completed",
      mcp: runtimeMcpReadout(runtime, "unavailable"),
    }
    void disposeQuietly(connection ?? undefined)
  }

  function publishDelegatedRuntimeStatus(runtime: AgentRuntime, status: SessionStatus): void {
    const identity = delegatedIdentity(runtime.seed.id)
    if (!identity || runtimes.get(runtime.seed.id) !== runtime) return
    if (status === "working") {
      publishDelegatedState({ ...identity, status: "running", sessionStatus: "working" })
    } else if (status === "awaiting_approval" || status === "awaiting_clarification") {
      publishDelegatedState({ ...identity, status: "needs_input", sessionStatus: status })
    } else if (status === "finished") {
      publishDelegatedState({ ...identity, status: "finished", sessionStatus: "finished", at: now() })
      releaseCompletedDelegatedRuntime(runtime)
    } else if (status === "error") {
      publishDelegatedState({ ...identity, status: "failed", sessionStatus: "error", at: now() })
    }
  }

  function enqueuePermission(runtime: AgentRuntime, request: PermissionRequest): Promise<PermissionOutcome> {
    if (!acceptsRuntimeEvents(runtime)) return Promise.resolve({ outcome: "cancelled" })
    publishDelegatedRuntimeStatus(runtime, "awaiting_approval")
    return interactionCoordinator.enqueuePermission(runtime.seed.id, runtime.generation, request)
  }

  function enqueueClarificationHandle(
    runtime: AgentRuntime,
    payload: ClarificationPayload,
  ): ClarificationRequestHandle {
    if (!acceptsRuntimeEvents(runtime)) {
      return cancelledClarificationHandle(options.newInteractionId?.() ?? crypto.randomUUID())
    }
    const generation = runtime.generation
    const key = clarificationCountKey(runtime.seed.id, generation)
    pendingClarificationCounts.set(key, (pendingClarificationCounts.get(key) ?? 0) + 1)
    store.applyEvent(runtime.seed.id, { kind: "status", status: "awaiting_clarification" })
    publishDelegatedRuntimeStatus(runtime, "awaiting_clarification")
    const handle = interactionCoordinator.enqueueClarification(
      runtime.seed.id,
      generation,
      payload,
    )
    const cancelTimeout = scheduleClarificationTimeout(
      () => handle.timeout(),
      options.config.clarificationTimeoutSeconds * 1_000,
    )
    const outcome = handle.outcome.finally(() => {
      cancelTimeout()
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
        publishDelegatedRuntimeStatus(runtime, "working")
      }
    })
    return {
      requestId: handle.requestId,
      outcome,
      cancel: handle.cancel,
      timeout: handle.timeout,
    }
  }

  async function enqueueClarification(
    runtime: AgentRuntime,
    payload: ClarificationPayload,
  ): Promise<ClarificationOutcome> {
    return enqueueClarificationHandle(runtime, payload).outcome
  }

  function mcpServersFor(runtime: AgentRuntime, generation: number) {
    if (runtime.bridgeGeneration === generation && runtime.bridgeMcpServer) {
      return runtime.mcpScope === "explore"
        ? [runtime.bridgeMcpServer]
        : [...mcpServers, runtime.bridgeMcpServer]
    }
    const generated = kittenMcpBridge.register({ sessionId: runtime.seed.id, generation })
    runtime.bridgeGeneration = generation
    runtime.bridgeMcpServer = generated
    return runtime.mcpScope === "explore" ? [generated] : [...mcpServers, generated]
  }

  function invalidateBridge(
    runtime: AgentRuntime,
    generation: number,
    reason: ClarificationSessionLossReason,
  ): void {
    terminateContextBuildForParent(runtime.seed.id, generation)
    try {
      kittenMcpBridge.cancelSession(runtime.seed.id, generation, reason)
    } catch (error) {
      onError(runtime.seed.id, error)
    } finally {
      if (runtime.bridgeGeneration === generation) {
        runtime.bridgeGeneration = null
        runtime.bridgeMcpServer = null
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

  function registerRuntime(
    seed: SessionSeed,
    config: ResolvedAgentConfig | null,
    mcpScope: "ordinary" | "explore" = "ordinary",
  ): AgentRuntime {
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
        mcp: mcpReadout("loading"),
      },
      connection: null,
      acpSessionId: null,
      unsubscribe: null,
      closing: false,
      acceptEvents: true,
      cancelCompleted: false,
      generation: 0,
      harnessDelivery: null,
      bridgeMcpServer: null,
      bridgeGeneration: null,
      mcpScope,
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
  async function startSession(
    seed: SessionSeed,
    config: ResolvedAgentConfig,
    registeredGeneration?: number,
  ): Promise<void> {
    let connection: AgentConnection | undefined
    let readinessRecorded = false
    const runtime = runtimes.get(seed.id) ?? registerRuntime(seed, config)
    runtime.generation = registeredGeneration ?? nextConnectionGeneration(seed.id, connectionGenerations)
    const generation = runtime.generation
    runtime.config = config
    store.setConversationAvailability(seed.id, { kind: "starting" })
    try {
      const preflightResult = await preflightCursor(config, preflight)
      if (!isCurrentGeneration(runtime, generation)) return
      if (!preflightResult.ready) {
        options.recorder?.providerReadiness?.(config.id, preflightOutcome(preflightResult.reason))
        readinessRecorded = true
        await failSession(runtime, undefined, preflightResult.message, "connection-failed")
        return
      }
      connection = create(config)
      runtime.connection = connection
      const ready = await connection.connect()
      if (!isCurrentGeneration(runtime, generation)) {
        if (runtime.connection === connection) await disposeQuietly(connection)
        return
      }
      if (!ready.ready) {
        const failure = longLivedReadinessFailure(config, ready)
        options.recorder?.providerReadiness?.(config.id, failure.reason)
        readinessRecorded = true
        await failSession(runtime, connection, failure.message, "connection-failed")
        return
      }
      if (config.id !== "cursor") {
        options.recorder?.providerReadiness?.(config.id, "ready")
        readinessRecorded = true
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
      let acpSessionId: string
      try {
        acpSessionId = await connection.newSession(seed.cwd, mcpServersFor(runtime, generation))
      } finally {
        captureSeed()
      }
      if (!isCurrentGeneration(runtime, generation)) {
        if (runtime.connection === connection) await disposeQuietly(connection)
        return
      }
      beginFreshHarnessDelivery(runtime, generation)
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
        mcp: runtimeMcpReadout(runtime, "attached"),
      }
      runtime.connection = connection
      runtime.acpSessionId = acpSessionId
      runtime.unsubscribe = unsubscribe
      store.setConversationAvailability(seed.id, { kind: "ready" })
      if (config.id === "cursor") {
        options.recorder?.providerReadiness?.(config.id, "ready")
        readinessRecorded = true
      }
    } catch (error) {
      if (!isCurrentGeneration(runtime, generation)) {
        if (runtime.connection === connection) await disposeQuietly(connection)
        return
      }
      if (!readinessRecorded) options.recorder?.providerReadiness?.(config.id, "handshake_failed")
      onError(seed.id, error)
      const message = config.id === "cursor"
        ? handshakeReadinessFailure(config).message
        : errorMessage(error)
      await failSession(runtime, connection, message, "connection-failed")
    }
  }

  /** Record a session as not-ready and release the connection it never got to use. */
  async function failSession(
    runtime: AgentRuntime,
    connection: AgentConnection | undefined,
    error: string,
    reasonCode: "connection-failed" | "restore-unavailable" | "provider-unavailable",
  ): Promise<void> {
    terminalizeSteering(runtime.seed.id)
    abandonPromptLifecycle(runtime.seed.id)
    terminalizeHarnessDelivery(runtime)
    invalidateBridge(runtime, runtime.generation, "connection_error")
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
      mcp: runtimeMcpReadout(runtime, "unavailable"),
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
    const generation = runtime.generation
    let seededConfig: DomainSessionEvent | null = null
    const captureSeed = connection.onUpdate((event) => {
      if (event.kind === "config_options") seededConfig = event
    })
    let acpSessionId: string
    try {
      acpSessionId = await connection.newSession(seed.cwd, mcpServersFor(runtime, generation))
    } finally {
      captureSeed()
    }
    if (!isCurrentGeneration(runtime, generation)) {
      throw new Error("Stale session generation")
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
  async function restoreSession(
    seed: SessionSeed,
    config: ResolvedAgentConfig,
    stored: PersistedAgent | undefined,
    checkpoint: HarnessDeliveryCheckpoint | undefined,
  ): Promise<boolean> {
    const previous = runtimes.get(seed.id) ?? registerRuntime(seed, config)
    if (store.getState().delegation.parents[seed.id]) {
      const cascade = await teardownDelegatedChildren(previous)
      if (cascade.outcome !== "closed") return false
    }
    const replacedGeneration = previous.generation
    terminalizeSteering(seed.id)
    const steeringRecovery = captureSteeringRecovery(seed.id)
    abandonPromptLifecycle(seed.id)
    terminalizeHarnessDelivery(previous, replacedGeneration)
    invalidateBridge(previous, replacedGeneration, "session_replaced")
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
    if (disposed || runtimes.get(seed.id) !== previous || previous.generation !== replacedGeneration) return false
    previous.config = config
    previous.generation = nextConnectionGeneration(seed.id, connectionGenerations)
    const generation = previous.generation
    previous.harnessDelivery = null
    previous.bridgeMcpServer = null
    previous.bridgeGeneration = null
    previous.closing = false
    previous.acceptEvents = true
    previous.cancelCompleted = false
    store.setConversationAvailability(seed.id, { kind: "starting" })

    let connection: AgentConnection | undefined
    let unsubscribe: Unsubscribe | undefined
    let readinessRecorded = false
    try {
      const preflightResult = await preflightCursor(config, preflight)
      if (!isCurrentGeneration(previous, generation)) return false
      if (!preflightResult.ready) {
        options.recorder?.providerReadiness?.(config.id, preflightOutcome(preflightResult.reason))
        readinessRecorded = true
        store.setRestoration(seed.id, "unavailable")
        await failSession(previous, undefined, preflightResult.message, "restore-unavailable")
        return false
      }
      connection = create(config)
      previous.connection = connection
      const ready = await connection.connect()
      if (!isCurrentGeneration(previous, generation)) {
        await disposeQuietly(connection)
        return false
      }
      if (!ready.ready) {
        const failure = longLivedReadinessFailure(config, ready)
        options.recorder?.providerReadiness?.(config.id, failure.reason)
        readinessRecorded = true
        store.setRestoration(seed.id, "unavailable")
        await failSession(previous, connection, failure.message, "restore-unavailable")
        return false
      }
      if (config.id !== "cursor") {
        options.recorder?.providerReadiness?.(config.id, "ready")
        readinessRecorded = true
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
          await connection.loadSession(acpSessionId, seed.cwd, mcpServersFor(previous, generation))
          if (!isCurrentGeneration(previous, generation)) {
            unsubscribe()
            await disposeQuietly(connection)
            return false
          }
          restorePersistedHarnessDelivery(previous, generation, checkpoint, "loaded")
          store.setRestoration(seed.id, "live")
        } catch (error) {
          unsubscribe()
          unsubscribe = undefined
          if (!isMissingCodexRollout(seed.providerKind, error)) throw error

          // Codex reports stale local threads as a generic internal error with a
          // nested "no rollout found" detail. The agent remains healthy, so recover
          // into a fresh live session rather than turning the whole pane into error.
          const fresh = await startFreshRestoredSession(connection, seed, previous)
          if (!isCurrentGeneration(previous, generation)) {
            fresh.unsubscribe()
            await disposeQuietly(connection)
            return false
          }
          acpSessionId = fresh.acpSessionId
          unsubscribe = fresh.unsubscribe
          restorePersistedHarnessDelivery(previous, generation, checkpoint, "fresh")
          store.setRestoration(seed.id, "unavailable")
        }
      } else {
        const fresh = await startFreshRestoredSession(connection, seed, previous)
        if (!isCurrentGeneration(previous, generation)) {
          fresh.unsubscribe()
          await disposeQuietly(connection)
          return false
        }
        acpSessionId = fresh.acpSessionId
        unsubscribe = fresh.unsubscribe
        restorePersistedHarnessDelivery(previous, generation, checkpoint, "fresh")
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
        mcp: mcpReadout("attached"),
      }
      previous.connection = connection
      previous.acpSessionId = acpSessionId
      previous.unsubscribe = unsubscribe
      store.setConversationAvailability(seed.id, { kind: "ready" })
      restoreSteeringRecovery(seed.id, generation, steeringRecovery)
      if (config.id === "cursor") {
        options.recorder?.providerReadiness?.(config.id, "ready")
        readinessRecorded = true
      }
      return true
    } catch (error) {
      if (!isCurrentGeneration(previous, generation)) {
        unsubscribe?.()
        await disposeQuietly(connection)
        return false
      }
      if (!readinessRecorded) options.recorder?.providerReadiness?.(config.id, "handshake_failed")
      unsubscribe?.()
      store.setRestoration(seed.id, "unavailable")
      onError(seed.id, error)
      const message = config.id === "cursor"
        ? handshakeReadinessFailure(config).message
        : errorMessage(error)
      await failSession(previous, connection, message, "restore-unavailable")
      return false
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

    const delegatedChild = delegatedIdentity(sessionId)
    if (delegatedChild) {
      if (choice === "keep-open") return Promise.resolve({ outcome: "kept-open" })
      if (choice === "background") {
        store.backgroundConversation(sessionId)
        return Promise.resolve({ outcome: "backgrounded" })
      }
      if ((choice === "close") !== (session.status === "idle")) {
        return Promise.resolve({ outcome: "ignored" })
      }

      const promise = teardownConversation(runtime, session.status, delegatedChild)
      closePromises.set(sessionId, promise)
      void promise.finally(() => {
        if (closePromises.get(sessionId) === promise) closePromises.delete(sessionId)
      })
      return promise
    }

    const delegatedParent = state.delegation.parents[sessionId]
    if (delegatedParent) {
      if (choice === "keep-open") return Promise.resolve({ outcome: "kept-open" })
      if (choice === "background") {
        store.backgroundConversation(sessionId)
        return Promise.resolve({ outcome: "backgrounded" })
      }
      const settledIdleParent = choice === "close" &&
        session.status === "idle" &&
        isDelegationSettled(state.delegation, sessionId)
      if (choice !== "cancel" && !settledIdleParent) return Promise.resolve({ outcome: "ignored" })

      const promise = teardownDelegatedParent(runtime, session.status)
      closePromises.set(sessionId, promise)
      void promise.finally(() => {
        if (closePromises.get(sessionId) === promise) closePromises.delete(sessionId)
      })
      return promise
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
    delegatedIdentity?: DelegatedChildIdentity,
  ): Promise<CloseConversationResult> {
    const sessionId = runtime.seed.id
    const generation = runtime.generation
    terminalizeSteering(sessionId)
    abandonPromptLifecycle(sessionId)
    terminalizeHarnessDelivery(runtime, generation)
    invalidateBridge(runtime, generation, "conversation_closed")
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
        if (!isCurrentGeneration(runtime, generation)) return { outcome: "ignored" }
        runtime.cancelCompleted = true
      }

      runtime.unsubscribe?.()
      runtime.unsubscribe = null
      if (runtime.connection) await runtime.connection.dispose()
      if (!isCurrentGeneration(runtime, generation)) return { outcome: "ignored" }
      runtime.connection = null
      runtime.acpSessionId = null
      if (delegatedIdentity) {
        publishDelegatedState({
          ...delegatedIdentity,
          status: "cancelled",
          sessionStatus: "idle",
          at: now(),
        })
      }
      runtimes.delete(sessionId)
      branchReadGenerations.delete(sessionId)
      if (delegatedIdentity) store.removeDelegationChild(delegatedIdentity)
      else store.removeSession(sessionId)
      return { outcome: "closed" }
    } catch (error) {
      onError(sessionId, error)
      if (delegatedIdentity) {
        const accepted = publishDelegatedState({
          ...delegatedIdentity,
          status: "failed",
          sessionStatus: "error",
          at: now(),
        })
        if (accepted) {
          options.recorder?.delegatedTeardownFailed?.(delegatedTelemetryKey(delegatedIdentity))
        }
      }
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
        mcp: mcpReadout("unavailable"),
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

  async function teardownDelegatedChildren(
    parentRuntime: AgentRuntime,
  ): Promise<CloseConversationResult> {
    const parent = store.getState().delegation.parents[parentRuntime.seed.id]
    if (!parent || parent.parentGeneration !== parentRuntime.generation) {
      return { outcome: "closed" }
    }

    const cascadeKey = delegatedCascadeTelemetryKey(parent.parentId, parent.parentGeneration)
    const beforeClose = parent
    store.markDelegationParentClosing(parent.parentId, parent.parentGeneration)
    const afterClose = store.getState().delegation.parents[parent.parentId]
    if (afterClose !== beforeClose && afterClose?.closeState === "closing") {
      options.recorder?.delegatedCascadeRequested?.(cascadeKey)
    }
    const results = await Promise.all(parent.childIds.map(async (childId) => {
      const identity = delegatedIdentity(childId)
      const childRuntime = runtimes.get(childId)
      const status = store.getState().sessions[childId]?.status
      if (!identity || !childRuntime || status === undefined || !ownsDelegatedIdentity(identity)) {
        onError(childId, new Error("Delegated child teardown ownership is unavailable"))
        options.recorder?.delegatedTeardownFailed?.(`${cascadeKey}:${childId}`)
        return { outcome: "teardown-failed" } as const
      }
      return teardownConversation(childRuntime, status, identity)
    }))
    if (results.every((result) => result.outcome === "closed")) {
      options.recorder?.delegatedCascadeCompleted?.(cascadeKey)
      return { outcome: "closed" }
    }
    return { outcome: "teardown-failed" }
  }

  async function teardownDelegatedParent(
    runtime: AgentRuntime,
    status: SessionStatus,
  ): Promise<CloseConversationResult> {
    const generation = runtime.generation
    const cascade = await teardownDelegatedChildren(runtime)
    if (cascade.outcome !== "closed") return cascade
    if (!isCurrentGeneration(runtime, generation)) return { outcome: "ignored" }
    return teardownConversation(runtime, status)
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
    await applyProviderDefaultsToFreshSession(sessionId)
    refreshBranch(sessionId)
    return sessionId
  }

  type SupportedExploreCapability = Extract<ExploreCapability, { status: "supported" }>
  type DelegatedBatchDenial = Extract<ExploreLaunchResult, { kind: "denied" }>
  interface DelegatedBatchContext {
    readonly route: AgentRunRoute
    readonly tasks: readonly AgentRunTask[]
    readonly parentSession: SessionState
    readonly parentRuntime: AgentRuntime
    readonly capability: SupportedExploreCapability
    readonly requireSelectedParent: boolean
  }
  interface ProvisionedDelegatedChild {
    readonly task: AgentRunTask
    readonly seed: SessionSeed
    readonly binding: ManagedWorktreeBinding
  }
  interface PreparedDelegatedChild extends ProvisionedDelegatedChild {
    readonly identity: DelegatedChildIdentity
    runtime?: AgentRuntime
  }
  interface StartedDelegatedChild {
    readonly snapshot?: AgentRunSnapshot
    readonly failure?: "bridge-unavailable" | "startup-failed" | "parent-closing"
  }

  function denyDelegatedBatch(
    reason: ExploreDenialReason,
    scope?: "per-parent" | "global",
  ): DelegatedBatchDenial {
    return scope ? { kind: "denied", reason, scope } : { kind: "denied", reason }
  }

  function isDelegatedBatchDenial(value: unknown): value is DelegatedBatchDenial {
    return typeof value === "object" && value !== null && "kind" in value
  }

  function preflightDelegatedBatch(
    route: AgentRunRoute,
    rawTasks: readonly AgentRunTask[],
    requireSelectedParent: boolean,
  ): DelegatedBatchContext | DelegatedBatchDenial {
    if (disposed || rawTasks.length === 0) return denyDelegatedBatch("parent-ineligible")
    const tasks = rawTasks.map((entry) => ({
      task: entry.task.trim(),
      desiredOutcome: entry.desiredOutcome.trim(),
    }))
    const taskKeys = new Set<string>()
    for (const task of tasks) {
      if (!task.task || !task.desiredOutcome) return denyDelegatedBatch("parent-ineligible")
      const key = `${task.task}\u0000${task.desiredOutcome}`
      if (taskKeys.has(key)) return denyDelegatedBatch("parent-ineligible")
      taskKeys.add(key)
    }

    const state = store.getState()
    const parentSession = state.sessions[route.parentId]
    const parentRuntime = runtimes.get(route.parentId)
    const parentDelegation = state.delegation.parents[route.parentId]
    if (
      (requireSelectedParent && state.workspace.selectedVisibleId !== route.parentId) ||
      !parentSession ||
      state.delegation.children[route.parentId] ||
      parentDelegation?.closeState === "closing" ||
      (parentDelegation !== undefined && parentDelegation.parentGeneration !== route.parentGeneration) ||
      !parentRuntime?.config ||
      parentRuntime.generation !== route.parentGeneration ||
      !parentRuntime.state.ready ||
      !acceptsRuntimeEvents(parentRuntime)
    ) {
      return denyDelegatedBatch(
        parentDelegation?.closeState === "closing" ? "parent-closing" : "parent-ineligible",
      )
    }

    const capability = attestExplore(parentRuntime.config)
    if (capability.status === "unsupported") return denyDelegatedBatch(capability.reason)
    const parentOccupied = countOccupiedDelegatedChildren(state.delegation, route.parentId)
    if (parentOccupied + tasks.length > capability.policy.limits.perParent) {
      return denyDelegatedBatch("capacity-exhausted", "per-parent")
    }
    const globallyOccupied = countOccupiedDelegatedChildren(state.delegation)
    if (globallyOccupied + tasks.length > capability.policy.limits.global) {
      return denyDelegatedBatch("capacity-exhausted", "global")
    }
    return {
      route,
      tasks,
      parentSession,
      parentRuntime,
      capability,
      requireSelectedParent,
    }
  }

  function contextStillOwnsLaunch(context: DelegatedBatchContext, childIds: readonly SessionId[]): boolean {
    const state = store.getState()
    const parent = state.delegation.parents[context.route.parentId]
    return !disposed &&
      (!context.requireSelectedParent || state.workspace.selectedVisibleId === context.route.parentId) &&
      state.sessions[context.route.parentId] === context.parentSession &&
      !state.delegation.children[context.route.parentId] &&
      parent?.closeState !== "closing" &&
      (parent === undefined || parent.parentGeneration === context.route.parentGeneration) &&
      runtimes.get(context.route.parentId) === context.parentRuntime &&
      context.parentRuntime.generation === context.route.parentGeneration &&
      context.parentRuntime.state.ready &&
      acceptsRuntimeEvents(context.parentRuntime) &&
      countOccupiedDelegatedChildren(state.delegation, context.route.parentId) + childIds.length <=
        context.capability.policy.limits.perParent &&
      countOccupiedDelegatedChildren(state.delegation) + childIds.length <=
        context.capability.policy.limits.global &&
      childIds.every((childId) => !state.workspace.conversations[childId] && !runtimes.has(childId))
  }

  async function rollbackBindings(children: readonly ProvisionedDelegatedChild[]): Promise<void> {
    await Promise.all(children.map(async (child) => {
      try {
        const result = await managedWorktrees.cleanup({
          binding: child.binding,
          ownerTerminal: true,
          ownerLive: false,
        })
        if (result.kind !== "removed") {
          onError(child.seed.id, new Error(`Managed worktree rollback ${result.kind}`))
        }
      } catch (error) {
        onError(child.seed.id, error)
      }
    }))
  }

  async function prepareDelegatedBatch(
    context: DelegatedBatchContext,
  ): Promise<readonly PreparedDelegatedChild[] | DelegatedBatchDenial> {
    const childIds = context.tasks.map(() => newSessionId())
    const childIdSet = new Set(childIds)
    const initialState = store.getState()
    if (
      childIdSet.size !== childIds.length ||
      childIds.some((childId) =>
        childId === context.route.parentId ||
        initialState.workspace.conversations[childId] !== undefined ||
        runtimes.has(childId)
      )
    ) {
      for (const childId of childIds) {
        onError(childId, new Error(`Conversation id already exists: ${childId}`))
      }
      return denyDelegatedBatch("startup-failed")
    }

    const provisioned: ProvisionedDelegatedChild[] = []
    const provisioning = await Promise.all(childIds.map(async (childId, index) => {
      options.recorder?.managedWorktreeRequested?.(childId)
      try {
        const result = await managedWorktrees.provision({
          parentCwd: context.parentSession.cwd,
          ownerSessionId: childId,
        })
        if (result.kind === "failed") {
          options.recorder?.managedWorktreeProvisionFailed?.(childId, result.reason)
          return null
        }
        const binding = result.binding
        if (
          binding.kind !== "managed" ||
          binding.ownerSessionId !== childId ||
          binding.worktreePath === context.parentSession.cwd
        ) {
          onError(childId, new Error("Managed worktree provisioner returned an invalid binding"))
          options.recorder?.managedWorktreeProvisionFailed?.(childId, "verification_failed")
          return null
        }
        options.recorder?.managedWorktreeProvisioned?.(childId)
        const seed: SessionSeed = {
          id: childId,
          providerKind: context.parentSession.providerKind,
          title: `${context.capability.recipe.displayName} child`,
          cwd: binding.worktreePath,
          worktreeBinding: binding,
        }
        return { task: context.tasks[index]!, seed, binding }
      } catch (error) {
        onError(childId, error)
        options.recorder?.managedWorktreeProvisionFailed?.(childId, "git_failed")
        return null
      }
    }))
    for (const child of provisioning) {
      if (child) provisioned.push(child)
    }
    if (provisioned.length !== context.tasks.length) {
      await rollbackBindings(provisioned)
      return denyDelegatedBatch("startup-failed")
    }
    if (!contextStillOwnsLaunch(context, childIds)) {
      await rollbackBindings(provisioned)
      const closing = store.getState().delegation.parents[context.route.parentId]?.closeState === "closing"
      return denyDelegatedBatch(closing ? "parent-closing" : "parent-ineligible")
    }

    const prepared: PreparedDelegatedChild[] = provisioned.map((child) => ({
      ...child,
      identity: {
        parentId: context.route.parentId,
        childId: child.seed.id,
        parentGeneration: context.route.parentGeneration,
        childGeneration: nextConnectionGeneration(child.seed.id, connectionGenerations),
      },
    }))

    const registered: PreparedDelegatedChild[] = []
    for (const child of prepared) {
      const admission = store.addDelegatedSession({
        seed: child.seed,
        parentId: child.identity.parentId,
        parentGeneration: child.identity.parentGeneration,
        childGeneration: child.identity.childGeneration,
        task: child.task.task,
        desiredOutcome: child.task.desiredOutcome,
        policy: context.capability.policy,
        displayName: child.seed.title,
      })
      if (admission.kind !== "accepted") {
        for (const accepted of registered) store.removeDelegationChild(accepted.identity)
        await rollbackBindings(provisioned)
        return admission.kind === "denied"
          ? denyDelegatedBatch(admission.reason, admission.scope)
          : denyDelegatedBatch("parent-ineligible")
      }
      registered.push(child)
    }

    for (const child of prepared) {
      const lifecycleKey = delegatedTelemetryKey(child.identity)
      options.recorder?.exploreLaunchEligible?.(lifecycleKey, {
        policyVersion: EXPLORE_ATTESTATION_VERSION,
        provider: context.capability.policy.confirmed.provider,
        count: 1,
      })
      options.recorder?.delegatedLaunchRequested?.(lifecycleKey)
      child.runtime = registerRuntime(child.seed, context.capability.recipe, "explore")
      child.runtime.generation = child.identity.childGeneration
    }
    return prepared
  }

  function agentRunSnapshot(identity: DelegatedChildIdentity): AgentRunSnapshot {
    const child = store.getState().delegation.children[identity.childId]
    const runtime = runtimes.get(identity.childId)
    if (
      !child ||
      child.parentId !== identity.parentId ||
      child.parentGeneration !== identity.parentGeneration ||
      child.childGeneration !== identity.childGeneration ||
      runtime?.generation !== identity.childGeneration
    ) {
      throw new Error("Delegated child ownership is unavailable")
    }
    return {
      childId: child.childId,
      status: child.status,
      ...(child.terminal ? { terminalAt: child.terminal.at } : {}),
    }
  }

  async function startPreparedDelegatedChild(
    context: DelegatedBatchContext,
    child: PreparedDelegatedChild,
  ): Promise<StartedDelegatedChild> {
    const childRuntime = child.runtime!
    const lifecycleKey = delegatedTelemetryKey(child.identity)
    let bridgeServer: import("../core/types.ts").McpServerConfig
    try {
      bridgeServer = kittenMcpBridge.register({
        sessionId: child.seed.id,
        generation: child.identity.childGeneration,
      })
    } catch (error) {
      onError(child.seed.id, error)
      try {
        kittenMcpBridge.cancelSession(child.seed.id, child.identity.childGeneration, "connection_error")
      } catch (cleanupError) {
        onError(child.seed.id, cleanupError)
      }
      store.publishDelegatedChildState({
        ...child.identity,
        status: "failed",
        sessionStatus: "error",
        at: now(),
      })
      options.recorder?.exploreStartFailed?.(lifecycleKey, {
        failureCategory: "bridge-unavailable",
        count: 1,
      })
      return { snapshot: agentRunSnapshot(child.identity), failure: "bridge-unavailable" }
    }

    childRuntime.bridgeGeneration = child.identity.childGeneration
    childRuntime.bridgeMcpServer = bridgeServer
    await startSession(child.seed, context.capability.recipe, child.identity.childGeneration)
    refreshBranch(child.seed.id)
    if (!ownsDelegatedIdentity(child.identity)) {
      return { failure: "parent-closing" }
    }
    if (!childRuntime.state.ready) {
      publishDelegatedState({
        ...child.identity,
        status: "failed",
        sessionStatus: "error",
        at: now(),
      })
      return ownsDelegatedIdentity(child.identity)
        ? { snapshot: agentRunSnapshot(child.identity), failure: "startup-failed" }
        : { failure: "parent-closing" }
    }

    const prompt = `Task:\n${child.task.task}\n\nDesired outcome:\n${child.task.desiredOutcome}`
    let dispatched = false
    const result = actions.sendPrompt(prompt, child.seed.id, {
      // The prompt action verifies that this idle child can dispatch before it
      // invokes us. Publishing `working` earlier would make that same action
      // reject the child as an already-active session.
      onDispatched: () => {
        if (!ownsDelegatedIdentity(child.identity)) return
        publishDelegatedState({
          ...child.identity,
          status: "running",
          sessionStatus: "working",
        })
        // Some adapters synchronously publish their own `working` update from
        // inside `connection.prompt`. That has already transitioned this child,
        // but the dispatch itself was still accepted.
        dispatched = true
      },
    })

    // `sendPrompt` normally invokes the callback inline, but this launch path is
    // deliberately detached from the child turn rather than from dispatch
    // acknowledgement. Yield exactly one microtask before classifying a missing
    // acknowledgement as a rejected start. That keeps an async action wrapper
    // from turning an accepted child prompt into a spurious startup failure,
    // while still never waiting for the provider's turn to settle.
    await Promise.resolve()

    const terminalizePromptFailure = (): void => {
      // `failSession` synchronously fences late runtime events before it awaits
      // disposal. Publish the terminal child state at that boundary: a detached
      // start/poll caller must not wait on an adapter's potentially slow teardown
      // before observing a rejected initial dispatch.
      void failSession(
        childRuntime,
        childRuntime.connection ?? undefined,
        "Initial child prompt failed",
        "connection-failed",
      ).catch((error) => onError(child.seed.id, error))
      if (!ownsDelegatedIdentity(child.identity)) return
      publishDelegatedState({
        ...child.identity,
        status: "failed",
        sessionStatus: "error",
        at: now(),
      })
      options.recorder?.exploreStartFailed?.(lifecycleKey, {
        failureCategory: "prompt-dispatch-failed",
        count: 1,
      })
    }

    if (!dispatched) {
      // Rejection before the transport starts is still an immediate startup
      // failure. Terminalize it in the background so no launch path waits on
      // connection disposal.
      terminalizePromptFailure()
      return ownsDelegatedIdentity(child.identity)
        ? { snapshot: agentRunSnapshot(child.identity), failure: "startup-failed" }
        : { failure: "parent-closing" }
    }

    // Agent-run start is detached: return the registered, running snapshot now.
    // A connection that rejects later is terminalized independently and is then
    // observable through the normal poll route.
    void result.then((outcome) => {
      if (outcome === null && ownsDelegatedIdentity(child.identity)) terminalizePromptFailure()
    })
    return { snapshot: agentRunSnapshot(child.identity) }
  }

  async function launchDelegatedBatch(
    context: DelegatedBatchContext,
  ): Promise<readonly StartedDelegatedChild[] | DelegatedBatchDenial> {
    const prepared = await prepareDelegatedBatch(context)
    if (isDelegatedBatchDenial(prepared)) return prepared
    return await Promise.all(prepared.map((child) => startPreparedDelegatedChild(context, child)))
  }

  function exploreAvailability(parentId: SessionId): ExploreAvailabilityResult {
    const runtime = runtimes.get(parentId)
    const route = { parentId, parentGeneration: runtime?.generation ?? -1 }
    const result = preflightDelegatedBatch(
      route,
      [{ task: "availability", desiredOutcome: "availability" }],
      true,
    )
    return "kind" in result ? result : { kind: "available" }
  }

  async function startExploreChild(input: StartDelegatedChildInput): Promise<ExploreLaunchResult> {
    const runtime = runtimes.get(input.parentId)
    const preflight = preflightDelegatedBatch(
      { parentId: input.parentId, parentGeneration: runtime?.generation ?? -1 },
      [{ task: input.task, desiredOutcome: input.desiredOutcome }],
      true,
    )
    if ("kind" in preflight) {
      if (preflight.scope) {
        options.recorder?.exploreCapacityDenied?.({ capacityScope: preflight.scope, count: 1 })
      } else {
        options.recorder?.exploreLaunchDenied?.({ denialReason: preflight.reason, count: 1 })
      }
      return preflight
    }
    const result = await launchDelegatedBatch(preflight)
    if (isDelegatedBatchDenial(result)) {
      if (result.scope) {
        options.recorder?.exploreCapacityDenied?.({ capacityScope: result.scope, count: 1 })
      } else {
        options.recorder?.exploreLaunchDenied?.({ denialReason: result.reason, count: 1 })
      }
      return result
    }
    const child = result[0]!
    if (child.failure) {
      const lostParent = !contextStillOwnsLaunch(preflight, []) ||
        (child.snapshot !== undefined &&
          store.getState().delegation.children[child.snapshot.childId] === undefined)
      return {
        kind: "denied",
        reason: lostParent || child.failure === "parent-closing" ? "parent-closing" :
          child.failure === "bridge-unavailable" ? "bridge-unavailable" : "startup-failed",
      }
    }
    if (!child.snapshot) return { kind: "denied", reason: "startup-failed" }
    return { kind: "started", childId: child.snapshot.childId }
  }

  function contextBuildPreflight(
    input: StartContextBuildInput,
  ): ContextBuildPreflight | Extract<ContextBuildAvailabilityResult, { readonly kind: "denied" }> {
    if (disposed) return { kind: "denied", reason: "controller_disposed" }
    const state = store.getState()
    const runtime = runtimes.get(input.parentId)
    const session = state.sessions[input.parentId]
    const conversation = state.workspace.conversations[input.parentId]
    if (!runtime || !session || !conversation) {
      return { kind: "denied", reason: "unknown_parent" }
    }
    if (
      runtime.seed.id !== input.parentId ||
      session.id !== input.parentId ||
      conversation.sessionId !== input.parentId ||
      session.providerKind !== runtime.seed.providerKind ||
      runtime.config?.id !== runtime.seed.providerKind
    ) {
      return { kind: "denied", reason: "session_mismatch" }
    }
    if (
      !runtime.config ||
      !runtime.state.ready ||
      !runtime.connection ||
      runtime.acpSessionId === null ||
      conversation.teardownState !== "open"
    ) {
      return { kind: "denied", reason: "parent_unavailable" }
    }
    if (
      runtime.generation <= 0 ||
      connectionGenerations.get(input.parentId) !== runtime.generation
    ) {
      return { kind: "denied", reason: "parent_generation_mismatch" }
    }
    if (
      !isAbsolute(session.cwd) ||
      session.cwd !== runtime.seed.cwd ||
      session.cwd.trim().length === 0
    ) {
      return { kind: "denied", reason: "workspace_mismatch" }
    }

    const pack = state.contextPacks[input.parentId]
    if (!pack) return { kind: "denied", reason: "unknown_parent" }
    if (pack.build) return { kind: "denied", reason: "build_active" }
    if (input.draft.kind === "refine") {
      if (!pack.sealed || !("manifest" in pack.sealed)) {
        return { kind: "denied", reason: "draft_unavailable" }
      }
    } else if (createDraft(input.draft.original, {
      ...(input.draft.mode === undefined ? {} : { mode: input.draft.mode }),
      ...(input.draft.discovered === undefined ? {} : { discovered: input.draft.discovered }),
      ...(input.draft.budgetLimit === undefined ? {} : { budgetLimit: input.draft.budgetLimit }),
    }).kind !== "created") {
      return { kind: "denied", reason: "invalid_draft" }
    }

    let capability: ContextBuildAvailability
    try {
      capability = attestContextBuild(runtime.config)
    } catch {
      return { kind: "denied", reason: "malformed_evidence" }
    }
    if (capability.status === "unavailable") {
      return { kind: "denied", reason: capability.reason }
    }
    if (!validContextBuildCapability(capability, runtime.config)) {
      return { kind: "denied", reason: "recipe_mismatch" }
    }
    return {
      parentRuntime: runtime as AgentRuntime & { config: ResolvedAgentConfig },
      capability,
      parentGeneration: runtime.generation,
      workspaceRoot: session.cwd,
    }
  }

  function contextBuildAvailability(input: StartContextBuildInput): ContextBuildAvailabilityResult {
    const result = contextBuildPreflight(input)
    return "kind" in result ? result : { kind: "available" }
  }

  function ownsContextBuild(child: ContextBuildChildRuntime): boolean {
    if (child.settled || contextBuildChildren.get(child.binding.childId) !== child) return false
    const current = store.getState().contextPacks[child.binding.parentId]?.build
    const parent = runtimes.get(child.binding.parentId)
    const session = store.getState().sessions[child.binding.parentId]
    return current !== null && current !== undefined &&
      sameContextBuildBinding(current, child.binding) &&
      parent?.generation === child.binding.parentGeneration &&
      parent.seed.cwd === child.route.workspaceRoot &&
      session?.cwd === child.route.workspaceRoot
  }

  function cancelContextBuildClarifications(child: ContextBuildChildRuntime): void {
    for (const handle of [...child.clarificationHandles]) {
      child.clarificationHandles.delete(handle)
      handle.cancel("connection_error")
    }
  }

  function releaseContextBuildChild(
    child: ContextBuildChildRuntime,
    options: {
      readonly bridgeReason?: "child_settled" | "parent_generation_changed" | "launch_denied"
      readonly outcome?: "ready_for_review" | "failed"
    } = {},
  ): void {
    if (child.settled) return
    child.settled = true
    if (options.bridgeReason) {
      try {
        contextPackBridge.revoke(child.route, options.bridgeReason)
      } catch (error) {
        onError(child.binding.parentId, error)
      }
    }
    cancelContextBuildClarifications(child)
    child.unsubscribe?.()
    child.unsubscribe = null
    if (contextBuildChildren.get(child.binding.childId) === child) {
      contextBuildChildren.delete(child.binding.childId)
    }
    if (options.outcome) {
      store.settleContextBuild(child.binding.parentId, child.binding, options.outcome)
    } else {
      store.releaseContextBuild(child.binding.parentId, child.binding)
    }
    const connection = child.connection
    child.connection = null
    child.acpSessionId = null
    if (connection) void disposeQuietly(connection).catch((error) => onError(child.binding.parentId, error))
  }

  function terminateContextBuildForParent(
    parentId: SessionId,
    parentGeneration: number,
  ): void {
    for (const child of [...contextBuildChildren.values()]) {
      if (
        child.binding.parentId === parentId &&
        child.binding.parentGeneration === parentGeneration
      ) {
        releaseContextBuildChild(child, { bridgeReason: "parent_generation_changed" })
      }
    }
  }

  function createContextBuildFacade(child: ContextBuildChildRuntime): ContextPackBridgeFacade {
    const authorized = (input: ContextPackBridgeAuthorization): boolean => {
      if (!ownsContextBuild(child) || !sameContextBuildRoute(input.route, child.route)) return false
      if (input.workspaceRoot !== child.route.workspaceRoot) return false
      return child.capability.operations.includes(contextBuildOperationFor(input.operation))
    }
    return {
      authorize: authorized,
      readDraft(route): DraftContextPack | null {
        if (!sameContextBuildRoute(route, child.route) || !ownsContextBuild(child)) return null
        return store.getState().contextPacks[route.parentId]?.draft ?? null
      },
      async readWorkspace(route, workspaceRoot, request, limits) {
        if (!sameContextBuildRoute(route, child.route) || !ownsContextBuild(child)) {
          return { kind: "blocked", reason: "invalid_workspace", path: request.path }
        }
        return await contextPackMaterializer.read(workspaceRoot, request, limits)
      },
      mutateDraft(route, input): ContextPackMutationResult | null {
        if (!sameContextBuildRoute(route, child.route) || !ownsContextBuild(child)) return null
        return store.applyContextPackBuilderMutation(route.parentId, input)
      },
      async askUser(route, form): Promise<ClarificationOutcome> {
        if (!sameContextBuildRoute(route, child.route) || !ownsContextBuild(child)) {
          return { kind: "cancelled" }
        }
        const parent = runtimes.get(route.parentId)
        if (!parent || parent.generation !== route.parentGeneration || !acceptsRuntimeEvents(parent)) {
          return { kind: "cancelled" }
        }
        const handle = enqueueClarificationHandle(parent, form)
        child.clarificationHandles.add(handle)
        try {
          return await handle.outcome
        } finally {
          child.clarificationHandles.delete(handle)
        }
      },
      dispose(_route, reason: ContextPackBridgeDisposalReason): void {
        cancelContextBuildClarifications(child)
        if (
          !child.settled &&
          (reason === "authorization_denied" || reason === "route_replaced" || reason === "bridge_disposed")
        ) {
          if (reason === "bridge_disposed") releaseContextBuildChild(child)
          else releaseContextBuildChild(child, { outcome: "failed" })
        }
      },
    }
  }

  function launchInvalidationReason(child: ContextBuildChildRuntime): ContextBuildDenialReason {
    const parent = runtimes.get(child.binding.parentId)
    const session = store.getState().sessions[child.binding.parentId]
    if (!parent || parent.generation !== child.binding.parentGeneration) return "parent_generation_mismatch"
    if (parent.seed.cwd !== child.route.workspaceRoot || session?.cwd !== child.route.workspaceRoot) {
      return "workspace_mismatch"
    }
    return "binding_changed"
  }

  async function startContextBuild(input: StartContextBuildInput): Promise<ContextBuildStartResult> {
    const preflight = contextBuildPreflight(input)
    if ("kind" in preflight) return preflight

    const childId = newSessionId()
    if (
      childId.trim().length === 0 ||
      runtimes.has(childId) ||
      contextBuildChildren.has(childId) ||
      store.getState().sessions[childId]
    ) {
      return { kind: "denied", reason: "startup_failed" }
    }
    const childGeneration = nextConnectionGeneration(childId, connectionGenerations)
    const prepared = store.prepareContextBuild(input.parentId, input.draft as ContextBuildDraftPreparation, {
      parentId: input.parentId,
      childId,
      parentGeneration: preflight.parentGeneration,
      childGeneration,
    })
    if (prepared.kind === "denied") {
      return {
        kind: "denied",
        reason: prepared.reason === "unknown_session" ? "unknown_parent" : prepared.reason,
      }
    }

    const route: ContextPackBridgeRoute = {
      parentId: prepared.binding.parentId,
      childId: prepared.binding.childId,
      parentGeneration: prepared.binding.parentGeneration,
      childGeneration: prepared.binding.childGeneration,
      draftRevision: prepared.binding.draftRevision,
      workspaceRoot: preflight.workspaceRoot,
    }
    const child: ContextBuildChildRuntime = {
      binding: prepared.binding,
      route,
      capability: preflight.capability,
      clarificationHandles: new Set(),
      connection: null,
      acpSessionId: null,
      unsubscribe: null,
      settled: false,
    }
    contextBuildChildren.set(childId, child)
    if (!ownsContextBuild(child)) {
      const reason = launchInvalidationReason(child)
      releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
      return { kind: "denied", reason }
    }

    let bridgeServer: import("../core/types.ts").McpServerConfig
    try {
      bridgeServer = contextPackBridge.register({
        route,
        facade: createContextBuildFacade(child),
      })
    } catch (error) {
      onError(input.parentId, error)
      releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
      return { kind: "denied", reason: "bridge_unavailable" }
    }
    if (!ownsContextBuild(child)) {
      const reason = launchInvalidationReason(child)
      releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
      return { kind: "denied", reason }
    }

    let connection: AgentConnection
    try {
      connection = createContextBuildConnection(preflight.capability.recipe)
      if (connection === preflight.parentRuntime.connection) {
        throw new Error("Context Build must own a distinct child connection")
      }
      child.connection = connection
      child.unsubscribe = connection.onUpdate(() => {})
      connection.onPermission(async () => ({ outcome: "cancelled" }))
      connection.onClarification(async () => ({ kind: "cancelled" }))
      const ready = await connection.connect()
      if (!ready.ready) throw new Error("Context Build child is not ready")
      if (!ownsContextBuild(child)) {
        const reason = launchInvalidationReason(child)
        releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
        return { kind: "denied", reason }
      }
      child.acpSessionId = await connection.newSession(preflight.workspaceRoot, [bridgeServer])
      if (!ownsContextBuild(child)) {
        const reason = launchInvalidationReason(child)
        releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
        return { kind: "denied", reason }
      }
    } catch (error) {
      onError(input.parentId, error)
      releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
      return { kind: "denied", reason: "startup_failed" }
    }

    let settlement: Promise<unknown>
    try {
      settlement = connection.prompt(child.acpSessionId!, [{
        type: "text",
        text: `${CONTEXT_PACK_MCP_INSTRUCTIONS}\n\nPrepare the bound draft for operator review, then stop.`,
      }])
    } catch (error) {
      onError(input.parentId, error)
      releaseContextBuildChild(child, { bridgeReason: "launch_denied" })
      return { kind: "denied", reason: "startup_failed" }
    }
    void settlement.then(
      () => releaseContextBuildChild(child, {
        bridgeReason: "child_settled",
        outcome: "ready_for_review",
      }),
      (error) => {
        onError(input.parentId, error)
        releaseContextBuildChild(child, {
          bridgeReason: "child_settled",
          outcome: "failed",
        })
      },
    )
    return { kind: "started", childId, draftRevision: prepared.draft.revision }
  }

  function contextPackWorkspace(
    sessionId: SessionId,
  ): { readonly workspaceRoot: string; readonly draft: DraftContextPack } |
    Extract<ContextPackReviewResult, { readonly kind: "blocked" }> {
    const state = store.getState()
    const session = state.sessions[sessionId]
    const runtime = runtimes.get(sessionId)
    if (!session || !runtime || !state.contextPacks[sessionId]) {
      return { kind: "blocked", reason: "unknown_session" }
    }
    const draft = state.contextPacks[sessionId]?.draft
    if (!draft) return { kind: "blocked", reason: "draft_unavailable" }
    if (
      !isAbsolute(session.cwd) ||
      session.cwd.trim().length === 0 ||
      session.cwd !== runtime.seed.cwd
    ) {
      return { kind: "blocked", reason: "workspace_mismatch" }
    }
    return { workspaceRoot: session.cwd, draft }
  }

  async function reviewContextPack(sessionId: SessionId): Promise<ContextPackReviewResult> {
    const workspace = contextPackWorkspace(sessionId)
    if ("kind" in workspace) return workspace
    const materialized = await contextPackMaterializer.materialize(
      workspace.workspaceRoot,
      workspace.draft.selections,
    )
    if (materialized.kind !== "materialized") {
      return { kind: "blocked", reason: materialized.reason }
    }
    if (store.getState().contextPacks[sessionId]?.draft !== workspace.draft) {
      return { kind: "blocked", reason: "draft_changed" }
    }

    const assembled = assembleCandidate(workspace.draft, materialized.artifacts, contextPackRedactor)
    if (assembled.kind === "blocked") {
      return { kind: "blocked", reason: assembled.reason }
    }
    if (assembled.candidate.verdict.kind === "blocked") {
      return { kind: "blocked", reason: assembled.candidate.verdict.reason }
    }
    if (!store.publishContextPackReview(sessionId, assembled.candidate)) {
      return { kind: "blocked", reason: "draft_changed" }
    }
    return { kind: "reviewed", candidate: assembled.candidate }
  }

  async function sealContextPack(
    sessionId: SessionId,
    candidateRevision: number,
  ): Promise<ContextPackSealActionResult> {
    const workspace = contextPackWorkspace(sessionId)
    if ("kind" in workspace) return workspace
    const reviewed = store.getState().contextPacks[sessionId]?.review
    if (!reviewed) return { kind: "blocked", reason: "review_unavailable" }
    if (reviewed.revision !== candidateRevision || workspace.draft.revision !== candidateRevision) {
      return { kind: "blocked", reason: "candidate_revision_mismatch" }
    }

    const materialized = await contextPackMaterializer.materialize(
      workspace.workspaceRoot,
      workspace.draft.selections,
    )
    if (materialized.kind !== "materialized") {
      return { kind: "blocked", reason: materialized.reason }
    }
    const current = store.getState().contextPacks[sessionId]
    if (current?.draft !== workspace.draft || current.review !== reviewed) {
      return { kind: "blocked", reason: "candidate_changed" }
    }

    const reassembled = assembleCandidate(workspace.draft, materialized.artifacts, contextPackRedactor)
    if (reassembled.kind === "blocked") {
      return { kind: "blocked", reason: reassembled.reason }
    }
    if (reassembled.candidate.verdict.kind === "blocked") {
      return { kind: "blocked", reason: "candidate_blocked" }
    }
    if (!sameContextPackReviewCandidate(reviewed, reassembled.candidate)) {
      return { kind: "blocked", reason: "candidate_changed" }
    }

    const result = sealCandidate({
      draft: workspace.draft,
      candidate: reviewed,
      currentSourceFences: reassembled.candidate.sourceFences,
      sealedAt: now(),
    })
    if (result.kind === "blocked") return result
    if (!store.sealContextPack(sessionId, result.sealed)) {
      return { kind: "blocked", reason: "candidate_changed" }
    }
    return result
  }

  function recipientFitEvidence(
    sessionId: SessionId,
    sealed: DurableSealedContextPack,
  ): RecipientFitEvidence {
    const runtime = runtimes.get(sessionId)
    const session = store.getState().sessions[sessionId]
    if (
      disposed ||
      !runtime?.config ||
      !runtime.state.ready ||
      !runtime.connection ||
      runtime.acpSessionId === null ||
      !session?.usage
    ) {
      return { kind: "missing" }
    }

    let availability: RecipientProfileAvailability
    try {
      availability = attestRecipientProfile(runtime.config)
    } catch {
      return invalidRecipientFitEvidence(sealed)
    }
    if (availability.status === "unavailable") {
      if (availability.reason === "stale_evidence") return { kind: "stale" }
      if (availability.reason === "malformed_evidence") return invalidRecipientFitEvidence(sealed)
      return { kind: "missing" }
    }

    const profile = availability.profile
    const currentModel = session.configOptions.find((option) => option.category === MODEL_CATEGORY)?.currentValue
    if (
      profile.validUntil < now() ||
      profile.recipe.id !== runtime.config.id ||
      session.usage.size !== profile.freshSessionCapacity ||
      (currentModel !== undefined && currentModel !== profile.model)
    ) {
      return { kind: "stale" }
    }

    let exactCount: number | null
    try {
      exactCount = countContextPackPayload(sealed.payload, profile)
    } catch {
      return invalidRecipientFitEvidence(sealed)
    }
    if (exactCount === null) return { kind: "missing" }
    return {
      kind: "current",
      sealedRevision: sealed.revision,
      payloadBytes: sealed.bytes,
      exactCount,
      capacity: session.usage.size,
      used: session.usage.used,
      reserve: profile.reserve,
      counterVersion: profile.counterVersion,
      evidenceVersion: profile.evidenceVersion,
    }
  }

  function assessContextPackRecipientFit(sessionId: SessionId): RecipientFit {
    const sealed = store.getState().contextPacks[sessionId]?.sealed
    if (!sealed) return { kind: "unavailable", reason: "missing_evidence" }
    return assessRecipientFit(sealed, recipientFitEvidence(sessionId, sealed))
  }

  function assessHandoffRecipientFit(
    targetSessionId: SessionId,
    sealed: DurableSealedContextPack,
  ): RecipientFit {
    return assessRecipientFit(sealed, recipientFitEvidence(targetSessionId, sealed))
  }

  function handoffSourceIdentities(
    sessionId: SessionId,
    bundle: HandoffBundle,
  ): HandoffSourceIdentityIndex {
    const files = Object.create(null) as Record<string, string>
    const pendingDiffs = Object.create(null) as Record<string, string>
    const session = store.getState().sessions[sessionId]
    const runtime = runtimes.get(sessionId)
    if (
      !session ||
      !runtime ||
      !isAbsolute(session.cwd) ||
      session.cwd !== runtime.seed.cwd
    ) return { files, pendingDiffs }

    let realRoot: string
    try {
      realRoot = realpathSync(session.cwd)
    } catch {
      return { files, pendingDiffs }
    }

    const fileIdentity = (path: string): string | null => {
      if (!isSafeRepositoryRelativePath(session.cwd, path)) return null
      try {
        const absolutePath = resolve(session.cwd, path)
        const stat = lstatSync(absolutePath)
        if (!stat.isFile()) return null
        const realSource = realpathSync(absolutePath)
        if (!isPathContainedBy(realRoot, realSource)) return null
        return `${String(stat.dev)}:${String(stat.ino)}`
      } catch {
        return null
      }
    }

    for (const file of bundle.files) {
      const identity = fileIdentity(file.path)
      if (identity !== null) files[file.path] = `file:${identity}`
    }
    for (const diff of bundle.pendingDiffs) {
      const identity = fileIdentity(diff.path)
      if (identity !== null) pendingDiffs[diff.toolCallId] = `diff:pending:${identity}`
    }
    return { files, pendingDiffs }
  }

  async function sendContextPackHere(sessionId: SessionId): Promise<ContextPackSendHereResult> {
    const sealed = store.getState().contextPacks[sessionId]?.sealed
    if (!sealed) return { kind: "blocked", reason: "sealed_unavailable" }

    const fit = assessRecipientFit(sealed, recipientFitEvidence(sessionId, sealed))
    if (fit.kind !== "fit") return { kind: "blocked", reason: "recipient_fit", fit }

    const current = store.getState().contextPacks[sessionId]?.sealed
    if (!current || !sameSealedCustody(sealed, current)) {
      return { kind: "blocked", reason: "sealed_changed" }
    }
    const result = await actions.sendPrompt([{ type: "text", text: sealed.payload }], sessionId)
    return result
      ? { kind: "sent", result }
      : { kind: "blocked", reason: "dispatch_failed" }
  }

  async function exportContextPack(
    input: ContextPackExportActionInput,
  ): Promise<ContextPackExportActionResult> {
    const sealed = store.getState().contextPacks[input.sessionId]?.sealed
    if (!sealed) return { kind: "blocked", reason: "sealed_unavailable" }

    const current = store.getState().contextPacks[input.sessionId]?.sealed
    if (!current || !sameSealedCustody(sealed, current)) {
      return { kind: "blocked", reason: "sealed_changed" }
    }
    return await contextPackExporter.export({
      sealed,
      destination: input.destination,
      writeConfirmed: input.writeConfirmed,
      overwriteConfirmed: input.overwriteConfirmed,
    })
  }

  async function startAgentRunBatch(
    route: AgentRunRoute,
    tasks: readonly AgentRunTask[],
  ): Promise<readonly AgentRunSnapshot[]> {
    const startedAt = now()
    let telemetryOutcome: AgentRunTelemetryInput["outcome"] = "rejected"
    const routeKey = `${route.parentId}\u0000${route.parentGeneration}`
    let ownsStartGuard = false
    try {
      if (activeAgentRunStarts.has(routeKey)) throw new KittenMcpBridgeError("busy")
      if (!agentRunRouteAvailable(route)) {
        telemetryOutcome = "unavailable"
        throw new KittenMcpBridgeError("unavailable")
      }
      activeAgentRunStarts.add(routeKey)
      ownsStartGuard = true
      if (tasks.length < 1 || tasks.length > 4) throw new Error("Invalid agent-run batch")
      const preflight = preflightDelegatedBatch(route, tasks, false)
      if ("kind" in preflight) throw new Error(`Agent-run start rejected: ${preflight.reason}`)
      const result = await launchDelegatedBatch(preflight)
      if (isDelegatedBatchDenial(result)) throw new Error(`Agent-run start rejected: ${result.reason}`)
      const snapshots = result.map((child) => {
        if (!child.snapshot) throw new Error("Agent-run child ownership was invalidated")
        return child.snapshot
      })
      telemetryOutcome = "accepted"
      return snapshots
    } catch (error) {
      if (telemetryOutcome !== "unavailable" && !agentRunRouteAvailable(route)) {
        telemetryOutcome = "unavailable"
        throw new KittenMcpBridgeError("unavailable")
      }
      throw error
    } finally {
      if (ownsStartGuard) activeAgentRunStarts.delete(routeKey)
      options.recorder?.agentRunControl?.({
        operation: "start",
        outcome: telemetryOutcome,
        batchSizeBucket: bucketAgentRunBatchSize(tasks.length),
        durationBucket: bucketAgentRunDuration(now() - startedAt),
      })
    }
  }

  function pollAgentRun(
    route: AgentRunRoute,
    childIds: readonly SessionId[],
  ): readonly AgentRunSnapshot[] {
    const startedAt = now()
    let telemetryOutcome: AgentRunTelemetryInput["outcome"] = "rejected"
    try {
      if (childIds.length === 0 || new Set(childIds).size !== childIds.length) {
        throw new Error("Invalid agent-run poll")
      }
      if (!agentRunRouteAvailable(route)) {
        telemetryOutcome = "unavailable"
        throw new Error("Agent-run route is unavailable")
      }
      const state = store.getState()
      const snapshots = childIds.map((childId) => {
        const child = state.delegation.children[childId]
        const runtime = runtimes.get(childId)
        if (
          !child ||
          child.parentId !== route.parentId ||
          child.parentGeneration !== route.parentGeneration ||
          runtime?.generation !== child.childGeneration
        ) {
          throw new Error("Agent-run child is unavailable")
        }
        return {
          childId,
          status: child.status,
          ...(child.terminal ? { terminalAt: child.terminal.at } : {}),
        }
      })
      telemetryOutcome = "accepted"
      return snapshots
    } finally {
      options.recorder?.agentRunControl?.({
        operation: "poll",
        outcome: telemetryOutcome,
        batchSizeBucket: bucketAgentRunBatchSize(childIds.length),
        durationBucket: bucketAgentRunDuration(now() - startedAt),
      })
    }
  }

  function agentRunRouteAvailable(route: AgentRunRoute): boolean {
    const state = store.getState()
    const parentRuntime = runtimes.get(route.parentId)
    return !disposed &&
      state.sessions[route.parentId] !== undefined &&
      state.delegation.children[route.parentId] === undefined &&
      state.delegation.parents[route.parentId]?.closeState !== "closing" &&
      parentRuntime?.state.ready === true &&
      parentRuntime.generation === route.parentGeneration &&
      acceptsRuntimeEvents(parentRuntime)
  }

  async function startDelegatedChild(input: StartDelegatedChildInput): Promise<SessionId | null> {
    const result = await startExploreChild(input)
    return result.kind === "started" ? result.childId : null
  }

  async function cleanupManagedWorktree(childId: SessionId): Promise<CleanupManagedWorktreeResult> {
    const state = store.getState()
    const session = state.sessions[childId]
    const child = state.delegation.children[childId]
    const binding = session?.worktreeBinding
    if (!session || !child || binding?.kind !== "managed" || binding.ownerSessionId !== childId) {
      return { kind: "refused", reason: "not_managed" }
    }
    if (!child.terminal || getSession(childId)) {
      return { kind: "refused", reason: "live_owned" }
    }

    let result: CleanupManagedWorktreeResult
    try {
      result = await managedWorktrees.cleanup({
        binding,
        ownerTerminal: true,
        ownerLive: false,
      })
    } catch (error) {
      onError(childId, error)
      result = { kind: "failed", reason: "git_failed" }
    }
    if (result.kind === "removed") {
      store.publishManagedWorktreeBinding(childId, {
        ...binding,
        availability: "unavailable",
        reason: "missing",
      })
      options.recorder?.managedWorktreeCleaned?.()
    } else {
      store.publishManagedWorktreeBinding(childId, {
        ...binding,
        availability: "cleanup_refused",
        reason: result.reason,
      })
      if (result.kind === "refused") {
        options.recorder?.managedWorktreeCleanupRefused?.(result.reason)
      }
    }
    return result
  }

  async function steerDelegatedChild(childId: SessionId, text: string) {
    const direction = text.trim()
    const identity = delegatedIdentity(childId)
    const snapshot = store.getState().delegation.children[childId]
    if (
      !direction ||
      !identity ||
      !snapshot ||
      snapshot.terminal ||
      store.getState().delegation.parents[snapshot.parentId]?.closeState !== "open" ||
      !ownsDelegatedIdentity(identity) ||
      !getSession(childId)
    ) {
      return null
    }
    const result = await actions.sendPrompt(direction, childId)
    if (result && store.getState().delegation.children[childId]?.status === "needs_input") {
      publishDelegatedState({ ...identity, status: "running", sessionStatus: "working" })
    }
    return result
  }

  async function cancelDelegatedChild(childId: SessionId): Promise<void> {
    const identity = delegatedIdentity(childId)
    const snapshot = store.getState().delegation.children[childId]
    const runtime = runtimes.get(childId)
    if (
      !identity ||
      !snapshot ||
      snapshot.terminal ||
      !runtime?.connection ||
      runtime.acpSessionId === null ||
      !ownsDelegatedIdentity(identity)
    ) {
      return
    }
    try {
      terminalizeHarnessDelivery(runtime, identity.childGeneration)
      await runtime.connection.cancel(runtime.acpSessionId)
      if (!ownsDelegatedIdentity(identity)) return
      runtime.cancelCompleted = true
      publishDelegatedState({
        ...identity,
        status: "cancelled",
        sessionStatus: "idle",
        at: now(),
      })
    } catch (error) {
      onError(childId, error)
      publishDelegatedState({
        ...identity,
        status: "failed",
        sessionStatus: "error",
        at: now(),
      })
    }
  }

  function preparePromptDispatch(sessionId: SessionId, blocks: PromptBlock[]) {
    const runtime = runtimes.get(sessionId)
    if (
      !runtime?.state.ready ||
      !runtime.config ||
      !runtime.connection ||
      runtime.acpSessionId === null ||
      !acceptsRuntimeEvents(runtime)
    ) return null

    if (activePrompts.has(sessionId)) return null

    const generation = runtime.generation
    const delivery = runtime.harnessDelivery
    if (!delivery || delivery.state === "in_flight" || delivery.state === "failed") return null

    let input: AgentPromptInput = blocks
    let settlesHarnessDelivery = false
    if (delivery.state === "pending") {
      let capability: HarnessCapability
      try {
        capability = resolveDeliveryCapability(runtime.config)
      } catch {
        capability = { status: "unsupported", reason: "incomplete_evidence" }
      }
      if (capability.status !== "supported") {
        publishHarnessDelivery(runtime, failBeforeDispatch(delivery, generation, {
          retrySafe: false,
          category: "unsupported_profile",
        }))
        return null
      }

      let rendered: ReturnType<typeof renderHarnessPrompt>
      try {
        rendered = renderHarnessPrompt(delivery.version)
      } catch {
        publishHarnessDelivery(runtime, failBeforeDispatch(delivery, generation, {
          retrySafe: false,
          category: "harness_render_failed",
        }))
        return null
      }
      if (rendered.kind !== "rendered") {
        publishHarnessDelivery(runtime, failBeforeDispatch(delivery, generation, {
          retrySafe: false,
          category: "harness_render_failed",
        }))
        return null
      }

      const claimed = beginDispatch(delivery, generation)
      if (claimed.state !== "in_flight") return null
      publishHarnessDelivery(runtime, claimed)
      input = {
        userBlocks: blocks,
        harness: { version: rendered.version, text: rendered.text },
        profileId: capability.profileId,
      }
      settlesHarnessDelivery = true
    }

    const connection = runtime.connection
    const acpSessionId = runtime.acpSessionId
    const lifecycle = beginPromptLifecycle(sessionId, generation, newSteeringId())
    return {
      async invoke() {
        try {
          const result = await connection.prompt(acpSessionId, input)
          if (settlesHarnessDelivery && isCurrentGeneration(runtime, generation)) {
            const current = runtime.harnessDelivery
            if (current) publishHarnessDelivery(runtime, completeDispatch(current, generation))
          }
          return result
        } catch (error) {
          if (settlesHarnessDelivery && isCurrentGeneration(runtime, generation)) {
            const current = runtime.harnessDelivery
            if (current) publishHarnessDelivery(runtime, failIndeterminate(current, generation))
          }
          throw error
        } finally {
          finishPromptLifecycle(sessionId, lifecycle)
        }
      },
    }
  }

  function beginPromptLifecycle(
    sessionId: SessionId,
    generation: number,
    turnId: string,
  ): ActivePromptLifecycle {
    if (activePrompts.has(sessionId)) throw new Error("A prompt lifecycle is already active")
    let settle!: () => void
    const settlement = new Promise<void>((resolve) => {
      settle = resolve
    })
    let settled = false
    const lifecycle: ActivePromptLifecycle = {
      turnId,
      generation,
      settlement,
      settle() {
        if (settled) return
        settled = true
        settle()
      },
    }
    activePrompts.set(sessionId, lifecycle)
    return lifecycle
  }

  function finishPromptLifecycle(sessionId: SessionId, lifecycle: ActivePromptLifecycle): void {
    lifecycle.settle()
    if (activePrompts.get(sessionId) === lifecycle) activePrompts.delete(sessionId)
  }

  function abandonPromptLifecycle(sessionId: SessionId): void {
    const lifecycle = activePrompts.get(sessionId)
    if (lifecycle) finishPromptLifecycle(sessionId, lifecycle)
  }

  function terminalizeSteering(
    sessionId: SessionId,
    reason: "lifecycle_lost" | "hard_stop" = "lifecycle_lost",
  ): void {
    const coordinator = steeringCoordinators.get(sessionId)
    if (!coordinator) return
    coordinator.terminalize(reason)
    steeringCoordinators.delete(sessionId)
  }

  function captureSteeringRecovery(sessionId: SessionId): SteeringRecoveryTransfer | null {
    const steering = store.getState().sessions[sessionId]?.steering
    const request = steering?.queue[0]
    return request && steering.recovery
      ? { requestId: request.id, blocks: steering.recovery }
      : null
  }

  function restoreSteeringRecovery(
    sessionId: SessionId,
    generation: number,
    transfer: SteeringRecoveryTransfer | null,
  ): void {
    if (!transfer || !store.getState().sessions[sessionId]) return
    store.applyEvent(sessionId, {
      kind: "steering_enqueue",
      activeTurnId: `replaced:${transfer.requestId}`,
      requestId: transfer.requestId,
      generation,
      blocks: transfer.blocks,
    })
    store.applyEvent(sessionId, {
      kind: "steering_recover",
      requestId: transfer.requestId,
      generation,
    })
  }

  function enqueueSteering(sessionId: SessionId, blocks: readonly PromptBlock[]): SteeringResult {
    const runtime = runtimes.get(sessionId)
    const active = activePrompts.get(sessionId)
    if (
      !runtime?.state.ready ||
      !runtime.connection ||
      runtime.acpSessionId === null ||
      !acceptsRuntimeEvents(runtime) ||
      !active ||
      active.generation !== runtime.generation
    ) {
      return { kind: "unavailable", reason: "inactive" }
    }

    const requestId = newSteeringId()
    store.applyEvent(sessionId, {
      kind: "steering_enqueue",
      activeTurnId: active.turnId,
      requestId,
      generation: runtime.generation,
      blocks,
    })
    const accepted = store.getState().sessions[sessionId]?.steering.queue.some(
      (request) => request.id === requestId && request.generation === runtime.generation,
    )
    if (!accepted) return { kind: "unavailable", reason: "recovering" }

    options.recorder?.steeringOutcome?.(requestId, "queued", "fallback")
    let coordinator = steeringCoordinators.get(sessionId)
    if (!coordinator) {
      const generation = runtime.generation
      const connection = runtime.connection
      const acpSessionId = runtime.acpSessionId
      const targetTurn = active
      coordinator = createSteeringCoordinator({
        sessionId,
        generation,
        store,
        hasPendingInteraction: () => interactionCoordinator.hasPending(sessionId, generation),
        cancelActiveTurn: async () => {
          if (!isCurrentGeneration(runtime, generation)) throw new Error("Steering generation was replaced")
          await connection.cancel(acpSessionId)
        },
        terminalSettlement: () => targetTurn.settlement,
        sendFollowUp: async (followUpBlocks, steeringRequestId) => {
          if (!isCurrentGeneration(runtime, generation) || activePrompts.has(sessionId)) {
            throw new Error("Steering follow-up lost its active generation")
          }
          const followUp = beginPromptLifecycle(sessionId, generation, steeringRequestId)
          try {
            await connection.prompt(acpSessionId, [...followUpBlocks])
          } finally {
            finishPromptLifecycle(sessionId, followUp)
          }
        },
        newMessageId: options.newMessageId,
        scheduleSettlementTimeout: options.scheduleSteeringSettlementTimeout,
        onOutcome: (lifecycleKey, outcome) => {
          options.recorder?.steeringOutcome?.(lifecycleKey, outcome, "fallback")
        },
        onError: (_reason, error) => {
          if (error !== undefined) onError(sessionId, error)
        },
      })
      steeringCoordinators.set(sessionId, coordinator)
    }
    coordinator.advance()
    return { kind: "queued", requestId }
  }

  async function applyProviderDefaultsToFreshSession(sessionId: SessionId): Promise<void> {
    if (!options.applyProviderDefaultsOnFreshSession) return
    const runtime = runtimes.get(sessionId)
    const defaults = runtime ? providerDefaults[runtime.seed.providerKind] : undefined
    if (
      !runtime?.state.ready ||
      runtime.mcpScope !== "ordinary" ||
      (!defaults?.model && !defaults?.effort)
    ) return
    await actions.applyProviderDefaults(sessionId)
  }

  const actions = createControllerActions({
    store,
    getSession,
    preparePromptDispatch,
    enqueueSteering,
    terminalizeSteering: (sessionId) => terminalizeSteering(sessionId, "hard_stop"),
    terminalizePromptDispatch: (sessionId) => {
      const runtime = runtimes.get(sessionId)
      if (runtime) terminalizeHarnessDelivery(runtime)
    },
    getProviderDefault: (sessionId) => {
      const provider = runtimes.get(sessionId)?.seed.providerKind
      return provider ? providerDefaults[provider] : undefined
    },
    resolvePermission,
    resolveClarification,
    newMessageId: options.newMessageId,
    onError,
    refreshBranch,
    recorder: options.recorder,
    repositoryFileSource,
    createConversation,
    startDelegatedChild,
    cleanupManagedWorktree,
    startExploreChild,
    exploreAvailability,
    startContextBuild,
    contextBuildAvailability,
    reviewContextPack,
    sealContextPack,
    assessContextPackRecipientFit,
    sendContextPackHere,
    exportContextPack,
    steerDelegatedChild,
    cancelDelegatedChild,
    closeConversation,
    startNewRun: async () => {
      if (disposed) return
      store.setRestorationBundle(null)
      const entries = orderedRuntimes(store, runtimes).filter(
        (runtime): runtime is AgentRuntime & { config: ResolvedAgentConfig } =>
          runtime.config !== null && !store.getState().delegation.children[runtime.seed.id],
      )
      await Promise.all(entries.map((entry) => restoreSession(entry.seed, entry.config, undefined, undefined)))
      await Promise.all(entries.map((entry) => applyProviderDefaultsToFreshSession(entry.seed.id)))
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
      const restored = await restoreSession(entry.seed, entry.config, undefined, undefined)
      const ready = restored && getSession(sessionId) !== undefined
      if (ready) {
        await applyProviderDefaultsToFreshSession(sessionId)
        store.setRestoration(sessionId, null)
        refreshBranch(sessionId)
      }
      return ready
    },
  })

  // Apply configured model and reasoning defaults before any fresh session receives
  // its optional opening task (ADR-005). Restored sessions intentionally retain their
  // persisted provider settings instead.
  await Promise.all(initialPlan.map((entry) => applyProviderDefaultsToFreshSession(entry.seed.id)))

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
    transcriptWindowingEnabled: options.config.transcriptWindowingEnabled,
    actions,
    shell,
    runtimes: () => orderedRuntimes(store, runtimes).map((runtime) => runtime.state),
    runtime: (sessionId) => runtimes.get(sessionId)?.state,
    isReady: (sessionId) => runtimes.get(sessionId)?.state.ready === true,
    handoffSourceIdentities,
    assessHandoffRecipientFit,
    updateProviderDefaults(defaults): void {
      providerDefaults = cloneProviderDefaults(defaults)
    },
    closeConversation,
    async restore(record, mode = "last-run"): Promise<void> {
      if (disposed) return
      options.recorder?.resumeLoadStarted?.()
      store.setRestorationBundle(record.handoffBundle)
      const restoredRecord = migratePersistedRunToV4(
        record.version === 1
          ? migratePersistedRunV1(record, resolveSessions(options.config, { launchCwd: cwd }))
          : record,
      )
      interactionCoordinator.cancelAll()
      const steeringRecoveries = new Map<SessionId, SteeringRecoveryTransfer>()
      for (const runtime of runtimes.values()) {
        terminalizeSteering(runtime.seed.id)
        const recovery = captureSteeringRecovery(runtime.seed.id)
        if (recovery) steeringRecoveries.set(runtime.seed.id, recovery)
        abandonPromptLifecycle(runtime.seed.id)
        terminalizeHarnessDelivery(runtime)
        invalidateBridge(runtime, runtime.generation, "session_replaced")
      }
      await disposeAgentRuntimes(runtimes)
      runtimes.clear()
      branchReadGenerations.clear()
      pendingClarificationCounts.clear()

      const entries = restoreEntries(restoredRecord)
      store.replaceSessions(
        entries.map((entry) => ({
          seed: entry.seed,
          workspace: entry.workspace,
          contextPack: entry.contextPack,
        })),
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
          await restoreSession(entry.seed, runtime.config, entry.stored, entry.checkpoint)
        }),
      )
      for (const [sessionId, recovery] of steeringRecoveries) {
        const runtime = runtimes.get(sessionId)
        if (runtime) restoreSteeringRecovery(sessionId, runtime.generation, recovery)
      }
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
      const workspace = store.getState().workspace
      let visibleCount = 0
      let backgroundCount = 0
      let unavailableCount = 0
      for (const sessionId of workspace.order) {
        const conversation = workspace.conversations[sessionId]
        if (!conversation) continue
        if (conversation.lifecycle === "visible") visibleCount += 1
        else backgroundCount += 1
        if (conversation.availability.kind === "unavailable") unavailableCount += 1
      }
      options.recorder?.tabRestore?.({ visibleCount, backgroundCount, unavailableCount })
    },
    async dispose(): Promise<void> {
      for (const runtime of runtimes.values()) {
        terminalizeSteering(runtime.seed.id)
        abandonPromptLifecycle(runtime.seed.id)
        terminalizeHarnessDelivery(runtime)
      }
      for (const child of [...contextBuildChildren.values()]) {
        releaseContextBuildChild(child, { bridgeReason: "parent_generation_changed" })
      }
      disposed = true
      await Promise.all([kittenMcpBridge.dispose(), contextPackBridge.dispose()])
      interactionCoordinator.dispose()
      steeringCoordinators.clear()
      activePrompts.clear()
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

/** Copy the small declarative snapshot so external config objects cannot mutate it. */
function cloneProviderDefaults(
  defaults: Partial<Record<ProviderKind, ProviderModelDefault>>,
): Partial<Record<ProviderKind, ProviderModelDefault>> {
  return Object.fromEntries(
    Object.entries(defaults).map(([provider, value]) => [provider, { ...value }]),
  ) as Partial<Record<ProviderKind, ProviderModelDefault>>
}

function defaultResolveHarnessCapability(config: ResolvedAgentConfig): HarnessCapability {
  return resolveHarnessCapability(config, harnessRuntimeEvidence(config))
}

/** Derive only exact, already-resolved runtime release facts; registry evidence still grants support. */
function harnessRuntimeEvidence(config: ResolvedAgentConfig): HarnessRuntimeEvidence | undefined {
  if (config.id === "cursor" && config.runtimeProfile.kind === "cursor-certified") {
    return {
      sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
      adapterPackage: "cursor-agent",
      adapterVersion: config.runtimeProfile.certifiedVersion,
    }
  }

  const packageSpec = config.command === "npx" && config.args[0] === "-y" && config.args.length === 2
    ? config.args[1]
    : undefined
  if (!packageSpec) return undefined
  const separator = packageSpec.lastIndexOf("@")
  if (separator <= 0 || separator === packageSpec.length - 1) return undefined
  return {
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    adapterPackage: packageSpec.slice(0, separator),
    adapterVersion: packageSpec.slice(separator + 1),
  }
}

/** Non-Cursor providers retain their established one-connection lifecycle. */
async function preflightCursor(
  config: ResolvedAgentConfig,
  preflight: typeof preflightAgentReadiness = preflightAgentReadiness,
): Promise<AgentReadinessPreflight> {
  return config.id === "cursor" ? preflight(config) : { ready: true }
}

function preflightOutcome(
  reason: Extract<AgentReadinessPreflight, { ready: false }>["reason"],
): ProviderReadinessOutcome {
  return reason === "binary_not_found" ? "binary_missing" : reason
}

function longLivedReadinessFailure(
  config: ResolvedAgentConfig,
  state: Extract<Awaited<ReturnType<AgentConnection["connect"]>>, { ready: false }>,
): { reason: "authentication_required" | "handshake_failed"; message: string } {
  return config.id === "cursor"
    ? connectionReadinessFailure(config, state)
    : { reason: "handshake_failed", message: state.error }
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

function validContextBuildCapability(
  capability: Extract<ContextBuildAvailability, { readonly status: "available" }>,
  config: ResolvedAgentConfig,
): boolean {
  return capability.capabilityVersion === "explore-v2" &&
    capability.evidenceVersion.trim().length > 0 &&
    capability.model.trim().length > 0 &&
    sameContextBuildOperations(capability.operations, CONTEXT_BUILD_OPERATIONS) &&
    capability.recipe.id === config.id &&
    capability.recipe.command === config.command &&
    sameStringArray(capability.recipe.args, config.args) &&
    sameStringRecord(capability.recipe.env, config.env)
}

function sameContextBuildOperations(
  left: readonly ContextBuildOperation[],
  right: readonly ContextBuildOperation[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameStringArray(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}

function sameContextBuildBinding(left: ContextBuildBinding, right: ContextBuildBinding): boolean {
  return left.parentId === right.parentId &&
    left.childId === right.childId &&
    left.parentGeneration === right.parentGeneration &&
    left.childGeneration === right.childGeneration &&
    left.draftRevision === right.draftRevision
}

function sameContextBuildRoute(left: ContextPackBridgeRoute, right: ContextPackBridgeRoute): boolean {
  return left.parentId === right.parentId &&
    left.childId === right.childId &&
    left.parentGeneration === right.parentGeneration &&
    left.childGeneration === right.childGeneration &&
    left.draftRevision === right.draftRevision &&
    left.workspaceRoot === right.workspaceRoot
}

function invalidRecipientFitEvidence(sealed: DurableSealedContextPack): RecipientFitEvidence {
  return {
    kind: "current",
    sealedRevision: sealed.revision,
    payloadBytes: sealed.bytes,
    exactCount: Number.NaN,
    capacity: Number.NaN,
    used: Number.NaN,
    reserve: Number.NaN,
    counterVersion: "",
    evidenceVersion: "",
  }
}

function sameContextPackReviewCandidate(
  left: ContextPackReviewCandidate,
  right: ContextPackReviewCandidate,
): boolean {
  return left.revision === right.revision &&
    left.payload === right.payload &&
    left.bytes === right.bytes &&
    left.packEstimate === right.packEstimate &&
    left.redactionCount === right.redactionCount &&
    JSON.stringify(left.manifest) === JSON.stringify(right.manifest) &&
    JSON.stringify(left.sourceFences) === JSON.stringify(right.sourceFences) &&
    JSON.stringify(left.verdict) === JSON.stringify(right.verdict)
}

function sameSealedCustody(left: ContextPackSealedState, right: ContextPackSealedState): boolean {
  return left === right &&
    left.revision === right.revision &&
    left.payload === right.payload &&
    left.bytes === right.bytes &&
    left.sealedAt === right.sealedAt
}

function contextBuildOperationFor(operation: ContextPackMcpOperation): ContextBuildOperation {
  switch (operation) {
    case "ask_user": return "ask_user:scoped"
    case "read_draft": return "draft:read-bounded"
    case "read_workspace": return "workspace:read-bounded"
    case "mutate_draft": return "draft:mutate-revision-fenced"
  }
}

function clarificationCountKey(sessionId: SessionId, generation: number): string {
  return `${sessionId}\u0000${generation}`
}

function defaultScheduleClarificationTimeout(callback: () => void, timeoutMs: number): () => void {
  const timer = setTimeout(callback, timeoutMs)
  return () => clearTimeout(timer)
}

function cancelledClarificationHandle(requestId: string): ClarificationRequestHandle {
  return {
    requestId,
    outcome: Promise.resolve({ kind: "cancelled" }),
    cancel: () => false,
    timeout: () => false,
  }
}

function mcpBridgeFailureCategory(reason: KittenMcpBridgeFailureReason): McpBridgeFailureCategory {
  switch (reason) {
    case "connection_concurrency_limit":
    case "connection_call_limit":
      return "capacity_limited"
    case "connection_frame_too_large":
    case "connection_malformed_frame":
    case "connection_invalid_request":
    case "connection_duplicate_call_id":
      return "invalid_request"
    case "registration_endpoint_failed":
    case "registration_capability_failed":
    case "registration_listen_failed":
    case "connection_unauthorized":
    case "connection_io_error":
    case "connection_request_failed":
      return "unavailable"
  }
}

/**
 * A compiled Kitten executable can run child mode directly. During `bun src/index.ts`
 * development, preserve the source entrypoint before appending the reserved mode flag.
 */
function defaultKittenMcpExecutable(): { command: string; args: readonly string[] } {
  const entrypoint = process.argv[1]
  return {
    command: process.execPath,
    args: entrypoint?.endsWith("/src/index.ts") || entrypoint?.endsWith("\\src\\index.ts")
      ? [entrypoint]
      : [],
  }
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
  checkpoint: HarnessDeliveryCheckpoint | undefined
  contextPack: ContextPackState
}

function restoreEntries(record: PersistedRunRecordV4): RestoreEntry[] {
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
      checkpoint: record.harnessDeliveries[sessionId],
      contextPack: restorePersistedContextPack(record.contextPacks[sessionId]),
    })
  }
  return entries
}

function restorePersistedContextPack(projection: PersistedContextPack | undefined): ContextPackState {
  if (!projection) return { draft: null, sealed: null, review: null, build: null }
  const restoredDraft = projection.draft ? restoreManifest(projection.draft) : null
  if (restoredDraft?.kind === "invalid") {
    return { draft: null, sealed: null, review: null, build: null }
  }
  return {
    draft: restoredDraft?.kind === "restored" ? restoredDraft.draft : null,
    sealed: projection.sealed ? { ...projection.sealed, restored: true } : null,
    review: null,
    build: null,
  }
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

function defaultCreateConnection(config: ResolvedAgentConfig): AgentConnection {
  return createAgentConnection({ config })
}

function defaultCreateContextBuildConnection(config: ResolvedAgentConfig): AgentConnection {
  return createAgentConnection({ config, fileSystemAccess: "none" })
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
