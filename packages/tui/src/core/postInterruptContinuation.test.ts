import { describe, expect, it } from "bun:test"

import {
  acknowledgePostInterruptContinuationRecovery,
  beginPostInterruptContinuationDispatch,
  coalescePostInterruptContinuationText,
  createPostInterruptContinuationState,
  deliverPostInterruptContinuation,
  enqueuePostInterruptContinuation,
  recoverPostInterruptContinuation,
  waitForPostInterruptContinuation,
} from "./postInterruptContinuation.ts"
import type { PostInterruptContinuationState, PromptBlock } from "./types.ts"

const blocks: readonly PromptBlock[] = [
  { type: "text", text: "continue with this" },
  { type: "text", text: "preserve exact spacing  " },
]

function queued(): PostInterruptContinuationState {
  return enqueuePostInterruptContinuation(
    createPostInterruptContinuationState(),
    "turn-interrupted",
    "continuation-1",
    7,
    blocks,
  )
}

function waiting(): PostInterruptContinuationState {
  return waitForPostInterruptContinuation(
    queued(),
    "turn-interrupted",
    "continuation-1",
    7,
  )
}

function dispatching(): PostInterruptContinuationState {
  return beginPostInterruptContinuationDispatch(
    waiting(),
    "turn-interrupted",
    "continuation-1",
    7,
  )
}

describe("post-interrupt continuation lifecycle", () => {
  it("initializes one empty live-only lifecycle", () => {
    expect(createPostInterruptContinuationState()).toEqual({
      interruptedTurnId: null,
      request: null,
      recovery: null,
    })
  })

  it("moves one request through queued, waiting, dispatching, and delivery", () => {
    const queuedState = queued()
    const waitingState = waiting()
    const dispatchingState = dispatching()
    const delivered = deliverPostInterruptContinuation(
      dispatchingState,
      "turn-interrupted",
      "continuation-1",
      7,
    )

    expect(queuedState).toEqual({
      interruptedTurnId: "turn-interrupted",
      request: {
        id: "continuation-1",
        generation: 7,
        blocks,
        phase: "queued",
      },
      recovery: null,
    })
    expect(queuedState.request?.blocks).not.toBe(blocks)
    expect(waitingState.request?.phase).toBe("waiting")
    expect(dispatchingState.request?.phase).toBe("dispatching")
    expect(coalescePostInterruptContinuationText(dispatchingState)).toBe(
      "continue with this\npreserve exact spacing  ",
    )
    expect(delivered).toEqual(createPostInterruptContinuationState())
  })

  it("admits dispatch directly from queued when settlement already exists", () => {
    expect(
      beginPostInterruptContinuationDispatch(
        queued(),
        "turn-interrupted",
        "continuation-1",
        7,
      ).request?.phase,
    ).toBe("dispatching")
  })

  it("rejects a second slot, duplicate request, replacement generation, and invalid input", () => {
    const state = queued()
    const otherBlocks: readonly PromptBlock[] = [{ type: "text", text: "replacement" }]

    expect(
      enqueuePostInterruptContinuation(
        state,
        "turn-interrupted",
        "continuation-1",
        7,
        otherBlocks,
      ),
    ).toBe(state)
    expect(
      enqueuePostInterruptContinuation(
        state,
        "turn-interrupted",
        "continuation-2",
        7,
        otherBlocks,
      ),
    ).toBe(state)
    expect(
      enqueuePostInterruptContinuation(
        state,
        "turn-interrupted",
        "continuation-2",
        8,
        otherBlocks,
      ),
    ).toBe(state)

    const idle = createPostInterruptContinuationState()
    expect(enqueuePostInterruptContinuation(idle, "", "continuation-1", 7, blocks)).toBe(
      idle,
    )
    expect(enqueuePostInterruptContinuation(idle, "turn", "", 7, blocks)).toBe(idle)
    expect(enqueuePostInterruptContinuation(idle, "turn", "request", -1, blocks)).toBe(idle)
    expect(enqueuePostInterruptContinuation(idle, "turn", "request", 7, [])).toBe(idle)
  })

  it("returns the existing state for stale, wrong-turn, and illegal lifecycle events", () => {
    const state = queued()

    expect(
      waitForPostInterruptContinuation(state, "turn-stale", "continuation-1", 7),
    ).toBe(state)
    expect(
      waitForPostInterruptContinuation(state, "turn-interrupted", "continuation-stale", 7),
    ).toBe(state)
    expect(
      waitForPostInterruptContinuation(state, "turn-interrupted", "continuation-1", 6),
    ).toBe(state)
    expect(
      deliverPostInterruptContinuation(state, "turn-interrupted", "continuation-1", 7),
    ).toBe(state)

    const waitingState = waiting()
    expect(
      waitForPostInterruptContinuation(
        waitingState,
        "turn-interrupted",
        "continuation-1",
        7,
      ),
    ).toBe(waitingState)

    const delivered = deliverPostInterruptContinuation(
      dispatching(),
      "turn-interrupted",
      "continuation-1",
      7,
    )
    expect(
      deliverPostInterruptContinuation(
        delivered,
        "turn-interrupted",
        "continuation-1",
        7,
      ),
    ).toBe(delivered)
  })

  it("recovers exact blocks from every live phase and clears them after one acknowledgement", () => {
    for (const state of [queued(), waiting(), dispatching()]) {
      const recovered = recoverPostInterruptContinuation(
        state,
        "turn-interrupted",
        "continuation-1",
        7,
      )

      expect(recovered.request?.phase).toBe("recovery")
      expect(recovered.recovery).toEqual(blocks)
      expect(recovered.recovery).not.toBe(state.request?.blocks)
      expect(recovered.recovery?.[1]?.text).toBe("preserve exact spacing  ")
      expect(
        recoverPostInterruptContinuation(
          recovered,
          "turn-interrupted",
          "continuation-1",
          7,
        ),
      ).toBe(recovered)
      expect(
        acknowledgePostInterruptContinuationRecovery(
          recovered,
          "turn-stale",
          "continuation-1",
          7,
        ),
      ).toBe(recovered)
      expect(
        acknowledgePostInterruptContinuationRecovery(
          recovered,
          "turn-interrupted",
          "continuation-1",
          8,
        ),
      ).toBe(recovered)

      const acknowledged = acknowledgePostInterruptContinuationRecovery(
        recovered,
        "turn-interrupted",
        "continuation-1",
        7,
      )
      expect(acknowledged).toEqual(createPostInterruptContinuationState())
      expect(
        acknowledgePostInterruptContinuationRecovery(
          acknowledged,
          "turn-interrupted",
          "continuation-1",
          7,
        ),
      ).toBe(acknowledged)
    }
  })
})
