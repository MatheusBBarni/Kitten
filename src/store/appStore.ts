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
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import type { AgentId, DomainSessionEvent, HandoffBundle, SessionState } from "../core/types.ts"

/** Every agent Kitten drives, in cockpit display order (ADR-001). */
export const AGENT_IDS: readonly AgentId[] = ["claude-code", "codex"]

/** Releases a subscription. Calling it more than once is a no-op. */
export type Unsubscribe = () => void

/** The approval overlay slot: one agent's pending permission request. */
export interface ApprovalOverlay {
  agentId: AgentId
  request: PermissionRequest
}

/** The hand-off preview slot: the bundle awaiting the user's curation and confirm. */
export interface HandoffPreviewOverlay {
  sourceAgentId: AgentId
  targetAgentId: AgentId
  bundle: HandoffBundle
}

/**
 * The overlay slots. At most one overlay of each kind exists at a time; the UI
 * (tasks 11 and 12) decides how to stack them. `null` means "closed".
 */
export interface OverlayState {
  approval: ApprovalOverlay | null
  handoffPreview: HandoffPreviewOverlay | null
}

/**
 * The whole application state.
 *
 * Per-agent status is not stored beside the session: it lives in
 * `sessions[agentId].status`, written by the reducer from `status` domain events.
 * Keeping one copy means the status strip and the transcript can never disagree.
 * Read it with the `selectAgentStatus` selector.
 */
export interface AppState {
  sessions: Record<AgentId, SessionState>
  focusedAgentId: AgentId
  overlays: OverlayState
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

  /** Apply one already-coalesced domain event to that agent's session slice. */
  applyEvent(agentId: AgentId, event: DomainSessionEvent): void
  /** Bind an agent to a (new) ACP session, resetting its transcript and status. */
  startSession(agentId: AgentId, sessionId: string): void
  /** Move keyboard focus to an agent. Focusing the focused agent is a no-op. */
  setFocus(agentId: AgentId): void

  /** Open the approval overlay for a pending permission request. */
  openApproval(overlay: ApprovalOverlay): void
  /** Clear the approval slot. Closing a closed slot is a no-op. */
  closeApproval(): void
  /** Open the hand-off preview overlay for the assembled bundle. */
  openHandoffPreview(overlay: HandoffPreviewOverlay): void
  /** Clear the hand-off preview slot. Closing a closed slot is a no-op. */
  closeHandoffPreview(): void
}

/** Construction options. Sessions start empty and idle unless a `sessionId` is given. */
export interface AppStoreOptions {
  /** Pre-bound ACP session ids per agent; defaults to `""` until `startSession`. */
  sessionIds?: Partial<Record<AgentId, string>>
  /** Which agent holds focus at startup. Defaults to the first agent. */
  focusedAgentId?: AgentId
}

/** Create an {@link AppStore} holding one empty session slice per agent. */
export function createAppStore(options: AppStoreOptions = {}): AppStore {
  return new AppStoreImpl(options)
}

class AppStoreImpl implements AppStore {
  private state: AppState
  private readonly listeners = new Set<(state: AppState, previous: AppState) => void>()

  constructor(options: AppStoreOptions) {
    this.state = {
      sessions: initialSessions(options.sessionIds),
      focusedAgentId: options.focusedAgentId ?? AGENT_IDS[0]!,
      overlays: { approval: null, handoffPreview: null },
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

  applyEvent(agentId: AgentId, event: DomainSessionEvent): void {
    const session = this.state.sessions[agentId]
    const next = sessionReducer(session, event)
    if (next === session) return
    this.commit({ ...this.state, sessions: { ...this.state.sessions, [agentId]: next } })
  }

  startSession(agentId: AgentId, sessionId: string): void {
    const fresh = createSessionState(agentId, sessionId)
    this.commit({ ...this.state, sessions: { ...this.state.sessions, [agentId]: fresh } })
  }

  setFocus(agentId: AgentId): void {
    if (this.state.focusedAgentId === agentId) return
    this.commit({ ...this.state, focusedAgentId: agentId })
  }

  openApproval(overlay: ApprovalOverlay): void {
    this.setOverlays({ approval: overlay })
  }

  closeApproval(): void {
    if (this.state.overlays.approval === null) return
    this.setOverlays({ approval: null })
  }

  openHandoffPreview(overlay: HandoffPreviewOverlay): void {
    this.setOverlays({ handoffPreview: overlay })
  }

  closeHandoffPreview(): void {
    if (this.state.overlays.handoffPreview === null) return
    this.setOverlays({ handoffPreview: null })
  }

  /** Replace one or both overlay slots, leaving the rest of the state identical. */
  private setOverlays(patch: Partial<OverlayState>): void {
    this.commit({ ...this.state, overlays: { ...this.state.overlays, ...patch } })
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

/** One empty, idle session slice per agent, optionally pre-bound to a session id. */
function initialSessions(sessionIds: Partial<Record<AgentId, string>> = {}): Record<AgentId, SessionState> {
  const sessions = {} as Record<AgentId, SessionState>
  for (const agentId of AGENT_IDS) {
    sessions[agentId] = createSessionState(agentId, sessionIds[agentId] ?? "")
  }
  return sessions
}
