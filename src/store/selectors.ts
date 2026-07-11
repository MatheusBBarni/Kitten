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
import type {
  ConfigOption,
  PendingDiff,
  PlanEntry,
  ProviderKind,
  SessionId,
  SessionState,
  SessionStatus,
  ShellState,
  ThemePreference,
  Turn,
} from "../core/types.ts"
import type {
  AppState,
  ApprovalOverlay,
  FocusedPane,
  HandoffPreviewOverlay,
  HandoffTargetOverlay,
  ModelSelectOverlay,
  SettingsOverlay,
  Selector,
} from "./appStore.ts"

/**
 * The needs-you predicate, re-exported from the core (ADR-006). It is the pure
 * domain function {@link needsAttention} defined beside {@link SessionStatus}; the
 * store surfaces it here so every attention reader - the overview, the notifier,
 * and {@link selectNextNeedy} below - reaches one definition.
 */
export { needsAttention }

/** The active conversation, retained while the shell owns keyboard focus. */
export const selectFocusedSessionId: Selector<SessionId> = (state) => state.focusedSessionId

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
    state.focusedPane.kind === "agent" && state.focusedPane.agentId === sessionId

/** One session's full state. Changes on every event for that session. */
export const selectSessionState =
  (sessionId: SessionId): Selector<SessionState> =>
  (state) =>
    state.sessions[sessionId]!

/** The focused session's full state. Changes when focus moves or that session updates. */
export const selectFocusedSession: Selector<SessionState> = (state) => state.sessions[state.focusedSessionId]!

/** One session's lifecycle status. The status strip subscribes to this per session. */
export const selectSessionStatus =
  (sessionId: SessionId): Selector<SessionStatus> =>
  (state) =>
    state.sessions[sessionId]!.status

/** One session's transcript. The conversation view subscribes to this. */
export const selectSessionTurns =
  (sessionId: SessionId): Selector<Turn[]> =>
  (state) =>
    state.sessions[sessionId]!.turns

/** One session's most recent plan. */
export const selectSessionPlan =
  (sessionId: SessionId): Selector<PlanEntry[]> =>
  (state) =>
    state.sessions[sessionId]!.plan

/** One session's proposed-but-unapplied edit diffs. */
export const selectSessionPendingDiffs =
  (sessionId: SessionId): Selector<PendingDiff[]> =>
  (state) =>
    state.sessions[sessionId]!.pendingDiffs

/** One session's referenced files and the strongest access seen for each. */
export const selectSessionReferencedFiles =
  (sessionId: SessionId): Selector<Map<string, "read" | "edited">> =>
  (state) =>
    state.sessions[sessionId]!.referencedFiles

/**
 * One session's full advertised config-option set (ADR-003), returned unfiltered so
 * the reference stays stable across unrelated updates - the reducer replaces this
 * array only on a `config_options` event, so a subscriber wakes only on a real change.
 * The selector overlay applies {@link visibleConfigOptions} to the result and memoizes
 * it; keeping the raw slice here is what preserves referential stability.
 */
export const selectAgentConfigOptions =
  (sessionId: SessionId): Selector<ConfigOption[]> =>
  (state) =>
    state.sessions[sessionId]!.configOptions

/**
 * One session's confirmed model, or `undefined` when the agent advertises no `model`
 * category. A primitive slice, so it compares by value and the status strip re-renders
 * only when the live model actually changes.
 */
export const selectAgentModel =
  (sessionId: SessionId): Selector<string | undefined> =>
  (state) =>
    state.sessions[sessionId]!.configOptions.find((option) => option.category === MODEL_CATEGORY)?.currentValue

/**
 * One session's confirmed reasoning effort, or `undefined` when the agent advertises no
 * `thought_level` category. A primitive slice like {@link selectAgentModel}.
 */
export const selectAgentEffort =
  (sessionId: SessionId): Selector<string | undefined> =>
  (state) =>
    state.sessions[sessionId]!.configOptions.find((option) => option.category === EFFORT_CATEGORY)?.currentValue

/** Every session id in display order. */
export const selectSessionOrder: Selector<SessionId[]> = (state) => state.order

/** One row of {@link selectSessionList}: a session's identity plus its live status. */
export interface SessionListItem {
  id: SessionId
  title: string
  providerKind: ProviderKind
  /** The session's own working directory (ADR-005). The overview card shows it. */
  cwd: string
  status: SessionStatus
  /** Whether this session's status is one the developer must act on (ADR-006). */
  needsAttention: boolean
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
 * Every session with its status, in display order (ADR-006). The Ctrl+S overview
 * (task_05) reads this to draw its card list and mark which rows need you. It is
 * memoized per state object (see {@link sessionListCache}): a subscriber wakes on any
 * committed change but a repeated read of the same state returns the same array.
 */
export const selectSessionList: Selector<SessionListItem[]> = (state) => {
  const cached = sessionListCache.get(state)
  if (cached) return cached
  const list = state.order.map((id) => {
    const session = state.sessions[id]!
    return {
      id,
      title: session.title,
      providerKind: session.providerKind,
      cwd: session.cwd,
      status: session.status,
      needsAttention: needsAttention(session.status),
    }
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
  (afterSessionId: SessionId): Selector<SessionId | null> =>
  (state) => {
    const { order } = state
    const count = order.length
    if (count === 0) return null
    const pivot = order.indexOf(afterSessionId)

    // Walk the order forward from just after the pivot, wrapping around, so ties in
    // rank are broken by nearest-after-pivot (a strict `<` keeps the first, i.e. the
    // closest, of each rank). When the pivot is absent (-1) this starts at index 0
    // and visits every session once.
    let best: { id: SessionId; rank: number } | null = null
    for (let step = 1; step <= count; step++) {
      const id = order[(pivot + step) % count]!
      if (id === afterSessionId) continue
      const status = state.sessions[id]!.status
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
 * Whether the Ctrl+S sessions overview is open (task_05). The overview is modal like
 * the other overlays, so it too is folded into {@link selectHasOpenOverlay} and stands
 * the shell's chords down while it is up.
 */
export const selectIsSessionsOpen: Selector<boolean> = (state) => state.overlays.sessions

/**
 * The session whose model/effort selector is open (ADR-004), or `null` when the
 * selector is closed. The overlay reads this to know which session to drive and
 * {@link selectAgentConfigOptions} to draw its list.
 */
export const selectModelSelectOverlay: Selector<ModelSelectOverlay | null> = (state) => state.overlays.modelSelect

/** The active settings tab, or `null` while the settings modal is closed. */
export const selectSettingsOverlay: Selector<SettingsOverlay | null> = (state) => state.overlays.settings

/** Whether any overlay is open, for views that dim or disable the cockpit beneath. */
export const selectHasOpenOverlay: Selector<boolean> = (state) =>
  state.overlays.approval !== null ||
  state.overlays.handoffPreview !== null ||
  state.overlays.handoffTarget !== null ||
  state.overlays.modelSelect !== null ||
  state.overlays.settings !== null ||
  state.overlays.sessions
