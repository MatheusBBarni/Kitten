import type { PromptBlock, SteeringPhase, SteeringRequest, SteeringState } from "./types.ts"

/** The empty lifecycle installed in every session state. */
export function createSteeringState(): SteeringState {
  return { activeTurnId: null, queue: [], recovery: null }
}

/** Append one direction without disturbing an in-progress head request. */
export function enqueueSteering(
  state: SteeringState,
  activeTurnId: string,
  requestId: string,
  generation: number,
  blocks: readonly PromptBlock[],
): SteeringState {
  if (
    activeTurnId.length === 0 ||
    requestId.length === 0 ||
    blocks.length === 0 ||
    state.recovery !== null ||
    state.queue.some((request) => request.id === requestId) ||
    (state.activeTurnId !== null && state.activeTurnId !== activeTurnId) ||
    (state.queue[0] !== undefined && state.queue[0].generation !== generation)
  ) {
    return state
  }

  const request: SteeringRequest = {
    id: requestId,
    generation,
    blocks: [...blocks],
    phase: "queued",
  }
  return {
    activeTurnId,
    queue: [...state.queue, request],
    recovery: null,
  }
}

/** Record that the head request is waiting for a safe interaction boundary. */
export function waitForSteeringBoundary(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  return moveHead(state, requestId, generation, ["queued"], "waiting")
}

/** Begin fallback cancellation once the interaction boundary is safe. */
export function beginSteeringCancellation(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  return moveHead(state, requestId, generation, ["queued", "waiting"], "cancelling")
}

/** Record that cancellation was accepted and terminal settlement is pending. */
export function settleSteeringCancellation(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  return moveHead(state, requestId, generation, ["cancelling"], "settling")
}

/** Begin the single coalesced follow-up send after terminal settlement. */
export function beginSteeringSend(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  return moveHead(state, requestId, generation, ["settling"], "sending")
}

/** Clear all queued raw blocks only after confirmed delivery. */
export function deliverSteering(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  const current = currentRequest(state, requestId, generation)
  if (current?.phase !== "sending" || state.recovery !== null) return state
  return createSteeringState()
}

/** Terminalize the queue while retaining an exact, ordered recovery payload. */
export function recoverSteering(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  const current = currentRequest(state, requestId, generation)
  if (
    current === undefined ||
    current.phase === "idle" ||
    current.phase === "failed" ||
    state.recovery !== null
  ) {
    return state
  }

  return {
    ...state,
    queue: replaceHead(state.queue, { ...current, phase: "failed" }),
    recovery: coalesceSteeringBlocks(state),
  }
}

/** Clear the terminal payload exactly once after the composer has copied it. */
export function acknowledgeSteeringRecovery(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringState {
  const current = currentRequest(state, requestId, generation)
  if (current?.phase !== "failed" || state.recovery === null) return state
  return createSteeringState()
}

/** Flatten request blocks in acceptance order without changing their content. */
export function coalesceSteeringBlocks(state: SteeringState): readonly PromptBlock[] {
  return state.queue.flatMap((request) => request.blocks)
}

/** Convert confirmed ordered blocks into the one normal user transcript turn. */
export function coalesceSteeringText(state: SteeringState): string {
  return coalesceSteeringBlocks(state).map((block) => block.text).join("\n")
}

function moveHead(
  state: SteeringState,
  requestId: string,
  generation: number,
  from: readonly SteeringPhase[],
  phase: SteeringPhase,
): SteeringState {
  const current = currentRequest(state, requestId, generation)
  if (current === undefined || state.recovery !== null || !from.includes(current.phase)) return state
  return { ...state, queue: replaceHead(state.queue, { ...current, phase }) }
}

function currentRequest(
  state: SteeringState,
  requestId: string,
  generation: number,
): SteeringRequest | undefined {
  const current = state.queue[0]
  return current?.id === requestId && current.generation === generation ? current : undefined
}

function replaceHead(
  queue: readonly SteeringRequest[],
  request: SteeringRequest,
): readonly SteeringRequest[] {
  return [request, ...queue.slice(1)]
}
