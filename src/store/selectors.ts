/**
 * Narrow selectors over {@link AppState}.
 *
 * Each selector reads the smallest slice a view needs, so `subscribeSelector`
 * (and, in the UI layer, `useSyncExternalStore`) can skip a re-render whenever the
 * slice is unchanged under `Object.is`. Two properties make that work:
 *
 * - Primitive slices (a status, the focused id) compare by value.
 * - Reference slices (turns, plan, pending diffs, overlay slots) keep their identity
 *   across unrelated updates, because the reducer and the store share structure.
 *
 * Per-agent selectors are curried: `selectSessionStatus("codex")` builds the selector
 * once. React callers should memoize that call (`useMemo`) so the selector identity
 * is stable across renders.
 */

import { EFFORT_CATEGORY, MODEL_CATEGORY, needsAttention } from "../core/types.ts"
import {
  isTerminalDelegatedChildStatus,
  selectDelegatedChild as selectCoreDelegatedChild,
  selectDelegationAggregateStatus as selectCoreDelegationAggregateStatus,
  selectDelegationParent as selectCoreDelegationParent,
  selectOrderedDelegatedChildIds,
  selectOrderedDelegatedChildren,
} from "../core/orchestration.ts"
import type { StatuslinePreference } from "../core/statusline.ts"
import { attentionConversationIds } from "../core/workspace.ts"
import type { PromptHistoryState } from "../core/promptHistory.ts"
import {
  projectTranscript,
  type TranscriptProjection,
} from "../core/transcriptProjection.ts"
import type {
  ExploreDenialReason,
  ExplorePolicySnapshot,
} from "../core/explorePolicy.ts"
import type {
  AvailableCommand,
  ConfigOption,
  ClarificationCapability,
  ContextUsage,
  DefaultApplyResult,
  DelegatedChildSnapshot,
  DelegatedChildStatus,
  DelegationAggregateStatus,
  DelegationParent,
  DelegationState,
  PendingDiff,
  PlanEntry,
  PromptBlock,
  ProviderKind,
  SessionId,
  SessionState,
  SessionStatus,
  SteeringPhase,
  SteeringState,
  ShellState,
  ThemePreference,
  Turn,
  HandoffBundle,
  HarnessDeliveryNotice,
  ManagedWorktreeAvailability,
  ManagedWorktreeBinding,
  ManagedWorktreeReason,
  ConversationAvailability,
  TeardownState,
  WorkspaceConversation,
  WorkspaceState,
  WorkspaceNotice,
} from "../core/types.ts"
import type {
  AppState,
  ApprovalOverlay,
  ClarificationOverlay,
  DelegationOverlay,
  FocusedPane,
  HandoffPreviewOverlay,
  HandoffTargetOverlay,
  KeyboardCapability,
  ModelSelectOverlay,
  RestorationMode,
  SettingsOverlay,
  Selector,
  StatuslineOverlay,
  TabDialogOverlay,
  TranscriptWindowState,
} from "./appStore.ts"

/**
 * The needs-you predicate, re-exported from the core (ADR-006). It is the pure
 * domain function {@link needsAttention} defined beside {@link SessionStatus}; the
 * store surfaces it here so every attention reader - the overview, the notifier,
 * and {@link selectNextNeedy} below - reaches one definition.
 */
export { needsAttention }

const EMPTY_TURNS: Turn[] = []
const EMPTY_PLAN: PlanEntry[] = []
const EMPTY_COMMANDS: AvailableCommand[] = []
const EMPTY_PENDING_DIFFS: PendingDiff[] = []
const EMPTY_REFERENCED_FILES = new Map<string, "read" | "edited">()
const EMPTY_CONFIG_OPTIONS: ConfigOption[] = []
const EMPTY_PROMPT_HISTORY: PromptHistoryState = { entries: [], cursor: null }
const EMPTY_ACTIVE_TOOL_CALL_IDS: readonly string[] = []
const DEFAULT_TRANSCRIPT_WINDOW: TranscriptWindowState = Object.freeze({
  revealedTurnCount: 0,
  detachedFromLive: false,
  scrollTop: null,
})
const EMPTY_STEERING_STATUS: SteeringStatus = Object.freeze({
  phase: "idle",
  queueCount: 0,
  recoveryAvailable: false,
})
const UNKNOWN_CLARIFICATION_CAPABILITY: ClarificationCapability = {
  status: "unsupported",
  reason: "unknown_recipe",
}

/** Selector-owned text for delegated lifecycle presentation. */
export const DELEGATED_CHILD_STATUS_LABELS: Readonly<Record<DelegatedChildStatus, string>> = {
  starting: "Starting",
  running: "Running",
  needs_input: "Needs input",
  finished: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
}

/** Fixed, content-free operator copy for every closed V1 refusal category. */
export const EXPLORE_DENIAL_LABELS: Readonly<Record<ExploreDenialReason, string>> = Object.freeze({
  "unsupported-provider": "This provider is not verified for safe explore delegation.",
  "missing-attestation": "This runtime has no verified safe explore attestation.",
  "stale-attestation": "This runtime's safe explore attestation is out of date.",
  "parent-ineligible": "This conversation is not eligible to start an explore child.",
  "parent-closing": "This conversation is closing and cannot start an explore child.",
  "capacity-exhausted": "Safe explore child capacity is currently full.",
  "bridge-unavailable": "The scoped ask_user capability is unavailable for safe explore.",
  "startup-failed": "The safe explore child could not be started.",
})

export const EXPLORE_ROLE_LABEL = "Role: explore"
export const EXPLORE_RESTRICTION_SUMMARY =
  "Read-only filesystem · No shell · No external MCP or agent control · Scoped ask_user only · No recursion"

export interface ExploreAvailabilityPresentation {
  readonly kind: "available" | "unavailable"
  readonly roleLabel: typeof EXPLORE_ROLE_LABEL
  readonly restrictionSummary: typeof EXPLORE_RESTRICTION_SUMMARY
  readonly statusLabel: string
  readonly reason: ExploreDenialReason | null
}

const AVAILABLE_EXPLORE_PRESENTATION: ExploreAvailabilityPresentation = Object.freeze({
  kind: "available",
  roleLabel: EXPLORE_ROLE_LABEL,
  restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
  statusLabel: "Available: safety will be verified again when you confirm.",
  reason: null,
})
const DENIED_EXPLORE_PRESENTATIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(EXPLORE_DENIAL_LABELS).map(([reason, label]) => [
      reason,
      Object.freeze({
        kind: "unavailable" as const,
        roleLabel: EXPLORE_ROLE_LABEL,
        restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
        statusLabel: `Unavailable: ${label}`,
        reason: reason as ExploreDenialReason,
      }),
    ]),
  ) as Record<ExploreDenialReason, ExploreAvailabilityPresentation>,
)

/** Stable presentation for the controller's advisory result captured with the parent. */
export const selectExploreAvailabilityPresentation = (
  reason: ExploreDenialReason | null,
): Selector<ExploreAvailabilityPresentation> => {
  const presentation = reason === null
    ? AVAILABLE_EXPLORE_PRESENTATION
    : DENIED_EXPLORE_PRESENTATIONS[reason]
  return () => presentation
}

export interface ExplorePolicyPresentation {
  readonly role: "explore"
  readonly roleLabel: "explore"
  readonly compactLabel: "explore"
  readonly restrictionSummary: typeof EXPLORE_RESTRICTION_SUMMARY
  readonly attestationVersion: string
  readonly confirmed: ExplorePolicySnapshot["confirmed"]
}

const explorePolicyPresentationCache = new WeakMap<ExplorePolicySnapshot, ExplorePolicyPresentation>()

function explorePolicyPresentation(
  policy: ExplorePolicySnapshot | undefined,
  terminal: boolean,
): ExplorePolicyPresentation | null {
  if (policy?.role !== "explore" || terminal) return null
  const cached = explorePolicyPresentationCache.get(policy)
  if (cached) return cached
  const presentation: ExplorePolicyPresentation = Object.freeze({
    role: "explore",
    roleLabel: "explore",
    compactLabel: "explore",
    restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
    attestationVersion: policy.attestationVersion,
    confirmed: policy.confirmed,
  })
  explorePolicyPresentationCache.set(policy, presentation)
  return presentation
}

export interface DelegatedChildPresentation {
  readonly kind: "child"
  readonly parentId: SessionId
  readonly parentLabel: string
  readonly lineageLabel: string
  readonly status: DelegatedChildStatus
  readonly statusLabel: string
  readonly terminalTranscriptAvailable: boolean
  /** Accepted live policy facts for task 05 presentation consumers. */
  readonly explore: ExplorePolicyPresentation | null
}

export interface DelegationParentPresentation {
  readonly kind: "parent"
  readonly childCount: number
  readonly groupStatus: "active" | "settled"
  readonly groupLabel: "Group active" | "Group settled"
}

/** Render-ready delegation data; views never inspect raw ownership records. */
export type DelegationPresentation = DelegatedChildPresentation | DelegationParentPresentation

/** Explicit, non-color-only review text for every managed-worktree availability. */
export const MANAGED_WORKTREE_AVAILABILITY_LABELS: Readonly<
  Record<ManagedWorktreeAvailability, string>
> = Object.freeze({
  unverified: "Review status unverified",
  available: "Review available",
  unavailable: "Review unavailable",
  cleanup_refused: "Cleanup refused",
})

/** Bounded operator copy for controller-published managed-worktree reasons. */
export const MANAGED_WORKTREE_REASON_LABELS: Readonly<Record<ManagedWorktreeReason, string>> =
  Object.freeze({
    not_git_repository: "No Git repository was found",
    detached_head: "The source checkout has no attached branch",
    submodules_unsupported: "Repositories with submodules are not supported",
    root_conflict: "The managed workspace root is unavailable",
    collision: "The managed workspace identity is already in use",
    verification_failed: "Managed workspace verification failed",
    missing: "Managed workspace is missing",
    external: "Workspace provenance is outside Kitten management",
    dirty: "Managed workspace has uncommitted changes",
    unmerged: "Managed workspace branch is not merged",
    live_owned: "Managed workspace is still owned by a live child",
    not_managed: "Workspace is not managed by Kitten",
    git_failed: "Git could not complete the workspace operation",
  })

/** One selector-owned model shared by compact and detailed review consumers. */
export interface ManagedWorktreeReviewPresentation {
  readonly kind: "managed-worktree"
  readonly managed: true
  readonly managedLabel: "Managed worktree"
  readonly provenance: "kitten-managed"
  readonly provenanceLabel: "Kitten-managed workspace"
  readonly worktreePath: string
  readonly branch: string
  readonly baseBranch: string
  readonly baseSha: string
  readonly availability: ManagedWorktreeAvailability
  readonly availabilityLabel: string
  readonly reason: ManagedWorktreeReason | null
  readonly reasonLabel: string | null
}

const managedWorktreeReviewCache = new Map<string, ManagedWorktreeReviewPresentation>()

function managedWorktreeReviewPresentation(
  binding: ManagedWorktreeBinding | undefined,
): ManagedWorktreeReviewPresentation | null {
  if (!binding) return null
  const key = JSON.stringify([
    binding.worktreePath,
    binding.branch,
    binding.baseBranch,
    binding.baseSha,
    binding.availability,
    binding.reason ?? null,
  ])
  const cached = managedWorktreeReviewCache.get(key)
  if (cached) return cached
  const reason = binding.reason ?? null
  const presentation: ManagedWorktreeReviewPresentation = Object.freeze({
    kind: "managed-worktree",
    managed: true,
    managedLabel: "Managed worktree",
    provenance: "kitten-managed",
    provenanceLabel: "Kitten-managed workspace",
    worktreePath: binding.worktreePath,
    branch: binding.branch,
    baseBranch: binding.baseBranch,
    baseSha: binding.baseSha,
    availability: binding.availability,
    availabilityLabel: MANAGED_WORKTREE_AVAILABILITY_LABELS[binding.availability],
    reason,
    reasonLabel: reason === null ? null : MANAGED_WORKTREE_REASON_LABELS[reason],
  })
  managedWorktreeReviewCache.set(key, presentation)
  return presentation
}

/** One stable render-safe review projection, or `null` for an ordinary session. */
export const selectManagedWorktreeReview =
  (sessionId: SessionId): Selector<ManagedWorktreeReviewPresentation | null> =>
  (state) =>
    managedWorktreeReviewPresentation(state.sessions[sessionId]?.worktreeBinding)

export interface DelegatedParentCloseStatusSummary {
  readonly status: DelegatedChildStatus
  readonly label: string
  readonly count: number
}

export interface DelegatedParentCloseSummary {
  readonly activeChildCount: number
  readonly statuses: readonly DelegatedParentCloseStatusSummary[]
}

const delegationPresentationCache = new WeakMap<
  DelegationState,
  Map<string, DelegationPresentation | null>
>()
const delegatedParentCloseSummaryCache = new WeakMap<
  DelegationState,
  Map<SessionId, DelegatedParentCloseSummary | null>
>()

/** The active conversation, retained while the shell owns keyboard focus. */
export const selectFocusedSessionId: Selector<SessionId | null> = (state) =>
  state.workspace.selectedVisibleId

/** The complete ephemeral delegation projection for controller/store integration. */
export const selectDelegationState: Selector<DelegationState> = (state) => state.delegation

/** One stable parent ownership record, or `null` when the session owns no children. */
export const selectDelegationParent =
  (parentId: SessionId): Selector<DelegationParent | null> =>
  (state) =>
    selectCoreDelegationParent(state.delegation, parentId) ?? null

/** One stable child lifecycle snapshot, or `null` for an ordinary/removed session. */
export const selectDelegatedChild =
  (childId: SessionId): Selector<DelegatedChildSnapshot | null> =>
  (state) =>
    selectCoreDelegatedChild(state.delegation, childId) ?? null

/** Stable registration-order child ids owned by one parent. */
export const selectDelegatedChildIds =
  (parentId: SessionId): Selector<readonly SessionId[]> =>
  (state) =>
    selectOrderedDelegatedChildIds(state.delegation, parentId)

/** Allocation-free aggregate lifecycle for one parent group. */
export const selectDelegationGroupStatus =
  (parentId: SessionId): Selector<DelegationAggregateStatus | null> =>
  (state) =>
    selectCoreDelegationAggregateStatus(state.delegation, parentId)

/** Active child count and explicit lifecycle labels for one captured parent close. */
export const selectDelegatedParentCloseSummary =
  (parentId: SessionId): Selector<DelegatedParentCloseSummary | null> =>
  (state) => {
    let byParent = delegatedParentCloseSummaryCache.get(state.delegation)
    if (!byParent) {
      byParent = new Map()
      delegatedParentCloseSummaryCache.set(state.delegation, byParent)
    }
    if (byParent.has(parentId)) return byParent.get(parentId) ?? null

    const activeChildren = selectOrderedDelegatedChildren(state.delegation, parentId).filter(
      (child) => !isTerminalDelegatedChildStatus(child.status),
    )
    if (activeChildren.length === 0) {
      byParent.set(parentId, null)
      return null
    }

    const statuses = (["starting", "running", "needs_input"] as const).flatMap((status) => {
      const count = activeChildren.filter((child) => child.status === status).length
      return count > 0 ? [{ status, label: DELEGATED_CHILD_STATUS_LABELS[status], count }] : []
    })
    const summary: DelegatedParentCloseSummary = {
      activeChildCount: activeChildren.length,
      statuses,
    }
    byParent.set(parentId, summary)
    return summary
  }

/** One conversation's reactive connection standing, or `null` when it no longer exists. */
export const selectConversationAvailability =
  (sessionId: SessionId | null): Selector<ConversationAvailability | null> =>
  (state) =>
    (sessionId ? state.workspace.conversations[sessionId]?.availability : null) ?? null

/** Ephemeral empty-workspace action feedback. */
export const selectWorkspaceNotice: Selector<WorkspaceNotice | null> = (state) =>
  state.workspaceNotice

/** Renderer-confirmed keyboard capability used by conditional matching and help. */
export const selectKeyboardCapability: Selector<KeyboardCapability> = (state) =>
  state.keyboardCapability

/** The pane that currently owns keyboard input. */
export const selectFocusedPane: Selector<FocusedPane> = (state) => state.focusedPane

/** The semantic shell slice. */
export const selectShell: Selector<ShellState> = (state) => state.shell

/** Whether the persistent shell currently owns keyboard input. */
export const selectIsShellFocused: Selector<boolean> = (state) => state.focusedPane.kind === "shell"

/** The user-selected theme preference that drives the live cockpit palette. */
export const selectThemePreference: Selector<ThemePreference> = (state) => state.preferences.theme

/** The resolved saved statusline preference; `layout: null` retains the legacy footer. */
export const selectStatuslinePreference: Selector<StatuslinePreference> = (state) =>
  state.preferences.statusline

/** Whether the given session owns keyboard focus. For the status strip's focus marker. */
export const selectIsFocused =
  (sessionId: SessionId): Selector<boolean> =>
  (state) =>
    state.focusedPane.kind === "agent" && state.focusedPane.sessionId === sessionId

/** One session's full state. Changes on every event for that session. */
export const selectSessionState =
  (sessionId: SessionId): Selector<SessionState> =>
  (state) =>
    state.sessions[sessionId]!

/** The focused session's full state. Changes when focus moves or that session updates. */
export const selectFocusedSession: Selector<SessionState | null> = (state) => {
  const sessionId = state.workspace.selectedVisibleId
  return sessionId ? (state.sessions[sessionId] ?? null) : null
}

/** Fixed policy inputs supplied by the resolved experiment configuration. */
export interface TranscriptProjectionOptions {
  readonly enabled: boolean
  readonly tailTurnCount: number
}

/** One session's ephemeral transcript presentation state. */
export const selectSessionTranscriptWindow =
  (sessionId: SessionId | null): Selector<TranscriptWindowState> =>
  (state) =>
    (sessionId ? state.transcriptWindows[sessionId] : undefined) ?? DEFAULT_TRANSCRIPT_WINDOW

/** The selected session's ephemeral transcript presentation state. */
export const selectFocusedTranscriptWindow: Selector<TranscriptWindowState> = (state) => {
  const sessionId = state.workspace.selectedVisibleId
  return (sessionId ? state.transcriptWindows[sessionId] : undefined) ?? DEFAULT_TRANSCRIPT_WINDOW
}

/**
 * Memoized projection for one addressed session. Unrelated sessions, focus changes,
 * and overlays without a matching approval tool preserve the result reference.
 */
export const selectSessionTranscriptProjection = (
  sessionId: SessionId | null,
  options: TranscriptProjectionOptions,
): Selector<TranscriptProjection> =>
  createTranscriptProjectionSelector(() => sessionId, options)

/**
 * Memoized projection for the selected conversation. A background stream leaves
 * every selected-session input unchanged, so focused subscribers remain silent.
 */
export const selectFocusedTranscriptProjection = (
  options: TranscriptProjectionOptions,
): Selector<TranscriptProjection> =>
  createTranscriptProjectionSelector((state) => state.workspace.selectedVisibleId, options)

function createTranscriptProjectionSelector(
  resolveSessionId: (state: AppState) => SessionId | null,
  options: TranscriptProjectionOptions,
): Selector<TranscriptProjection> {
  let previousTurns: readonly Turn[] | undefined
  let previousStatus: SessionStatus | undefined
  let previousRevealedTurnCount: number | undefined
  let previousApprovalToolCallId: string | null | undefined
  let previousProjection: TranscriptProjection | undefined

  return (state) => {
    const sessionId = resolveSessionId(state)
    const session = sessionId ? state.sessions[sessionId] : undefined
    const turns = session?.turns ?? EMPTY_TURNS
    const transcriptWindow = sessionId
      ? (state.transcriptWindows[sessionId] ?? DEFAULT_TRANSCRIPT_WINDOW)
      : DEFAULT_TRANSCRIPT_WINDOW
    const approval = state.overlays.approval
    const status = options.enabled ? (session?.status ?? "idle") : "idle"
    const revealedTurnCount = options.enabled ? transcriptWindow.revealedTurnCount : 0
    const approvalToolCallId = options.enabled && approval?.sessionId === sessionId
      ? approval.request.toolCall.toolCallId
      : null

    if (
      previousProjection &&
      previousTurns === turns &&
      previousStatus === status &&
      previousRevealedTurnCount === revealedTurnCount &&
      previousApprovalToolCallId === approvalToolCallId
    ) {
      return previousProjection
    }

    previousTurns = turns
    previousStatus = status
    previousRevealedTurnCount = revealedTurnCount
    previousApprovalToolCallId = approvalToolCallId
    previousProjection = projectTranscript({
      turns,
      enabled: options.enabled,
      revealedTurnCount,
      protection: {
        tailTurnCount: options.tailTurnCount,
        activeStreamingMessageId: status === "working" ? streamingTailMessageId(turns) : null,
        activeToolCallIds: EMPTY_ACTIVE_TOOL_CALL_IDS,
        approvalToolCallId,
      },
    })
    return previousProjection
  }
}

function streamingTailMessageId(turns: readonly Turn[]): string | null {
  const tail = turns[turns.length - 1]
  return tail?.kind === "agent" ? tail.messageId : null
}

/** One session's lifecycle status. The status strip subscribes to this per session. */
export const selectSessionStatus =
  (sessionId: SessionId | null): Selector<SessionStatus> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.status : undefined) ?? "idle"

/** Content-free composer status for one session's reducer-owned steering lifecycle. */
export interface SteeringStatus {
  readonly phase: SteeringPhase
  readonly queueCount: number
  readonly recoveryAvailable: boolean
}

/** Focused recovery data copied once by the composer before acknowledgement. */
export interface SteeringRecovery {
  readonly requestId: string
  readonly blocks: readonly PromptBlock[]
}

const steeringStatusCache = new WeakMap<SteeringState, SteeringStatus>()
const steeringRecoveryCache = new WeakMap<SteeringState, SteeringRecovery>()

function steeringStatus(state: SteeringState | undefined): SteeringStatus {
  const current = state?.queue[0]
  if (!state || (!current && state.recovery === null)) return EMPTY_STEERING_STATUS
  const cached = steeringStatusCache.get(state)
  if (cached) return cached
  const status: SteeringStatus = Object.freeze({
    phase: current?.phase ?? "idle",
    queueCount: state.queue.length,
    recoveryAvailable: state.recovery !== null,
  })
  steeringStatusCache.set(state, status)
  return status
}

function steeringRecovery(state: SteeringState | undefined): SteeringRecovery | null {
  const current = state?.queue[0]
  if (!state || !current || state.recovery === null) return null
  const cached = steeringRecoveryCache.get(state)
  if (cached) return cached
  const recovery: SteeringRecovery = Object.freeze({
    requestId: current.id,
    blocks: state.recovery,
  })
  steeringRecoveryCache.set(state, recovery)
  return recovery
}

/** Stable compact steering projection; null and unknown sessions share the idle fallback. */
export const selectSessionSteeringStatus =
  (sessionId: SessionId | null): Selector<SteeringStatus> =>
  (state) =>
    steeringStatus(sessionId ? state.sessions[sessionId]?.steering : undefined)

/** One session's current steering phase, safely idle when it is absent. */
export const selectSessionSteeringPhase =
  (sessionId: SessionId | null): Selector<SteeringPhase> =>
  (state) =>
    steeringStatus(sessionId ? state.sessions[sessionId]?.steering : undefined).phase

/** Number of accepted steering requests still owned by one session's reducer state. */
export const selectSessionSteeringQueueCount =
  (sessionId: SessionId | null): Selector<number> =>
  (state) =>
    steeringStatus(sessionId ? state.sessions[sessionId]?.steering : undefined).queueCount

/** Whether the focused recovery path has one reducer-owned payload available to copy. */
export const selectSessionSteeringRecoveryAvailable =
  (sessionId: SessionId | null): Selector<boolean> =>
  (state) =>
    steeringStatus(sessionId ? state.sessions[sessionId]?.steering : undefined)
      .recoveryAvailable

/** Exact one-time recovery data for the focused composer; generic status stays content-free. */
export const selectSessionSteeringRecovery =
  (sessionId: SessionId | null): Selector<SteeringRecovery | null> =>
  (state) =>
    steeringRecovery(sessionId ? state.sessions[sessionId]?.steering : undefined)

/** One session's rounded remaining-context percentage, or `null` when unknown. */
export const selectSessionHeadroom =
  (sessionId: SessionId): Selector<number | null> =>
  (state) => {
    const usage = state.sessions[sessionId]?.usage
    if (!usage || usage.size <= 0) return null
    return Math.round(((usage.size - usage.used) / usage.size) * 100)
  }

/** One session's live-restore outcome, or `null` during a normal non-restored run. */
export const selectRestoration =
  (sessionId: SessionId | null): Selector<RestorationMode | null> =>
  (state) =>
    (sessionId ? state.restoration[sessionId] : null) ?? null

/** The persisted hand-off context for a restored run's unavailable pane. */
export const selectRestorationBundle: Selector<HandoffBundle | null> = (state) =>
  state.restorationBundle

/** One session's fixed unsafe-start recovery notice; healthy states return `null`. */
export const selectHarnessDeliveryNotice =
  (sessionId: SessionId | null): Selector<HarnessDeliveryNotice | null> =>
  (state) =>
    (sessionId ? state.harnessDeliveryNotices[sessionId] : null) ?? null

/** The selected conversation's fixed unsafe-start recovery notice. */
export const selectFocusedHarnessDeliveryNotice: Selector<HarnessDeliveryNotice | null> = (state) => {
  const sessionId = state.workspace.selectedVisibleId
  return sessionId ? (state.harnessDeliveryNotices[sessionId] ?? null) : null
}

/** One session's current git branch, or `null` when it has not been resolved. */
export const selectSessionBranch =
  (sessionId: SessionId): Selector<string | null> =>
  (state) =>
    state.sessions[sessionId]?.branch ?? null

/**
 * Reserved model slot for the `model-effort-selector` feature. It stays hidden
 * until that delegated feature owns and wires the backing session data.
 */
export const selectSessionModel =
  (_sessionId: SessionId): Selector<string | null> =>
  (_state) =>
    null

/**
 * Reserved context slot for the `agent-usage-gauge` feature. It stays hidden
 * until that delegated feature owns and wires the backing session data.
 */
export const selectSessionContext =
  (_sessionId: SessionId): Selector<ContextUsage | null> =>
  (_state) =>
    null

/** One session's transcript. The conversation view subscribes to this. */
export const selectSessionTurns =
  (sessionId: SessionId | null): Selector<Turn[]> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.turns : undefined) ?? EMPTY_TURNS

/** One session's composer history; unrelated session/store updates retain its reference. */
export const selectSessionPromptHistory =
  (sessionId: SessionId | null): Selector<PromptHistoryState> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.promptHistory : undefined) ?? EMPTY_PROMPT_HISTORY

/** One session's most recent plan. */
export const selectSessionPlan =
  (sessionId: SessionId | null): Selector<PlanEntry[]> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.plan : undefined) ?? EMPTY_PLAN

/**
 * One session's latest agent-advertised slash commands. The reducer replaces this
 * array only for a `commands` event, so its reference stays stable while the user
 * types in the command menu or another session streams.
 */
export const selectSessionCommands =
  (sessionId: SessionId | null): Selector<AvailableCommand[]> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.commands : undefined) ?? EMPTY_COMMANDS

/** One session's proposed-but-unapplied edit diffs. */
export const selectSessionPendingDiffs =
  (sessionId: SessionId | null): Selector<PendingDiff[]> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.pendingDiffs : undefined) ?? EMPTY_PENDING_DIFFS

/** One session's referenced files and the strongest access seen for each. */
export const selectSessionReferencedFiles =
  (sessionId: SessionId | null): Selector<Map<string, "read" | "edited">> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.referencedFiles : undefined) ?? EMPTY_REFERENCED_FILES

/**
 * One session's full advertised config-option set (ADR-003), returned unfiltered so
 * the reference stays stable across unrelated updates - the reducer replaces this
 * array only on a `config_options` event, so a subscriber wakes only on a real change.
 * The selector overlay applies {@link visibleConfigOptions} to the result and memoizes
 * it; keeping the raw slice here is what preserves referential stability.
 */
export const selectAgentConfigOptions =
  (sessionId: SessionId | null): Selector<ConfigOption[]> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.configOptions : undefined) ?? EMPTY_CONFIG_OPTIONS

/** One session's stored terminal provider-default result, without deriving display state. */
export const selectSessionDefaultApplyResult =
  (sessionId: SessionId | null): Selector<DefaultApplyResult | null> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.defaultApplyResult : null) ?? null

/**
 * One session's confirmed model, or `undefined` when the agent advertises no `model`
 * category. A primitive slice, so it compares by value and the status strip re-renders
 * only when the live model actually changes.
 */
export const selectAgentModel =
  (sessionId: SessionId | null): Selector<string | undefined> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.configOptions : undefined)?.find((option) => option.category === MODEL_CATEGORY)?.currentValue

/**
 * One session's confirmed reasoning effort, or `undefined` when the agent advertises no
 * `thought_level` category. A primitive slice like {@link selectAgentModel}.
 */
export const selectAgentEffort =
  (sessionId: SessionId | null): Selector<string | undefined> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.configOptions : undefined)?.find((option) => option.category === EFFORT_CATEGORY)?.currentValue

/** Every session id in display order. */
export const selectSessionOrder: Selector<SessionId[]> = (state) => state.workspace.order

/** One row of {@link selectSessionList}: a session's identity plus its live status. */
export interface SessionListItem {
  id: SessionId
  title: string
  /** Display label with deterministic duplicate-name disambiguation. */
  label: string
  providerKind: ProviderKind
  /** The session's own working directory (ADR-005). The overview card shows it. */
  cwd: string
  status: SessionStatus
  /** Whether this session's status is one the developer must act on (ADR-006). */
  needsAttention: boolean
  lifecycle: "visible" | "background"
  /** Whether this Visible conversation is the workspace selection. */
  selected: boolean
  /** Whether the current attention epoch has already been visited. */
  attentionSeen: boolean
  /** Cached lineage/lifecycle or parent-group presentation for delegated work. */
  delegation: DelegationPresentation | null
  /** Shared managed-worktree review facts, independent of live delegation ownership. */
  review: ManagedWorktreeReviewPresentation | null
}

/**
 * Cache one derived list per combination of the three immutable slices it reads.
 * Structural sharing keeps the result stable across unrelated commits, while a
 * session, workspace, or delegation change rebuilds the projection. Weak keys keep
 * concurrent stores isolated and allow superseded slices to be collected.
 */
const sessionListCache = new WeakMap<
  WorkspaceState,
  WeakMap<DelegationState, WeakMap<AppState["sessions"], SessionListItem[]>>
>()
const sessionListItemCache = new WeakMap<WorkspaceConversation, Map<string, SessionListItem>>()
const stableSessionLists = new WeakMap<SessionId[], SessionListItem[]>()
const projectionObjectIds = new WeakMap<object, number>()
let nextProjectionObjectId = 1

function projectionObjectKey(value: object | null): string {
  if (value === null) return "null"
  let id = projectionObjectIds.get(value)
  if (id === undefined) {
    id = nextProjectionObjectId++
    projectionObjectIds.set(value, id)
  }
  return String(id)
}

function delegationPresentationKey(presentation: DelegationPresentation | null): string {
  if (presentation === null) return "ordinary"
  if (presentation.kind === "parent") {
    return JSON.stringify([
      presentation.kind,
      presentation.childCount,
      presentation.groupStatus,
      presentation.groupLabel,
    ])
  }
  return JSON.stringify([
    presentation.kind,
    presentation.parentId,
    presentation.parentLabel,
    presentation.lineageLabel,
    presentation.status,
    presentation.statusLabel,
    presentation.terminalTranscriptAvailable,
    presentation.explore?.role ?? null,
    presentation.explore?.roleLabel ?? null,
    presentation.explore?.compactLabel ?? null,
    presentation.explore?.restrictionSummary ?? null,
    presentation.explore?.attestationVersion ?? null,
    presentation.explore?.confirmed.provider ?? null,
    presentation.explore?.confirmed.model ?? null,
    presentation.explore?.confirmed.effort ?? null,
  ])
}

function stableSessionList(state: AppState, next: SessionListItem[]): SessionListItem[] {
  const previous = stableSessionLists.get(state.workspace.order)
  if (
    previous &&
    previous.length === next.length &&
    previous.every((item, index) => item === next[index])
  ) {
    return previous
  }
  stableSessionLists.set(state.workspace.order, next)
  return next
}

function displayLabel(state: AppState, sessionId: SessionId): string {
  const conversation = state.workspace.conversations[sessionId]
  if (!conversation) return sessionId
  const duplicate = duplicatePosition(state, sessionId)
  return duplicate.count > 1
    ? `${conversation.displayName} (${duplicate.index})`
    : conversation.displayName
}

function delegationPresentation(
  state: AppState,
  sessionId: SessionId,
): DelegationPresentation | null {
  const child = selectCoreDelegatedChild(state.delegation, sessionId)
  const parent = selectCoreDelegationParent(state.delegation, sessionId)
  const parentLabel = child ? displayLabel(state, child.parentId) : ""
  const aggregateStatus = parent
    ? selectCoreDelegationAggregateStatus(state.delegation, sessionId)
    : null
  const groupStatus = aggregateStatus === "settled" ? "settled" : "active"
  const key = child
    ? `child\u0000${sessionId}\u0000${parentLabel}\u0000${child.status}`
    : parent && aggregateStatus
      ? `parent\u0000${sessionId}\u0000${parent.childIds.length}\u0000${groupStatus}`
      : `ordinary\u0000${sessionId}`
  let cache = delegationPresentationCache.get(state.delegation)
  if (!cache) {
    cache = new Map()
    delegationPresentationCache.set(state.delegation, cache)
  }
  if (cache.has(key)) return cache.get(key) ?? null

  const presentation: DelegationPresentation | null = child
    ? {
        kind: "child",
        parentId: child.parentId,
        parentLabel,
        lineageLabel: `Child of ${parentLabel}`,
        status: child.status,
        statusLabel: DELEGATED_CHILD_STATUS_LABELS[child.status],
        terminalTranscriptAvailable: child.terminal !== undefined,
        explore: explorePolicyPresentation(child.policy, child.terminal !== undefined),
      }
    : parent && aggregateStatus
      ? {
          kind: "parent",
          childCount: parent.childIds.length,
          groupStatus,
          groupLabel: groupStatus === "settled" ? "Group settled" : "Group active",
        }
      : null
  cache.set(key, presentation)
  return presentation
}

/**
 * Every session with its status, in display order (ADR-006). The `/sessions` overview
 * (task_05) reads this to draw its card list and mark which rows need you. It is
 * memoized by the immutable state slices it reads (see {@link sessionListCache}), so
 * unrelated commits retain the same array while relevant changes rebuild it.
 */
export const selectSessionList: Selector<SessionListItem[]> = (state) => {
  let byDelegation = sessionListCache.get(state.workspace)
  if (!byDelegation) {
    byDelegation = new WeakMap()
    sessionListCache.set(state.workspace, byDelegation)
  }
  let bySessions = byDelegation.get(state.delegation)
  if (!bySessions) {
    bySessions = new WeakMap()
    byDelegation.set(state.delegation, bySessions)
  }
  const cached = bySessions.get(state.sessions)
  if (cached) return cached
  const list = state.workspace.order.flatMap((id) => {
    const session = state.sessions[id]!
    const conversation = state.workspace.conversations[id]
    if (!session || !conversation) return []
    const duplicate = duplicatePosition(state, id)
    const label = duplicate.count > 1
      ? `${conversation.displayName} (${duplicate.index})`
      : conversation.displayName
    const delegation = delegationPresentation(state, id)
    const review = managedWorktreeReviewPresentation(session.worktreeBinding)
    const key = JSON.stringify([
      label,
      session.providerKind,
      session.cwd,
      session.status,
      conversation.lifecycle,
      state.workspace.selectedVisibleId === id,
      conversation.attention.seen,
      delegationPresentationKey(delegation),
      projectionObjectKey(review),
    ])
    let byKey = sessionListItemCache.get(conversation)
    if (!byKey) {
      byKey = new Map()
      sessionListItemCache.set(conversation, byKey)
    }
    const cachedItem = byKey.get(key)
    if (cachedItem) return [cachedItem]
    const item: SessionListItem = {
      id,
      title: conversation.displayName,
      label,
      providerKind: session.providerKind,
      cwd: session.cwd,
      status: session.status,
      needsAttention: needsAttention(session.status),
      lifecycle: conversation.lifecycle,
      selected: state.workspace.selectedVisibleId === id,
      attentionSeen: conversation.attention.seen,
      delegation,
      review,
    }
    byKey.set(key, item)
    return [item]
  })
  const stable = stableSessionList(state, list)
  bySessions.set(state.sessions, stable)
  return stable
}

/**
 * The rank a needs-you status carries when several sessions want attention at once
 * (ADR-006): a clarification blocks an agent and is answered first, then approval,
 * a crash, and a finished turn. Non-attention statuses never appear as candidates.
 */
const ATTENTION_RANK: Readonly<Record<SessionStatus, number>> = {
  awaiting_clarification: 0,
  awaiting_approval: 1,
  error: 2,
  finished: 3,
  working: Number.POSITIVE_INFINITY,
  idle: Number.POSITIVE_INFINITY,
}

/**
 * The next session that needs you after `afterSessionId`, or `null` when none does
 * (ADR-006). This is what the jump-to-next action (task_05) sets focus to.
 *
 * Candidates are every needs-you session except `afterSessionId` itself. They are
 * ranked first by status priority (`awaiting_clarification`, then approval, error,
 * and finished), then by distance walking the `order` array forward from the pivot
 * and wrapping around - so among equal-priority sessions the one just after the
 * pivot wins, and a lone needy session earlier in the order is still found by wrapping.
 */
export const selectNextNeedy =
  (afterSessionId: SessionId | null): Selector<SessionId | null> =>
  (state) => {
    const { order } = state.workspace
    const count = order.length
    if (count === 0) return null
    const pivot = afterSessionId === null ? -1 : order.indexOf(afterSessionId)

    // Walk the order forward from just after the pivot, wrapping around, so ties in
    // rank are broken by nearest-after-pivot (a strict `<` keeps the first, i.e. the
    // closest, of each rank). When the pivot is absent (-1) this starts at index 0
    // and visits every session once.
    let best: { id: SessionId; rank: number } | null = null
    for (let step = 1; step <= count; step++) {
      const id = order[(pivot + step) % count]!
      if (id === afterSessionId) continue
      const conversation = state.workspace.conversations[id]
      if (!conversation || conversation.attention.seen) continue
      const status = conversation.attention.status
      if (!needsAttention(status)) continue
      const rank = ATTENTION_RANK[status]
      if (best === null || rank < best.rank) best = { id, rank }
    }
    return best?.id ?? null
  }

/** The pending permission request, or `null` when the approval overlay is closed. */
export const selectApprovalOverlay: Selector<ApprovalOverlay | null> = (state) => state.overlays.approval

/** The active resolver-free clarification projection, or `null` while none is shown. */
export const selectClarificationOverlay: Selector<ClarificationOverlay | null> = (state) =>
  state.overlays.clarification

/** The focused parent captured for an explicit delegation launch. */
export const selectDelegationOverlay: Selector<DelegationOverlay | null> = (state) =>
  state.overlays.delegation

/** Whether clarification currently owns top modal priority. */
export const selectIsClarificationOpen: Selector<boolean> = (state) =>
  state.overlays.clarification !== null

/** One configured session's protocol-free structured-clarification capability. */
export const selectClarificationCapability =
  (sessionId: SessionId): Selector<ClarificationCapability> =>
  (state) =>
    state.clarificationCapabilities[sessionId] ?? UNKNOWN_CLARIFICATION_CAPABILITY

/**
 * Whether a permission request is awaiting the user. The shell reads this to stand
 * down its own key bindings, since the approval overlay is modal while it is open.
 */
export const selectIsApprovalOpen: Selector<boolean> = (state) => state.overlays.approval !== null

/** The hand-off bundle awaiting confirmation, or `null` when the preview is closed. */
export const selectHandoffPreview: Selector<HandoffPreviewOverlay | null> = (state) => state.overlays.handoffPreview

/**
 * The source session while the hand-off target picker is open (task_06), or `null`
 * when it is closed. The picker draws its candidate list from {@link selectSessionList}
 * filtered to the ready sessions other than this source.
 */
export const selectHandoffTarget: Selector<HandoffTargetOverlay | null> = (state) => state.overlays.handoffTarget

/**
 * Whether the `/sessions` overview is open (task_05). The overview is modal like
 * the other overlays, so it too is folded into {@link selectHasOpenOverlay} and stands
 * the shell's chords down while it is up.
 */
export const selectIsSessionsOpen: Selector<boolean> = (state) => state.overlays.sessions

/** Whether the resumable-session picker is open. */
export const selectSessionPicker: Selector<boolean> = (state) => state.overlays.sessionPicker

/**
 * The session whose model/effort selector is open (ADR-004), or `null` when the
 * selector is closed. The overlay reads this to know which session to drive and
 * {@link selectAgentConfigOptions} to draw its list.
 */
export const selectModelSelectOverlay: Selector<ModelSelectOverlay | null> = (state) => state.overlays.modelSelect

/** The active settings tab, or `null` while the settings modal is closed. */
export const selectSettingsOverlay: Selector<SettingsOverlay | null> = (state) => state.overlays.settings

/** The transient `/statusline` flow, or `null` while its modal is closed. */
export const selectStatuslineOverlay: Selector<StatuslineOverlay | null> = (state) =>
  state.overlays.statusline

/** The captured-target rename/close dialog, below approval in modal precedence. */
export const selectTabDialogOverlay: Selector<TabDialogOverlay | null> = (state) =>
  state.overlays.tabDialog

export type ActiveModal =
  | { kind: "clarification"; sessionId: SessionId; requestId: string }
  | { kind: "approval"; sessionId: SessionId }
  | { kind: "delegation"; sessionId: SessionId }
  | { kind: "tab-dialog"; sessionId: SessionId }
  | { kind: "sessions" }
  | { kind: "session-picker" }
  | { kind: "model-select"; sessionId: SessionId }
  | { kind: "settings" }
  | { kind: "handoff-target"; sessionId: SessionId }
  | { kind: "statusline"; sessionId: SessionId }
  | null

/** Explicit modal precedence; approval identity always wins over a captured tab target. */
export const selectActiveModal: Selector<ActiveModal> = (state) => {
  const overlays = state.overlays
  if (overlays.clarification) {
    return {
      kind: "clarification",
      sessionId: overlays.clarification.sessionId,
      requestId: overlays.clarification.requestId,
    }
  }
  if (overlays.approval) return { kind: "approval", sessionId: overlays.approval.sessionId }
  if (overlays.delegation) return { kind: "delegation", sessionId: overlays.delegation.parentId }
  if (overlays.tabDialog) return { kind: "tab-dialog", sessionId: overlays.tabDialog.sessionId }
  if (overlays.sessions) return { kind: "sessions" }
  if (overlays.sessionPicker) return { kind: "session-picker" }
  if (overlays.modelSelect) return { kind: "model-select", sessionId: overlays.modelSelect.sessionId }
  if (overlays.settings) return { kind: "settings" }
  if (overlays.handoffTarget) return { kind: "handoff-target", sessionId: overlays.handoffTarget.sourceSessionId }
  if (overlays.statusline) return { kind: "statusline", sessionId: overlays.statusline.sessionId }
  return null
}

/** Whether any overlay is open, for views that dim or disable the cockpit beneath. */
export const selectHasOpenOverlay: Selector<boolean> = (state) =>
  state.overlays.clarification !== null ||
  state.overlays.approval !== null ||
  state.overlays.delegation !== null ||
  state.overlays.handoffPreview !== null ||
  state.overlays.handoffTarget !== null ||
  state.overlays.modelSelect !== null ||
  state.overlays.settings !== null ||
  state.overlays.statusline !== null ||
  state.overlays.tabDialog !== null ||
  state.overlays.sessions ||
  state.overlays.sessionPicker

/** Render-ready workspace row shared by visible tabs, background work, and attention. */
export interface WorkspaceConversationView {
  id: SessionId
  displayName: string
  label: string
  lifecycle: "visible" | "background"
  providerKind: ProviderKind
  cwd: string
  status: SessionStatus
  selected: boolean
  needsAttention: boolean
  attentionSeen: boolean
  availability: ConversationAvailability
  teardownState: TeardownState
  duplicateIndex: number
  duplicateCount: number
  sharedWorkspaceCount: number
  /** Cached lineage/lifecycle or parent-group presentation for delegated work. */
  delegation: DelegationPresentation | null
  /** The same cached managed-worktree review object exposed by session-list rows. */
  review: ManagedWorktreeReviewPresentation | null
}

export interface SharedWorkspaceCue {
  cwd: string
  count: number
  sessionIds: SessionId[]
}

interface WorkspaceListCache {
  visible?: WorkspaceConversationView[]
  background?: WorkspaceConversationView[]
  attention?: WorkspaceConversationView[]
  duplicateLabels?: Readonly<Record<SessionId, string>>
  shared?: SharedWorkspaceCue[]
}

const workspaceListCache = new WeakMap<
  WorkspaceState,
  WeakMap<DelegationState, WorkspaceListCache>
>()
const stableWorkspaceLists = new WeakMap<
  SessionId[],
  Pick<WorkspaceListCache, "visible" | "background" | "attention">
>()
const conversationViewCache = new WeakMap<
  WorkspaceConversation,
  Map<string, WorkspaceConversationView>
>()

function duplicatePosition(state: AppState, sessionId: SessionId): { index: number; count: number } {
  const conversation = state.workspace.conversations[sessionId]!
  const matching = state.workspace.order.filter(
    (id) => state.workspace.conversations[id]?.displayName === conversation.displayName,
  )
  return { index: matching.indexOf(sessionId) + 1, count: matching.length }
}

function sharedWorkspaceCount(state: AppState, cwd: string): number {
  return state.workspace.order.reduce(
    (count, id) => count + (state.sessions[id]?.cwd === cwd ? 1 : 0),
    0,
  )
}

function workspaceConversationView(
  state: AppState,
  sessionId: SessionId,
): WorkspaceConversationView | null {
  const conversation = state.workspace.conversations[sessionId]
  const session = state.sessions[sessionId]
  if (!conversation || !session) return null
  const duplicate = duplicatePosition(state, sessionId)
  const sharedCount = sharedWorkspaceCount(state, session.cwd)
  const selected = state.workspace.selectedVisibleId === sessionId
  const delegation = delegationPresentation(state, sessionId)
  const review = managedWorktreeReviewPresentation(session.worktreeBinding)
  const key = [
    session.providerKind,
    session.cwd,
    session.status,
    selected,
    duplicate.index,
    duplicate.count,
    sharedCount,
    delegationPresentationKey(delegation),
    projectionObjectKey(review),
  ].join("\u0000")
  let byKey = conversationViewCache.get(conversation)
  if (!byKey) {
    byKey = new Map()
    conversationViewCache.set(conversation, byKey)
  }
  const cached = byKey.get(key)
  if (cached) return cached
  const view: WorkspaceConversationView = {
    id: sessionId,
    displayName: conversation.displayName,
    label:
      duplicate.count > 1
        ? `${conversation.displayName} (${duplicate.index})`
        : conversation.displayName,
    lifecycle: conversation.lifecycle,
    providerKind: session.providerKind,
    cwd: session.cwd,
    status: session.status,
    selected,
    needsAttention: needsAttention(conversation.attention.status),
    attentionSeen: conversation.attention.seen,
    availability: conversation.availability,
    teardownState: conversation.teardownState,
    duplicateIndex: duplicate.index,
    duplicateCount: duplicate.count,
    sharedWorkspaceCount: sharedCount,
    delegation,
    review,
  }
  byKey.set(key, view)
  return view
}

function stableList(
  state: AppState,
  slot: "visible" | "background" | "attention",
  next: WorkspaceConversationView[],
): WorkspaceConversationView[] {
  let cache = stableWorkspaceLists.get(state.workspace.order)
  if (!cache) {
    cache = {}
    stableWorkspaceLists.set(state.workspace.order, cache)
  }
  const previous = cache[slot]
  if (
    previous &&
    previous.length === next.length &&
    previous.every((item, index) => item === next[index])
  ) {
    return previous
  }
  cache[slot] = next
  return next
}

function workspaceCache(state: AppState): WorkspaceListCache {
  let byDelegation = workspaceListCache.get(state.workspace)
  if (!byDelegation) {
    byDelegation = new WeakMap()
    workspaceListCache.set(state.workspace, byDelegation)
  }
  let cache = byDelegation.get(state.delegation)
  if (!cache) {
    cache = {}
    byDelegation.set(state.delegation, cache)
  }
  return cache
}

export const selectVisibleTabs: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state,
    "visible",
    state.workspace.order.flatMap((id) => {
      if (state.workspace.conversations[id]?.lifecycle !== "visible") return []
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectBackgroundWork: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state,
    "background",
    state.workspace.order.flatMap((id) => {
      if (state.workspace.conversations[id]?.lifecycle !== "background") return []
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectAttentionQueue: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state,
    "attention",
    attentionConversationIds(state.workspace).flatMap((id) => {
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectNextAttention: Selector<SessionId | null> = (state) =>
  attentionConversationIds(state.workspace)[0] ?? null

export const selectDuplicateLabels: Selector<Readonly<Record<SessionId, string>>> = (state) => {
  const cache = workspaceCache(state)
  if (cache.duplicateLabels) return cache.duplicateLabels
  const labels: Record<SessionId, string> = {}
  for (const id of state.workspace.order) {
    const item = workspaceConversationView(state, id)
    if (item) labels[id] = item.label
  }
  cache.duplicateLabels = labels
  return labels
}

export const selectSharedWorkspaces: Selector<SharedWorkspaceCue[]> = (state) => {
  const cache = workspaceCache(state)
  if (cache.shared) return cache.shared
  const idsByCwd = new Map<string, SessionId[]>()
  for (const id of state.workspace.order) {
    const cwd = state.sessions[id]?.cwd
    if (!cwd) continue
    const ids = idsByCwd.get(cwd) ?? []
    ids.push(id)
    idsByCwd.set(cwd, ids)
  }
  cache.shared = [...idsByCwd.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([cwd, sessionIds]) => ({ cwd, count: sessionIds.length, sessionIds }))
  return cache.shared
}
