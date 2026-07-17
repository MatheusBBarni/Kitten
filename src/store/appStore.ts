/**
 * The reactive application store.
 *
 * Kitten keeps all mutable UI-facing state in one external store with targeted
 * subscriptions (ADR-004). React never owns this state: components read it through
 * narrow selectors (see `./selectors.ts`) and re-render only when the exact slice
 * they read changes. That is what keeps a streaming token from re-rendering the
 * whole transcript.
 *
 * The store sits above the pure core and below the UI (ADR-003):
 *
 * - It never writes a `SessionState` by hand. Every domain event is applied by the
 *   core `sessionReducer`, which stays the single writer of session state.
 * - It performs no batching. The Agent Adapter Layer already coalesces streamed
 *   message chunks to at most one `DomainSessionEvent` per frame, so `applyEvent`
 *   applies its event synchronously and notifies subscribers immediately.
 * - It imports no ACP wire type. `PermissionRequest` is the adapter's already
 *   translated, protocol-free view of a permission prompt, imported type-only.
 *
 * State is immutable throughout: every action produces a new `AppState` with
 * structural sharing, so an untouched agent's slice keeps its identity and its
 * subscribers stay silent.
 */

import type { PermissionRequest } from "../agent/agentConnection.ts"
import {
  applyBuilderMutation as applyBuilderContextPackMutation,
  applyOperatorMutation as applyOperatorContextPackMutation,
  createDraft,
  startFreshFromSealed,
} from "../core/contextPack.ts"
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import { createShellState, shellReducer } from "../core/shellReducer.ts"
import {
  createDelegationState,
  delegationReducer,
  registerDelegatedChild,
} from "../core/orchestration.ts"
import type { ExplorePolicySnapshot } from "../core/explorePolicy.ts"
import type {
  StatuslineLayout,
  StatuslinePreference,
  StatuslinePreset,
} from "../core/statusline.ts"
import { createWorkspaceState, workspaceReducer } from "../core/workspace.ts"
import {
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_KINDS,
  HARNESS_DELIVERY_FAILED_NOTICE,
  type ClarificationCapability,
  type ClarificationPayload,
  type ConfigOption,
  type DelegationState,
  type DomainSessionEvent,
  type ExploreCapacityScope,
  type HandoffBundle,
  type HarnessDeliveryNotice,
  type ManagedWorktreeBinding,
  type ProviderKind,
  type SessionId,
  type SessionSeed,
  type SessionState,
  type ShellEvent,
  type ShellState,
  type ThemePreference,
  type ConversationAvailability,
  type ContextBuildBinding,
  type ContextPackDraftResult,
  type ContextPackInstructions,
  type ContextPackMutation,
  type ContextPackMutationResult,
  type ContextPackReviewCandidate,
  type ContextPackState,
  type RevisionFencedContextPackMutation,
  type SealedContextPack,
  type TeardownState,
  type WorkspaceState,
  type WorkspaceEvent,
  type WorkspaceConversationSeed,
  type WorkspaceNotice,
} from "../core/types.ts"
import type { HarnessPromptVersion } from "../core/harnessPrompt.ts"

/** Every provider kind Kitten seeds a default session for, in cockpit order (ADR-001). */
export const AGENT_IDS: readonly ProviderKind[] = PROVIDER_KINDS

/** Releases a subscription. Calling it more than once is a no-op. */
export type Unsubscribe = () => void

/**
 * The approval overlay slot: one session's pending permission request, labeled with
 * the session it belongs to. `title` and `cwd` name the requesting session and its
 * working directory so a multi-session approval can never be answered for the wrong
 * agent (the labeling UI is task_07).
 */
export interface ApprovalOverlay {
  sessionId: SessionId
  title: string
  cwd: string
  request: PermissionRequest
}

/** Resolver-free view of the controller's currently active clarification request. */
export interface ClarificationOverlay {
  requestId: string
  generation: number
  sessionId: SessionId
  title: string
  cwd: string
  payload: ClarificationPayload
}

/** The hand-off preview slot: the bundle awaiting the user's curation and confirm. */
export interface HandoffPreviewOverlay {
  sourceSessionId: SessionId
  targetSessionId: SessionId
  bundle: HandoffBundle
  /** The target's allowlisted model/effort options when the preview opened. */
  targetConfigOptions: ConfigOption[]
}

/**
 * The hand-off target-picker slot: the source session while the developer chooses
 * which session receives the hand-off (task_06). It carries no target of its own -
 * the picker draws its candidate list from {@link SessionState} and readiness - and
 * exists only while there is a genuine choice to make (three or more ready sessions).
 * With a single possible recipient the flow skips this step and opens the preview
 * directly, keeping the two-agent hand-off one keystroke.
 */
export interface HandoffTargetOverlay {
  sourceSessionId: SessionId
}

/**
 * The model/effort selector slot: the session whose model and reasoning effort the
 * developer is choosing (ADR-004). It carries no options of its own - the overlay
 * draws its list from that session's {@link SessionState.configOptions} through
 * {@link visibleConfigOptions}, always rendering the agent-confirmed state - so the
 * slot need only name which session the picker is open for.
 */
export interface ModelSelectOverlay {
  sessionId: SessionId
}

/** The V1 settings modal state. Future categories add tabs here. */
export interface SettingsOverlay {
  tab: "theme"
}

/** Product-owned recovery layout names; no arbitrary preset data enters the store. */
export type StatuslinePresetName = StatuslinePreset["name"]

/**
 * One valid phase of the transient `/statusline` workflow. Request text, failure
 * details, preset choice, and preview data live only here; none are preferences.
 */
export type StatuslineModalPhase =
  | { readonly phase: "disclosure" }
  | { readonly phase: "request"; readonly requestText: string }
  | { readonly phase: "waiting"; readonly requestText: string }
  | {
      readonly phase: "preview"
      readonly requestText: string
      readonly layout: StatuslineLayout
      readonly preset: StatuslinePresetName | null
    }
  | { readonly phase: "failure"; readonly requestText: string; readonly reason: string }
  | {
      readonly phase: "presets"
      readonly requestText: string
      readonly reason: string
      readonly selectedPreset: StatuslinePresetName | null
    }

/** The selected session plus its current transient `/statusline` modal phase. */
export type StatuslineOverlay = StatuslineModalPhase & { readonly sessionId: SessionId }

/** Reactive user preferences that views can subscribe to independently of sessions. */
export interface Preferences {
  theme: ThemePreference
  statusline: StatuslinePreference
}

/** Ephemeral presentation state for one live session transcript. Never persisted. */
export interface TranscriptWindowState {
  readonly revealedTurnCount: number
  readonly detachedFromLive: boolean
  readonly scrollTop: number | null
}

/** One renderable workspace entry retained in a lazy directory snapshot. */
export interface ExplorerEntrySnapshot {
  readonly relativePath: string
  readonly name: string
  readonly kind: "directory" | "file" | "contained_link"
}

/** Closed failure vocabulary for a directory result; raw filesystem errors never enter the store. */
export type ExplorerUnavailableReason =
  | "workspace-unavailable"
  | "outside-workspace"
  | "not-found"
  | "not-directory"
  | "permission-denied"
  | "unsupported-entry"
  | "io-error"

/** Current result for one explicitly requested directory. */
export type ExplorerDirectorySnapshot =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly entries: readonly ExplorerEntrySnapshot[] }
  | { readonly kind: "unavailable"; readonly reason: ExplorerUnavailableReason }

/** Fixed, content-free feedback retained independently for each live session. */
export type ExplorerNotice =
  | { readonly code: "refresh-complete" }
  | { readonly code: "directory-unavailable" }
  | { readonly code: "system-default-dispatched" }
  | { readonly code: "custom-dispatched" }
  | { readonly code: "fallback-dispatched" }
  | { readonly code: "launch-failed" }

/** Current-run explorer position for one session workspace. Never persisted. */
export interface ExplorerPosition {
  readonly workspaceRoot: string
  readonly expandedPaths: readonly string[]
  readonly selectedPath: string | null
  readonly scrollTop: number
  readonly directories: Readonly<Record<string, ExplorerDirectorySnapshot>>
  readonly notice: ExplorerNotice | null
  readonly generation: number
}

/** Global reveal state plus structurally shared, session-addressed positions. */
export interface ExplorerState {
  readonly visible: boolean
  readonly positions: Partial<Record<SessionId, ExplorerPosition>>
}

/** Whether a restored session is promptable or only its saved context remains. */
export type RestorationMode = "live" | "unavailable"

/** Renderer-observed keyboard support. This state is deliberately never persisted. */
export type KeyboardCapability = "unknown" | "kittyConfirmed"

/** The pane that currently owns keyboard input (ADR-005). */
export type FocusedPane =
  | { kind: "agent"; sessionId: SessionId }
  | { kind: "explorer"; sessionId: SessionId }
  | { kind: "shell" }
  | { kind: "workspace" }

/** One captured-target tab dialog. Approval remains the higher-priority modal. */
export type TabDialogOverlay =
  | { kind: "rename"; sessionId: SessionId }
  | { kind: "close"; sessionId: SessionId }

/** The focused parent captured when the explicit delegation flow opens. */
export interface DelegationOverlay {
  parentId: SessionId
}

/**
 * The overlay slots. At most one overlay of each kind exists at a time; the UI
 * (tasks 11 and 12) decides how to stack them. `null` means "closed".
 *
 * `sessions` and `sessionPicker` are plain booleans rather than payload slots: each
 * overlay draws its data from a separate source, so its slot need only say whether
 * it is open.
 */
export interface OverlayState {
  approval: ApprovalOverlay | null
  clarification: ClarificationOverlay | null
  /** Captures only the parent identity; all launch drafts remain component-local. */
  delegation: DelegationOverlay | null
  handoffPreview: HandoffPreviewOverlay | null
  /** The hand-off target picker, open only while the developer is choosing a recipient. */
  handoffTarget: HandoffTargetOverlay | null
  /** The model/effort selector, open only while the developer is choosing a model or effort. */
  modelSelect: ModelSelectOverlay | null
  /** The settings modal, open on its active settings tab. */
  settings: SettingsOverlay | null
  /** The transient `/statusline` customization flow. */
  statusline: StatuslineOverlay | null
  tabDialog: TabDialogOverlay | null
  sessions: boolean
  /** The resumable-session picker carries no payload; it reads runs from the run store. */
  sessionPicker: boolean
}

/**
 * The whole application state.
 *
 * Sessions are keyed by their Kitten {@link SessionId}, with an explicit `order`
 * array fixing display order (ADR-004): a plain object plus an order array, not a
 * `Map`, so the store keeps its immutable structural-sharing and `Object.is`
 * selector-equality invariants. Two sessions may share a provider kind; each has a
 * distinct id. Per-session status lives in `sessions[id].status`, written by the
 * reducer, so the status strip and the transcript can never disagree. Read it with
 * the `selectSessionStatus` selector.
 */
export interface AppState {
  sessions: Record<SessionId, SessionState>
  /** Session-owned Context Pack custody. Review candidates and build bindings are live-only. */
  contextPacks: Readonly<Record<SessionId, ContextPackState>>
  /** Per-session live transcript presentation state; intentionally absent from run records. */
  transcriptWindows: Record<SessionId, TranscriptWindowState>
  /** Current-run explorer visibility and lazy per-session positions. */
  explorer: ExplorerState
  /** Protocol-free live delegation ownership; intentionally empty after restore. */
  delegation: DelegationState
  /** User-owned conversation metadata, order, lifecycle, selection, and attention acknowledgement. */
  workspace: WorkspaceState
  /** Ephemeral action feedback for valid empty-workspace states. */
  workspaceNotice: WorkspaceNotice | null
  /** Ephemeral terminal-input capability, promoted only by the renderer boundary. */
  keyboardCapability: KeyboardCapability
  focusedPane: FocusedPane
  shell: ShellState
  preferences: Preferences
  /** Protocol-free capability classification exposed per configured session. */
  clarificationCapabilities: Record<SessionId, ClarificationCapability>
  /** Content-free controller checkpoint projection consumed by persistence and recovery work. */
  harnessDeliveries: Partial<Record<SessionId, HarnessDeliveryCheckpointProjection>>
  /** Ephemeral fixed recovery projection; absent for every healthy delivery state. */
  harnessDeliveryNotices: Partial<Record<SessionId, HarnessDeliveryNotice>>
  overlays: OverlayState
  restoration: Record<SessionId, RestorationMode | null>
  /** The persisted hand-off context for the currently restored cockpit run. */
  restorationBundle: HandoffBundle | null
}

export interface HarnessDeliveryCheckpointProjection {
  readonly version: HarnessPromptVersion
  readonly generation: number
  readonly state: "not_required" | "pending" | "in_flight" | "delivered" | "failed"
  readonly failureCategory?: "unsupported_profile" | "harness_render_failed" | "dispatch_indeterminate"
}

/** Inputs required to atomically register one normal session as a delegated child. */
export interface DelegatedSessionRegistration {
  readonly seed: SessionSeed
  readonly parentId: SessionId
  readonly parentGeneration: number
  readonly childGeneration: number
  readonly task: string
  readonly desiredOutcome: string
  /** Accepted explore policy; task 03 makes this mandatory at the controller boundary. */
  readonly policy?: ExplorePolicySnapshot
  readonly displayName?: string
}

/** Synchronous result returned before any delegated runtime startup can begin. */
export type DelegatedSessionAdmissionResult =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "denied"
      readonly reason: "capacity-exhausted"
      readonly scope: ExploreCapacityScope
    }
  | { readonly kind: "rejected" }

export interface DelegatedChildIdentity {
  readonly parentId: SessionId
  readonly childId: SessionId
  readonly parentGeneration: number
  readonly childGeneration: number
}

/** One generation-fenced lifecycle projection paired with its normal session status. */
export type DelegatedChildStatePublication = DelegatedChildIdentity &
  (
    | { readonly status: "running"; readonly sessionStatus: "working" }
    | {
        readonly status: "needs_input"
        readonly sessionStatus: "awaiting_clarification" | "awaiting_approval"
      }
    | { readonly status: "finished"; readonly sessionStatus: "finished"; readonly at: number }
    | { readonly status: "failed"; readonly sessionStatus: "error"; readonly at: number }
    | { readonly status: "cancelled"; readonly sessionStatus: "idle"; readonly at: number }
  )

/** One explicit draft choice admitted together with its live Context Build binding. */
export type ContextBuildDraftPreparation =
  | {
      readonly kind: "start_fresh"
      readonly original: string
      readonly mode?: ContextPackInstructions["mode"]
      readonly discovered?: string
      readonly budgetLimit?: number
    }
  | { readonly kind: "refine" }

/** Generation identity supplied by the controller before any child I/O starts. */
export interface ContextBuildBindingIdentity {
  readonly parentId: SessionId
  readonly childId: SessionId
  readonly parentGeneration: number
  readonly childGeneration: number
}

/** Atomic prepare result; expected denials never escape as exceptions. */
export type ContextBuildPreparationResult =
  | {
      readonly kind: "prepared"
      readonly draft: NonNullable<ContextPackState["draft"]>
      readonly binding: ContextBuildBinding
    }
  | {
      readonly kind: "denied"
      readonly reason: "unknown_session" | "build_active" | "draft_unavailable" | "invalid_draft"
    }

/** A function projecting a narrow slice out of the state, for `subscribeSelector`. */
export type Selector<T> = (state: AppState) => T

/** The store's public surface: reads, subscriptions, and actions. */
export interface AppStore {
  /** The current state. Always a fresh object when anything changed. */
  getState(): AppState
  /** Subscribe to every state change. Prefer {@link subscribeSelector}. */
  subscribe(listener: (state: AppState, previous: AppState) => void): Unsubscribe
  /**
   * Subscribe to one narrow slice. The listener runs only when the selected value
   * changes under `isEqual` (default `Object.is`), so a token appended to agent A's
   * transcript never notifies a subscriber reading agent B's status.
   */
  subscribeSelector<T>(
    selector: Selector<T>,
    listener: (value: T, previous: T) => void,
    isEqual?: (a: T, b: T) => boolean,
  ): Unsubscribe

  /** Apply one already-coalesced domain event to that session's slice. */
  applyEvent(sessionId: SessionId, event: DomainSessionEvent): void
  /** Reveal an additional number of older turns for one live session. */
  revealTranscriptHistory(sessionId: SessionId, turnCount: number): void
  /** Record whether one session is being read away from its live tail. */
  setTranscriptDetached(sessionId: SessionId, detachedFromLive: boolean): void
  /** Capture or clear one session's renderer-owned scroll anchor. */
  captureTranscriptScrollTop(sessionId: SessionId, scrollTop: number | null): void
  /** Reattach one session to its live tail and clear its captured anchor. */
  returnTranscriptToLive(sessionId: SessionId): void
  /** Reveal and focus the selected session's explorer, or hide it and return to its composer. */
  toggleExplorer(sessionId: SessionId): void
  /** Replace one session's selected explorer row. */
  setExplorerSelection(sessionId: SessionId, relativePath: string | null): void
  /** Expand or collapse one session-owned directory without touching another session. */
  setExplorerExpanded(sessionId: SessionId, relativePath: string, expanded: boolean): void
  /** Capture one session's render-owned explorer scroll position. */
  setExplorerScrollTop(sessionId: SessionId, scrollTop: number): void
  /** Replace one session's fixed explorer feedback. */
  setExplorerNotice(sessionId: SessionId, notice: ExplorerNotice | null): void
  /**
   * Mark one directory request loading and return its captured generation. Refreshes
   * invalidate every prior request for the session and clear its lazy snapshots.
   */
  beginExplorerDirectoryRequest(
    sessionId: SessionId,
    workspaceRoot: string,
    relativePath: string,
    options?: { readonly refresh?: boolean },
  ): number | null
  /** Commit a ready/unavailable directory result only while its request fence is current. */
  commitExplorerDirectory(
    sessionId: SessionId,
    workspaceRoot: string,
    generation: number,
    relativePath: string,
    snapshot: Exclude<ExplorerDirectorySnapshot, { readonly kind: "loading" }>,
  ): boolean
  /** Clear one reducer-owned recovery payload after the composer has copied it. */
  acknowledgeSteeringRecovery(sessionId: SessionId, requestId: string): void
  /** Create and own a new addressed draft while retaining any current sealed pack. */
  createContextPackDraft(
    sessionId: SessionId,
    original: string,
    options?: {
      readonly mode?: ContextPackInstructions["mode"]
      readonly discovered?: string
      readonly budgetLimit?: number
    },
  ): ContextPackDraftResult | null
  /** Start a distinct addressed draft from the current immutable sealed value. */
  refineContextPackDraft(sessionId: SessionId): ContextPackDraftResult | null
  /** Apply one operator-authorized mutation to the addressed current draft. */
  applyContextPackOperatorMutation(
    sessionId: SessionId,
    mutation: ContextPackMutation,
  ): ContextPackMutationResult | null
  /** Apply one bridge-authorized, revision-fenced builder mutation. */
  applyContextPackBuilderMutation(
    sessionId: SessionId,
    mutation: RevisionFencedContextPackMutation,
  ): ContextPackMutationResult | null
  /** Publish one already-materialized exact review candidate for the current draft revision. */
  publishContextPackReview(
    sessionId: SessionId,
    candidate: ContextPackReviewCandidate,
  ): boolean
  /** Publish one core-validated sealed value for the exact current review candidate. */
  sealContextPack(sessionId: SessionId, sealed: SealedContextPack): boolean
  /** Bind one live Context Build to the addressed current draft. */
  bindContextBuild(sessionId: SessionId, binding: ContextBuildBinding): boolean
  /** Atomically create/refine the addressed draft and bind its exact revision before launch. */
  prepareContextBuild(
    sessionId: SessionId,
    preparation: ContextBuildDraftPreparation,
    identity: ContextBuildBindingIdentity,
  ): ContextBuildPreparationResult
  /** Release only the matching live Context Build generation. */
  releaseContextBuild(sessionId: SessionId, binding: ContextBuildBinding): boolean
  /** Release one matching build and publish only background attention for its terminal outcome. */
  settleContextBuild(
    sessionId: SessionId,
    binding: ContextBuildBinding,
    outcome: "ready_for_review" | "failed",
  ): boolean
  /** Apply one semantic shell event through the pure shell reducer. */
  applyShellEvent(event: ShellEvent): void
  /** Bind a session to a (new) ACP session id, resetting its transcript and status. */
  startSession(
    sessionId: SessionId,
    acpSessionId: string,
    options?: { preserveWorkspaceAttention?: boolean },
  ): void
  /** Atomically insert a normalized execution slice and its visible workspace entry. */
  addSession(seed: SessionSeed, options?: { displayName?: string; availability?: ConversationAvailability }): void
  /** Atomically insert and background a normal child session with delegation ownership. */
  addDelegatedSession(registration: DelegatedSessionRegistration): DelegatedSessionAdmissionResult
  /** Publish one accepted child lifecycle and its reducer-owned session status atomically. */
  publishDelegatedChildState(publication: DelegatedChildStatePublication): void
  /** Publish controller-verified managed-worktree review state for its owning session. */
  publishManagedWorktreeBinding(sessionId: SessionId, binding: ManagedWorktreeBinding): void
  /** Fence new child registration before a controller-owned parent cascade begins. */
  markDelegationParentClosing(parentId: SessionId, parentGeneration: number): void
  /** Atomically remove one terminal child from session, workspace, and delegation state. */
  removeDelegationChild(identity: DelegatedChildIdentity): void
  /** Atomically replace execution/workspace membership from validated restore descriptors. */
  replaceSessions(
    entries: readonly {
      seed: SessionSeed
      workspace: WorkspaceConversationSeed
      contextPack?: ContextPackState
    }[],
    selectedVisibleId: SessionId | null,
  ): void
  /** Atomically remove an execution slice after successful teardown and close its workspace entry. */
  removeSession(sessionId: SessionId): void
  renameConversation(sessionId: SessionId, displayName: string): void
  selectConversation(sessionId: SessionId): void
  selectAdjacentConversation(direction: "previous" | "next"): void
  backgroundConversation(sessionId: SessionId): void
  reopenConversation(sessionId: SessionId): void
  setConversationAvailability(sessionId: SessionId, availability: ConversationAvailability): void
  setConversationTeardown(sessionId: SessionId, teardownState: TeardownState): void
  setWorkspaceNotice(notice: WorkspaceNotice | null): void
  /** Record the first observed Kitty-protocol key event. Idempotent after confirmation. */
  confirmKittyKeyboard(): void
  /** Move keyboard focus to a session. Focusing the focused session is a no-op. */
  setFocus(sessionId: SessionId): void
  /** Move keyboard focus to an agent or the shell. Reapplying the same pane is a no-op. */
  setFocusedPane(pane: FocusedPane): void

  /** Open the approval overlay for a pending permission request. */
  openApproval(overlay: ApprovalOverlay): void
  /** Clear the approval slot. Closing a closed slot is a no-op. */
  closeApproval(): void
  /** Project the controller-owned active clarification without storing its resolver. */
  openClarification(overlay: ClarificationOverlay): void
  /** Clear only the clarification projection. */
  closeClarification(): void
  /** Capture the currently focused parent for an explicit child launch. */
  openDelegation(overlay: DelegationOverlay): void
  /** Cancel or finish the explicit delegation flow. */
  closeDelegation(): void
  /** Open the hand-off preview overlay for the assembled bundle. */
  openHandoffPreview(overlay: HandoffPreviewOverlay): void
  /** Clear the hand-off preview slot. Closing a closed slot is a no-op. */
  closeHandoffPreview(): void
  /** Open the hand-off target picker for the source session. */
  openHandoffTarget(overlay: HandoffTargetOverlay): void
  /** Clear the hand-off target-picker slot. Closing a closed slot is a no-op. */
  closeHandoffTarget(): void
  /** Open the model/effort selector for the given session. */
  openModelSelect(overlay: ModelSelectOverlay): void
  /** Clear the model/effort selector slot. Closing a closed slot is a no-op. */
  closeModelSelect(): void
  /** Open the settings modal on its requested tab (Theme in V1). */
  openSettings(overlay?: SettingsOverlay): void
  /** Clear the settings slot. Closing a closed slot is a no-op. */
  closeSettings(): void
  /** Open the transient `/statusline` flow for one selected session. */
  openStatusline(overlay: StatuslineOverlay): void
  /** Advance an open `/statusline` flow without changing its captured session. */
  updateStatusline(state: StatuslineModalPhase): void
  /** Clear all transient `/statusline` data without changing the saved preference. */
  closeStatusline(): void
  /** Open a captured-target tab dialog unless approval currently owns modal precedence. */
  openTabDialog(overlay: TabDialogOverlay): void
  closeTabDialog(): void
  /** Open the `/sessions` overview. Opening an open overview is a no-op. */
  openSessions(): void
  /** Close the sessions overview. Closing a closed overview is a no-op. */
  closeSessions(): void
  /** Open the resumable-session picker. Opening an open picker is a no-op. */
  openSessionPicker(): void
  /** Close the resumable-session picker. Closing a closed picker is a no-op. */
  closeSessionPicker(): void
  /** Publish one session's resolved structured-clarification capability. */
  setClarificationCapability(sessionId: SessionId, capability: ClarificationCapability): void
  /** Publish one fixed, content-free controller delivery checkpoint. */
  setHarnessDelivery(
    sessionId: SessionId,
    checkpoint: HarnessDeliveryCheckpointProjection,
  ): void
  /** Set one session's restoration status without changing its transcript. */
  setRestoration(sessionId: SessionId, mode: RestorationMode | null): void
  /** Replace the persisted context exposed by degraded restored panes. */
  setRestorationBundle(bundle: HandoffBundle | null): void
  /** Change the reactive theme preference. Reapplying the current value is a no-op. */
  setThemePreference(theme: ThemePreference): void
  /** Replace the resolved statusline preference. Equal resolved values are no-ops. */
  setStatuslinePreference(preference: StatuslinePreference): void
}

/** Construction options. Defaults to one seeded session per provider kind. */
export interface AppStoreOptions {
  /**
   * The sessions to seed, in display order. Defaults to one per provider kind in the
   * process working directory (today's two-session boot).
   */
  seeds?: SessionSeed[]
  /** Which session holds focus at startup. Defaults to the first seeded session. */
  selectedVisibleId?: SessionId
  /** Reactive user-preference seed. Defaults to following the terminal theme. */
  preferences?: Partial<Preferences>
}

/** Create an {@link AppStore} holding one empty session slice per seed. */
export function createAppStore(options: AppStoreOptions = {}): AppStore {
  return new AppStoreImpl(options)
}

class AppStoreImpl implements AppStore {
  private state: AppState
  private readonly listeners = new Set<(state: AppState, previous: AppState) => void>()

  constructor(options: AppStoreOptions) {
    const seeds = options.seeds ?? defaultSessionSeeds()
    const sessions = {} as Record<SessionId, SessionState>
    const contextPacks = {} as Record<SessionId, ContextPackState>
    const transcriptWindows = {} as Record<SessionId, TranscriptWindowState>
    const restoration = {} as Record<SessionId, RestorationMode | null>
    const clarificationCapabilities = {} as Record<SessionId, ClarificationCapability>
    for (const seed of seeds) {
      sessions[seed.id] = createSessionState(seed)
      contextPacks[seed.id] = createContextPackState()
      transcriptWindows[seed.id] = createTranscriptWindowState()
      restoration[seed.id] = null
      clarificationCapabilities[seed.id] = unknownClarificationCapability()
    }
    const workspace = createWorkspaceState({
      conversations: seeds.map((seed) => ({
        sessionId: seed.id,
        displayName: seed.title,
        availability: { kind: "starting" },
      })),
      selectedVisibleId: options.selectedVisibleId ?? null,
    })
    this.state = {
      sessions,
      contextPacks,
      transcriptWindows,
      explorer: { visible: false, positions: {} },
      delegation: createDelegationState(),
      workspace,
      workspaceNotice: null,
      keyboardCapability: "unknown",
      focusedPane: workspace.selectedVisibleId
        ? { kind: "agent", sessionId: workspace.selectedVisibleId }
        : { kind: "workspace" },
      shell: createShellState(),
      preferences: {
        theme: options.preferences?.theme ?? "auto",
        statusline: options.preferences?.statusline ?? {
          llmDisclosureAcknowledged: false,
          layout: null,
        },
      },
      clarificationCapabilities,
      harnessDeliveries: {},
      harnessDeliveryNotices: {},
      overlays: {
        approval: null,
        clarification: null,
        delegation: null,
        handoffPreview: null,
        handoffTarget: null,
        modelSelect: null,
        settings: null,
        statusline: null,
        tabDialog: null,
        sessions: false,
        sessionPicker: false,
      },
      restoration,
      restorationBundle: null,
    }
  }

  getState(): AppState {
    return this.state
  }

  subscribe(listener: (state: AppState, previous: AppState) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeSelector<T>(
    selector: Selector<T>,
    listener: (value: T, previous: T) => void,
    isEqual: (a: T, b: T) => boolean = Object.is,
  ): Unsubscribe {
    let current = selector(this.state)
    return this.subscribe((state) => {
      const next = selector(state)
      if (isEqual(current, next)) return
      const previous = current
      current = next
      listener(next, previous)
    })
  }

  applyEvent(sessionId: SessionId, event: DomainSessionEvent): void {
    const session = this.state.sessions[sessionId]
    if (!session) return
    const next = sessionReducer(session, event)
    if (next === session) return
    const workspace =
      next.status === session.status
        ? this.state.workspace
        : workspaceReducer(this.state.workspace, {
            kind: "execution_status",
            sessionId,
            status: next.status,
          })
    const position = this.state.explorer.positions[sessionId]
    const explorer = next.cwd !== session.cwd && position
      ? {
          ...this.state.explorer,
          positions: {
            ...this.state.explorer.positions,
            [sessionId]: createExplorerPosition(next.cwd, position.generation + 1),
          },
        }
      : this.state.explorer
    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [sessionId]: next },
      workspace,
      explorer,
    })
  }

  revealTranscriptHistory(sessionId: SessionId, turnCount: number): void {
    const current = this.state.transcriptWindows[sessionId]
    if (!current || !Number.isFinite(turnCount) || turnCount <= 0) return
    const increment = Math.floor(turnCount)
    if (increment <= 0) return
    const revealedTurnCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      current.revealedTurnCount + increment,
    )
    if (revealedTurnCount === current.revealedTurnCount) return
    this.updateTranscriptWindow(sessionId, { ...current, revealedTurnCount })
  }

  setTranscriptDetached(sessionId: SessionId, detachedFromLive: boolean): void {
    const current = this.state.transcriptWindows[sessionId]
    if (!current || current.detachedFromLive === detachedFromLive) return
    this.updateTranscriptWindow(sessionId, { ...current, detachedFromLive })
  }

  captureTranscriptScrollTop(sessionId: SessionId, scrollTop: number | null): void {
    const current = this.state.transcriptWindows[sessionId]
    if (
      !current ||
      (scrollTop !== null && (!Number.isFinite(scrollTop) || scrollTop < 0)) ||
      current.scrollTop === scrollTop
    ) {
      return
    }
    this.updateTranscriptWindow(sessionId, { ...current, scrollTop })
  }

  returnTranscriptToLive(sessionId: SessionId): void {
    const current = this.state.transcriptWindows[sessionId]
    if (!current || (!current.detachedFromLive && current.scrollTop === null)) return
    this.updateTranscriptWindow(sessionId, {
      ...current,
      detachedFromLive: false,
      scrollTop: null,
    })
  }

  toggleExplorer(sessionId: SessionId): void {
    if (
      hasOpenOverlay(this.state.overlays) ||
      !this.state.sessions[sessionId] ||
      this.state.workspace.selectedVisibleId !== sessionId
    ) {
      return
    }
    const visible = !this.state.explorer.visible
    const current = this.state.explorer.positions[sessionId]
    const position = current?.workspaceRoot === this.state.sessions[sessionId].cwd
      ? current
      : createExplorerPosition(
          this.state.sessions[sessionId].cwd,
          current ? current.generation + 1 : 0,
        )
    this.commit({
      ...this.state,
      explorer: {
        visible,
        positions: current === position
          ? this.state.explorer.positions
          : { ...this.state.explorer.positions, [sessionId]: position },
      },
      focusedPane: visible
        ? { kind: "explorer", sessionId }
        : { kind: "agent", sessionId },
    })
  }

  setExplorerSelection(sessionId: SessionId, relativePath: string | null): void {
    this.updateExplorerPosition(sessionId, (current) =>
      current.selectedPath === relativePath ? current : { ...current, selectedPath: relativePath },
    )
  }

  setExplorerExpanded(sessionId: SessionId, relativePath: string, expanded: boolean): void {
    this.updateExplorerPosition(sessionId, (current) => {
      const contains = current.expandedPaths.includes(relativePath)
      if (contains === expanded) return current
      return {
        ...current,
        expandedPaths: expanded
          ? [...current.expandedPaths, relativePath]
          : current.expandedPaths.filter((path) => path !== relativePath),
      }
    })
  }

  setExplorerScrollTop(sessionId: SessionId, scrollTop: number): void {
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return
    this.updateExplorerPosition(sessionId, (current) =>
      current.scrollTop === scrollTop ? current : { ...current, scrollTop },
    )
  }

  setExplorerNotice(sessionId: SessionId, notice: ExplorerNotice | null): void {
    this.updateExplorerPosition(sessionId, (current) =>
      current.notice?.code === notice?.code ? current : { ...current, notice },
    )
  }

  beginExplorerDirectoryRequest(
    sessionId: SessionId,
    workspaceRoot: string,
    relativePath: string,
    options: { readonly refresh?: boolean } = {},
  ): number | null {
    const session = this.state.sessions[sessionId]
    if (!session || session.cwd !== workspaceRoot) return null

    const previous = this.state.explorer.positions[sessionId]
    const workspaceChanged = previous !== undefined && previous.workspaceRoot !== workspaceRoot
    let current = previous?.workspaceRoot === workspaceRoot
      ? previous
      : createExplorerPosition(workspaceRoot, previous ? previous.generation + 1 : 0)
    if (options.refresh && !workspaceChanged) {
      current = { ...current, directories: {}, generation: current.generation + 1 }
    }
    if (
      !options.refresh &&
      previous === current &&
      current.directories[relativePath]?.kind === "loading"
    ) {
      return current.generation
    }

    const position: ExplorerPosition = {
      ...current,
      directories: {
        ...current.directories,
        [relativePath]: { kind: "loading" },
      },
    }
    this.commit({
      ...this.state,
      explorer: {
        ...this.state.explorer,
        positions: { ...this.state.explorer.positions, [sessionId]: position },
      },
    })
    return position.generation
  }

  commitExplorerDirectory(
    sessionId: SessionId,
    workspaceRoot: string,
    generation: number,
    relativePath: string,
    snapshot: Exclude<ExplorerDirectorySnapshot, { readonly kind: "loading" }>,
  ): boolean {
    const session = this.state.sessions[sessionId]
    const current = this.state.explorer.positions[sessionId]
    if (
      !session ||
      session.cwd !== workspaceRoot ||
      !current ||
      current.workspaceRoot !== workspaceRoot ||
      current.generation !== generation ||
      current.directories[relativePath]?.kind !== "loading"
    ) {
      return false
    }
    this.updateExplorerPosition(sessionId, (position) => ({
      ...position,
      directories: { ...position.directories, [relativePath]: snapshot },
    }))
    return true
  }

  acknowledgeSteeringRecovery(sessionId: SessionId, requestId: string): void {
    const steering = this.state.sessions[sessionId]?.steering
    const current = steering?.queue[0]
    if (!current || steering.recovery === null) return
    this.applyEvent(sessionId, {
      kind: "steering_acknowledge_recovery",
      requestId,
      generation: current.generation,
    })
  }

  createContextPackDraft(
    sessionId: SessionId,
    original: string,
    options: {
      readonly mode?: ContextPackInstructions["mode"]
      readonly discovered?: string
      readonly budgetLimit?: number
    } = {},
  ): ContextPackDraftResult | null {
    const current = this.state.contextPacks[sessionId]
    if (!current || current.build) return null
    const result = createDraft(original, options)
    if (result.kind !== "created") return result
    this.commitContextPack(sessionId, {
      ...current,
      draft: result.draft,
      review: null,
    })
    return result
  }

  refineContextPackDraft(sessionId: SessionId): ContextPackDraftResult | null {
    const current = this.state.contextPacks[sessionId]
    if (!current?.sealed || !isLiveSealedContextPack(current.sealed) || current.build) return null
    const result = startFreshFromSealed(current.sealed)
    if (result.kind !== "created") return result
    this.commitContextPack(sessionId, {
      ...current,
      draft: result.draft,
      review: null,
    })
    return result
  }

  applyContextPackOperatorMutation(
    sessionId: SessionId,
    mutation: ContextPackMutation,
  ): ContextPackMutationResult | null {
    const current = this.state.contextPacks[sessionId]
    if (!current?.draft) return null
    const result = applyOperatorContextPackMutation(current.draft, mutation)
    if (result.kind !== "applied") return result
    this.commitContextPack(sessionId, {
      ...current,
      draft: result.draft,
      review: null,
      build: current.build?.state === "ready_for_review"
        ? { ...current.build, state: "building" }
        : current.build,
    })
    return result
  }

  applyContextPackBuilderMutation(
    sessionId: SessionId,
    mutation: RevisionFencedContextPackMutation,
  ): ContextPackMutationResult | null {
    const current = this.state.contextPacks[sessionId]
    if (!current?.draft) return null
    const result = applyBuilderContextPackMutation(current.draft, mutation)
    if (result.kind !== "applied") return result
    this.commitContextPack(sessionId, {
      ...current,
      draft: result.draft,
      review: null,
      build: current.build?.state === "ready_for_review"
        ? { ...current.build, state: "building" }
        : current.build,
    })
    return result
  }

  publishContextPackReview(
    sessionId: SessionId,
    candidate: ContextPackReviewCandidate,
  ): boolean {
    const current = this.state.contextPacks[sessionId]
    if (
      !current?.draft ||
      candidate.revision !== current.draft.revision ||
      candidate.manifest.revision !== current.draft.revision
    ) {
      return false
    }
    if (current.review === candidate) return true
    const build = current.build
      ? { ...current.build, state: "ready_for_review" as const }
      : null
    this.commitContextPack(sessionId, { ...current, review: candidate, build })
    return true
  }

  sealContextPack(sessionId: SessionId, sealed: SealedContextPack): boolean {
    const current = this.state.contextPacks[sessionId]
    if (
      !current?.draft ||
      !current.review ||
      current.review.verdict.kind !== "ready" ||
      sealed.revision !== current.draft.revision ||
      sealed.revision !== current.review.revision ||
      sealed.manifest.revision !== current.review.manifest.revision ||
      sealed.payload !== current.review.payload ||
      sealed.bytes !== current.review.bytes ||
      sealed.packEstimate !== current.review.packEstimate ||
      sealed.redactionCount !== current.review.redactionCount ||
      JSON.stringify(sealed.manifest) !== JSON.stringify(current.review.manifest) ||
      JSON.stringify(sealed.sourceFences) !== JSON.stringify(current.review.sourceFences)
    ) {
      return false
    }
    if (current.sealed === sealed) return true
    this.commitContextPack(sessionId, { ...current, sealed })
    return true
  }

  bindContextBuild(sessionId: SessionId, binding: ContextBuildBinding): boolean {
    const current = this.state.contextPacks[sessionId]
    if (
      !current?.draft ||
      current.build ||
      binding.parentId !== sessionId ||
      binding.draftRevision !== current.draft.revision ||
      binding.state !== "building"
    ) {
      return false
    }
    this.commitContextPack(sessionId, { ...current, build: binding })
    return true
  }

  prepareContextBuild(
    sessionId: SessionId,
    preparation: ContextBuildDraftPreparation,
    identity: ContextBuildBindingIdentity,
  ): ContextBuildPreparationResult {
    const current = this.state.contextPacks[sessionId]
    if (!current || identity.parentId !== sessionId) {
      return { kind: "denied", reason: "unknown_session" }
    }
    if (current.build) return { kind: "denied", reason: "build_active" }

    const result = preparation.kind === "start_fresh"
      ? createDraft(preparation.original, {
          ...(preparation.mode === undefined ? {} : { mode: preparation.mode }),
          ...(preparation.discovered === undefined ? {} : { discovered: preparation.discovered }),
          ...(preparation.budgetLimit === undefined ? {} : { budgetLimit: preparation.budgetLimit }),
        })
      : current.sealed && isLiveSealedContextPack(current.sealed)
        ? startFreshFromSealed(current.sealed)
        : null
    if (result === null) return { kind: "denied", reason: "draft_unavailable" }
    if (result.kind !== "created") return { kind: "denied", reason: "invalid_draft" }

    const binding: ContextBuildBinding = {
      ...identity,
      draftRevision: result.draft.revision,
      state: "building",
    }
    this.commitContextPack(sessionId, {
      ...current,
      draft: result.draft,
      review: null,
      build: binding,
    })
    return { kind: "prepared", draft: result.draft, binding }
  }

  releaseContextBuild(sessionId: SessionId, binding: ContextBuildBinding): boolean {
    const current = this.state.contextPacks[sessionId]
    if (!current?.build || !sameContextBuildIdentity(current.build, binding)) return false
    this.commitContextPack(sessionId, { ...current, build: null })
    return true
  }

  settleContextBuild(
    sessionId: SessionId,
    binding: ContextBuildBinding,
    outcome: "ready_for_review" | "failed",
  ): boolean {
    const current = this.state.contextPacks[sessionId]
    if (!current?.build || !sameContextBuildIdentity(current.build, binding)) return false
    const workspace = workspaceReducer(this.state.workspace, {
      kind: "execution_status",
      sessionId,
      status: outcome === "ready_for_review" ? "finished" : "error",
    })
    this.commit({
      ...this.state,
      contextPacks: {
        ...this.state.contextPacks,
        [sessionId]: { ...current, build: null },
      },
      workspace,
    })
    return true
  }

  applyShellEvent(event: ShellEvent): void {
    const next = shellReducer(this.state.shell, event)
    if (next === this.state.shell) return
    this.commit({ ...this.state, shell: next })
  }

  startSession(
    sessionId: SessionId,
    acpSessionId: string,
    options: { preserveWorkspaceAttention?: boolean } = {},
  ): void {
    const existing = this.state.sessions[sessionId]
    if (!existing) return
    // Reset the transcript and bind the ACP id, but keep the session's identity
    // (provider kind, title, cwd, task) fixed at seed time.
    const fresh = createSessionState({
      id: existing.id,
      providerKind: existing.providerKind,
      title: existing.title,
      cwd: existing.cwd,
      task: existing.task,
      worktreeBinding: existing.worktreeBinding,
      acpSessionId,
    })
    const workspace = options.preserveWorkspaceAttention
      ? this.state.workspace
      : workspaceReducer(this.state.workspace, {
          kind: "execution_status",
          sessionId,
          status: fresh.status,
        })
    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [sessionId]: fresh },
      transcriptWindows: {
        ...this.state.transcriptWindows,
        [sessionId]: createTranscriptWindowState(),
      },
      workspace,
    })
  }

  addSession(
    seed: SessionSeed,
    options: { displayName?: string; availability?: ConversationAvailability } = {},
  ): void {
    if (this.state.sessions[seed.id] || this.state.workspace.conversations[seed.id]) return
    const workspace = workspaceReducer(this.state.workspace, {
      kind: "create",
      sessionId: seed.id,
      displayName: options.displayName ?? seed.title,
      availability: options.availability,
      initialStatus: "idle",
    })
    if (workspace === this.state.workspace) return
    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [seed.id]: createSessionState(seed) },
      contextPacks: { ...this.state.contextPacks, [seed.id]: createContextPackState() },
      transcriptWindows: {
        ...this.state.transcriptWindows,
        [seed.id]: createTranscriptWindowState(),
      },
      workspace,
      restoration: { ...this.state.restoration, [seed.id]: null },
      clarificationCapabilities: {
        ...this.state.clarificationCapabilities,
        [seed.id]: unknownClarificationCapability(),
      },
      harnessDeliveries: { ...this.state.harnessDeliveries },
      harnessDeliveryNotices: { ...this.state.harnessDeliveryNotices },
      focusedPane: { kind: "agent", sessionId: seed.id },
    })
  }

  addDelegatedSession(
    registration: DelegatedSessionRegistration,
  ): DelegatedSessionAdmissionResult {
    const {
      seed,
      parentId,
      parentGeneration,
      childGeneration,
      task,
      desiredOutcome,
      policy,
    } = registration
    if (
      !this.state.sessions[parentId] ||
      !this.state.workspace.conversations[parentId] ||
      this.state.sessions[seed.id] ||
      this.state.workspace.conversations[seed.id]
    ) {
      return { kind: "rejected" }
    }

    const selectedVisibleId = this.state.workspace.selectedVisibleId

    const admission = registerDelegatedChild(this.state.delegation, {
      kind: "register_child",
      parentId,
      childId: seed.id,
      parentGeneration,
      childGeneration,
      task,
      desiredOutcome,
      ...(policy ? { policy } : {}),
    })
    if (admission.kind !== "accepted") {
      return admission.kind === "denied"
        ? { kind: "denied", reason: admission.reason, scope: admission.scope }
        : { kind: "rejected" }
    }
    const delegation = admission.state

    const createdWorkspace = workspaceReducer(this.state.workspace, {
      kind: "create",
      sessionId: seed.id,
      displayName: registration.displayName ?? seed.title,
      availability: { kind: "starting" },
      initialStatus: "idle",
    })
    if (createdWorkspace === this.state.workspace) return { kind: "rejected" }
    const backgroundWorkspace = workspaceReducer(createdWorkspace, {
      kind: "background",
      sessionId: seed.id,
    })
    if (backgroundWorkspace === createdWorkspace) return { kind: "rejected" }
    const workspace = backgroundWorkspace.selectedVisibleId === selectedVisibleId
      ? backgroundWorkspace
      : { ...backgroundWorkspace, selectedVisibleId }
    if (workspace.selectedVisibleId !== selectedVisibleId) return { kind: "rejected" }

    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [seed.id]: createSessionState(seed) },
      contextPacks: { ...this.state.contextPacks, [seed.id]: createContextPackState() },
      transcriptWindows: {
        ...this.state.transcriptWindows,
        [seed.id]: createTranscriptWindowState(),
      },
      delegation,
      workspace,
      restoration: { ...this.state.restoration, [seed.id]: null },
      clarificationCapabilities: {
        ...this.state.clarificationCapabilities,
        [seed.id]: unknownClarificationCapability(),
      },
    })
    return { kind: "accepted" }
  }

  publishDelegatedChildState(publication: DelegatedChildStatePublication): void {
    const session = this.state.sessions[publication.childId]
    if (!session) return
    const delegation = reduceDelegatedChildPublication(this.state.delegation, publication)
    if (delegation === this.state.delegation) return

    const nextSession = sessionReducer(session, {
      kind: "status",
      status: publication.sessionStatus,
    })
    const workspace = workspaceReducer(this.state.workspace, {
      kind: "execution_status",
      sessionId: publication.childId,
      status: nextSession.status,
    })
    this.commit({
      ...this.state,
      sessions: { ...this.state.sessions, [publication.childId]: nextSession },
      delegation,
      workspace,
    })
  }

  publishManagedWorktreeBinding(sessionId: SessionId, binding: ManagedWorktreeBinding): void {
    const session = this.state.sessions[sessionId]
    if (
      !session ||
      binding.ownerSessionId !== sessionId ||
      sameManagedWorktreeBinding(session.worktreeBinding, binding)
    ) {
      return
    }
    this.commit({
      ...this.state,
      sessions: {
        ...this.state.sessions,
        [sessionId]: { ...session, worktreeBinding: binding },
      },
    })
  }

  markDelegationParentClosing(parentId: SessionId, parentGeneration: number): void {
    const delegation = delegationReducer(this.state.delegation, {
      kind: "mark_parent_closing",
      parentId,
      parentGeneration,
    })
    if (delegation === this.state.delegation) return
    this.commit({ ...this.state, delegation })
  }

  removeDelegationChild(identity: DelegatedChildIdentity): void {
    const session = this.state.sessions[identity.childId]
    const conversation = this.state.workspace.conversations[identity.childId]
    if (!session || !conversation) return
    const delegation = delegationReducer(this.state.delegation, {
      kind: "remove_child",
      ...identity,
    })
    if (delegation === this.state.delegation) return

    const workspace = workspaceReducer(this.state.workspace, {
      kind: "close_succeeded",
      sessionId: identity.childId,
    })
    const sessions = { ...this.state.sessions }
    const contextPacks = { ...this.state.contextPacks }
    const transcriptWindows = { ...this.state.transcriptWindows }
    const explorerPositions = { ...this.state.explorer.positions }
    const restoration = { ...this.state.restoration }
    const clarificationCapabilities = { ...this.state.clarificationCapabilities }
    const harnessDeliveries = { ...this.state.harnessDeliveries }
    const harnessDeliveryNotices = { ...this.state.harnessDeliveryNotices }
    delete sessions[identity.childId]
    delete contextPacks[identity.childId]
    delete transcriptWindows[identity.childId]
    delete explorerPositions[identity.childId]
    delete restoration[identity.childId]
    delete clarificationCapabilities[identity.childId]
    delete harnessDeliveries[identity.childId]
    delete harnessDeliveryNotices[identity.childId]

    this.commit({
      ...this.state,
      sessions,
      contextPacks,
      transcriptWindows,
      explorer: { ...this.state.explorer, positions: explorerPositions },
      delegation,
      workspace,
      overlays: clearSessionOverlays(this.state.overlays, identity.childId),
      restoration,
      clarificationCapabilities,
      harnessDeliveries,
      harnessDeliveryNotices,
      focusedPane: reconcilePane(this.state.focusedPane, workspace),
    })
  }

  replaceSessions(
    entries: readonly {
      seed: SessionSeed
      workspace: WorkspaceConversationSeed
      contextPack?: ContextPackState
    }[],
    selectedVisibleId: SessionId | null,
  ): void {
    const sessions: Record<SessionId, SessionState> = {}
    const contextPacks: Record<SessionId, ContextPackState> = {}
    const transcriptWindows: Record<SessionId, TranscriptWindowState> = {}
    const restoration: Record<SessionId, RestorationMode | null> = {}
    const clarificationCapabilities: Record<SessionId, ClarificationCapability> = {}
    for (const entry of entries) {
      sessions[entry.seed.id] = createSessionState(entry.seed)
      contextPacks[entry.seed.id] = entry.contextPack
        ? {
            draft: entry.contextPack.draft,
            sealed: entry.contextPack.sealed,
            review: null,
            build: null,
          }
        : createContextPackState()
      transcriptWindows[entry.seed.id] = createTranscriptWindowState()
      restoration[entry.seed.id] = null
      clarificationCapabilities[entry.seed.id] = unknownClarificationCapability()
    }
    const workspace = createWorkspaceState({
      conversations: entries.map((entry) => entry.workspace),
      selectedVisibleId,
    })
    this.commit({
      ...this.state,
      sessions,
      contextPacks,
      transcriptWindows,
      explorer: { ...this.state.explorer, positions: {} },
      delegation: createDelegationState(),
      workspace,
      workspaceNotice: null,
      overlays: { ...this.state.overlays, delegation: null },
      restoration,
      clarificationCapabilities,
      harnessDeliveries: {},
      harnessDeliveryNotices: {},
      focusedPane: reconcilePane(this.state.focusedPane, workspace),
    })
  }

  removeSession(sessionId: SessionId): void {
    if (!this.state.sessions[sessionId] || !this.state.workspace.conversations[sessionId]) return
    const workspace = workspaceReducer(this.state.workspace, { kind: "close_succeeded", sessionId })
    const sessions = { ...this.state.sessions }
    const contextPacks = { ...this.state.contextPacks }
    const transcriptWindows = { ...this.state.transcriptWindows }
    const explorerPositions = { ...this.state.explorer.positions }
    const restoration = { ...this.state.restoration }
    const clarificationCapabilities = { ...this.state.clarificationCapabilities }
    const harnessDeliveries = { ...this.state.harnessDeliveries }
    const harnessDeliveryNotices = { ...this.state.harnessDeliveryNotices }
    delete sessions[sessionId]
    delete contextPacks[sessionId]
    delete transcriptWindows[sessionId]
    delete explorerPositions[sessionId]
    delete restoration[sessionId]
    delete clarificationCapabilities[sessionId]
    delete harnessDeliveries[sessionId]
    delete harnessDeliveryNotices[sessionId]
    this.commit({
      ...this.state,
      sessions,
      contextPacks,
      transcriptWindows,
      explorer: { ...this.state.explorer, positions: explorerPositions },
      workspace,
      overlays: clearSessionOverlays(this.state.overlays, sessionId),
      restoration,
      clarificationCapabilities,
      harnessDeliveries,
      harnessDeliveryNotices,
      focusedPane: reconcilePane(this.state.focusedPane, workspace),
    })
  }

  renameConversation(sessionId: SessionId, displayName: string): void {
    this.commitWorkspace({ kind: "rename", sessionId, displayName })
  }

  selectConversation(sessionId: SessionId): void {
    if (hasOpenOverlay(this.state.overlays)) return
    const workspace = workspaceReducer(this.state.workspace, { kind: "select", sessionId })
    if (workspace === this.state.workspace) return
    this.commit({ ...this.state, workspace, focusedPane: { kind: "agent", sessionId } })
  }

  selectAdjacentConversation(direction: "previous" | "next"): void {
    if (hasOpenOverlay(this.state.overlays)) return
    const workspace = workspaceReducer(this.state.workspace, { kind: "select_adjacent", direction })
    if (workspace === this.state.workspace) return
    this.commit({
      ...this.state,
      workspace,
      focusedPane: workspace.selectedVisibleId
        ? { kind: "agent", sessionId: workspace.selectedVisibleId }
        : { kind: "workspace" },
    })
  }

  confirmKittyKeyboard(): void {
    if (this.state.keyboardCapability === "kittyConfirmed") return
    this.commit({ ...this.state, keyboardCapability: "kittyConfirmed" })
  }

  backgroundConversation(sessionId: SessionId): void {
    this.commitWorkspace({ kind: "background", sessionId })
  }

  reopenConversation(sessionId: SessionId): void {
    const workspace = workspaceReducer(this.state.workspace, { kind: "reopen", sessionId })
    if (workspace === this.state.workspace) return
    this.commit({
      ...this.state,
      workspace,
      focusedPane: { kind: "agent", sessionId },
    })
  }

  setConversationAvailability(
    sessionId: SessionId,
    availability: ConversationAvailability,
  ): void {
    this.commitWorkspace({ kind: "set_availability", sessionId, availability })
  }

  setConversationTeardown(sessionId: SessionId, teardownState: TeardownState): void {
    this.commitWorkspace({ kind: "set_teardown_state", sessionId, teardownState })
  }

  setWorkspaceNotice(notice: WorkspaceNotice | null): void {
    if (this.state.workspaceNotice?.code === notice?.code) return
    this.commit({ ...this.state, workspaceNotice: notice })
  }

  setFocus(sessionId: SessionId): void {
    this.selectConversation(sessionId)
  }

  setFocusedPane(pane: FocusedPane): void {
    if (hasOpenOverlay(this.state.overlays)) return
    if (pane.kind === "agent" || pane.kind === "explorer") {
      if (pane.kind === "explorer" && !this.state.explorer.visible) return
      const conversation = this.state.workspace.conversations[pane.sessionId]
      if (!conversation || conversation.lifecycle !== "visible") return
      const workspace = workspaceReducer(this.state.workspace, {
        kind: "select",
        sessionId: pane.sessionId,
      })
      if (
        workspace === this.state.workspace &&
        this.state.focusedPane.kind === pane.kind &&
        this.state.focusedPane.sessionId === pane.sessionId
      ) {
        return
      }
      this.commit({ ...this.state, workspace, focusedPane: pane })
      return
    }
    if (pane.kind === "workspace" && this.state.workspace.selectedVisibleId !== null) return
    const current = this.state.focusedPane
    if (current.kind === pane.kind) return
    this.commit({ ...this.state, focusedPane: pane })
  }

  openApproval(overlay: ApprovalOverlay): void {
    this.setOverlays({ approval: overlay })
  }

  closeApproval(): void {
    if (this.state.overlays.approval === null) return
    this.setOverlays({ approval: null })
  }

  openClarification(overlay: ClarificationOverlay): void {
    this.setOverlays({ clarification: overlay })
  }

  closeClarification(): void {
    if (this.state.overlays.clarification === null) return
    this.setOverlays({ clarification: null })
  }

  openDelegation(overlay: DelegationOverlay): void {
    const state = this.state
    const conversation = state.workspace.conversations[overlay.parentId]
    if (
      hasOpenOverlay(state.overlays) ||
      state.focusedPane.kind !== "agent" ||
      state.focusedPane.sessionId !== overlay.parentId ||
      state.workspace.selectedVisibleId !== overlay.parentId ||
      conversation?.lifecycle !== "visible" ||
      conversation.teardownState === "closing" ||
      !state.sessions[overlay.parentId] ||
      state.delegation.children[overlay.parentId]
    ) {
      return
    }
    this.setOverlays({ delegation: overlay })
  }

  closeDelegation(): void {
    if (this.state.overlays.delegation === null) return
    this.setOverlays({ delegation: null })
  }

  openHandoffPreview(overlay: HandoffPreviewOverlay): void {
    this.setOverlays({ handoffPreview: overlay })
  }

  closeHandoffPreview(): void {
    if (this.state.overlays.handoffPreview === null) return
    this.setOverlays({ handoffPreview: null })
  }

  openHandoffTarget(overlay: HandoffTargetOverlay): void {
    this.setOverlays({ handoffTarget: overlay })
  }

  closeHandoffTarget(): void {
    if (this.state.overlays.handoffTarget === null) return
    this.setOverlays({ handoffTarget: null })
  }

  openModelSelect(overlay: ModelSelectOverlay): void {
    const selectedSessionId = this.state.workspace.selectedVisibleId
    const selectedConversation = selectedSessionId
      ? this.state.workspace.conversations[selectedSessionId]
      : undefined
    if (
      selectedSessionId === null ||
      overlay.sessionId !== selectedSessionId ||
      selectedConversation?.lifecycle !== "visible"
    ) {
      return
    }
    this.setOverlays({ modelSelect: overlay })
  }

  closeModelSelect(): void {
    if (this.state.overlays.modelSelect === null) return
    this.setOverlays({ modelSelect: null })
  }

  openSettings(overlay: SettingsOverlay = { tab: "theme" }): void {
    this.setOverlays({ settings: overlay })
  }

  closeSettings(): void {
    if (this.state.overlays.settings === null) return
    this.setOverlays({ settings: null })
  }

  openStatusline(overlay: StatuslineOverlay): void {
    if (this.state.overlays.statusline === overlay) return
    this.setOverlays({ statusline: overlay })
  }

  updateStatusline(state: StatuslineModalPhase): void {
    const current = this.state.overlays.statusline
    if (current === null) return
    this.setOverlays({ statusline: { sessionId: current.sessionId, ...state } })
  }

  closeStatusline(): void {
    if (this.state.overlays.statusline === null) return
    this.setOverlays({ statusline: null })
  }

  openTabDialog(overlay: TabDialogOverlay): void {
    if (this.state.overlays.approval !== null) return
    const conversation = this.state.workspace.conversations[overlay.sessionId]
    if (!conversation || conversation.teardownState === "closing") return
    if (
      this.state.overlays.tabDialog?.kind === overlay.kind &&
      this.state.overlays.tabDialog.sessionId === overlay.sessionId
    ) {
      return
    }
    this.setOverlays({ tabDialog: overlay })
  }

  closeTabDialog(): void {
    if (this.state.overlays.tabDialog === null) return
    this.setOverlays({ tabDialog: null })
  }

  openSessions(): void {
    if (this.state.overlays.sessions) return
    this.setOverlays({ sessions: true })
  }

  closeSessions(): void {
    if (!this.state.overlays.sessions) return
    this.setOverlays({ sessions: false })
  }

  openSessionPicker(): void {
    if (this.state.overlays.sessionPicker) return
    this.setOverlays({ sessionPicker: true })
  }

  closeSessionPicker(): void {
    if (!this.state.overlays.sessionPicker) return
    this.setOverlays({ sessionPicker: false })
  }

  setClarificationCapability(sessionId: SessionId, capability: ClarificationCapability): void {
    if (!this.state.sessions[sessionId]) return
    const current = this.state.clarificationCapabilities[sessionId]
    if (sameClarificationCapability(current, capability)) return
    this.commit({
      ...this.state,
      clarificationCapabilities: {
        ...this.state.clarificationCapabilities,
        [sessionId]: capability,
      },
    })
  }

  setRestoration(sessionId: SessionId, mode: RestorationMode | null): void {
    if (!this.state.sessions[sessionId] || this.state.restoration[sessionId] === mode) return
    this.commit({
      ...this.state,
      restoration: { ...this.state.restoration, [sessionId]: mode },
    })
  }

  setRestorationBundle(bundle: HandoffBundle | null): void {
    if (this.state.restorationBundle === bundle) return
    this.commit({ ...this.state, restorationBundle: bundle })
  }

  setHarnessDelivery(
    sessionId: SessionId,
    checkpoint: HarnessDeliveryCheckpointProjection,
  ): void {
    if (!this.state.sessions[sessionId]) return
    const current = this.state.harnessDeliveries[sessionId]
    const currentNotice = this.state.harnessDeliveryNotices[sessionId]
    const nextNotice = checkpoint.state === "failed" ? HARNESS_DELIVERY_FAILED_NOTICE : undefined
    if (
      current?.version === checkpoint.version &&
      current.generation === checkpoint.generation &&
      current.state === checkpoint.state &&
      current.failureCategory === checkpoint.failureCategory &&
      currentNotice === nextNotice
    ) return
    const harnessDeliveryNotices = { ...this.state.harnessDeliveryNotices }
    if (nextNotice) harnessDeliveryNotices[sessionId] = nextNotice
    else delete harnessDeliveryNotices[sessionId]
    this.commit({
      ...this.state,
      harnessDeliveries: {
        ...this.state.harnessDeliveries,
        [sessionId]: { ...checkpoint },
      },
      harnessDeliveryNotices,
    })
  }

  setThemePreference(theme: ThemePreference): void {
    if (this.state.preferences.theme === theme) return
    this.commit({ ...this.state, preferences: { ...this.state.preferences, theme } })
  }

  setStatuslinePreference(preference: StatuslinePreference): void {
    if (sameStatuslinePreference(this.state.preferences.statusline, preference)) return
    this.commit({
      ...this.state,
      preferences: { ...this.state.preferences, statusline: preference },
    })
  }

  /** Replace one or both overlay slots, leaving the rest of the state identical. */
  private setOverlays(patch: Partial<OverlayState>): void {
    this.commit({ ...this.state, overlays: { ...this.state.overlays, ...patch } })
  }

  private commitWorkspace(event: WorkspaceEvent): void {
    const workspace = workspaceReducer(this.state.workspace, event)
    if (workspace === this.state.workspace) return
    this.commit({
      ...this.state,
      workspace,
      focusedPane: reconcilePane(this.state.focusedPane, workspace),
    })
  }

  private commitContextPack(sessionId: SessionId, contextPack: ContextPackState): void {
    this.commit({
      ...this.state,
      contextPacks: { ...this.state.contextPacks, [sessionId]: contextPack },
    })
  }

  private updateTranscriptWindow(
    sessionId: SessionId,
    transcriptWindow: TranscriptWindowState,
  ): void {
    this.commit({
      ...this.state,
      transcriptWindows: {
        ...this.state.transcriptWindows,
        [sessionId]: transcriptWindow,
      },
    })
  }

  private updateExplorerPosition(
    sessionId: SessionId,
    update: (current: ExplorerPosition) => ExplorerPosition,
  ): void {
    const session = this.state.sessions[sessionId]
    if (!session) return
    const previous = this.state.explorer.positions[sessionId]
    const current = previous?.workspaceRoot === session.cwd
      ? previous
      : createExplorerPosition(session.cwd, previous ? previous.generation + 1 : 0)
    const next = update(current)
    if (previous === next) return
    this.commit({
      ...this.state,
      explorer: {
        ...this.state.explorer,
        positions: { ...this.state.explorer.positions, [sessionId]: next },
      },
    })
  }

  /**
   * Publish a new state. Listeners are notified from a snapshot of the set, so a
   * listener that unsubscribes (or subscribes) during notification cannot disturb
   * the current pass.
   */
  private commit(next: AppState): void {
    if (next === this.state) return
    const previous = this.state
    this.state = next
    for (const listener of [...this.listeners]) {
      listener(next, previous)
    }
  }
}

function createContextPackState(): ContextPackState {
  return { draft: null, sealed: null, review: null, build: null }
}

function createTranscriptWindowState(): TranscriptWindowState {
  return { revealedTurnCount: 0, detachedFromLive: false, scrollTop: null }
}

function isLiveSealedContextPack(
  value: NonNullable<ContextPackState["sealed"]>,
): value is SealedContextPack {
  return "manifest" in value &&
    "packEstimate" in value &&
    "redactionCount" in value &&
    "sourceFences" in value
}

function sameContextBuildIdentity(
  left: ContextBuildBinding,
  right: ContextBuildBinding,
): boolean {
  return (
    left.parentId === right.parentId &&
    left.childId === right.childId &&
    left.parentGeneration === right.parentGeneration &&
    left.childGeneration === right.childGeneration &&
    left.draftRevision === right.draftRevision
  )
}

function createExplorerPosition(workspaceRoot: string, generation = 0): ExplorerPosition {
  return {
    workspaceRoot,
    expandedPaths: [],
    selectedPath: null,
    scrollTop: 0,
    directories: {},
    notice: null,
    generation,
  }
}

function reconcilePane(pane: FocusedPane, workspace: WorkspaceState): FocusedPane {
  if (pane.kind === "shell") return pane
  if (!workspace.selectedVisibleId) return { kind: "workspace" }
  return pane.kind === "explorer"
    ? { kind: "explorer", sessionId: workspace.selectedVisibleId }
    : { kind: "agent", sessionId: workspace.selectedVisibleId }
}

function reduceDelegatedChildPublication(
  delegation: DelegationState,
  publication: DelegatedChildStatePublication,
): DelegationState {
  const identity = {
    parentId: publication.parentId,
    childId: publication.childId,
    parentGeneration: publication.parentGeneration,
    childGeneration: publication.childGeneration,
  }
  return publication.status === "running" || publication.status === "needs_input"
    ? delegationReducer(delegation, {
        kind: "publish_child_status",
        ...identity,
        status: publication.status,
      })
    : delegationReducer(delegation, {
        kind: "publish_child_status",
        ...identity,
        status: publication.status,
        at: publication.at,
      })
}

function clearSessionOverlays(overlays: OverlayState, sessionId: SessionId): OverlayState {
  if (
    overlays.tabDialog?.sessionId !== sessionId &&
    overlays.clarification?.sessionId !== sessionId &&
    overlays.delegation?.parentId !== sessionId
  ) {
    return overlays
  }
  return {
    ...overlays,
    ...(overlays.tabDialog?.sessionId === sessionId ? { tabDialog: null } : {}),
    ...(overlays.clarification?.sessionId === sessionId ? { clarification: null } : {}),
    ...(overlays.delegation?.parentId === sessionId ? { delegation: null } : {}),
  }
}

function hasOpenOverlay(overlays: OverlayState): boolean {
  return (
    overlays.approval !== null ||
    overlays.clarification !== null ||
    overlays.delegation !== null ||
    overlays.handoffPreview !== null ||
    overlays.handoffTarget !== null ||
    overlays.modelSelect !== null ||
    overlays.settings !== null ||
    overlays.statusline !== null ||
    overlays.tabDialog !== null ||
    overlays.sessions ||
    overlays.sessionPicker
  )
}

function sameStatuslinePreference(left: StatuslinePreference, right: StatuslinePreference): boolean {
  if (left.llmDisclosureAcknowledged !== right.llmDisclosureAcknowledged) return false
  if (left.layout === right.layout) return true
  if (left.layout === null || right.layout === null) return false
  const rightLayout = right.layout
  if (left.layout.separator !== rightLayout.separator || left.layout.line.length !== rightLayout.line.length) {
    return false
  }
  return left.layout.line.every((item, index) => {
    const other = rightLayout.line[index]!
    return typeof item === "string"
      ? item === other
      : typeof other !== "string" && item.kind === other.kind && item.maxChars === other.maxChars
  })
}

function unknownClarificationCapability(): ClarificationCapability {
  return { status: "unsupported", reason: "unknown_recipe" }
}

function sameClarificationCapability(
  left: ClarificationCapability | undefined,
  right: ClarificationCapability,
): boolean {
  if (!left || left.status !== right.status) return false
  if (left.status === "supported" && right.status === "supported") {
    return left.adapterPackage === right.adapterPackage && left.adapterVersion === right.adapterVersion
  }
  return left.status === "unsupported" && right.status === "unsupported" && left.reason === right.reason
}

function sameManagedWorktreeBinding(
  left: ManagedWorktreeBinding | undefined,
  right: ManagedWorktreeBinding,
): boolean {
  return left?.kind === right.kind &&
    left.id === right.id &&
    left.repoRoot === right.repoRoot &&
    left.worktreePath === right.worktreePath &&
    left.branch === right.branch &&
    left.baseBranch === right.baseBranch &&
    left.baseSha === right.baseSha &&
    left.ownerSessionId === right.ownerSessionId &&
    left.availability === right.availability &&
    left.reason === right.reason
}

/**
 * The default seed fleet: one session per provider kind in the process working
 * directory, titled by the provider display name. Each session's {@link SessionId}
 * is seeded equal to its provider kind, which is unambiguous while there is exactly
 * one session per provider; the config-driven sessions list (task_02) assigns
 * distinct ids for repeated providers without any change here.
 */
export function defaultSessionSeeds(cwd: string = process.cwd()): SessionSeed[] {
  return AGENT_IDS.map((providerKind) => ({
    id: providerKind,
    providerKind,
    title: PROVIDER_DISPLAY_NAMES[providerKind],
    cwd,
  }))
}
