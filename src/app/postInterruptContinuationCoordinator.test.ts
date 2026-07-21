import { describe, expect, it } from "bun:test"

import type { HardStopContinuationCapability, PromptBlock } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import {
  createPostInterruptContinuationCoordinator,
  POST_INTERRUPT_SETTLEMENT_TIMEOUT_MS,
  type PostInterruptContinuationCoordinatorOptions,
} from "./postInterruptContinuationCoordinator.ts"

const SESSION_ID = "hard-stop-session"
const GENERATION = 7
const BLOCKS: readonly PromptBlock[] = [{ type: "text", text: "continue safely" }]

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function drain(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function setup(overrides: Partial<PostInterruptContinuationCoordinatorOptions> = {}) {
  const store = createAppStore({
    seeds: [{ id: SESSION_ID, providerKind: "codex", title: "Codex", cwd: "/repo" }],
    selectedVisibleId: SESSION_ID,
  })
  const cancellation = deferred()
  const settlement = deferred()
  let capability: HardStopContinuationCapability = { status: "supported" }
  let ownsLifecycle = true
  let cancellationCount = 0
  let settleHarness = true
  let settledHarnessCount = 0
  let terminalizedHarnessCount = 0
  let timeout: (() => void) | null = null
  let timeoutMs: number | null = null
  const dispatched: Array<{ blocks: readonly PromptBlock[]; requestId: string }> = []
  const outcomes: string[] = []
  const errors: string[] = []
  const coordinator = createPostInterruptContinuationCoordinator({
    sessionId: SESSION_ID,
    generation: GENERATION,
    interruptedTurnId: "turn-1",
    store,
    capability: () => capability,
    cancelActiveTurn: () => {
      cancellationCount += 1
      return cancellation.promise
    },
    terminalSettlement: settlement.promise,
    ownsCapturedLifecycle: () => ownsLifecycle,
    settleInterruptedHarness: () => {
      settledHarnessCount += 1
      return settleHarness
    },
    terminalizeHarness: () => {
      terminalizedHarnessCount += 1
    },
    dispatchOrdinary: (blocks, requestId) => {
      dispatched.push({ blocks: [...blocks], requestId })
      return { messageId: "ordinary-user-turn" }
    },
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
    cancellation,
    settlement,
    dispatched,
    outcomes,
    errors,
    cancellationCount: () => cancellationCount,
    settledHarnessCount: () => settledHarnessCount,
    terminalizedHarnessCount: () => terminalizedHarnessCount,
    setCapability: (value: HardStopContinuationCapability) => {
      capability = value
    },
    setOwnsLifecycle: (value: boolean) => {
      ownsLifecycle = value
    },
    setSettleHarness: (value: boolean) => {
      settleHarness = value
    },
    fireTimeout: () => timeout?.(),
    timeoutMs: () => timeoutMs,
  }
}

function recoveryText(test: ReturnType<typeof setup>): string | undefined {
  return test.store.getState().sessions[SESSION_ID]?.postInterruptContinuation.recovery?.[0]?.text
}

describe("createPostInterruptContinuationCoordinator", () => {
  it("waits for cancellation acceptance and terminal settlement in either completion order", async () => {
    for (const order of ["settlement-first", "cancellation-first"] as const) {
      const test = setup()
      test.coordinator.start()
      expect(test.coordinator.queue("request-1", BLOCKS)).toEqual({
        kind: "queued",
        requestId: "request-1",
      })
      expect(test.store.getState().sessions[SESSION_ID]?.postInterruptContinuation.request?.phase).toBe("waiting")
      expect(test.timeoutMs()).toBe(POST_INTERRUPT_SETTLEMENT_TIMEOUT_MS)

      if (order === "settlement-first") test.settlement.resolve()
      else test.cancellation.resolve()
      await drain()
      expect(test.dispatched).toEqual([])
      expect(test.settledHarnessCount()).toBe(0)

      if (order === "settlement-first") test.cancellation.resolve()
      else test.settlement.resolve()
      await drain()
      expect(test.settledHarnessCount()).toBe(1)
      expect(test.dispatched).toEqual([{ blocks: BLOCKS, requestId: "request-1" }])
      expect(test.store.getState().sessions[SESSION_ID]?.postInterruptContinuation.request).toBeNull()
      expect(test.store.getState().sessions[SESSION_ID]?.turns).toContainEqual({
        kind: "user",
        messageId: "ordinary-user-turn",
        text: "continue safely",
      })
      expect(test.outcomes).toEqual(["dispatched"])
    }
  })

  it("rejects duplicate request identities and keeps duplicate or late proof callbacks inert", async () => {
    const test = setup()
    test.coordinator.start()
    expect(test.coordinator.queue("request-1", BLOCKS).kind).toBe("queued")
    expect(test.coordinator.queue("request-1", BLOCKS)).toEqual({
      kind: "unavailable",
      reason: "recovering",
    })

    test.cancellation.resolve()
    test.settlement.resolve()
    await drain()
    test.cancellation.resolve()
    test.settlement.resolve()
    test.coordinator.start()
    await drain()

    expect(test.cancellationCount()).toBe(1)
    expect(test.dispatched).toHaveLength(1)
    expect(test.settledHarnessCount()).toBe(1)
  })

  it("fails closed for missing or lost capability", async () => {
    const missing = setup()
    missing.setCapability({ status: "unavailable", reason: "missing_implementation" })
    missing.coordinator.start()
    expect(missing.cancellationCount()).toBe(1)
    expect(missing.coordinator.queue("request-1", BLOCKS).kind).toBe("queued")
    expect(recoveryText(missing)).toBe("continue safely")
    expect(missing.dispatched).toEqual([])
    expect(missing.terminalizedHarnessCount()).toBe(1)

    const lost = setup()
    lost.coordinator.start()
    lost.coordinator.queue("request-1", BLOCKS)
    lost.setCapability({ status: "unavailable", reason: "attestation_mismatch" })
    lost.cancellation.resolve()
    lost.settlement.resolve()
    await drain()
    expect(recoveryText(lost)).toBe("continue safely")
    expect(lost.dispatched).toEqual([])
    expect(lost.terminalizedHarnessCount()).toBe(1)
  })

  it("recovers stale lifecycle and indeterminate first delivery without dispatch", async () => {
    for (const failure of ["lifecycle", "harness"] as const) {
      const test = setup()
      test.coordinator.start()
      test.coordinator.queue("request-1", BLOCKS)
      if (failure === "lifecycle") test.setOwnsLifecycle(false)
      else test.setSettleHarness(false)
      test.cancellation.resolve()
      test.settlement.resolve()
      await drain()

      expect(recoveryText(test)).toBe("continue safely")
      expect(test.dispatched).toEqual([])
      expect(test.terminalizedHarnessCount()).toBe(1)
      expect(test.errors).toContain(
        failure === "lifecycle" ? "lifecycle_lost" : "first_delivery_indeterminate",
      )
    }
  })

  it("recovers on rejected cancellation and timeout, then ignores late settlement", async () => {
    const rejected = setup()
    rejected.coordinator.start()
    rejected.coordinator.queue("request-1", BLOCKS)
    rejected.cancellation.reject(new Error("cancel rejected"))
    await drain()
    expect(recoveryText(rejected)).toBe("continue safely")
    expect(rejected.dispatched).toEqual([])
    expect(rejected.errors).toContain("cancel_failed")

    const timedOut = setup()
    timedOut.coordinator.start()
    timedOut.coordinator.queue("request-1", BLOCKS)
    timedOut.fireTimeout()
    await drain()
    expect(recoveryText(timedOut)).toBe("continue safely")
    expect(timedOut.outcomes).toContain("timeout")
    timedOut.cancellation.resolve()
    timedOut.settlement.resolve()
    await drain()
    expect(timedOut.dispatched).toEqual([])
    expect(timedOut.settledHarnessCount()).toBe(0)
  })

  it("restores on second Escape without a second cancellation and fences later proof", async () => {
    const test = setup()
    test.coordinator.start()
    test.coordinator.queue("request-1", BLOCKS)

    expect(test.coordinator.recover()).toBe(true)
    expect(test.coordinator.recover()).toBe(true)
    expect(recoveryText(test)).toBe("continue safely")
    expect(test.cancellationCount()).toBe(1)

    test.cancellation.resolve()
    test.settlement.resolve()
    await drain()
    expect(test.settledHarnessCount()).toBe(1)
    expect(test.dispatched).toEqual([])
    expect(test.coordinator.acknowledgeRecovery("stale")).toBe(false)
    expect(test.coordinator.acknowledgeRecovery("request-1")).toBe(true)
    expect(test.store.getState().sessions[SESSION_ID]?.postInterruptContinuation.recovery).toBeNull()
  })

  it("recovers on disposal or ordinary dispatch rejection", async () => {
    const disposed = setup()
    disposed.coordinator.start()
    disposed.coordinator.queue("request-1", BLOCKS)
    disposed.coordinator.dispose()
    disposed.cancellation.resolve()
    disposed.settlement.resolve()
    await drain()
    expect(recoveryText(disposed)).toBe("continue safely")
    expect(disposed.dispatched).toEqual([])

    const rejected = setup({ dispatchOrdinary: () => null })
    rejected.coordinator.start()
    rejected.coordinator.queue("request-1", BLOCKS)
    rejected.cancellation.resolve()
    rejected.settlement.resolve()
    await drain()
    expect(recoveryText(rejected)).toBe("continue safely")
    expect(rejected.errors).toContain("dispatch_rejected")
  })
})
