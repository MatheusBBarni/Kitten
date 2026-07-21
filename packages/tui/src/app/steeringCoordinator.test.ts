import { describe, expect, it } from "bun:test"

import type { PromptBlock } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import {
  createSteeringCoordinator,
  STEERING_FOLLOW_UP_PREFIX,
  STEERING_TERMINAL_SETTLEMENT_TIMEOUT_MS,
  type SteeringCoordinatorOptions,
} from "./steeringCoordinator.ts"

const SESSION_ID = "steering-session"
const GENERATION = 7

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function drain(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

function setup(overrides: Partial<SteeringCoordinatorOptions> = {}) {
  const store = createAppStore({
    seeds: [{ id: SESSION_ID, providerKind: "codex", title: "Codex", cwd: "/repo" }],
    selectedVisibleId: SESSION_ID,
  })
  store.applyEvent(SESSION_ID, {
    kind: "steering_enqueue",
    activeTurnId: "turn-1",
    requestId: "request-1",
    generation: GENERATION,
    blocks: [{ type: "text", text: "first direction" }],
  })
  const cancellations = deferred()
  const settlement = deferred()
  const followUp = deferred()
  const sent: readonly PromptBlock[][] = []
  let pendingInteraction = false
  let timeout: (() => void) | null = null
  let timeoutMs: number | null = null
  const outcomes: string[] = []
  const errors: string[] = []
  const coordinator = createSteeringCoordinator({
    sessionId: SESSION_ID,
    generation: GENERATION,
    store,
    hasPendingInteraction: () => pendingInteraction,
    cancelActiveTurn: () => cancellations.promise,
    terminalSettlement: () => settlement.promise,
    sendFollowUp: (blocks) => {
      ;(sent as PromptBlock[][]).push([...blocks])
      return followUp.promise
    },
    newMessageId: () => "steering-user-turn",
    scheduleSettlementTimeout: (callback, bound) => {
      timeout = callback
      timeoutMs = bound
      return () => {
        timeout = null
      }
    },
    onOutcome: (_requestId, outcome) => outcomes.push(outcome),
    onError: (reason) => errors.push(reason),
    ...overrides,
  })
  return {
    store,
    coordinator,
    cancellations,
    settlement,
    followUp,
    sent,
    outcomes,
    errors,
    pending: (value: boolean) => {
      pendingInteraction = value
    },
    fireTimeout: () => timeout?.(),
    timeoutMs: () => timeoutMs,
  }
}

describe("createSteeringCoordinator", () => {
  it("waits for a targeted interaction, then cancels, settles, and sends one ordered follow-up", async () => {
    const test = setup()
    test.pending(true)
    test.coordinator.advance()
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("waiting")

    test.store.applyEvent(SESSION_ID, {
      kind: "steering_enqueue",
      activeTurnId: "turn-1",
      requestId: "request-2",
      generation: GENERATION,
      blocks: [{ type: "text", text: "second direction" }],
    })
    test.pending(false)
    test.coordinator.advance()
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("cancelling")

    test.cancellations.resolve()
    await drain()
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("settling")
    expect(test.timeoutMs()).toBe(STEERING_TERMINAL_SETTLEMENT_TIMEOUT_MS)

    test.settlement.resolve()
    await drain()
    expect(test.sent).toEqual([[
      { type: "text", text: STEERING_FOLLOW_UP_PREFIX },
      { type: "text", text: "first direction" },
      { type: "text", text: "second direction" },
    ]])
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("sending")

    test.followUp.resolve()
    await drain()
    const session = test.store.getState().sessions[SESSION_ID]!
    expect(session.steering.queue).toEqual([])
    expect(session.turns).toContainEqual({
      kind: "user",
      messageId: "steering-user-turn",
      text: "first direction\nsecond direction",
    })
    expect(test.outcomes).toEqual(["delivered"])
  })

  it("recovers exact text once when cancellation fails", async () => {
    const test = setup()
    test.coordinator.advance()
    test.cancellations.reject(new Error("cancel failed"))
    await drain()

    const steering = test.store.getState().sessions[SESSION_ID]!.steering
    expect(steering.queue[0]?.phase).toBe("failed")
    expect(steering.recovery).toEqual([{ type: "text", text: "first direction" }])
    expect(test.errors).toEqual(["cancel_failed"])
    expect(test.outcomes).toEqual(["recovered"])

    test.coordinator.terminalize("lifecycle_lost")
    expect(test.errors).toEqual(["cancel_failed"])
    expect(test.outcomes).toEqual(["recovered"])
  })

  it("times out the named settlement wait and ignores the late terminal result", async () => {
    const test = setup()
    test.coordinator.advance()
    test.cancellations.resolve()
    await drain()
    test.fireTimeout()
    await drain()

    expect(test.store.getState().sessions[SESSION_ID]!.steering.recovery?.[0]?.text).toBe("first direction")
    expect(test.errors).toEqual(["settlement_timeout"])
    expect(test.outcomes).toEqual(["timeout"])
    test.settlement.resolve()
    await drain()
    expect(test.sent).toEqual([])
    expect(test.outcomes).toEqual(["timeout"])
  })

  it("recovers on follow-up failure without an automatic resend", async () => {
    const test = setup()
    test.coordinator.advance()
    test.cancellations.resolve()
    await drain()
    test.settlement.resolve()
    await drain()
    test.followUp.reject(new Error("send failed"))
    await drain()

    expect(test.sent).toHaveLength(1)
    expect(test.store.getState().sessions[SESSION_ID]!.steering.recovery?.[0]?.text).toBe("first direction")
    expect(test.errors).toEqual(["follow_up_failed"])
    expect(test.outcomes).toEqual(["recovered"])
  })

  it("terminalizes hard stop once and fences deferred cancellation success", async () => {
    const test = setup()
    test.coordinator.advance()
    test.coordinator.terminalize("hard_stop")
    test.coordinator.terminalize("hard_stop")

    expect(test.store.getState().sessions[SESSION_ID]!.steering.recovery).toEqual([
      { type: "text", text: "first direction" },
    ])
    expect(test.errors).toEqual(["hard_stop"])
    expect(test.outcomes).toEqual(["recovered"])

    test.cancellations.resolve()
    test.settlement.resolve()
    test.followUp.resolve()
    await drain()
    expect(test.sent).toEqual([])
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("failed")
  })

  it("ignores a stale generation without invoking an effect", () => {
    let cancelled = 0
    const test = setup({
      generation: GENERATION + 1,
      cancelActiveTurn: async () => {
        cancelled += 1
      },
    })
    test.coordinator.advance()
    expect(cancelled).toBe(0)
    expect(test.store.getState().sessions[SESSION_ID]!.steering.queue[0]?.phase).toBe("queued")
  })
})
