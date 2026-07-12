/**
 * Pure, protocol-free session-tab workspace model.
 *
 * Agent execution remains owned by `sessionReducer`; this reducer owns only
 * user workspace lifecycle, ordering, selection, runtime standing, teardown,
 * and attention acknowledgement.
 */

import { needsAttention } from "./types.ts"
import type {
  AttentionRecord,
  ConversationAvailability,
  SessionId,
  SessionStatus,
  WorkspaceConversation,
  WorkspaceConversationSeed,
  WorkspaceEvent,
  WorkspaceState,
} from "./types.ts"

const ATTENTION_RANK: Readonly<Partial<Record<SessionStatus, number>>> = {
  awaiting_approval: 0,
  error: 1,
  finished: 2,
}

export interface CreateWorkspaceStateOptions {
  conversations?: readonly WorkspaceConversationSeed[]
  selectedVisibleId?: SessionId | null
}

/** Build a valid workspace from boot/restore seeds. Duplicate or invalid seeds are ignored. */
export function createWorkspaceState(options: CreateWorkspaceStateOptions = {}): WorkspaceState {
  const conversations: Record<SessionId, WorkspaceConversation> = {}
  const order: SessionId[] = []

  for (const [index, seed] of (options.conversations ?? []).entries()) {
    const displayName = normalizeDisplayName(seed.displayName)
    if (!displayName || conversations[seed.sessionId]) continue

    conversations[seed.sessionId] = {
      sessionId: seed.sessionId,
      displayName,
      lifecycle: seed.lifecycle ?? "visible",
      createdOrdinal: seed.createdOrdinal ?? index,
      availability: seed.availability ?? { kind: "starting" },
      teardownState: seed.teardownState ?? "open",
      attention: seed.attention ?? idleAttention(),
    }
    order.push(seed.sessionId)
  }

  const requested = options.selectedVisibleId ?? null
  const selectedVisibleId = isVisible(conversations[requested ?? ""])
    ? requested
    : (order.find((id) => isVisible(conversations[id])) ?? null)

  return { conversations, order, selectedVisibleId }
}

/** Apply one workspace event while preserving references for every unaffected entry. */
export function workspaceReducer(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.kind) {
    case "create":
      return createConversation(state, event)
    case "rename":
      return renameConversation(state, event.sessionId, event.displayName)
    case "select":
      return selectConversation(state, event.sessionId)
    case "select_adjacent":
      return selectAdjacent(state, event.direction)
    case "background":
      return backgroundConversation(state, event.sessionId)
    case "reopen":
      return reopenConversation(state, event.sessionId)
    case "set_availability":
      return updateAvailability(state, event.sessionId, event.availability)
    case "set_teardown_state":
      return updateConversation(state, event.sessionId, (conversation) =>
        conversation.teardownState === event.teardownState
          ? conversation
          : { ...conversation, teardownState: event.teardownState },
      )
    case "execution_status":
      return observeExecutionStatus(state, event.sessionId, event.status)
    case "close_succeeded":
      return closeConversation(state, event.sessionId)
    default:
      return assertNever(event)
  }
}

/** Return visible conversation IDs in stable workspace order. */
export function visibleConversationIds(state: WorkspaceState): SessionId[] {
  return state.order.filter((id) => isVisible(state.conversations[id]))
}

/** Lower values are more urgent; non-attention statuses have no queue rank. */
export function attentionRank(status: SessionStatus): number | null {
  return ATTENTION_RANK[status] ?? null
}

/**
 * Return unseen attention candidates by urgency, then nearest forward workspace
 * position from the selected conversation. Background conversations participate.
 */
export function attentionConversationIds(state: WorkspaceState): SessionId[] {
  const originIndex = state.selectedVisibleId ? state.order.indexOf(state.selectedVisibleId) : -1
  const size = state.order.length
  const forwardDistance = (id: SessionId): number => {
    const index = state.order.indexOf(id)
    return originIndex < 0 || size === 0 ? index : (index - originIndex + size) % size
  }

  return state.order
    .filter((id) => {
      const conversation = state.conversations[id]
      return Boolean(
        id !== state.selectedVisibleId &&
          conversation &&
          needsAttention(conversation.attention.status) &&
          !conversation.attention.seen,
      )
    })
    .sort((left, right) => {
      const leftConversation = state.conversations[left]!
      const rightConversation = state.conversations[right]!
      const rankDifference =
        (attentionRank(leftConversation.attention.status) ?? Number.MAX_SAFE_INTEGER) -
        (attentionRank(rightConversation.attention.status) ?? Number.MAX_SAFE_INTEGER)
      return rankDifference || forwardDistance(left) - forwardDistance(right)
    })
}

function createConversation(
  state: WorkspaceState,
  event: Extract<WorkspaceEvent, { kind: "create" }>,
): WorkspaceState {
  const displayName = normalizeDisplayName(event.displayName)
  if (!displayName || state.conversations[event.sessionId]) return state

  const status = event.initialStatus ?? "idle"
  const attention: AttentionRecord = {
    status,
    seen: true,
    sequence: needsAttention(status) ? 1 : 0,
  }
  const conversation: WorkspaceConversation = {
    sessionId: event.sessionId,
    displayName,
    lifecycle: "visible",
    createdOrdinal: nextCreatedOrdinal(state),
    availability: event.availability ?? { kind: "starting" },
    teardownState: "open",
    attention,
  }

  return {
    conversations: { ...state.conversations, [event.sessionId]: conversation },
    order: [...state.order, event.sessionId],
    selectedVisibleId: event.sessionId,
  }
}

function renameConversation(state: WorkspaceState, sessionId: SessionId, rawName: string): WorkspaceState {
  const displayName = normalizeDisplayName(rawName)
  if (!displayName) return state
  return updateConversation(state, sessionId, (conversation) =>
    conversation.displayName === displayName ? conversation : { ...conversation, displayName },
  )
}

function selectConversation(state: WorkspaceState, sessionId: SessionId): WorkspaceState {
  const conversation = state.conversations[sessionId]
  if (!isVisible(conversation)) return state

  const acknowledged = acknowledgeAttention(conversation)
  if (state.selectedVisibleId === sessionId && acknowledged === conversation) return state

  return {
    ...state,
    conversations:
      acknowledged === conversation
        ? state.conversations
        : { ...state.conversations, [sessionId]: acknowledged },
    selectedVisibleId: sessionId,
  }
}

function selectAdjacent(
  state: WorkspaceState,
  direction: Extract<WorkspaceEvent, { kind: "select_adjacent" }>["direction"],
): WorkspaceState {
  const visible = visibleConversationIds(state)
  if (visible.length === 0) return state

  const currentIndex = state.selectedVisibleId ? visible.indexOf(state.selectedVisibleId) : -1
  const nextIndex =
    currentIndex < 0
      ? direction === "next"
        ? 0
        : visible.length - 1
      : (currentIndex + (direction === "next" ? 1 : -1) + visible.length) % visible.length
  return selectConversation(state, visible[nextIndex]!)
}

function backgroundConversation(state: WorkspaceState, sessionId: SessionId): WorkspaceState {
  const conversation = state.conversations[sessionId]
  if (!isVisible(conversation) || conversation.teardownState === "closing") return state

  const selectedVisibleId =
    state.selectedVisibleId === sessionId ? nextVisibleAfter(state, sessionId) : state.selectedVisibleId
  return {
    ...state,
    conversations: {
      ...state.conversations,
      [sessionId]: { ...conversation, lifecycle: "background" },
    },
    selectedVisibleId,
  }
}

function reopenConversation(state: WorkspaceState, sessionId: SessionId): WorkspaceState {
  const conversation = state.conversations[sessionId]
  if (
    !conversation ||
    conversation.lifecycle !== "background" ||
    conversation.teardownState === "closing"
  ) {
    return state
  }

  const reopened = acknowledgeAttention({ ...conversation, lifecycle: "visible" })
  return {
    ...state,
    conversations: { ...state.conversations, [sessionId]: reopened },
    selectedVisibleId: sessionId,
  }
}

function updateAvailability(
  state: WorkspaceState,
  sessionId: SessionId,
  availability: ConversationAvailability,
): WorkspaceState {
  return updateConversation(state, sessionId, (conversation) =>
    sameAvailability(conversation.availability, availability)
      ? conversation
      : { ...conversation, availability },
  )
}

function observeExecutionStatus(
  state: WorkspaceState,
  sessionId: SessionId,
  status: SessionStatus,
): WorkspaceState {
  return updateConversation(state, sessionId, (conversation) => {
    if (conversation.attention.status === status) return conversation

    return {
      ...conversation,
      attention: {
        status,
        seen: !needsAttention(status),
        sequence: conversation.attention.sequence + (needsAttention(status) ? 1 : 0),
      },
    }
  })
}

function closeConversation(state: WorkspaceState, sessionId: SessionId): WorkspaceState {
  const conversation = state.conversations[sessionId]
  if (!conversation) return state

  const conversations = { ...state.conversations }
  delete conversations[sessionId]
  return {
    conversations,
    order: state.order.filter((id) => id !== sessionId),
    selectedVisibleId:
      state.selectedVisibleId === sessionId ? nextVisibleAfter(state, sessionId) : state.selectedVisibleId,
  }
}

function updateConversation(
  state: WorkspaceState,
  sessionId: SessionId,
  update: (conversation: WorkspaceConversation) => WorkspaceConversation,
): WorkspaceState {
  const conversation = state.conversations[sessionId]
  if (!conversation) return state
  const next = update(conversation)
  return next === conversation
    ? state
    : { ...state, conversations: { ...state.conversations, [sessionId]: next } }
}

function nextVisibleAfter(state: WorkspaceState, sessionId: SessionId): SessionId | null {
  const startIndex = state.order.indexOf(sessionId)
  for (let offset = 1; offset < state.order.length; offset += 1) {
    const candidate = state.order[(startIndex + offset) % state.order.length]!
    if (isVisible(state.conversations[candidate])) return candidate
  }
  return null
}

function acknowledgeAttention(conversation: WorkspaceConversation): WorkspaceConversation {
  return needsAttention(conversation.attention.status) && !conversation.attention.seen
    ? { ...conversation, attention: { ...conversation.attention, seen: true } }
    : conversation
}

function sameAvailability(left: ConversationAvailability, right: ConversationAvailability): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind !== "unavailable" || right.kind !== "unavailable") return true
  return left.reasonCode === right.reasonCode && left.retryable === right.retryable
}

function nextCreatedOrdinal(state: WorkspaceState): number {
  return state.order.reduce(
    (highest, id) => Math.max(highest, state.conversations[id]?.createdOrdinal ?? -1),
    -1,
  ) + 1
}

function idleAttention(): AttentionRecord {
  return { status: "idle", seen: true, sequence: 0 }
}

function isVisible(
  conversation: WorkspaceConversation | undefined,
): conversation is WorkspaceConversation & { lifecycle: "visible" } {
  return conversation?.lifecycle === "visible"
}

function normalizeDisplayName(displayName: string): string {
  return displayName.trim()
}

function assertNever(event: never): never {
  throw new Error(`Unhandled workspace event: ${JSON.stringify(event)}`)
}
