/**
 * The telemetry recorder: opt-in, content-free, local JSONL only.
 *
 * This is the honest instrumentation behind the PRD kill-or-scale gate (ADR-002). It
 * records the metric events from the TechSpec "Monitoring and Observability" section
 * and nothing else, under three hard constraints the PRD's privacy stance demands:
 *
 * - **Opt-in.** With telemetry disabled the recorder is a no-op that never even
 *   constructs a sink, so a run records nothing and touches no file. The gate is
 *   {@link createTelemetryRecorder}'s `enabled` flag, sourced from `AppConfig`.
 * - **Content-free.** A {@link TelemetryRecord} carries only an event type, a
 *   timestamp, an anonymous session reference, fixed identifiers/enums, and coarse
 *   numbers (buckets, durations). There is no text field, so no prompt or code can be
 *   stored even by accident - the guarantee is structural, not a matter of discipline.
 * - **Local only.** The default sink appends JSONL to a file on disk with the Node
 *   fs API. There is no network path anywhere in this module.
 *
 * First-response timing, the re-explanation heuristic, and the attention metrics
 * (attention latency and idle-fleet, task_09) are derived by
 * {@link TelemetryRecorder.watch}, which subscribes to store transitions and diffs the
 * per-agent turn stream and status/focus edges; the hand-off events, the focus-switch
 * counters, and the max-concurrent snapshot come from callers driving this recorder
 * directly. The re-explanation heuristic itself is the pure core predicate
 * (`../core/telemetryHeuristics.ts`); this module only feeds it and records its verdict.
 * `reexplanation_detected` also serves as the shell moat signal: analysis compares
 * hand-offs with and without a preceding `shell_snapshot_attached` event.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

import {
  EFFORT_CATEGORY,
  needsAttention,
  type ConfigOption,
  type ExploreCapacityScope,
  type ManagedWorktreeReason,
  type ProviderKind,
  type SessionId,
  type SessionStatus,
  type ThemePreference,
} from "../core/types.ts"
import {
  bucketChars,
  detectReexplanation,
  effortChangeKept,
  REEXPLANATION_CHAR_THRESHOLD,
  type EffortRetentionEvent,
} from "../core/telemetryHeuristics.ts"
import {
  isExploreDenialReason,
  type ExploreDenialReason,
} from "../core/explorePolicy.ts"
import type { AppStore, Unsubscribe } from "../store/appStore.ts"

/** The exact content-free debug record used to validate adapter usage emission. */
export interface UsageSeenRecord {
  evt: "usage_seen"
  provider: ProviderKind
  used: number
  size: number
}

/** Injectable output boundary for the usage-emission debug log. */
export interface UsageSeenSink {
  write(record: UsageSeenRecord): void
}

/** Inputs copied field-by-field into a usage-emission debug record. */
export type UsageSeenInput = Omit<UsageSeenRecord, "evt">

/**
 * Pure opt-in gate for usage-emission validation. Disabled is the default and does
 * not construct a record, matching the recorder's existing opt-in discipline.
 */
export function createUsageSeenRecord(input: UsageSeenInput, enabled = false): UsageSeenRecord | null {
  if (!enabled) return null
  return { evt: "usage_seen", provider: input.provider, used: input.used, size: input.size }
}

/** Emit one structured debug record when the pure opt-in gate allows it. */
export function logUsageSeen(input: UsageSeenInput, enabled = false, sink?: UsageSeenSink): void {
  const record = createUsageSeenRecord(input, enabled)
  if (record) sink?.write(record)
}

/** Every telemetry event Kitten records. Names match the TechSpec metric set. */
export type TelemetryEventType =
  | "handoff_invoked"
  | "handoff_sent"
  | "handoff_repeat"
  | "effort_linked_handoff"
  | "reexplanation_detected"
  | "bundle_edit_chars"
  | "model_switched"
  | "effort_switched"
  | "switch_confirmed"
  | "switch_unverified"
  | "provider_default_outcome"
  | "effort_change_kept"
  | "agent_ready"
  | "agent_unready"
  | "provider_readiness"
  | "first_response_ms"
  // The multi-session attention metrics (task_09). Each measures whether the fleet
  // stays productive; all are content-free (durations, counts, and session ids only).
  | "attention_latency_ms"
  | "idle_fleet_ms"
  | "focus_switch"
  | "overview_switch"
  | "max_concurrent_sessions"
  | "settings_opened"
  | "theme_set"
  | "config_write"
  | "config_write_error"
  | "shell_activated"
  | "shell_snapshot_attached"
  | "external_run"
  | "session_resumed"
  | "resume_pane_unavailable"
  | "resume_first_action"
  | "resume_picker_interactive_ms"
  | "resume_load_usable_ms"
  | "prompt_history_eligible"
  | "prompt_history_recalled"
  | "prompt_history_cleared"
  | "prompt_history_edited_resend"
  | "file_selector_opened"
  | "file_selector_discovery"
  | "file_selector_query_rendered"
  | "file_selector_selected"
  | "file_selector_corrected"
  | "clarification_capability_classified"
  | "clarification_presented"
  | "clarification_settled"
  | "clarification_preempted"
  | "clarification_resumed"
  | "clarification_session_loss_cancelled"
  | "tab_created"
  | "tab_selected"
  | "tab_backgrounded"
  | "tab_close_confirmed"
  | "tab_close_kept_open"
  | "tab_restore"
  | "tab_attention_seen"
  | "tab_switch_latency_ms"
  | "delegated_launch_requested"
  | "delegated_launch_succeeded"
  | "delegated_launch_failed"
  | "delegated_visible_running_ms"
  | "delegated_child_terminal"
  | "delegated_cascade_requested"
  | "delegated_cascade_completed"
  | "delegated_teardown_failed"
  | "explore_launch_eligible"
  | "explore_launch_denied"
  | "explore_capacity_denied"
  | "explore_start_failed"
  | "explore_terminal"
  | "managed_worktree_requested"
  | "managed_worktree_provisioned"
  | "managed_worktree_provision_failed"
  | "managed_worktree_reconciled"
  | "managed_worktree_cleanup_refused"
  | "managed_worktree_cleaned"
  | "agent_run_control"
  | "kitten_mcp_bridge_failure"
  | "steering_outcome"

/** Closed lifecycle values for structured-clarification telemetry. */
export type ClarificationCapabilityStatus = "supported" | "unsupported"
export type ClarificationCapabilityDiagnostic =
  | "verified_recipe"
  | "unknown_recipe"
  | "recipe_overridden"
  | "unverified_recipe"
export type ClarificationTerminalKind = "submitted" | "skipped" | "timed_out" | "cancelled"
export type ClarificationInteractionKind = "permission" | "clarification"
export type ClarificationSessionLossReason =
  | "connection_error"
  | "session_replaced"
  | "conversation_closed"
  | "controller_disposed"
export type ClarificationDurationBucket = "under_5s" | "5_to_30s" | "30_to_120s" | "over_120s"

/** The complete readiness taxonomy permitted in local telemetry. */
export type ProviderReadinessOutcome =
  | "ready"
  | "binary_missing"
  | "version_mismatch"
  | "uncertified_recipe"
  | "authentication_required"
  | "handshake_failed"

/** Content-free presentation metadata; request/session identities are never serialized. */
export interface ClarificationPresentedInput {
  requestId: string
  sessionId: SessionId
  capability: ClarificationCapabilityStatus
  focused: boolean
  hasSingle: boolean
  hasMulti: boolean
  hasText: boolean
  fieldCount: number
}

/** Closed discovery outcomes; no repository or query detail crosses this boundary. */
export type FileSelectorDiscoveryOutcome = "ready" | "unavailable"

/** Closed post-render states for the warm local-query latency metric. */
export type FileSelectorRenderState = "results" | "empty" | "unavailable"

/** The two entry points whose adoption the resume metrics compare. */
export type ResumeMode = "picker" | "last-run"

/** Whole-cockpit live fidelity is deliberately capped to the V1 two-pane contract. */
export type ResumeLiveCount = 0 | 1 | 2

/** The content-free outcome emitted when one whole-cockpit restore settles. */
export interface SessionResumedInput {
  mode: ResumeMode
  liveCount: ResumeLiveCount
}

/** Closed, content-free dimensions for Session Tabs product telemetry. */
export type TabCreationSource = "inherited" | "default"
export type TabSelectionSource = "mouse" | "kitty_chord" | "sessions_fallback" | "attention_jump" | "model_select"
export type TabCloseOutcome = "cancel" | "idle_close"
export type TabRestoreCountBucket = "zero" | "one" | "two_to_four" | "five_or_more"
export type TabSwitchLatencyBucket = "under_200ms" | "200_to_499ms" | "500_to_999ms" | "1s_or_more"
export type TabAttentionStatus = "awaiting_approval" | "error" | "finished"
export type TabLifecycle = "visible" | "background"
export type ProviderDefaultOutcome = "none" | "applied" | "partial" | "unavailable"
export type DelegatedTerminalStatus = "finished" | "failed" | "cancelled"
export type ExplorePolicyVersion = "explore-v1"
export type ExploreStartupFailureCategory =
  | "bridge-unavailable"
  | "session-start-failed"
  | "prompt-dispatch-failed"
export type ExploreTerminalStatus = DelegatedTerminalStatus
/** Closed dimensions for one settled route-authorized agent control operation. */
export type AgentRunOperation = "start" | "poll"
export type AgentRunOutcome = "accepted" | "rejected" | "unavailable"
export type AgentRunBatchSizeBucket = "zero" | "one" | "two" | "three_to_four" | "five_or_more"
export type AgentRunDurationBucket =
  | "under_100ms"
  | "100_to_499ms"
  | "500_to_1999ms"
  | "2s_or_more"
/** Closed bridge outcome categories; no transport reason or identity crosses this boundary. */
export type McpBridgeFailureCategory = "capacity_limited" | "unavailable" | "invalid_request"

/** Closed, content-free dimensions for one steering lifecycle observation. */
export type SteeringTelemetryOutcome =
  | "queued"
  | "delivered"
  | "recovered"
  | "timeout"
  | "unavailable"
export type SteeringCapabilityClass = "native" | "fallback" | "unavailable"
export type SteeringDurationBucket = "under_5s" | "5_to_30s" | "30_to_120s" | "over_120s"

/** The exact steering record written locally; lifecycle identity never crosses this boundary. */
export interface SteeringOutcomeRecord {
  readonly type: "steering_outcome"
  readonly at: number
  readonly sessionRef: string
  readonly outcome: SteeringTelemetryOutcome
  readonly capabilityClass: SteeringCapabilityClass
  readonly durationBucket: SteeringDurationBucket
}

export interface AgentRunTelemetryInput {
  readonly operation: AgentRunOperation
  readonly outcome: AgentRunOutcome
  readonly batchSizeBucket: AgentRunBatchSizeBucket
  readonly durationBucket: AgentRunDurationBucket
}

export interface ExploreLaunchEligibleInput {
  readonly policyVersion: ExplorePolicyVersion
  readonly provider: ProviderKind
  readonly count: 1
}

export interface ExploreLaunchDeniedInput {
  readonly denialReason: ExploreDenialReason
  readonly count: 1
}

export interface ExploreCapacityDeniedInput {
  readonly capacityScope: ExploreCapacityScope
  readonly count: 1
}

export interface ExploreStartFailedInput {
  readonly failureCategory: ExploreStartupFailureCategory
  readonly count: 1
}

export interface ExploreTerminalInput {
  readonly terminalStatus: ExploreTerminalStatus
  readonly count: 1
}

/** Exact restore facts accepted by the recorder before it reduces them to buckets. */
export interface TabRestoreInput {
  visibleCount: number
  backgroundCount: number
  unavailableCount: number
}

/**
 * One recorded event. Deliberately holds no text: an anonymous `sessionRef`, an
 * optional fixed identifiers/enums (session, theme, source), and coarse numbers only.
 * This is what makes the recorder content-free by construction rather than by review.
 */
export interface TelemetryRecord {
  type: TelemetryEventType
  /** Epoch milliseconds the event was recorded, from the injected clock. */
  at: number
  /** An anonymous reference to this app run - never an ACP session id or path. */
  sessionRef: string
  /** Which session the event concerns, when relevant. A Kitten session id, not user content. */
  agent?: SessionId
  /** A coarse character bucket (see `bucketChars`), never an exact count. */
  charBucket?: number
  /** A measured duration in milliseconds, for timing events. */
  durationMs?: number
  /** A count of sessions, for `max_concurrent_sessions`. A small integer, never content. */
  count?: number
  /** A validated, fixed theme preference for `theme_set`, never user-provided text. */
  themeId?: ThemePreference
  /** The fixed origin of a settings config write, never a user-provided label. */
  source?: "modal"
  /** Which fixed resume entry point was used. */
  mode?: ResumeMode
  /** How many of the two resume panes restored live. */
  liveCount?: ResumeLiveCount
  /** Whether the first post-resume prompt continued instead of re-explaining. */
  continued?: boolean
  /** Fixed file-discovery outcome; never a source error, path, or query. */
  outcome?: FileSelectorDiscoveryOutcome | AgentRunOutcome | SteeringTelemetryOutcome
  /** Fixed warm-query render state; never a candidate count or candidate content. */
  state?: FileSelectorRenderState
  /** Recorder-owned ordinal for one session in this run; never a Kitten/ACP session id. */
  agentRef?: number
  /** Closed structured-clarification capability state. */
  capability?: ClarificationCapabilityStatus
  /** Closed capability reason; never an adapter package, version, command, or recipe. */
  diagnostic?: ClarificationCapabilityDiagnostic
  /** Whether the requesting session was focused when its dialog was first projected. */
  focused?: boolean
  /** Terminal clarification result without selected values or text. */
  terminalKind?: ClarificationTerminalKind
  /** Non-exclusive form-shape flags; mixed forms may set several to true. */
  hasSingle?: boolean
  hasMulti?: boolean
  hasText?: boolean
  /** Coarse latency bucket; exact durations are not recorded. */
  durationBucket?: ClarificationDurationBucket | AgentRunDurationBucket | SteeringDurationBucket
  /** The closed kind of interaction suspended or resumed by clarification priority. */
  interactionKind?: ClarificationInteractionKind
  /** The closed lifecycle reason for terminal cancellation on session loss. */
  lossReason?: ClarificationSessionLossReason
  /** Provider classification is safe only as Kitten's closed provider enum. */
  provider?: ProviderKind
  /** Fixed readiness result; never a command, version, profile, path, or error string. */
  readinessOutcome?: ProviderReadinessOutcome
  /** Closed Session Tabs dimensions; none can contain user or adapter content. */
  creationSource?: TabCreationSource
  selectionSource?: TabSelectionSource
  tabCloseOutcome?: TabCloseOutcome
  visibleCountBucket?: TabRestoreCountBucket
  backgroundCountBucket?: TabRestoreCountBucket
  unavailableCountBucket?: TabRestoreCountBucket
  switchLatencyBucket?: TabSwitchLatencyBucket
  attentionStatus?: TabAttentionStatus
  /** The bounded terminal provider-default category; no requested values are recorded. */
  defaultOutcome?: ProviderDefaultOutcome
  lifecycle?: TabLifecycle
  /** Closed delegated terminal state; never a task, outcome, identity, or provider error. */
  delegatedStatus?: DelegatedTerminalStatus
  /** Fixed V1 policy contract label; never an attestation payload or runtime version. */
  policyVersion?: ExplorePolicyVersion
  /** Closed explore refusal reason; never provider output or user content. */
  denialReason?: ExploreDenialReason
  /** Which atomic reservation limit refused admission. */
  capacityScope?: ExploreCapacityScope
  /** Closed accepted-launch failure category; never a raw error. */
  failureCategory?: ExploreStartupFailureCategory
  /** Closed current-generation explore terminal state. */
  terminalStatus?: ExploreTerminalStatus
  /** Bounded managed-worktree lifecycle category; never Git identity or raw output. */
  managedWorktreeReason?: ManagedWorktreeReason
  /** Fixed route-authorized control operation; no route or lifecycle identity is retained. */
  operation?: AgentRunOperation
  /** Bounded request cardinality; never a raw task or child list length. */
  batchSizeBucket?: AgentRunBatchSizeBucket
  /** Closed bridge failure category; never a route, call, transport reason, or error. */
  mcpBridgeFailureCategory?: McpBridgeFailureCategory
  /** Closed steering transport class; never an adapter recipe or configuration. */
  capabilityClass?: SteeringCapabilityClass
}

/** Where recorded events go. The default is a local JSONL file; tests inject memory. */
export interface TelemetrySink {
  write(record: TelemetryRecord): void
}

/** What the hand-off flow reports when it sends a curated bundle to the target. */
export interface HandoffSentInput {
  /** The session that received the bundle - the one to watch for re-explanation. */
  targetSessionId: SessionId
  /** How many characters the developer changed in the summary (see `editedCharCount`). */
  editChars: number
}

/** The recorder surface its callers drive. Every method is a no-op when disabled. */
export interface TelemetryRecorder {
  /** Whether telemetry is on. `false` means every method here does nothing. */
  readonly enabled: boolean
  /** A hand-off preview was opened over a source session. */
  handoffInvoked(): void
  /** A curated bundle was sent to the target; also records edit volume and repeats. */
  handoffSent(input: HandoffSentInput): void
  /** A hand-off carried one or more target model/effort changes. */
  effortLinkedHandoff(sessionId: SessionId): void
  /** The settings modal was opened. */
  settingsOpened(): void
  /** The integrated shell started its first command in this run. */
  shellActivated(): void
  /** A hand-off carried a developer-curated shell snapshot. */
  shellSnapshotAttached(): void
  /** The developer chose the in-cockpit affordance to run outside Kitten. */
  externalRun(): void
  /** A validated theme preference was applied. */
  themeSet(themeId: ThemePreference): void
  /** A modal-originated config write succeeded. */
  configWrite(source: "modal"): void
  /** A modal-originated config write failed. */
  configWriteError(source: "modal"): void
  /**
   * Record a model or effort switch from the adapter-reported outcome. `effortChanged`
   * arms the content-free kept-change watch only for a confirmed value change.
   */
  recordSwitch(sessionId: SessionId, kind: "model" | "effort", confirmed: boolean, effortChanged: boolean): void
  /** Record only the terminal category of one explicit provider-default attempt. */
  recordProviderDefaultOutcome(outcome: ProviderDefaultOutcome): void
  /** Count an accepted composer submission and emit eligibility exactly at the second. */
  promptHistorySubmitted(sessionId: SessionId): void
  /** Record a successful history selection. */
  promptHistoryRecalled(sessionId: SessionId): void
  /** Record leaving the newest recalled entry for a blank composer. */
  promptHistoryCleared(sessionId: SessionId): void
  /** Record submission of a changed recalled entry. */
  promptHistoryEditedResend(sessionId: SessionId): void
  /** A valid file-selector token opened for the addressed session. */
  fileSelectorOpened(sessionId: SessionId): void
  /** Repository discovery settled with a fixed outcome and caller-owned duration. */
  fileSelectorDiscovery(
    sessionId: SessionId,
    outcome: FileSelectorDiscoveryOutcome,
    durationMs: number,
  ): void
  /** A warm local query committed one fixed render state after the supplied duration. */
  fileSelectorQueryRendered(
    sessionId: SessionId,
    state: FileSelectorRenderState,
    durationMs: number,
  ): void
  /** One file reference was accepted after the supplied open-to-selection duration. */
  fileSelectorSelected(sessionId: SessionId, durationMs: number): void
  /** One pending accepted reference was edited through before submission. */
  fileSelectorCorrected(sessionId: SessionId): void
  /** A provider recipe was classified without recording any recipe identity. */
  clarificationCapabilityClassified(
    provider: ProviderKind,
    capability: ClarificationCapabilityStatus,
    diagnostic: ClarificationCapabilityDiagnostic,
  ): void
  /** A clarification dialog was first projected; starts its private latency clock. */
  clarificationPresented(input: ClarificationPresentedInput): void
  /** A projected clarification reached its first terminal outcome. */
  clarificationSettled(requestId: string, terminalKind: ClarificationTerminalKind): void
  /** Clarification priority suspended one active agent interaction. */
  clarificationPreempted(sessionId: SessionId, interactionKind: ClarificationInteractionKind): void
  /** A previously suspended agent interaction became active again. */
  clarificationResumed(sessionId: SessionId, interactionKind: ClarificationInteractionKind): void
  /** A clarification was terminally cancelled because its live session was lost. */
  clarificationCancelledOnSessionLoss(
    sessionId: SessionId,
    lossReason: ClarificationSessionLossReason,
  ): void
  /** A session completed its handshake and holds a live ACP session. */
  agentReady(sessionId: SessionId): void
  /** A session failed to come up. */
  agentUnready(sessionId: SessionId): void
  /** One provider lifecycle attempt settled with a fixed, content-free outcome. */
  providerReadiness(provider: ProviderKind, outcome: ProviderReadinessOutcome): void
  /**
   * A developer moved keyboard focus to `sessionId`. `viaOverview` marks a switch made
   * through `/sessions` (jump-into or jump-to-next) rather than a direct `/switch`
   * cycle - the numerator and denominator behind the overview-reliance metric (task_09).
   */
  focusSwitch(sessionId: SessionId, viaOverview: boolean): void
  /**
   * The peak number of concurrently-live sessions in this run - the multi-session
   * adoption signal (task_09). Recorded once from the boot readiness snapshot.
   */
  maxConcurrentSessions(count: number): void
  /** Start the load-to-usable clock immediately before restore orchestration. */
  resumeLoadStarted(): void
  /** Record a settled whole-cockpit resume and arm its first-action classification. */
  sessionResumed(input: SessionResumedInput): void
  /** Record one pane that could not restore live. */
  resumePaneUnavailable(sessionId: SessionId): void
  /** A fresh conversation was created from an inherited or default provider recipe. */
  tabCreated(provider: ProviderKind, source: TabCreationSource): void
  /** A user-directed selection was accepted; starts the private render-settle clock. */
  tabSelectionStarted(source: TabSelectionSource): void
  /** The selected workspace committed to the rendered tree; records only a bucket. */
  tabSelectionSettled(): void
  /** A visible conversation was deliberately kept running in the background. */
  tabBackgrounded(): void
  /** A close reached one of the two approved destructive outcomes. */
  tabCloseConfirmed(outcome: TabCloseOutcome): void
  /** The active-work close dialog resolved without changing lifecycle. */
  tabCloseKeptOpen(): void
  /** A restored workspace settled; exact counts are reduced before recording. */
  tabRestore(input: TabRestoreInput): void
  /** One approval/error/finished attention epoch was visited. */
  tabAttentionSeen(status: TabAttentionStatus, lifecycle: TabLifecycle): void
  /** Start private launch timing after one delegated registration is accepted. */
  delegatedLaunchRequested(lifecycleKey: string): void
  /** Settle one accepted launch and emit its visible-Running latency exactly once. */
  delegatedLaunchSucceeded(lifecycleKey: string): void
  /** Settle one accepted pre-Running launch failure exactly once. */
  delegatedLaunchFailed(lifecycleKey: string): void
  /** Emit one accepted terminal lifecycle outcome, deduplicated by private key. */
  delegatedChildTerminal(lifecycleKey: string, status: DelegatedTerminalStatus): void
  /** Emit the first accepted parent cascade request. */
  delegatedCascadeRequested(lifecycleKey: string): void
  /** Emit completion for a previously accepted cascade exactly once. */
  delegatedCascadeCompleted(lifecycleKey: string): void
  /** Emit one content-free teardown failure without serializing its cause. */
  delegatedTeardownFailed(lifecycleKey: string): void
  /** Record one accepted V1 eligibility fact after atomic registration succeeds. */
  exploreLaunchEligible(lifecycleKey: string, input: ExploreLaunchEligibleInput): void
  /** Record one pre-registration typed refusal. */
  exploreLaunchDenied(input: ExploreLaunchDeniedInput): void
  /** Record only an atomic capacity-admission refusal. */
  exploreCapacityDenied(input: ExploreCapacityDeniedInput): void
  /** Record one accepted launch's fixed startup-failure category. */
  exploreStartFailed(lifecycleKey: string, input: ExploreStartFailedInput): void
  /** Record one terminal state for the current private lifecycle key. */
  exploreTerminal(lifecycleKey: string, input: ExploreTerminalInput): void
  /** Start one private provisioning attempt after controller validation accepts it. */
  managedWorktreeRequested(attemptKey: string): void
  /** Settle one private provisioning attempt as controller-accepted success. */
  managedWorktreeProvisioned(attemptKey: string): void
  /** Settle one private provisioning attempt with a bounded failure category. */
  managedWorktreeProvisionFailed(attemptKey: string, reason: ManagedWorktreeReason): void
  /** Record one accepted restore reconciliation, optionally with its bounded unavailable reason. */
  managedWorktreeReconciled(reason?: ManagedWorktreeReason): void
  /** Record a service-accepted cleanup refusal with its bounded reason. */
  managedWorktreeCleanupRefused(reason: ManagedWorktreeReason): void
  /** Record a service-accepted clean removal. */
  managedWorktreeCleaned(): void
  /** Record one settled route-authorized control using only approved closed dimensions. */
  agentRunControl(input: AgentRunTelemetryInput): void
  /** Record one bridge failure using only its closed semantic category. */
  mcpBridgeFailure(category: McpBridgeFailureCategory): void
  /** Record one steering lifecycle outcome, deduplicated and timed by a private key. */
  steeringOutcome(
    lifecycleKey: string,
    outcome: SteeringTelemetryOutcome,
    capabilityClass: SteeringCapabilityClass,
  ): void
  /** Start the picker-open-to-interactive clock before opening its store slot. */
  resumePickerOpened(): void
  /** Close the picker clock after its interactive tree commits. */
  resumePickerInteractive(): void
  /**
   * Subscribe to store transitions to derive `first_response_ms`,
   * `reexplanation_detected`, `attention_latency_ms`, and `idle_fleet_ms`. Returns an
   * unsubscribe; a no-op when disabled.
   */
  watch(store: AppStore): Unsubscribe
}

/** Construction seams. Only `enabled` is required; the rest have real defaults. */
export interface TelemetryRecorderOptions {
  /** The opt-in gate, sourced from `AppConfig.telemetryEnabled`. */
  enabled: boolean
  /** Where events go. Defaults to a JSONL file sink at {@link resolveTelemetryPath}. */
  sink?: TelemetrySink
  /** The clock for `at`/durations. Defaults to `Date.now`. */
  now?: () => number
  /** The anonymous run reference. Defaults to a fresh random id. */
  sessionRef?: string
  /** Re-explanation length threshold. Defaults to the core heuristic's value. */
  reexplanationThreshold?: number
}

/** The single disabled instance: records nothing, opens no file, watches nothing. */
const NOOP_RECORDER: TelemetryRecorder = {
  enabled: false,
  handoffInvoked() {},
  handoffSent() {},
  effortLinkedHandoff() {},
  settingsOpened() {},
  shellActivated() {},
  shellSnapshotAttached() {},
  externalRun() {},
  themeSet() {},
  configWrite() {},
  configWriteError() {},
  recordSwitch() {},
  recordProviderDefaultOutcome() {},
  promptHistorySubmitted() {},
  promptHistoryRecalled() {},
  promptHistoryCleared() {},
  promptHistoryEditedResend() {},
  fileSelectorOpened() {},
  fileSelectorDiscovery() {},
  fileSelectorQueryRendered() {},
  fileSelectorSelected() {},
  fileSelectorCorrected() {},
  clarificationCapabilityClassified() {},
  clarificationPresented() {},
  clarificationSettled() {},
  clarificationPreempted() {},
  clarificationResumed() {},
  clarificationCancelledOnSessionLoss() {},
  agentReady() {},
  agentUnready() {},
  providerReadiness() {},
  focusSwitch() {},
  maxConcurrentSessions() {},
  resumeLoadStarted() {},
  sessionResumed() {},
  resumePaneUnavailable() {},
  tabCreated() {},
  tabSelectionStarted() {},
  tabSelectionSettled() {},
  tabBackgrounded() {},
  tabCloseConfirmed() {},
  tabCloseKeptOpen() {},
  tabRestore() {},
  tabAttentionSeen() {},
  delegatedLaunchRequested() {},
  delegatedLaunchSucceeded() {},
  delegatedLaunchFailed() {},
  delegatedChildTerminal() {},
  delegatedCascadeRequested() {},
  delegatedCascadeCompleted() {},
  delegatedTeardownFailed() {},
  exploreLaunchEligible() {},
  exploreLaunchDenied() {},
  exploreCapacityDenied() {},
  exploreStartFailed() {},
  exploreTerminal() {},
  managedWorktreeRequested() {},
  managedWorktreeProvisioned() {},
  managedWorktreeProvisionFailed() {},
  managedWorktreeReconciled() {},
  managedWorktreeCleanupRefused() {},
  managedWorktreeCleaned() {},
  agentRunControl() {},
  mcpBridgeFailure() {},
  steeringOutcome() {},
  resumePickerOpened() {},
  resumePickerInteractive() {},
  watch() {
    return () => {}
  },
}

/**
 * Build a telemetry recorder.
 *
 * Returns the shared no-op recorder when `enabled` is false - so a disabled run never
 * constructs a sink and never writes a byte - and a live recorder otherwise.
 */
export function createTelemetryRecorder(options: TelemetryRecorderOptions): TelemetryRecorder {
  if (!options.enabled) return NOOP_RECORDER
  return new ActiveRecorder(options)
}

/** Per-session bookkeeping for the store-derived metrics. */
interface AgentWatch {
  /**
   * The ACP session id last seen for this session. A change means the slice was reset
   * (a restart/reconnect), which resets every derived timer - a restart is not the
   * developer acting, so it must not emit a latency or count as a first response.
   */
  seenAcpSessionId: string
  /** How many turns of this session's transcript `watch` has already processed. */
  seenTurns: number
  /** Last observed confirmed effort value; transient only, never written to telemetry. */
  seenEffortValue: string | undefined
  /** A pending confirmed effort change, reduced to content-free event kinds. */
  effortRetention: EffortRetentionEvent[] | null
  /** When the pending prompt was sent, or `null` when no first response is awaited. */
  awaitingResponseAt: number | null
  /** True while the next developer message could count as re-explanation. */
  reexplanationArmed: boolean
  /**
   * When this session entered its current needs-you state, or `null` when it does not
   * need the developer. Attention latency is the gap from here to the state resolving.
   */
  neededSince: number | null
  /**
   * When this session started needing the developer while unfocused, or `null` when it
   * is not both needy and unfocused. Idle-fleet time accrues over this window.
   */
  idleFleetSince: number | null
  /** Last workspace attention epoch observed, used only to detect unseen -> seen. */
  seenAttentionSequence: number
  seenAttentionSeen: boolean
  attentionLifecycle: TabLifecycle
}

interface ClarificationWatch {
  startedAt: number
  agentRef: number
}

class ActiveRecorder implements TelemetryRecorder {
  readonly enabled = true
  private readonly sink: TelemetrySink
  private readonly now: () => number
  private readonly sessionRef: string
  private readonly threshold: number
  private handoffCount = 0
  private resumeLoadStartedAt: number | null = null
  private resumePickerOpenedAt: number | null = null
  private resumeFirstActionArmed = false
  private pendingTabSwitch: { source: TabSelectionSource; startedAt: number } | null = null
  private readonly promptSubmissionCounts = new Map<SessionId, number>()
  private readonly watches = new Map<SessionId, AgentWatch>()
  private readonly agentRefs = new Map<SessionId, number>()
  private readonly clarificationWatches = new Map<string, ClarificationWatch>()
  private readonly delegatedLaunchStarts = new Map<string, number>()
  private readonly delegatedLaunchSettled = new Set<string>()
  private readonly delegatedTerminals = new Set<string>()
  private readonly delegatedCascadeRequestedKeys = new Set<string>()
  private readonly delegatedCascadeCompletedKeys = new Set<string>()
  private readonly delegatedTeardownFailures = new Set<string>()
  private readonly exploreEligibleKeys = new Set<string>()
  private readonly exploreStartupFailureKeys = new Set<string>()
  private readonly exploreTerminalKeys = new Set<string>()
  private readonly managedWorktreeProvisionAttempts = new Set<string>()
  private readonly managedWorktreeProvisionSettled = new Set<string>()
  private readonly steeringLifecycleStarts = new Map<string, number>()
  private readonly steeringLifecycleOutcomes = new Set<string>()
  private nextAgentRef = 1

  constructor(options: TelemetryRecorderOptions) {
    this.sink = options.sink ?? createJsonlFileSink(resolveTelemetryPath())
    this.now = options.now ?? (() => Date.now())
    this.sessionRef = options.sessionRef ?? crypto.randomUUID()
    this.threshold = options.reexplanationThreshold ?? REEXPLANATION_CHAR_THRESHOLD
  }

  handoffInvoked(): void {
    this.record({ type: "handoff_invoked" })
  }

  handoffSent(input: HandoffSentInput): void {
    this.handoffCount += 1
    this.record({ type: "handoff_sent", agent: input.targetSessionId })
    // A repeat hand-off in one run is a distinct signal for the 7-day-repeat metric.
    if (this.handoffCount > 1) this.record({ type: "handoff_repeat", agent: input.targetSessionId })
    this.record({ type: "bundle_edit_chars", agent: input.targetSessionId, charBucket: bucketChars(input.editChars) })
    // Arm re-explanation detection on the target. This runs after the flow's own
    // `sendPrompt`, so the bundle's user turn is already consumed and only a
    // subsequent developer message can trip the heuristic.
    this.watchFor(input.targetSessionId).reexplanationArmed = true
  }

  effortLinkedHandoff(sessionId: SessionId): void {
    this.record({ type: "effort_linked_handoff", agent: sessionId })
  }

  settingsOpened(): void {
    this.record({ type: "settings_opened" })
  }

  shellActivated(): void {
    this.record({ type: "shell_activated" })
  }

  shellSnapshotAttached(): void {
    this.record({ type: "shell_snapshot_attached" })
  }

  externalRun(): void {
    this.record({ type: "external_run" })
  }

  themeSet(themeId: ThemePreference): void {
    this.record({ type: "theme_set", themeId })
  }

  configWrite(source: "modal"): void {
    this.record({ type: "config_write", source })
  }

  configWriteError(source: "modal"): void {
    this.record({ type: "config_write_error", source })
  }

  recordSwitch(sessionId: SessionId, kind: "model" | "effort", confirmed: boolean, effortChanged: boolean): void {
    this.record({ type: kind === "model" ? "model_switched" : "effort_switched", agent: sessionId })
    this.record({ type: confirmed ? "switch_confirmed" : "switch_unverified", agent: sessionId })
    // Only a confirmed, actual effort change can contribute to the kept-change metric.
    // The transient stream carries event kinds only, never the option's value.
    if (kind === "effort" && confirmed && effortChanged) {
      this.watchFor(sessionId).effortRetention = [{ kind: "effort_change" }]
    }
  }

  recordProviderDefaultOutcome(outcome: ProviderDefaultOutcome): void {
    this.record({ type: "provider_default_outcome", defaultOutcome: outcome })
  }

  promptHistorySubmitted(sessionId: SessionId): void {
    const count = (this.promptSubmissionCounts.get(sessionId) ?? 0) + 1
    this.promptSubmissionCounts.set(sessionId, count)
    if (count === 2) this.record({ type: "prompt_history_eligible", agent: sessionId })
  }

  promptHistoryRecalled(sessionId: SessionId): void {
    this.record({ type: "prompt_history_recalled", agent: sessionId })
  }

  promptHistoryCleared(sessionId: SessionId): void {
    this.record({ type: "prompt_history_cleared", agent: sessionId })
  }

  promptHistoryEditedResend(sessionId: SessionId): void {
    this.record({ type: "prompt_history_edited_resend", agent: sessionId })
  }

  fileSelectorOpened(sessionId: SessionId): void {
    this.record({ type: "file_selector_opened", agent: sessionId })
  }

  fileSelectorDiscovery(
    sessionId: SessionId,
    outcome: FileSelectorDiscoveryOutcome,
    durationMs: number,
  ): void {
    this.record({ type: "file_selector_discovery", agent: sessionId, outcome, durationMs })
  }

  fileSelectorQueryRendered(
    sessionId: SessionId,
    state: FileSelectorRenderState,
    durationMs: number,
  ): void {
    this.record({ type: "file_selector_query_rendered", agent: sessionId, state, durationMs })
  }

  fileSelectorSelected(sessionId: SessionId, durationMs: number): void {
    this.record({ type: "file_selector_selected", agent: sessionId, durationMs })
  }

  fileSelectorCorrected(sessionId: SessionId): void {
    this.record({ type: "file_selector_corrected", agent: sessionId })
  }

  clarificationCapabilityClassified(
    provider: ProviderKind,
    capability: ClarificationCapabilityStatus,
    diagnostic: ClarificationCapabilityDiagnostic,
  ): void {
    this.record({ type: "clarification_capability_classified", provider, capability, diagnostic })
  }

  clarificationPresented(input: ClarificationPresentedInput): void {
    if (this.clarificationWatches.has(input.requestId)) return
    const at = this.now()
    const watch: ClarificationWatch = {
      startedAt: at,
      agentRef: this.agentRef(input.sessionId),
    }
    this.clarificationWatches.set(input.requestId, watch)
    this.record({
      type: "clarification_presented",
      agentRef: watch.agentRef,
      capability: input.capability,
      focused: input.focused,
    }, at)
  }

  clarificationSettled(requestId: string, terminalKind: ClarificationTerminalKind): void {
    const watch = this.clarificationWatches.get(requestId)
    if (!watch) return
    this.clarificationWatches.delete(requestId)
    const at = this.now()
    this.record({
      type: "clarification_settled",
      terminalKind,
      durationBucket: bucketClarificationDuration(at - watch.startedAt),
    }, at)
  }

  clarificationPreempted(sessionId: SessionId, interactionKind: ClarificationInteractionKind): void {
    this.record({ type: "clarification_preempted", agentRef: this.agentRef(sessionId), interactionKind })
  }

  clarificationResumed(sessionId: SessionId, interactionKind: ClarificationInteractionKind): void {
    this.record({ type: "clarification_resumed", agentRef: this.agentRef(sessionId), interactionKind })
  }

  clarificationCancelledOnSessionLoss(
    sessionId: SessionId,
    lossReason: ClarificationSessionLossReason,
  ): void {
    this.record({
      type: "clarification_session_loss_cancelled",
      agentRef: this.agentRef(sessionId),
      lossReason,
    })
  }

  agentReady(sessionId: SessionId): void {
    this.record({ type: "agent_ready", agent: sessionId })
  }

  agentUnready(sessionId: SessionId): void {
    this.record({ type: "agent_unready", agent: sessionId })
  }

  providerReadiness(provider: ProviderKind, readinessOutcome: ProviderReadinessOutcome): void {
    this.record({ type: "provider_readiness", provider, readinessOutcome })
  }

  focusSwitch(sessionId: SessionId, viaOverview: boolean): void {
    // Every switch is the overview-reliance denominator; the ones made through the
    // overview are also the numerator, so their share measures how much the developer
    // leans on the overview instead of switching directly with `/switch`.
    this.record({ type: "focus_switch", agent: sessionId })
    if (viaOverview) this.record({ type: "overview_switch", agent: sessionId })
  }

  maxConcurrentSessions(count: number): void {
    this.record({ type: "max_concurrent_sessions", count })
  }

  resumeLoadStarted(): void {
    this.resumeLoadStartedAt = this.now()
  }

  sessionResumed(input: SessionResumedInput): void {
    this.record({ type: "session_resumed", mode: input.mode, liveCount: input.liveCount })
    if (this.resumeLoadStartedAt !== null) {
      this.record({ type: "resume_load_usable_ms", durationMs: this.now() - this.resumeLoadStartedAt })
      this.resumeLoadStartedAt = null
    }
    this.resumeFirstActionArmed = true
  }

  resumePaneUnavailable(sessionId: SessionId): void {
    this.record({ type: "resume_pane_unavailable", agent: sessionId })
  }

  tabCreated(provider: ProviderKind, creationSource: TabCreationSource): void {
    this.record({ type: "tab_created", provider, creationSource })
  }

  tabSelectionStarted(selectionSource: TabSelectionSource): void {
    const startedAt = this.now()
    this.record({ type: "tab_selected", selectionSource }, startedAt)
    this.pendingTabSwitch = { source: selectionSource, startedAt }
  }

  tabSelectionSettled(): void {
    const pending = this.pendingTabSwitch
    if (!pending) return
    this.pendingTabSwitch = null
    this.record({
      type: "tab_switch_latency_ms",
      selectionSource: pending.source,
      switchLatencyBucket: bucketTabSwitchLatency(this.now() - pending.startedAt),
    })
  }

  tabBackgrounded(): void {
    this.record({ type: "tab_backgrounded" })
  }

  tabCloseConfirmed(tabCloseOutcome: TabCloseOutcome): void {
    this.record({ type: "tab_close_confirmed", tabCloseOutcome })
  }

  tabCloseKeptOpen(): void {
    this.record({ type: "tab_close_kept_open" })
  }

  tabRestore(input: TabRestoreInput): void {
    this.record({
      type: "tab_restore",
      visibleCountBucket: bucketTabRestoreCount(input.visibleCount),
      backgroundCountBucket: bucketTabRestoreCount(input.backgroundCount),
      unavailableCountBucket: bucketTabRestoreCount(input.unavailableCount),
    })
  }

  tabAttentionSeen(attentionStatus: TabAttentionStatus, lifecycle: TabLifecycle): void {
    this.record({ type: "tab_attention_seen", attentionStatus, lifecycle })
  }

  delegatedLaunchRequested(lifecycleKey: string): void {
    if (this.delegatedLaunchStarts.has(lifecycleKey) || this.delegatedLaunchSettled.has(lifecycleKey)) return
    const at = this.now()
    this.delegatedLaunchStarts.set(lifecycleKey, at)
    this.record({ type: "delegated_launch_requested" }, at)
  }

  delegatedLaunchSucceeded(lifecycleKey: string): void {
    const startedAt = this.delegatedLaunchStarts.get(lifecycleKey)
    if (startedAt === undefined || this.delegatedLaunchSettled.has(lifecycleKey)) return
    this.delegatedLaunchSettled.add(lifecycleKey)
    this.delegatedLaunchStarts.delete(lifecycleKey)
    const at = this.now()
    this.record({ type: "delegated_launch_succeeded" }, at)
    this.record({ type: "delegated_visible_running_ms", durationMs: at - startedAt }, at)
  }

  delegatedLaunchFailed(lifecycleKey: string): void {
    if (!this.delegatedLaunchStarts.has(lifecycleKey) || this.delegatedLaunchSettled.has(lifecycleKey)) return
    this.delegatedLaunchSettled.add(lifecycleKey)
    this.delegatedLaunchStarts.delete(lifecycleKey)
    this.record({ type: "delegated_launch_failed" })
  }

  delegatedChildTerminal(lifecycleKey: string, delegatedStatus: DelegatedTerminalStatus): void {
    if (this.delegatedTerminals.has(lifecycleKey)) return
    this.delegatedTerminals.add(lifecycleKey)
    this.record({ type: "delegated_child_terminal", delegatedStatus })
  }

  delegatedCascadeRequested(lifecycleKey: string): void {
    if (this.delegatedCascadeRequestedKeys.has(lifecycleKey)) return
    this.delegatedCascadeRequestedKeys.add(lifecycleKey)
    this.record({ type: "delegated_cascade_requested" })
  }

  delegatedCascadeCompleted(lifecycleKey: string): void {
    if (
      !this.delegatedCascadeRequestedKeys.has(lifecycleKey) ||
      this.delegatedCascadeCompletedKeys.has(lifecycleKey)
    ) return
    this.delegatedCascadeCompletedKeys.add(lifecycleKey)
    this.record({ type: "delegated_cascade_completed" })
  }

  delegatedTeardownFailed(lifecycleKey: string): void {
    if (this.delegatedTeardownFailures.has(lifecycleKey)) return
    this.delegatedTeardownFailures.add(lifecycleKey)
    this.record({ type: "delegated_teardown_failed" })
  }

  exploreLaunchEligible(lifecycleKey: string, input: ExploreLaunchEligibleInput): void {
    if (
      this.exploreEligibleKeys.has(lifecycleKey) ||
      !hasExactKeys(input, ["policyVersion", "provider", "count"]) ||
      input.policyVersion !== "explore-v1" ||
      !isProviderKind(input.provider) ||
      input.count !== 1
    ) return
    this.exploreEligibleKeys.add(lifecycleKey)
    this.record({
      type: "explore_launch_eligible",
      policyVersion: input.policyVersion,
      provider: input.provider,
      count: input.count,
    })
  }

  exploreLaunchDenied(input: ExploreLaunchDeniedInput): void {
    if (
      !hasExactKeys(input, ["denialReason", "count"]) ||
      !isExploreDenialReason(input.denialReason) ||
      input.count !== 1
    ) return
    this.record({ type: "explore_launch_denied", ...input })
  }

  exploreCapacityDenied(input: ExploreCapacityDeniedInput): void {
    if (
      !hasExactKeys(input, ["capacityScope", "count"]) ||
      (input.capacityScope !== "per-parent" && input.capacityScope !== "global") ||
      input.count !== 1
    ) return
    this.record({ type: "explore_capacity_denied", ...input })
  }

  exploreStartFailed(lifecycleKey: string, input: ExploreStartFailedInput): void {
    if (
      this.exploreStartupFailureKeys.has(lifecycleKey) ||
      !hasExactKeys(input, ["failureCategory", "count"]) ||
      !isExploreStartupFailureCategory(input.failureCategory) ||
      input.count !== 1
    ) return
    this.exploreStartupFailureKeys.add(lifecycleKey)
    this.record({ type: "explore_start_failed", ...input })
  }

  exploreTerminal(lifecycleKey: string, input: ExploreTerminalInput): void {
    if (
      this.exploreTerminalKeys.has(lifecycleKey) ||
      !hasExactKeys(input, ["terminalStatus", "count"]) ||
      !isExploreTerminalStatus(input.terminalStatus) ||
      input.count !== 1
    ) return
    this.exploreTerminalKeys.add(lifecycleKey)
    this.record({ type: "explore_terminal", ...input })
  }

  managedWorktreeRequested(attemptKey: string): void {
    if (
      this.managedWorktreeProvisionAttempts.has(attemptKey) ||
      this.managedWorktreeProvisionSettled.has(attemptKey)
    ) return
    this.managedWorktreeProvisionAttempts.add(attemptKey)
    this.record({ type: "managed_worktree_requested" })
  }

  managedWorktreeProvisioned(attemptKey: string): void {
    if (
      !this.managedWorktreeProvisionAttempts.has(attemptKey) ||
      this.managedWorktreeProvisionSettled.has(attemptKey)
    ) return
    this.managedWorktreeProvisionAttempts.delete(attemptKey)
    this.managedWorktreeProvisionSettled.add(attemptKey)
    this.record({ type: "managed_worktree_provisioned" })
  }

  managedWorktreeProvisionFailed(attemptKey: string, reason: ManagedWorktreeReason): void {
    if (
      !this.managedWorktreeProvisionAttempts.has(attemptKey) ||
      this.managedWorktreeProvisionSettled.has(attemptKey) ||
      !isManagedWorktreeReason(reason)
    ) return
    this.managedWorktreeProvisionAttempts.delete(attemptKey)
    this.managedWorktreeProvisionSettled.add(attemptKey)
    this.record({ type: "managed_worktree_provision_failed", managedWorktreeReason: reason })
  }

  managedWorktreeReconciled(reason?: ManagedWorktreeReason): void {
    if (reason !== undefined && !isManagedWorktreeReason(reason)) return
    this.record({
      type: "managed_worktree_reconciled",
      ...(reason === undefined ? {} : { managedWorktreeReason: reason }),
    })
  }

  managedWorktreeCleanupRefused(reason: ManagedWorktreeReason): void {
    if (!isManagedWorktreeReason(reason)) return
    this.record({ type: "managed_worktree_cleanup_refused", managedWorktreeReason: reason })
  }

  managedWorktreeCleaned(): void {
    this.record({ type: "managed_worktree_cleaned" })
  }

  agentRunControl(input: AgentRunTelemetryInput): void {
    this.record({
      type: "agent_run_control",
      operation: input.operation,
      outcome: input.outcome,
      batchSizeBucket: input.batchSizeBucket,
      durationBucket: input.durationBucket,
    })
  }

  mcpBridgeFailure(category: McpBridgeFailureCategory): void {
    if (!isMcpBridgeFailureCategory(category)) return
    this.record({
      type: "kitten_mcp_bridge_failure",
      mcpBridgeFailureCategory: category,
    })
  }

  steeringOutcome(
    lifecycleKey: string,
    outcome: SteeringTelemetryOutcome,
    capabilityClass: SteeringCapabilityClass,
  ): void {
    if (!isSteeringTelemetryOutcome(outcome) || !isSteeringCapabilityClass(capabilityClass)) return

    const dedupeKey = `${lifecycleKey}\u0000${outcome}`
    if (this.steeringLifecycleOutcomes.has(dedupeKey)) return

    const at = this.now()
    const startedAt = this.steeringLifecycleStarts.get(lifecycleKey) ?? at
    this.steeringLifecycleStarts.set(lifecycleKey, startedAt)
    this.steeringLifecycleOutcomes.add(dedupeKey)
    this.record({
      type: "steering_outcome",
      outcome,
      capabilityClass,
      durationBucket: bucketSteeringDuration(at - startedAt),
    }, at)
  }

  resumePickerOpened(): void {
    this.resumePickerOpenedAt = this.now()
  }

  resumePickerInteractive(): void {
    if (this.resumePickerOpenedAt === null) return
    this.record({ type: "resume_picker_interactive_ms", durationMs: this.now() - this.resumePickerOpenedAt })
    this.resumePickerOpenedAt = null
  }

  watch(store: AppStore): Unsubscribe {
    // Prime the per-session state so pre-existing transcript is not replayed as new and
    // a session already needing the developer at subscribe time is still measured.
    const initial = store.getState()
    for (const sessionId of initial.workspace.order) {
      const session = initial.sessions[sessionId]!
      const conversation = initial.workspace.conversations[sessionId]!
      const watch = this.watchFor(sessionId)
      watch.seenAcpSessionId = session.acpSessionId
      watch.seenTurns = session.turns.length
      watch.seenEffortValue = effortValue(session.configOptions)
      const needy = needsAttention(session.status)
      watch.neededSince = needy ? this.now() : null
      watch.idleFleetSince = needy && initial.workspace.selectedVisibleId !== sessionId ? this.now() : null
      watch.seenAttentionSequence = conversation.attention.sequence
      watch.seenAttentionSeen = conversation.attention.seen
      watch.attentionLifecycle = conversation.lifecycle
    }
    return store.subscribe((state) => {
      for (const sessionId of state.workspace.order) {
        const session = state.sessions[sessionId]!
        const watch = this.watchFor(sessionId)
        // A rebound ACP session id means the slice was reset. Drop every stale timer and
        // arming silently and skip this commit: a restart is not the developer acting.
        if (session.acpSessionId !== watch.seenAcpSessionId) {
          watch.seenAcpSessionId = session.acpSessionId
          this.promptSubmissionCounts.delete(sessionId)
          watch.seenTurns = session.turns.length
          watch.seenEffortValue = effortValue(session.configOptions)
          watch.awaitingResponseAt = null
          watch.reexplanationArmed = false
          watch.effortRetention = null
          watch.neededSince = null
          watch.idleFleetSince = null
          continue
        }
        this.processEffortChange(sessionId, session.configOptions)
        this.processSession(sessionId, session.turns)
        this.processAttention(sessionId, session.status, state.workspace.selectedVisibleId === sessionId)
        this.processTabAttention(state.workspace.conversations[sessionId]!, watch)
      }
    })
  }

  /** Apply the turns newly appended to one session's transcript since the last pass. */
  private processSession(sessionId: SessionId, turns: readonly { kind: string; text?: string }[]): void {
    const watch = this.watchFor(sessionId)
    // A new session resets the transcript; drop stale timers/arming and resync. The
    // attention timers reset silently too: a restart is not the developer answering.
    if (turns.length < watch.seenTurns) {
      watch.seenTurns = turns.length
      watch.awaitingResponseAt = null
      watch.reexplanationArmed = false
      watch.effortRetention = null
      watch.neededSince = null
      watch.idleFleetSince = null
      return
    }
    for (let i = watch.seenTurns; i < turns.length; i++) this.handleTurn(sessionId, watch, turns[i]!)
    watch.seenTurns = turns.length
  }

  /**
   * Fold one session's current attention state into two durations (ADR-006):
   *
   * - **Attention latency** runs from the rising edge into a needs-you state to the
   *   falling edge out of it - the state resolves only when the developer acts, so the
   *   gap is how long they took to respond after the session started needing them.
   * - **Idle-fleet** runs only while the session is both needy and unfocused - the
   *   waiting time a session spends wanting the developer who is busy elsewhere.
   *
   * Both are emitted on the falling edge, carrying a duration and the session id only.
   */
  private processAttention(sessionId: SessionId, status: SessionStatus, isFocused: boolean): void {
    const watch = this.watchFor(sessionId)
    const needy = needsAttention(status)

    if (needy && watch.neededSince === null) watch.neededSince = this.now()
    else if (!needy && watch.neededSince !== null) {
      this.record({ type: "attention_latency_ms", agent: sessionId, durationMs: this.now() - watch.neededSince })
      watch.neededSince = null
    }

    const waiting = needy && !isFocused
    if (waiting && watch.idleFleetSince === null) watch.idleFleetSince = this.now()
    else if (!waiting && watch.idleFleetSince !== null) {
      this.record({ type: "idle_fleet_ms", agent: sessionId, durationMs: this.now() - watch.idleFleetSince })
      watch.idleFleetSince = null
    }
  }

  /** Emit only the approved attention visit edge, with no conversation identity. */
  private processTabAttention(
    conversation: {
      lifecycle: TabLifecycle
      attention: { status: SessionStatus; seen: boolean; sequence: number }
    },
    watch: AgentWatch,
  ): void {
    const attention = conversation.attention
    if (
      attention.sequence !== watch.seenAttentionSequence &&
      !attention.seen &&
      isTabAttentionStatus(attention.status)
    ) {
      watch.attentionLifecycle = conversation.lifecycle
    }
    if (
      attention.sequence === watch.seenAttentionSequence &&
      !watch.seenAttentionSeen &&
      attention.seen &&
      isTabAttentionStatus(attention.status)
    ) {
      this.tabAttentionSeen(attention.status, watch.attentionLifecycle)
    }
    watch.seenAttentionSequence = attention.sequence
    watch.seenAttentionSeen = attention.seen
  }

  private handleTurn(sessionId: SessionId, watch: AgentWatch, turn: { kind: string; text?: string }): void {
    if (turn.kind === "user") {
      this.resolveEffortRetention(sessionId, watch)
      if (this.resumeFirstActionArmed) {
        this.resumeFirstActionArmed = false
        const result = detectReexplanation(
          [{ kind: "developer_message", charCount: turn.text?.length ?? 0 }],
          this.threshold,
        )
        this.record({ type: "resume_first_action", continued: !result.detected })
      }
      // A prompt was sent: start the first-response clock for this session.
      watch.awaitingResponseAt = this.now()
      if (watch.reexplanationArmed) {
        // The developer's first message after the hand-off decides re-explanation.
        watch.reexplanationArmed = false
        const result = detectReexplanation([{ kind: "developer_message", charCount: turn.text?.length ?? 0 }], this.threshold)
        if (result.detected) this.record({ type: "reexplanation_detected", agent: sessionId, charBucket: result.charBucket })
      }
      return
    }
    // An agent message or tool call is the first response; a tool call also ends the
    // re-explanation window (the target started acting on the bundle).
    if (watch.awaitingResponseAt !== null) {
      this.record({ type: "first_response_ms", agent: sessionId, durationMs: this.now() - watch.awaitingResponseAt })
      watch.awaitingResponseAt = null
    }
    if (turn.kind === "tool_call") watch.reexplanationArmed = false
  }

  private watchFor(sessionId: SessionId): AgentWatch {
    let watch = this.watches.get(sessionId)
    if (!watch) {
      watch = {
        seenAcpSessionId: "",
        seenTurns: 0,
        seenEffortValue: undefined,
        effortRetention: null,
        awaitingResponseAt: null,
        reexplanationArmed: false,
        neededSince: null,
        idleFleetSince: null,
        seenAttentionSequence: 0,
        seenAttentionSeen: true,
        attentionLifecycle: "visible",
      }
      this.watches.set(sessionId, watch)
    }
    return watch
  }

  private agentRef(sessionId: SessionId): number {
    const existing = this.agentRefs.get(sessionId)
    if (existing !== undefined) return existing
    const created = this.nextAgentRef
    this.nextAgentRef += 1
    this.agentRefs.set(sessionId, created)
    return created
  }

  /** Stamp and write one event. The one place `at`/`sessionRef` are attached. */
  private record(event: Omit<TelemetryRecord, "at" | "sessionRef">, at = this.now()): void {
    this.sink.write({ ...event, at, sessionRef: this.sessionRef })
  }

  /** Compare one store snapshot's confirmed effort to the prior snapshot. */
  private processEffortChange(sessionId: SessionId, options: readonly ConfigOption[]): void {
    const watch = this.watchFor(sessionId)
    const current = effortValue(options)
    if (current === watch.seenEffortValue) return

    // A pending metric sees any subsequent effort change as the original choice not
    // surviving. Whether that new value is an exact revert is immaterial to retention.
    watch.effortRetention?.push({ kind: "effort_change" })
    watch.seenEffortValue = current
  }

  /** Close a pending effort-change window at the pane's next developer turn. */
  private resolveEffortRetention(sessionId: SessionId, watch: AgentWatch): void {
    const events = watch.effortRetention
    if (!events) return
    events.push({ kind: "next_turn" })
    if (effortChangeKept(events)) this.record({ type: "effort_change_kept", agent: sessionId })
    watch.effortRetention = null
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function isProviderKind(value: unknown): value is ProviderKind {
  return value === "claude-code" || value === "codex" || value === "cursor"
}

function isExploreStartupFailureCategory(value: unknown): value is ExploreStartupFailureCategory {
  return value === "bridge-unavailable" ||
    value === "session-start-failed" ||
    value === "prompt-dispatch-failed"
}

function isExploreTerminalStatus(value: unknown): value is ExploreTerminalStatus {
  return value === "finished" || value === "failed" || value === "cancelled"
}

function isManagedWorktreeReason(value: unknown): value is ManagedWorktreeReason {
  return value === "not_git_repository" ||
    value === "detached_head" ||
    value === "submodules_unsupported" ||
    value === "root_conflict" ||
    value === "collision" ||
    value === "verification_failed" ||
    value === "missing" ||
    value === "external" ||
    value === "dirty" ||
    value === "unmerged" ||
    value === "live_owned" ||
    value === "not_managed" ||
    value === "git_failed"
}

function bucketClarificationDuration(durationMs: number): ClarificationDurationBucket {
  if (durationMs < 5_000) return "under_5s"
  if (durationMs < 30_000) return "5_to_30s"
  if (durationMs < 120_000) return "30_to_120s"
  return "over_120s"
}

function isSteeringTelemetryOutcome(value: unknown): value is SteeringTelemetryOutcome {
  return value === "queued" ||
    value === "delivered" ||
    value === "recovered" ||
    value === "timeout" ||
    value === "unavailable"
}

function isMcpBridgeFailureCategory(value: unknown): value is McpBridgeFailureCategory {
  return value === "capacity_limited" || value === "unavailable" || value === "invalid_request"
}

function isSteeringCapabilityClass(value: unknown): value is SteeringCapabilityClass {
  return value === "native" || value === "fallback" || value === "unavailable"
}

/** Reduce exact steering latency before any value reaches the local sink. */
export function bucketSteeringDuration(durationMs: number): SteeringDurationBucket {
  const normalized = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  if (normalized < 5_000) return "under_5s"
  if (normalized < 30_000) return "5_to_30s"
  if (normalized < 120_000) return "30_to_120s"
  return "over_120s"
}

/** Reduce an agent-control request size before it crosses the recorder boundary. */
export function bucketAgentRunBatchSize(batchSize: number): AgentRunBatchSizeBucket {
  const normalized = Number.isFinite(batchSize) ? Math.max(0, Math.floor(batchSize)) : 0
  if (normalized === 0) return "zero"
  if (normalized === 1) return "one"
  if (normalized === 2) return "two"
  if (normalized <= 4) return "three_to_four"
  return "five_or_more"
}

/** Reduce controller-operation time; child execution time never enters this function. */
export function bucketAgentRunDuration(durationMs: number): AgentRunDurationBucket {
  const normalized = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  if (normalized < 100) return "under_100ms"
  if (normalized < 500) return "100_to_499ms"
  if (normalized < 2_000) return "500_to_1999ms"
  return "2s_or_more"
}

/** Reduce exact restore counts to the only cardinalities written to tab telemetry. */
export function bucketTabRestoreCount(count: number): TabRestoreCountBucket {
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  if (normalized === 0) return "zero"
  if (normalized === 1) return "one"
  if (normalized <= 4) return "two_to_four"
  return "five_or_more"
}

/** Keep the PRD's 200 ms success boundary explicit without writing exact timings. */
export function bucketTabSwitchLatency(durationMs: number): TabSwitchLatencyBucket {
  const normalized = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  if (normalized < 200) return "under_200ms"
  if (normalized < 500) return "200_to_499ms"
  if (normalized < 1_000) return "500_to_999ms"
  return "1s_or_more"
}

function isTabAttentionStatus(status: SessionStatus): status is TabAttentionStatus {
  return status === "awaiting_approval" || status === "error" || status === "finished"
}

/** Read an effort's current value from the generic, adapter-owned option surface. */
function effortValue(options: readonly ConfigOption[]): string | undefined {
  return options.find((option) => option.category === EFFORT_CATEGORY)?.currentValue
}

/**
 * Record each agent's readiness once at startup. The other event source
 * ({@link TelemetryRecorder.agentReady}) exists for later transitions; this covers
 * the boot snapshot from the controller's runtimes.
 */
export function recordReadiness(
  recorder: TelemetryRecorder,
  runtimes: readonly { sessionId: SessionId; ready: boolean }[],
): void {
  let live = 0
  for (const runtime of runtimes) {
    if (runtime.ready) {
      recorder.agentReady(runtime.sessionId)
      live += 1
    } else recorder.agentUnready(runtime.sessionId)
  }
  // The peak concurrently-live count for the run: how many sessions actually came up,
  // the multi-session adoption signal (task_09). One event per run from the boot snapshot.
  recorder.maxConcurrentSessions(live)
}

/** The environment variable that overrides the telemetry file location outright. */
export const TELEMETRY_PATH_ENV_VAR = "KITTEN_TELEMETRY_PATH"

/**
 * Where the JSONL log lives: an explicit `KITTEN_TELEMETRY_PATH` wins, else the XDG
 * state directory, else `~/.local/state/kitten/telemetry.jsonl`. State, not config:
 * this is generated data, kept out of the user's hand-edited config tree.
 */
export function resolveTelemetryPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[TELEMETRY_PATH_ENV_VAR]
  if (explicit) return explicit
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "kitten", "telemetry.jsonl")
}

/**
 * A sink that appends one JSON object per line to a local file. Creates the parent
 * directory once, when the sink is built, rather than on every append. Synchronous:
 * telemetry events are infrequent, and a blocking append is simpler and safer than
 * juggling an async write queue on exit.
 */
export function createJsonlFileSink(path: string): TelemetrySink {
  return createLocalJsonlSink<TelemetryRecord>(path)
}

/** Local JSONL sink for the exact usage-emission debug record shape. */
export function createUsageSeenJsonlFileSink(path: string): UsageSeenSink {
  return createLocalJsonlSink<UsageSeenRecord>(path)
}

function createLocalJsonlSink<T>(path: string): { write(record: T): void } {
  mkdirSync(dirname(path), { recursive: true })
  return {
    write(record: T): void {
      appendFileSync(path, `${JSON.stringify(record)}\n`)
    },
  }
}
