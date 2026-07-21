import type { HarnessPromptVersion } from "../core/harnessPrompt.ts"

export type HarnessDeliveryState =
  | "not_required"
  | "pending"
  | "in_flight"
  | "delivered"
  | "settled_interrupted"
  | "failed"

export type HarnessFailureCategory =
  | "unsupported_profile"
  | "harness_render_failed"
  | "dispatch_indeterminate"

type PreDispatchTerminalCategory = Exclude<HarnessFailureCategory, "dispatch_indeterminate">

export type HarnessPreDispatchFailure =
  | { readonly retrySafe: true }
  | { readonly retrySafe: false; readonly category: PreDispatchTerminalCategory }

interface HarnessDeliveryBase {
  readonly version: HarnessPromptVersion
  readonly generation: number
}

export type HarnessDelivery =
  | (HarnessDeliveryBase & {
    readonly state: Exclude<HarnessDeliveryState, "failed">
  })
  | (HarnessDeliveryBase & {
    readonly state: "failed"
      readonly failureCategory: HarnessFailureCategory
    })

export interface RestoredHarnessDeliveryCheckpoint {
  readonly version: HarnessPromptVersion
  readonly generation: number
  readonly state: HarnessDeliveryState
  readonly failureCategory?: HarnessFailureCategory
}

/** Start one genuinely fresh controller generation with one delivery opportunity. */
export function beginFresh(
  version: HarnessPromptVersion,
  expectedGeneration: number,
): HarnessDelivery {
  return { version, generation: expectedGeneration, state: "pending" }
}

/** Start one successfully loaded controller generation with no delivery opportunity. */
export function beginLoaded(
  version: HarnessPromptVersion,
  expectedGeneration: number,
): HarnessDelivery {
  return { version, generation: expectedGeneration, state: "not_required" }
}

/**
 * Rebind persisted control facts to the new process generation. Successful
 * loads never gain a delivery opportunity; explicit unresolved or failed facts
 * fail closed instead of replaying an old first turn.
 */
export function restoreHarnessDelivery(
  checkpoint: RestoredHarnessDeliveryCheckpoint | undefined,
  version: HarnessPromptVersion,
  expectedGeneration: number,
  lifecycle: "fresh" | "loaded",
): HarnessDelivery {
  if (checkpoint?.state === "settled_interrupted") {
    return {
      version: checkpoint.version,
      generation: expectedGeneration,
      state: "settled_interrupted",
    }
  }
  if (checkpoint?.state === "pending" || checkpoint?.state === "in_flight") {
    return terminalFailure(
      { version: checkpoint.version, generation: expectedGeneration, state: "in_flight" },
      "dispatch_indeterminate",
    )
  }
  if (checkpoint?.state === "failed") {
    return terminalFailure(
      { version: checkpoint.version, generation: expectedGeneration, state: "in_flight" },
      checkpoint.failureCategory ?? "dispatch_indeterminate",
    )
  }
  return lifecycle === "loaded"
    ? beginLoaded(version, expectedGeneration)
    : beginFresh(version, expectedGeneration)
}

/** Claim the sole fresh-generation dispatch opportunity before invoking transport. */
export function beginDispatch(
  delivery: HarnessDelivery,
  expectedGeneration: number,
): HarnessDelivery {
  if (!isExpected(delivery, expectedGeneration) || delivery.state !== "pending") return delivery
  return transition(delivery, "in_flight")
}

/** Settle a matching in-flight transport invocation after terminal resolution. */
export function completeDispatch(
  delivery: HarnessDelivery,
  expectedGeneration: number,
): HarnessDelivery {
  if (!isExpected(delivery, expectedGeneration) || delivery.state !== "in_flight") return delivery
  return transition(delivery, "delivered")
}

/** Record a confirmed cancellation only after the matching invocation settles. */
export function settleInterrupted(
  delivery: HarnessDelivery,
  expectedGeneration: number,
): HarnessDelivery {
  if (!isExpected(delivery, expectedGeneration) || delivery.state !== "in_flight") return delivery
  return transition(delivery, "settled_interrupted")
}

/**
 * Classify a failure known to have happened before transport invocation.
 * Retry-safe failures retain the existing opportunity; fixed unsupported or
 * render failures close it without retaining an error or content payload.
 */
export function failBeforeDispatch(
  delivery: HarnessDelivery,
  expectedGeneration: number,
  failure: HarnessPreDispatchFailure,
): HarnessDelivery {
  if (!isExpected(delivery, expectedGeneration) || delivery.state !== "pending") return delivery
  if (failure.retrySafe) return delivery
  return terminalFailure(delivery, failure.category)
}

/** Terminalize any matching invocation that may have reached transport. */
export function failIndeterminate(
  delivery: HarnessDelivery,
  expectedGeneration: number,
): HarnessDelivery {
  if (!isExpected(delivery, expectedGeneration) || delivery.state !== "in_flight") return delivery
  return terminalFailure(delivery, "dispatch_indeterminate")
}

function isExpected(delivery: HarnessDelivery, expectedGeneration: number): boolean {
  return delivery.generation === expectedGeneration
}

function transition(
  delivery: HarnessDelivery,
  state: "in_flight" | "delivered" | "settled_interrupted",
): HarnessDelivery {
  return { version: delivery.version, generation: delivery.generation, state }
}

function terminalFailure(
  delivery: HarnessDelivery,
  failureCategory: HarnessFailureCategory,
): HarnessDelivery {
  return {
    version: delivery.version,
    generation: delivery.generation,
    state: "failed",
    failureCategory,
  }
}
