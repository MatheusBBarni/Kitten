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
 * Per-agent selectors are curried: `selectAgentStatus("codex")` builds the selector
 * once. React callers should memoize that call (`useMemo`) so the selector identity
 * is stable across renders.
 */

import type { AgentId, AgentStatus, PendingDiff, PlanEntry, SessionState, Turn } from "../core/types.ts"
import type { AppState, ApprovalOverlay, HandoffPreviewOverlay, Selector } from "./appStore.ts"

/** The agent that currently owns keyboard focus. */
export const selectFocusedAgentId: Selector<AgentId> = (state) => state.focusedAgentId

/** Whether the given agent owns keyboard focus. For the status strip's focus marker. */
export const selectIsFocused =
  (agentId: AgentId): Selector<boolean> =>
  (state) =>
    state.focusedAgentId === agentId

/** One agent's full session. Changes on every event for that agent. */
export const selectAgentSession =
  (agentId: AgentId): Selector<SessionState> =>
  (state) =>
    state.sessions[agentId]

/** The focused agent's full session. Changes when focus moves or that agent updates. */
export const selectFocusedSession: Selector<SessionState> = (state) => state.sessions[state.focusedAgentId]

/** One agent's lifecycle status. The status strip subscribes to this per agent. */
export const selectAgentStatus =
  (agentId: AgentId): Selector<AgentStatus> =>
  (state) =>
    state.sessions[agentId].status

/** One agent's transcript. The conversation view subscribes to this. */
export const selectAgentTurns =
  (agentId: AgentId): Selector<Turn[]> =>
  (state) =>
    state.sessions[agentId].turns

/** One agent's most recent plan. */
export const selectAgentPlan =
  (agentId: AgentId): Selector<PlanEntry[]> =>
  (state) =>
    state.sessions[agentId].plan

/** One agent's proposed-but-unapplied edit diffs. */
export const selectAgentPendingDiffs =
  (agentId: AgentId): Selector<PendingDiff[]> =>
  (state) =>
    state.sessions[agentId].pendingDiffs

/** One agent's referenced files and the strongest access seen for each. */
export const selectAgentReferencedFiles =
  (agentId: AgentId): Selector<Map<string, "read" | "edited">> =>
  (state) =>
    state.sessions[agentId].referencedFiles

/** The pending permission request, or `null` when the approval overlay is closed. */
export const selectApprovalOverlay: Selector<ApprovalOverlay | null> = (state) => state.overlays.approval

/** The hand-off bundle awaiting confirmation, or `null` when the preview is closed. */
export const selectHandoffPreview: Selector<HandoffPreviewOverlay | null> = (state) => state.overlays.handoffPreview

/** Whether any overlay is open, for views that dim or disable the cockpit beneath. */
export const selectHasOpenOverlay: Selector<boolean> = (state) =>
  state.overlays.approval !== null || state.overlays.handoffPreview !== null
