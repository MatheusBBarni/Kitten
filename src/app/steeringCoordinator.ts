import type { PromptBlock, SessionId, SteeringRequest } from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"

/** The longest fallback waits for the cancelled turn's terminal acknowledgement. */
export const STEERING_TERMINAL_SETTLEMENT_TIMEOUT_MS = 5_000

/** Provider-neutral context prepended only to the fallback transport payload. */
export const STEERING_FOLLOW_UP_PREFIX = "The previous turn was interrupted. Continue with this direction:"

export type SteeringTerminalReason =
  | "cancel_failed"
  | "settlement_timeout"
  | "follow_up_failed"
  | "lifecycle_lost"
  | "hard_stop"

export type SteeringCoordinatorOutcome = "delivered" | "recovered" | "timeout"

export interface SteeringCoordinatorOptions {
  readonly sessionId: SessionId
  readonly generation: number
  readonly store: AppStore
  /** True while this exact session generation owns any unresolved user interaction. */
  readonly hasPendingInteraction: () => boolean
  /** Request cancellation of the exact active transport generation. */
  readonly cancelActiveTurn: () => Promise<void>
  /** The captured turn's terminal promise, or null when it already settled. */
  readonly terminalSettlement: () => Promise<void> | null
  /** Send one coalesced follow-up and resolve only after terminal acknowledgement. */
  readonly sendFollowUp: (blocks: readonly PromptBlock[], requestId: string) => Promise<void>
  readonly newMessageId?: () => string
  readonly scheduleSettlementTimeout?: (callback: () => void, timeoutMs: number) => () => void
  readonly onOutcome?: (requestId: string, outcome: SteeringCoordinatorOutcome) => void
  readonly onError?: (reason: SteeringTerminalReason, error?: unknown) => void
}

export interface SteeringCoordinator {
  /** Re-read reducer truth and advance the current request when its boundary is safe. */
  advance(): void
  /** Recover the current exact queue once and fence all later callbacks. */
  terminalize(reason: SteeringTerminalReason): void
  /** Idempotently stop the runner, recovering any accepted live request. */
  dispose(): void
}

/**
 * Run one session generation's asynchronous steering effects.
 *
 * Queue, phase, and recovery authority stay in the reducer. This runner retains
 * only one in-flight effect token and timeout cancellation hook, and revalidates
 * session/request/generation identity before every state transition.
 */
export function createSteeringCoordinator(options: SteeringCoordinatorOptions): SteeringCoordinator {
  const newMessageId = options.newMessageId ?? (() => crypto.randomUUID())
  const scheduleTimeout = options.scheduleSettlementTimeout ?? defaultScheduleSettlementTimeout
  let disposed = false
  let effectRequestId: string | null = null
  let cancelTimeout: (() => void) | null = null

  function current(): SteeringRequest | null {
    if (disposed) return null
    const request = options.store.getState().sessions[options.sessionId]?.steering.queue[0]
    return request?.generation === options.generation ? request : null
  }

  function isCurrent(requestId: string, phase?: SteeringRequest["phase"]): boolean {
    const request = current()
    return request?.id === requestId && (phase === undefined || request.phase === phase)
  }

  function event(
    kind: "steering_wait" | "steering_cancel" | "steering_settle" | "steering_send",
    requestId: string,
  ): boolean {
    if (!isCurrent(requestId)) return false
    options.store.applyEvent(options.sessionId, {
      kind,
      requestId,
      generation: options.generation,
    })
    return isCurrent(requestId)
  }

  function recover(requestId: string, reason: SteeringTerminalReason, error?: unknown): void {
    const before = options.store.getState().sessions[options.sessionId]?.steering
    if (
      !isCurrent(requestId) ||
      before?.recovery !== null ||
      before.queue[0]?.phase === "failed"
    ) return
    options.store.applyEvent(options.sessionId, {
      kind: "steering_recover",
      requestId,
      generation: options.generation,
    })
    if (!isCurrent(requestId, "failed")) return
    cancelTimeout?.()
    cancelTimeout = null
    effectRequestId = null
    options.onError?.(reason, error)
    options.onOutcome?.(requestId, reason === "settlement_timeout" ? "timeout" : "recovered")
  }

  async function waitForSettlement(requestId: string): Promise<boolean> {
    const settlement = options.terminalSettlement()
    if (settlement === null) return true

    let resolveTimeout!: () => void
    const timeout = new Promise<"timeout">((resolve) => {
      resolveTimeout = () => resolve("timeout")
    })
    cancelTimeout = scheduleTimeout(resolveTimeout, STEERING_TERMINAL_SETTLEMENT_TIMEOUT_MS)
    const outcome = await Promise.race([
      settlement.then(() => "settled" as const),
      timeout,
    ])
    cancelTimeout?.()
    cancelTimeout = null
    if (!isCurrent(requestId, "settling")) return false
    if (outcome === "timeout") {
      recover(requestId, "settlement_timeout")
      return false
    }
    return true
  }

  async function runFallback(requestId: string): Promise<void> {
    try {
      // Interaction ownership can change after advance() was scheduled. Recheck
      // immediately before cancellation and return to reducer-owned waiting state.
      if (!isCurrent(requestId) || options.hasPendingInteraction()) {
        if (isCurrent(requestId, "queued")) event("steering_wait", requestId)
        return
      }
      if (!event("steering_cancel", requestId) || !isCurrent(requestId, "cancelling")) return
      if (options.hasPendingInteraction()) {
        recover(requestId, "lifecycle_lost")
        return
      }

      try {
        await options.cancelActiveTurn()
      } catch (error) {
        recover(requestId, "cancel_failed", error)
        return
      }
      if (!isCurrent(requestId, "cancelling")) return
      if (!event("steering_settle", requestId) || !isCurrent(requestId, "settling")) return
      if (!(await waitForSettlement(requestId))) return

      const steering = options.store.getState().sessions[options.sessionId]?.steering
      if (!steering || !isCurrent(requestId, "settling")) return
      const blocks = steering.queue.flatMap((request) => request.blocks)
      if (!event("steering_send", requestId) || !isCurrent(requestId, "sending")) return
      try {
        await options.sendFollowUp(
          [{ type: "text", text: STEERING_FOLLOW_UP_PREFIX }, ...blocks],
          requestId,
        )
      } catch (error) {
        recover(requestId, "follow_up_failed", error)
        return
      }
      if (!isCurrent(requestId, "sending")) return
      options.store.applyEvent(options.sessionId, {
        kind: "steering_deliver",
        requestId,
        generation: options.generation,
        messageId: newMessageId(),
      })
      if (options.store.getState().sessions[options.sessionId]?.steering.queue.length === 0) {
        options.onOutcome?.(requestId, "delivered")
      }
    } finally {
      if (effectRequestId === requestId) effectRequestId = null
    }
  }

  function advance(): void {
    const request = current()
    if (!request || effectRequestId === request.id || request.phase === "failed") return
    if (request.phase === "queued" || request.phase === "waiting") {
      if (options.hasPendingInteraction()) {
        if (request.phase === "queued") event("steering_wait", request.id)
        return
      }
      effectRequestId = request.id
      void runFallback(request.id)
    }
  }

  function terminalize(reason: SteeringTerminalReason): void {
    const request = current()
    if (!request) return
    recover(request.id, reason)
  }

  return {
    advance,
    terminalize,
    dispose() {
      if (disposed) return
      terminalize("lifecycle_lost")
      disposed = true
      cancelTimeout?.()
      cancelTimeout = null
      effectRequestId = null
    },
  }
}

function defaultScheduleSettlementTimeout(callback: () => void, timeoutMs: number): () => void {
  const timer = setTimeout(callback, timeoutMs)
  return () => clearTimeout(timer)
}
