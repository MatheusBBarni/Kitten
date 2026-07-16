import type { AgentConfig, SteeringCapability } from "../core/types.ts"

/** Every identity-bearing field in one audited native-steering recipe. */
export interface CertifiedNativeSteeringRecipe {
  readonly adapterId: string
  readonly providerKind: AgentConfig["id"]
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly adapterPackage: string
  readonly adapterVersion: string
}

/**
 * Adapter-local evidence that a native implementation observes a terminal
 * acknowledgement. Recipe certification alone cannot enable the capability.
 */
export interface NativeSteeringAdapterImplementation {
  readonly adapterId: string
  readonly terminalAcknowledgement: true
}

/** V1 has no audited native recipe. A reviewed certification must add one. */
export const CERTIFIED_NATIVE_STEERING_RECIPES: readonly CertifiedNativeSteeringRecipe[] = []

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/u

/**
 * Resolve capability from the final merged recipe and independent adapter-local
 * implementation evidence. Both lists default empty, so all production recipes
 * remain unavailable until an audited implementation deliberately wires them.
 */
export function classifySteeringCapability(
  recipe: Pick<AgentConfig, "id" | "command" | "args" | "env">,
  certifiedRecipes: readonly CertifiedNativeSteeringRecipe[] = CERTIFIED_NATIVE_STEERING_RECIPES,
  implementations: readonly NativeSteeringAdapterImplementation[] = [],
): SteeringCapability {
  const certified = certifiedRecipes.find(
    (candidate) => completeCertification(candidate) && sameRecipe(candidate, recipe),
  )
  if (!certified) return { status: "unavailable" }

  const implemented = implementations.some(
    (implementation) =>
      implementation.adapterId === certified.adapterId && implementation.terminalAcknowledgement,
  )
  if (!implemented) return { status: "unavailable" }

  return {
    status: "native",
    adapterId: certified.adapterId,
    adapterPackage: certified.adapterPackage,
    adapterVersion: certified.adapterVersion,
  }
}

function completeCertification(candidate: CertifiedNativeSteeringRecipe): boolean {
  if (
    candidate.adapterId.length === 0 ||
    candidate.adapterPackage.length === 0 ||
    !EXACT_SEMVER.test(candidate.adapterVersion)
  ) {
    return false
  }

  const packageSpecs = candidate.args.filter((arg) => arg.startsWith(`${candidate.adapterPackage}@`))
  return packageSpecs.length === 0 || packageSpecs.includes(`${candidate.adapterPackage}@${candidate.adapterVersion}`)
}

function sameRecipe(
  expected: CertifiedNativeSteeringRecipe,
  actual: Pick<AgentConfig, "id" | "command" | "args" | "env">,
): boolean {
  return (
    expected.providerKind === actual.id &&
    expected.command === actual.command &&
    sameOrderedValues(expected.args, actual.args) &&
    sameEnvironment(expected.env, actual.env)
  )
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameOrderedValues(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}
