import type { NativeSteeringAdapterImplementation } from "../config/steeringCapability.ts"

/**
 * Adapter-local native steering implementations with terminal acknowledgement.
 * V1 intentionally has none; adding an entry requires the matching audited
 * recipe certification and the provider-specific implementation in this layer.
 */
export const NATIVE_STEERING_ADAPTER_IMPLEMENTATIONS: readonly NativeSteeringAdapterImplementation[] = []
