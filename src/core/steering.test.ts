import { describe, expect, it } from "bun:test"

import {
  acknowledgeSteeringRecovery,
  beginSteeringCancellation,
  beginSteeringSend,
  coalesceSteeringBlocks,
  coalesceSteeringText,
  createSteeringState,
  deliverSteering,
  enqueueSteering,
  recoverSteering,
  settleSteeringCancellation,
  waitForSteeringBoundary,
} from "./steering.ts"
import type { PromptBlock, SteeringState } from "./types.ts"

const first: readonly PromptBlock[] = [{ type: "text", text: "first direction" }]
const second: readonly PromptBlock[] = [
  { type: "text", text: "second direction" },
  { type: "text", text: "keep this exact spacing  " },
]

function queued(): SteeringState {
  return enqueueSteering(createSteeringState(), "turn-1", "request-1", 7, first)
}

function sending(): SteeringState {
  const cancelling = beginSteeringCancellation(queued(), "request-1", 7)
  const settling = settleSteeringCancellation(cancelling, "request-1", 7)
  return beginSteeringSend(settling, "request-1", 7)
}

describe("steering lifecycle", () => {
  it("initializes one empty, recoverable lifecycle authority", () => {
    expect(createSteeringState()).toEqual({ activeTurnId: null, queue: [], recovery: null })
  })

  it("enqueues accepted directions in chronological order", () => {
    const one = queued()
    const two = enqueueSteering(one, "turn-1", "request-2", 7, second)

    expect(two.activeTurnId).toBe("turn-1")
    expect(two.queue.map(({ id, phase }) => ({ id, phase }))).toEqual([
      { id: "request-1", phase: "queued" },
      { id: "request-2", phase: "queued" },
    ])
    expect(coalesceSteeringBlocks(two)).toEqual([...first, ...second])
    expect(coalesceSteeringText(two)).toBe(
      "first direction\nsecond direction\nkeep this exact spacing  ",
    )
  })

  it("moves through every fallback phase with the current identity and generation", () => {
    const waiting = waitForSteeringBoundary(queued(), "request-1", 7)
    const cancelling = beginSteeringCancellation(waiting, "request-1", 7)
    const settling = settleSteeringCancellation(cancelling, "request-1", 7)
    const sendingState = beginSteeringSend(settling, "request-1", 7)
    const delivered = deliverSteering(sendingState, "request-1", 7)

    expect(waiting.queue[0]?.phase).toBe("waiting")
    expect(cancelling.queue[0]?.phase).toBe("cancelling")
    expect(settling.queue[0]?.phase).toBe("settling")
    expect(sendingState.queue[0]?.phase).toBe("sending")
    expect(delivered).toEqual(createSteeringState())
  })

  it("can begin cancellation directly when the boundary is already safe", () => {
    expect(beginSteeringCancellation(queued(), "request-1", 7).queue[0]?.phase).toBe(
      "cancelling",
    )
  })

  it("returns the identical state for stale ids, generations, invalid transitions, and duplicates", () => {
    const state = queued()

    expect(waitForSteeringBoundary(state, "stale", 7)).toBe(state)
    expect(waitForSteeringBoundary(state, "request-1", 6)).toBe(state)
    expect(beginSteeringSend(state, "request-1", 7)).toBe(state)

    const waiting = waitForSteeringBoundary(state, "request-1", 7)
    expect(waitForSteeringBoundary(waiting, "request-1", 7)).toBe(waiting)

    const delivered = deliverSteering(sending(), "request-1", 7)
    expect(deliverSteering(delivered, "request-1", 7)).toBe(delivered)
  })

  it("rejects duplicate requests, changed active turns, changed generations, and enqueue after failure", () => {
    const state = queued()
    expect(enqueueSteering(state, "turn-1", "request-1", 7, second)).toBe(state)
    expect(enqueueSteering(state, "turn-2", "request-2", 7, second)).toBe(state)
    expect(enqueueSteering(state, "turn-1", "request-2", 8, second)).toBe(state)
    expect(enqueueSteering(state, "turn-1", "request-2", 7, [])).toBe(state)

    const failed = recoverSteering(state, "request-1", 7)
    expect(enqueueSteering(failed, "turn-1", "request-2", 7, second)).toBe(failed)
  })

  it("retains exact ordered raw blocks through recovery until one acknowledgement", () => {
    const state = enqueueSteering(queued(), "turn-1", "request-2", 7, second)
    const failed = recoverSteering(state, "request-1", 7)

    expect(failed.queue[0]?.phase).toBe("failed")
    expect(failed.queue.slice(1)).toBeArrayOfSize(1)
    expect(failed.recovery).toEqual([...first, ...second])
    expect(failed.recovery?.[2]?.text).toBe("keep this exact spacing  ")
    expect(recoverSteering(failed, "request-1", 7)).toBe(failed)
    expect(acknowledgeSteeringRecovery(failed, "stale", 7)).toBe(failed)
    expect(acknowledgeSteeringRecovery(failed, "request-1", 8)).toBe(failed)

    const acknowledged = acknowledgeSteeringRecovery(failed, "request-1", 7)
    expect(acknowledged).toEqual(createSteeringState())
    expect(acknowledgeSteeringRecovery(acknowledged, "request-1", 7)).toBe(acknowledged)
  })

  it("allows every nonterminal phase to recover but never an empty lifecycle", () => {
    const states = [
      queued(),
      waitForSteeringBoundary(queued(), "request-1", 7),
      beginSteeringCancellation(queued(), "request-1", 7),
      settleSteeringCancellation(
        beginSteeringCancellation(queued(), "request-1", 7),
        "request-1",
        7,
      ),
      sending(),
    ]

    for (const state of states) {
      expect(recoverSteering(state, "request-1", 7).queue[0]?.phase).toBe("failed")
    }
    const empty = createSteeringState()
    expect(recoverSteering(empty, "request-1", 7)).toBe(empty)
  })
})
