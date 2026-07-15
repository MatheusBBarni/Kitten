/**
 * Pure, protocol-free state transitions and selectors for flat child delegation.
 * Runtime ownership, clocks, I/O, ACP, store state, and UI concerns stay outside.
 */

import type {
  DelegatedChildSnapshot,
  DelegatedChildStatus,
  DelegatedChildTerminalSnapshot,
  DelegatedChildTerminalStatus,
  DelegationAggregateStatus,
  DelegationEvent,
  DelegationParent,
  DelegationState,
  SessionId,
} from "./types.ts"

const EMPTY_CHILD_IDS = Object.freeze([]) as readonly SessionId[]

const TERMINAL_STATUSES: ReadonlySet<DelegatedChildStatus> = new Set([
  "finished",
  "failed",
  "cancelled",
])

const LEGAL_TRANSITIONS: Readonly<Record<DelegatedChildStatus, ReadonlySet<DelegatedChildStatus>>> = {
  starting: new Set(["running", "needs_input", "failed", "cancelled"]),
  running: new Set(["needs_input", "finished", "failed", "cancelled"]),
  needs_input: new Set(["running", "failed", "cancelled"]),
  finished: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

/** Create the empty ephemeral projection used at boot and after restore. */
export function createDelegationState(): DelegationState {
  return { parents: {}, children: {} }
}

/** Apply one invariant-checked delegation event with no-op identity preservation. */
export function delegationReducer(state: DelegationState, event: DelegationEvent): DelegationState {
  switch (event.kind) {
    case "register_child":
      return registerChild(state, event)
    case "publish_child_status":
      return publishChildStatus(state, event)
    case "mark_parent_closing":
      return markParentClosing(state, event.parentId, event.parentGeneration)
    case "remove_child":
      return removeChild(state, event)
    default:
      return assertNever(event)
  }
}

/** Return one parent record without allocating a selector wrapper. */
export function selectDelegationParent(
  state: DelegationState,
  parentId: SessionId,
): DelegationParent | undefined {
  return state.parents[parentId]
}

/** Return one child snapshot without allocating a selector wrapper. */
export function selectDelegatedChild(
  state: DelegationState,
  childId: SessionId,
): DelegatedChildSnapshot | undefined {
  return state.children[childId]
}

/** Return the exact ordered-id reference owned by a parent, or one shared empty reference. */
export function selectOrderedDelegatedChildIds(
  state: DelegationState,
  parentId: SessionId,
): readonly SessionId[] {
  return state.parents[parentId]?.childIds ?? EMPTY_CHILD_IDS
}

/** Resolve a parent's children in immutable registration order. */
export function selectOrderedDelegatedChildren(
  state: DelegationState,
  parentId: SessionId,
): readonly DelegatedChildSnapshot[] {
  return selectOrderedDelegatedChildIds(state, parentId).flatMap((childId) => {
    const child = state.children[childId]
    return child ? [child] : []
  })
}

/** Derive needs-input precedence, active work, or full settlement for one parent. */
export function selectDelegationAggregateStatus(
  state: DelegationState,
  parentId: SessionId,
): DelegationAggregateStatus | null {
  const children = selectOrderedDelegatedChildren(state, parentId)
  if (children.length === 0) return null
  if (children.some((child) => child.status === "needs_input")) return "needs_input"
  if (children.every((child) => isTerminalStatus(child.status))) return "settled"
  return "active"
}

/** A group settles only after every registered child has one terminal snapshot. */
export function isDelegationSettled(state: DelegationState, parentId: SessionId): boolean {
  return selectDelegationAggregateStatus(state, parentId) === "settled"
}

/** Return stable terminal snapshots in child registration order, omitting active children. */
export function selectDelegationTerminalOutcomes(
  state: DelegationState,
  parentId: SessionId,
): readonly DelegatedChildTerminalSnapshot[] {
  return selectOrderedDelegatedChildren(state, parentId).flatMap((child) =>
    child.terminal ? [child.terminal] : [],
  )
}

/** A child can leave the registry only after its lifecycle is permanently terminal. */
export function isDelegatedChildCleanupEligible(
  state: DelegationState,
  childId: SessionId,
): boolean {
  return state.children[childId]?.terminal !== undefined
}

/** A group is cleanup-eligible only when it exists and every child is terminal. */
export function isDelegationCleanupEligible(state: DelegationState, parentId: SessionId): boolean {
  return isDelegationSettled(state, parentId)
}

/** Closed predicate shared by reducer validation and downstream consumers. */
export function isTerminalDelegatedChildStatus(
  status: DelegatedChildStatus,
): status is DelegatedChildTerminalStatus {
  return isTerminalStatus(status)
}

function registerChild(
  state: DelegationState,
  event: Extract<DelegationEvent, { kind: "register_child" }>,
): DelegationState {
  if (
    event.parentId === event.childId ||
    !event.parentId ||
    !event.childId ||
    !event.task.trim() ||
    !event.desiredOutcome.trim() ||
    !validGeneration(event.parentGeneration) ||
    !validGeneration(event.childGeneration) ||
    state.children[event.childId] ||
    state.children[event.parentId] ||
    state.parents[event.childId]
  ) {
    return state
  }

  const existingParent = state.parents[event.parentId]
  if (
    existingParent &&
    (existingParent.parentGeneration !== event.parentGeneration ||
      existingParent.closeState === "closing")
  ) {
    return state
  }

  const child: DelegatedChildSnapshot = {
    childId: event.childId,
    parentId: event.parentId,
    parentGeneration: event.parentGeneration,
    childGeneration: event.childGeneration,
    status: "starting",
    task: event.task,
    desiredOutcome: event.desiredOutcome,
  }
  const parent: DelegationParent = existingParent
    ? { ...existingParent, childIds: [...existingParent.childIds, event.childId] }
    : {
        parentId: event.parentId,
        parentGeneration: event.parentGeneration,
        childIds: [event.childId],
        closeState: "open",
      }

  return {
    parents: { ...state.parents, [event.parentId]: parent },
    children: { ...state.children, [event.childId]: child },
  }
}

function publishChildStatus(
  state: DelegationState,
  event: Extract<DelegationEvent, { kind: "publish_child_status" }>,
): DelegationState {
  const child = currentChild(state, event)
  if (!child || child.terminal || child.status === event.status) return state
  if (!LEGAL_TRANSITIONS[child.status].has(event.status)) return state

  const terminal = isTerminalDelegatedChildStatus(event.status)
  if (terminal && (!("at" in event) || !Number.isFinite(event.at))) return state

  const nextChild: DelegatedChildSnapshot = terminal && "at" in event
    ? {
        ...child,
        status: event.status,
        terminal: { status: event.status, at: event.at },
      }
    : { ...child, status: event.status }

  return { ...state, children: { ...state.children, [event.childId]: nextChild } }
}

function markParentClosing(
  state: DelegationState,
  parentId: SessionId,
  parentGeneration: number,
): DelegationState {
  const parent = state.parents[parentId]
  if (
    !parent ||
    parent.parentGeneration !== parentGeneration ||
    parent.closeState === "closing"
  ) {
    return state
  }
  return {
    ...state,
    parents: { ...state.parents, [parentId]: { ...parent, closeState: "closing" } },
  }
}

function removeChild(
  state: DelegationState,
  event: Extract<DelegationEvent, { kind: "remove_child" }>,
): DelegationState {
  const child = currentChild(state, event)
  const parent = state.parents[event.parentId]
  if (!child?.terminal || !parent) return state

  const childIds = parent.childIds.filter((childId) => childId !== event.childId)
  const children = { ...state.children }
  delete children[event.childId]

  const parents = { ...state.parents }
  if (childIds.length === 0) delete parents[event.parentId]
  else parents[event.parentId] = { ...parent, childIds }

  return { parents, children }
}

function currentChild(
  state: DelegationState,
  identity: {
    readonly parentId: SessionId
    readonly childId: SessionId
    readonly parentGeneration: number
    readonly childGeneration: number
  },
): DelegatedChildSnapshot | undefined {
  const child = state.children[identity.childId]
  const parent = state.parents[identity.parentId]
  return child &&
    parent &&
    child.parentId === identity.parentId &&
    child.parentGeneration === identity.parentGeneration &&
    child.childGeneration === identity.childGeneration &&
    parent.parentGeneration === identity.parentGeneration
    ? child
    : undefined
}

function validGeneration(generation: number): boolean {
  return Number.isSafeInteger(generation) && generation >= 0
}

function isTerminalStatus(status: DelegatedChildStatus): status is DelegatedChildTerminalStatus {
  return TERMINAL_STATUSES.has(status)
}

function assertNever(event: never): never {
  throw new Error(`Unhandled delegation event: ${JSON.stringify(event)}`)
}
