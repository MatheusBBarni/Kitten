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

import type { AgentStatus, PendingDiff, PlanEntry, SessionId, SessionState, Turn } from "../core/types.ts"
import type { AppState, ApprovalOverlay, HandoffPreviewOverlay, Selector } from "./appStore.ts"

/** The session that currently owns keyboard focus. */
export const selectFocusedSessionId: Selector<SessionId> = (state) => state.focusedSessionId

/** Whether the given session owns keyboard focus. For the status strip's focus marker. */
export const selectIsFocused =
  (sessionId: SessionId): Selector<boolean> =>
  (state) =>
    state.focusedSessionId === sessionId

/** One session's full state. Changes on every event for that session. */
export const selectSessionState =
  (sessionId: SessionId): Selector<SessionState> =>
  (state) =>
    state.sessions[sessionId]!

/** The focused session's full state. Changes when focus moves or that session updates. */
export const selectFocusedSession: Selector<SessionState> = (state) => state.sessions[state.focusedSessionId]!

/** One session's lifecycle status. The status strip subscribes to this per session. */
export const selectSessionStatus =
  (sessionId: SessionId): Selector<AgentStatus> =>
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

/** Every session id in display order. */
export const selectSessionOrder: Selector<SessionId[]> = (state) => state.order

/** The pending permission request, or `null` when the approval overlay is closed. */
export const selectApprovalOverlay: Selector<ApprovalOverlay | null> = (state) => state.overlays.approval

/**
 * Whether a permission request is awaiting the user. The shell reads this to stand
 * down its own key bindings, since the approval overlay is modal while it is open.
 */
export const selectIsApprovalOpen: Selector<boolean> = (state) => state.overlays.approval !== null

/** The hand-off bundle awaiting confirmation, or `null` when the preview is closed. */
export const selectHandoffPreview: Selector<HandoffPreviewOverlay | null> = (state) => state.overlays.handoffPreview

/** Whether any overlay is open, for views that dim or disable the cockpit beneath. */
export const selectHasOpenOverlay: Selector<boolean> = (state) =>
  state.overlays.approval !== null || state.overlays.handoffPreview !== null
