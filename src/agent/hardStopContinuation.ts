import type { HardStopContinuationAdapterImplementation } from "../config/hardStopContinuationCapability.ts"

/**
 * Reviewed adapter implementations that prove accepted cancellation and terminal
 * settlement. V1 intentionally starts empty; adding one requires matching exact
 * recipe certification and provider-specific implementation evidence here.
 */
export const HARD_STOP_CONTINUATION_ADAPTER_IMPLEMENTATIONS: readonly HardStopContinuationAdapterImplementation[] = []
