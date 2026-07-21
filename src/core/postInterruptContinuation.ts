import type {
  PostInterruptContinuationPhase,
  PostInterruptContinuationRequest,
  PostInterruptContinuationState,
  PromptBlock,
} from "./types.ts"

/** The empty live-only lifecycle installed in every session state. */
export function createPostInterruptContinuationState(): PostInterruptContinuationState {
  return { interruptedTurnId: null, request: null, recovery: null }
}

/** Accept exactly one generation-bound continuation after an explicit interruption. */
export function enqueuePostInterruptContinuation(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
  blocks: readonly PromptBlock[],
): PostInterruptContinuationState {
  if (
    interruptedTurnId.length === 0 ||
    requestId.length === 0 ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    blocks.length === 0 ||
    state.interruptedTurnId !== null ||
    state.request !== null ||
    state.recovery !== null
  ) {
    return state
  }

  return {
    interruptedTurnId,
    request: {
      id: requestId,
      generation,
      blocks: [...blocks],
      phase: "queued",
    },
    recovery: null,
  }
}

/** Record that the accepted continuation is waiting for the interrupted turn boundary. */
export function waitForPostInterruptContinuation(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationState {
  return moveRequest(
    state,
    interruptedTurnId,
    requestId,
    generation,
    ["queued"],
    "waiting",
  )
}

/** Admit the single ordinary dispatch after the controller confirms it is safe. */
export function beginPostInterruptContinuationDispatch(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationState {
  return moveRequest(
    state,
    interruptedTurnId,
    requestId,
    generation,
    ["queued", "waiting"],
    "dispatching",
  )
}

/** Clear the live request only after ordinary dispatch is acknowledged. */
export function deliverPostInterruptContinuation(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationState {
  const request = currentRequest(state, interruptedTurnId, requestId, generation)
  if (request?.phase !== "dispatching" || state.recovery !== null) return state
  return createPostInterruptContinuationState()
}

/** Retain the exact request blocks for one local composer recovery. */
export function recoverPostInterruptContinuation(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationState {
  const request = currentRequest(state, interruptedTurnId, requestId, generation)
  if (
    !request ||
    request.phase === "idle" ||
    request.phase === "recovery" ||
    state.recovery !== null
  ) {
    return state
  }

  return {
    ...state,
    request: { ...request, phase: "recovery" },
    recovery: [...request.blocks],
  }
}

/** Clear the recovered payload exactly once after the composer copies it. */
export function acknowledgePostInterruptContinuationRecovery(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationState {
  const request = currentRequest(state, interruptedTurnId, requestId, generation)
  if (request?.phase !== "recovery" || state.recovery === null) return state
  return createPostInterruptContinuationState()
}

/** Convert the accepted blocks into the eventual ordinary user-turn text. */
export function coalescePostInterruptContinuationText(
  state: PostInterruptContinuationState,
): string {
  return state.request?.blocks.map((block) => block.text).join("\n") ?? ""
}

function moveRequest(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
  from: readonly PostInterruptContinuationPhase[],
  phase: PostInterruptContinuationPhase,
): PostInterruptContinuationState {
  const request = currentRequest(state, interruptedTurnId, requestId, generation)
  if (!request || state.recovery !== null || !from.includes(request.phase)) return state
  return { ...state, request: { ...request, phase } }
}

function currentRequest(
  state: PostInterruptContinuationState,
  interruptedTurnId: string,
  requestId: string,
  generation: number,
): PostInterruptContinuationRequest | null {
  const request = state.request
  return state.interruptedTurnId === interruptedTurnId &&
    request?.id === requestId &&
    request.generation === generation
    ? request
    : null
}
