import type {
  HardStopContinuationCapability,
  PostInterruptContinuationRequest,
  PromptBlock,
  SessionId,
} from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"

/** Maximum time an explicit Hard Stop may wait for both required proof boundaries. */
export const POST_INTERRUPT_SETTLEMENT_TIMEOUT_MS = 5_000

export type PostInterruptContinuationTerminalReason =
  | "capability_unavailable"
  | "cancel_failed"
  | "settlement_timeout"
  | "lifecycle_lost"
  | "first_delivery_indeterminate"
  | "dispatch_rejected"

export type PostInterruptContinuationOutcome = "dispatched" | "recovered" | "timeout"

export type PostInterruptContinuationQueueResult =
  | { readonly kind: "queued"; readonly requestId: string }
  | { readonly kind: "unavailable"; readonly reason: "inactive" | "recovering" }

export interface PostInterruptContinuationCoordinatorOptions {
  readonly sessionId: SessionId
  readonly generation: number
  readonly interruptedTurnId: string
  readonly store: AppStore
  /** Re-read the protocol-free attestation before safe admission. */
  readonly capability: () => HardStopContinuationCapability
  /** Request cancellation of the exact captured transport generation. */
  readonly cancelActiveTurn: () => Promise<void>
  /** Terminal settlement of the exact lifecycle captured before cancellation. */
  readonly terminalSettlement: Promise<void>
  /** Recheck runtime, ACP session, generation, and captured lifecycle ownership. */
  readonly ownsCapturedLifecycle: () => boolean
  /** Close an in-flight first-harness checkpoint only after both proof boundaries. */
  readonly settleInterruptedHarness: () => boolean
  /** Preserve Task 03's indeterminate fallback for every ambiguous proof branch. */
  readonly terminalizeHarness: () => void
  /** Start one ordinary prompt through the existing controller preparation seam. */
  readonly dispatchOrdinary: (
    blocks: readonly PromptBlock[],
    requestId: string,
  ) => { readonly messageId: string } | null
  readonly scheduleSettlementTimeout?: (callback: () => void, timeoutMs: number) => () => void
  readonly onOutcome?: (
    requestId: string | null,
    outcome: PostInterruptContinuationOutcome,
  ) => void
  readonly onError?: (reason: PostInterruptContinuationTerminalReason, error?: unknown) => void
  readonly onFinished?: () => void
}

export interface PostInterruptContinuationCoordinator {
  /** Begin cancellation and proof collection exactly once. */
  start(): void
  /** Accept one exact reducer-owned continuation request and advance it when proof allows. */
  queue(requestId: string, blocks: readonly PromptBlock[]): PostInterruptContinuationQueueResult
  /** Restore the current request locally without issuing transport cancellation again. */
  recover(): boolean
  /** Clear one exact recovery payload only after the composer has copied it. */
  acknowledgeRecovery(requestId: string): boolean
  /** Fail closed and fence all later callbacks. */
  terminalize(reason: PostInterruptContinuationTerminalReason): void
  /** Idempotently fail closed and release the runner. */
  dispose(): void
}

type ProofState =
  | { readonly kind: "pending" }
  | { readonly kind: "safe" }
  | { readonly kind: "failed"; readonly reason: PostInterruptContinuationTerminalReason }

/**
 * Coordinate one explicit Hard Stop without owning session state.
 *
 * The reducer retains the request and recovery payload. This effect runner retains
 * only the captured proof identities, one timeout, and exact-once dispatch fences.
 */
export function createPostInterruptContinuationCoordinator(
  options: PostInterruptContinuationCoordinatorOptions,
): PostInterruptContinuationCoordinator {
  const scheduleTimeout = options.scheduleSettlementTimeout ?? defaultScheduleSettlementTimeout
  let started = false
  let disposed = false
  let withdrawn = false
  let dispatchRequestId: string | null = null
  let proof: ProofState = { kind: "pending" }
  let cancelTimeout: (() => void) | null = null

  function current(): PostInterruptContinuationRequest | null {
    if (disposed) return null
    const state = options.store.getState().sessions[options.sessionId]?.postInterruptContinuation
    const request = state?.request
    return state?.interruptedTurnId === options.interruptedTurnId &&
      request?.generation === options.generation
      ? request
      : null
  }

  function isCurrent(
    requestId: string,
    phase?: PostInterruptContinuationRequest["phase"],
  ): boolean {
    const request = current()
    return request?.id === requestId && (phase === undefined || request.phase === phase)
  }

  function event(
    kind: "post_interrupt_continuation_wait" | "post_interrupt_continuation_dispatch",
    requestId: string,
  ): boolean {
    if (!isCurrent(requestId)) return false
    options.store.applyEvent(options.sessionId, {
      kind,
      interruptedTurnId: options.interruptedTurnId,
      requestId,
      generation: options.generation,
    })
    return isCurrent(requestId)
  }

  function recoverCurrent(
    reason?: PostInterruptContinuationTerminalReason,
    error?: unknown,
  ): boolean {
    const request = current()
    if (!request) return false
    if (request.phase !== "recovery") {
      options.store.applyEvent(options.sessionId, {
        kind: "post_interrupt_continuation_recover",
        interruptedTurnId: options.interruptedTurnId,
        requestId: request.id,
        generation: options.generation,
      })
    }
    if (!isCurrent(request.id, "recovery")) return false
    dispatchRequestId = null
    if (reason) {
      options.onError?.(reason, error)
      options.onOutcome?.(
        request.id,
        reason === "settlement_timeout" ? "timeout" : "recovered",
      )
    }
    return true
  }

  function fail(
    reason: PostInterruptContinuationTerminalReason,
    error?: unknown,
  ): void {
    if (proof.kind === "failed" || disposed) return
    proof = { kind: "failed", reason }
    cancelTimeout?.()
    cancelTimeout = null
    options.terminalizeHarness()
    const recovered = recoverCurrent(reason, error)
    if (!recovered) options.onError?.(reason, error)
  }

  function advance(): void {
    const request = current()
    if (!request || withdrawn || dispatchRequestId !== null) return
    if (proof.kind === "failed") {
      recoverCurrent(proof.reason)
      return
    }
    if (proof.kind === "pending") {
      if (request.phase === "queued") event("post_interrupt_continuation_wait", request.id)
      return
    }

    if (options.capability().status !== "supported") {
      fail("capability_unavailable")
      return
    }
    if (!options.ownsCapturedLifecycle()) {
      fail("lifecycle_lost")
      return
    }
    if (
      request.phase !== "queued" &&
      request.phase !== "waiting"
    ) return
    if (!event("post_interrupt_continuation_dispatch", request.id) || !isCurrent(request.id, "dispatching")) {
      return
    }

    dispatchRequestId = request.id
    let dispatch: { readonly messageId: string } | null
    try {
      dispatch = options.dispatchOrdinary(request.blocks, request.id)
    } catch (error) {
      dispatchRequestId = null
      fail("dispatch_rejected", error)
      return
    }
    if (dispatch === null) {
      dispatchRequestId = null
      fail("dispatch_rejected")
      return
    }
    if (!isCurrent(request.id, "dispatching")) return
    options.store.applyEvent(options.sessionId, {
      kind: "post_interrupt_continuation_deliver",
      interruptedTurnId: options.interruptedTurnId,
      requestId: request.id,
      generation: options.generation,
      messageId: dispatch.messageId,
    })
    if (current() !== null) return
    options.onOutcome?.(request.id, "dispatched")
    options.onFinished?.()
  }

  async function evaluateProof(cancellation: Promise<void>): Promise<void> {
    if (options.capability().status !== "supported") {
      void cancellation.catch(() => {})
      fail("capability_unavailable")
      return
    }

    let resolveTimeout!: () => void
    const timeout = new Promise<"timeout">((resolve) => {
      resolveTimeout = () => resolve("timeout")
    })
    cancelTimeout = scheduleTimeout(resolveTimeout, POST_INTERRUPT_SETTLEMENT_TIMEOUT_MS)
    let outcome: "settled" | "timeout"
    try {
      outcome = await Promise.race([
        Promise.all([cancellation, options.terminalSettlement]).then(() => "settled" as const),
        timeout,
      ])
    } catch (error) {
      fail("cancel_failed", error)
      return
    }
    cancelTimeout?.()
    cancelTimeout = null
    if (proof.kind !== "pending" || disposed) return
    if (outcome === "timeout") {
      fail("settlement_timeout")
      return
    }
    if (options.capability().status !== "supported") {
      fail("capability_unavailable")
      return
    }
    if (!options.ownsCapturedLifecycle()) {
      fail("lifecycle_lost")
      return
    }
    if (!options.settleInterruptedHarness()) {
      fail("first_delivery_indeterminate")
      return
    }
    proof = { kind: "safe" }
    advance()
  }

  return {
    start(): void {
      if (started || disposed) return
      started = true
      let cancellation: Promise<void>
      try {
        cancellation = options.cancelActiveTurn()
      } catch (error) {
        fail("cancel_failed", error)
        return
      }
      void evaluateProof(cancellation)
    },

    queue(requestId, blocks): PostInterruptContinuationQueueResult {
      if (
        disposed ||
        withdrawn ||
        requestId.length === 0 ||
        blocks.length === 0 ||
        !options.ownsCapturedLifecycle()
      ) {
        return { kind: "unavailable", reason: "inactive" }
      }
      if (current() !== null) return { kind: "unavailable", reason: "recovering" }
      const state = options.store.getState().sessions[options.sessionId]?.postInterruptContinuation
      if (!state || state.recovery !== null || state.interruptedTurnId !== null) {
        return { kind: "unavailable", reason: "recovering" }
      }
      options.store.applyEvent(options.sessionId, {
        kind: "post_interrupt_continuation_enqueue",
        interruptedTurnId: options.interruptedTurnId,
        requestId,
        generation: options.generation,
        blocks,
      })
      if (!isCurrent(requestId, "queued")) {
        return { kind: "unavailable", reason: "recovering" }
      }
      advance()
      return { kind: "queued", requestId }
    },

    recover(): boolean {
      const request = current()
      if (!request) return false
      withdrawn = true
      return recoverCurrent()
    },

    acknowledgeRecovery(requestId): boolean {
      if (!isCurrent(requestId, "recovery")) return false
      options.store.applyEvent(options.sessionId, {
        kind: "post_interrupt_continuation_acknowledge_recovery",
        interruptedTurnId: options.interruptedTurnId,
        requestId,
        generation: options.generation,
      })
      if (current() !== null) return false
      options.onFinished?.()
      return true
    },

    terminalize(reason): void {
      fail(reason)
    },

    dispose(): void {
      if (disposed) return
      fail("lifecycle_lost")
      disposed = true
      cancelTimeout?.()
      cancelTimeout = null
      dispatchRequestId = null
    },
  }
}

function defaultScheduleSettlementTimeout(callback: () => void, timeoutMs: number): () => void {
  const timer = setTimeout(callback, timeoutMs)
  return () => clearTimeout(timer)
}
