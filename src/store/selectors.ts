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
import { attentionConversationIds } from "../core/workspace.ts"
import type { PromptHistoryState } from "../core/promptHistory.ts"
import type {
  AvailableCommand,
  ConfigOption,
  ContextUsage,
  PendingDiff,
  PlanEntry,
  ProviderKind,
  SessionId,
  SessionState,
  SessionStatus,
  ShellState,
  ThemePreference,
  Turn,
  HandoffBundle,
  ConversationAvailability,
  TeardownState,
  WorkspaceConversation,
  WorkspaceState,
  WorkspaceNotice,
} from "../core/types.ts"
import type {
  AppState,
  ApprovalOverlay,
  FocusedPane,
  HandoffPreviewOverlay,
  HandoffTargetOverlay,
  KeyboardCapability,
  ModelSelectOverlay,
  RestorationMode,
  SettingsOverlay,
  Selector,
  TabDialogOverlay,
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

/** The active conversation, retained while the shell owns keyboard focus. */
export const selectFocusedSessionId: Selector<SessionId | null> = (state) =>
  state.workspace.selectedVisibleId

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

/** One session's lifecycle status. The status strip subscribes to this per session. */
export const selectSessionStatus =
  (sessionId: SessionId | null): Selector<SessionStatus> =>
  (state) =>
    (sessionId ? state.sessions[sessionId]?.status : undefined) ?? "idle"

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
}

/**
 * Cache of one derived list per {@link AppState} object. The store commits a fresh
 * `AppState` on every change and keeps unchanged ones by identity (structural
 * sharing), so keying on the state object gives {@link selectSessionList} a stable
 * reference between commits - which `useSyncExternalStore` requires of its snapshot -
 * while still rebuilding on any real change. A `WeakMap` keeps it correct across
 * concurrent stores and lets a superseded state (and its list) be collected.
 */
const sessionListCache = new WeakMap<AppState, SessionListItem[]>()

/**
 * Every session with its status, in display order (ADR-006). The `/sessions` overview
 * (task_05) reads this to draw its card list and mark which rows need you. It is
 * memoized per state object (see {@link sessionListCache}): a subscriber wakes on any
 * committed change but a repeated read of the same state returns the same array.
 */
export const selectSessionList: Selector<SessionListItem[]> = (state) => {
  const cached = sessionListCache.get(state)
  if (cached) return cached
  const list = state.workspace.order.flatMap((id) => {
    const session = state.sessions[id]!
    const conversation = state.workspace.conversations[id]
    if (!session || !conversation) return []
    const duplicate = duplicatePosition(state, id)
    return [{
      id,
      title: conversation.displayName,
      label:
        duplicate.count > 1
          ? `${conversation.displayName} (${duplicate.index})`
          : conversation.displayName,
      providerKind: session.providerKind,
      cwd: session.cwd,
      status: session.status,
      needsAttention: needsAttention(session.status),
      lifecycle: conversation.lifecycle,
      selected: state.workspace.selectedVisibleId === id,
      attentionSeen: conversation.attention.seen,
    }]
  })
  sessionListCache.set(state, list)
  return list
}

/**
 * The rank a needs-you status carries when several sessions want attention at once
 * (ADR-006): an approval blocks an agent and is answered first, a crash is next, a
 * finished turn last. Non-attention statuses never appear as candidates.
 */
const ATTENTION_RANK: Readonly<Record<SessionStatus, number>> = {
  awaiting_approval: 0,
  error: 1,
  finished: 2,
  working: Number.POSITIVE_INFINITY,
  idle: Number.POSITIVE_INFINITY,
}

/**
 * The next session that needs you after `afterSessionId`, or `null` when none does
 * (ADR-006). This is what the jump-to-next action (task_05) sets focus to.
 *
 * Candidates are every needs-you session except `afterSessionId` itself. They are
 * ranked first by status priority (`awaiting_approval` before `error` before
 * `finished`), then by distance walking the `order` array forward from the pivot and
 * wrapping around - so among equal-priority sessions the one just after the pivot
 * wins, and a lone needy session earlier in the order is still found by wrapping.
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

/** The captured-target rename/close dialog, below approval in modal precedence. */
export const selectTabDialogOverlay: Selector<TabDialogOverlay | null> = (state) =>
  state.overlays.tabDialog

export type ActiveModal =
  | { kind: "approval"; sessionId: SessionId }
  | { kind: "tab-dialog"; sessionId: SessionId }
  | { kind: "sessions" }
  | { kind: "session-picker" }
  | { kind: "model-select"; sessionId: SessionId }
  | { kind: "settings" }
  | { kind: "handoff-target"; sessionId: SessionId }
  | null

/** Explicit modal precedence; approval identity always wins over a captured tab target. */
export const selectActiveModal: Selector<ActiveModal> = (state) => {
  const overlays = state.overlays
  if (overlays.approval) return { kind: "approval", sessionId: overlays.approval.sessionId }
  if (overlays.tabDialog) return { kind: "tab-dialog", sessionId: overlays.tabDialog.sessionId }
  if (overlays.sessions) return { kind: "sessions" }
  if (overlays.sessionPicker) return { kind: "session-picker" }
  if (overlays.modelSelect) return { kind: "model-select", sessionId: overlays.modelSelect.sessionId }
  if (overlays.settings) return { kind: "settings" }
  if (overlays.handoffTarget) return { kind: "handoff-target", sessionId: overlays.handoffTarget.sourceSessionId }
  return null
}

/** Whether any overlay is open, for views that dim or disable the cockpit beneath. */
export const selectHasOpenOverlay: Selector<boolean> = (state) =>
  state.overlays.approval !== null ||
  state.overlays.handoffPreview !== null ||
  state.overlays.handoffTarget !== null ||
  state.overlays.modelSelect !== null ||
  state.overlays.settings !== null ||
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

const workspaceListCache = new WeakMap<WorkspaceState, WorkspaceListCache>()
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
  const key = [
    session.providerKind,
    session.cwd,
    session.status,
    selected,
    duplicate.index,
    duplicate.count,
    sharedCount,
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
  }
  byKey.set(key, view)
  return view
}

function stableList(
  workspace: WorkspaceState,
  slot: "visible" | "background" | "attention",
  next: WorkspaceConversationView[],
): WorkspaceConversationView[] {
  let cache = workspaceListCache.get(workspace)
  if (!cache) {
    cache = {}
    workspaceListCache.set(workspace, cache)
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

export const selectVisibleTabs: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state.workspace,
    "visible",
    state.workspace.order.flatMap((id) => {
      if (state.workspace.conversations[id]?.lifecycle !== "visible") return []
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectBackgroundWork: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state.workspace,
    "background",
    state.workspace.order.flatMap((id) => {
      if (state.workspace.conversations[id]?.lifecycle !== "background") return []
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectAttentionQueue: Selector<WorkspaceConversationView[]> = (state) =>
  stableList(
    state.workspace,
    "attention",
    attentionConversationIds(state.workspace).flatMap((id) => {
      const item = workspaceConversationView(state, id)
      return item ? [item] : []
    }),
  )

export const selectNextAttention: Selector<SessionId | null> = (state) =>
  attentionConversationIds(state.workspace)[0] ?? null

export const selectDuplicateLabels: Selector<Readonly<Record<SessionId, string>>> = (state) => {
  let cache = workspaceListCache.get(state.workspace)
  if (!cache) {
    cache = {}
    workspaceListCache.set(state.workspace, cache)
  }
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
  let cache = workspaceListCache.get(state.workspace)
  if (!cache) {
    cache = {}
    workspaceListCache.set(state.workspace, cache)
  }
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
