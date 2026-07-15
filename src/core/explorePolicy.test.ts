import { describe, expect, it } from "bun:test"

import {
  EXPLORE_DENIAL_REASONS,
  EXPLORE_RESTRICTIONS,
  createExploreDenial,
  evaluateExplorePolicy,
  isExploreDenialReason,
  type ExplorePolicyInput,
} from "./explorePolicy.ts"

const validInput = (): ExplorePolicyInput => ({
  role: "explore",
  restrictions: {
    filesystem: "read-only",
    shell: false,
    externalMcp: false,
    agentControl: false,
    askUser: true,
    maxDepth: 0,
  },
  limits: { perParent: 2, global: 6 },
  attestationVersion: " verifier-v1 ",
  confirmed: { provider: "codex", model: " gpt-5.4 ", effort: " high " },
})

describe("evaluateExplorePolicy", () => {
  it("accepts only the exact V1 restrictions and returns a deeply immutable snapshot", () => {
    const decision = evaluateExplorePolicy(validInput())

    expect(decision).toEqual({
      kind: "eligible",
      policy: {
        role: "explore",
        restrictions: {
          filesystem: "read-only",
          shell: false,
          externalMcp: false,
          agentControl: false,
          askUser: true,
          maxDepth: 0,
        },
        limits: { perParent: 2, global: 6 },
        attestationVersion: "verifier-v1",
        confirmed: { provider: "codex", model: "gpt-5.4", effort: "high" },
      },
    })
    expect(Object.isFrozen(decision)).toBe(true)
    if (decision.kind !== "eligible") throw new Error("expected eligible policy")
    expect(Object.isFrozen(decision.policy)).toBe(true)
    expect(Object.isFrozen(decision.policy.restrictions)).toBe(true)
    expect(Object.isFrozen(decision.policy.limits)).toBe(true)
    expect(Object.isFrozen(decision.policy.confirmed)).toBe(true)
    expect(Object.isFrozen(EXPLORE_RESTRICTIONS)).toBe(true)
    expect(Reflect.set(decision.policy.restrictions, "shell", true)).toBe(false)
    expect(decision.policy.restrictions.shell).toBe(false)
  })

  it.each([
    ["filesystem", "read-write"],
    ["shell", true],
    ["externalMcp", true],
    ["agentControl", true],
    ["askUser", false],
    ["maxDepth", 1],
  ] as const)("rejects an altered %s restriction", (field, value) => {
    const input = validInput()
    const restrictions = { ...(input.restrictions as Record<string, unknown>), [field]: value }

    expect(evaluateExplorePolicy({ ...input, restrictions })).toEqual({
      kind: "denied",
      reason: "stale-attestation",
    })
  })

  it.each([
    [
      "invalid role",
      (input: ExplorePolicyInput) => ({ ...input, role: "engineer" }),
      "parent-ineligible",
    ],
    [
      "changed restriction",
      (input: ExplorePolicyInput) => ({
        ...input,
        restrictions: { ...(input.restrictions as object), shell: true },
      }),
      "stale-attestation",
    ],
    [
      "extra restriction",
      (input: ExplorePolicyInput) => ({
        ...input,
        restrictions: { ...(input.restrictions as object), writePaths: [] },
      }),
      "stale-attestation",
    ],
    [
      "blank attestation",
      (input: ExplorePolicyInput) => ({ ...input, attestationVersion: "  " }),
      "missing-attestation",
    ],
    [
      "zero per-parent capacity",
      (input: ExplorePolicyInput) => ({ ...input, limits: { perParent: 0, global: 6 } }),
      "capacity-exhausted",
    ],
    [
      "negative global capacity",
      (input: ExplorePolicyInput) => ({ ...input, limits: { perParent: 2, global: -1 } }),
      "capacity-exhausted",
    ],
    [
      "non-finite capacity",
      (input: ExplorePolicyInput) => ({
        ...input,
        limits: { perParent: Number.POSITIVE_INFINITY, global: 6 },
      }),
      "capacity-exhausted",
    ],
    [
      "fractional capacity",
      (input: ExplorePolicyInput) => ({ ...input, limits: { perParent: 1.5, global: 6 } }),
      "capacity-exhausted",
    ],
    [
      "unknown provider",
      (input: ExplorePolicyInput) => ({
        ...input,
        confirmed: { provider: "unknown", model: "model", effort: "high" },
      }),
      "unsupported-provider",
    ],
    [
      "blank model",
      (input: ExplorePolicyInput) => ({
        ...input,
        confirmed: { provider: "codex", model: " ", effort: "high" },
      }),
      "missing-attestation",
    ],
    [
      "blank effort",
      (input: ExplorePolicyInput) => ({
        ...input,
        confirmed: { provider: "codex", model: "model", effort: "" },
      }),
      "missing-attestation",
    ],
    [
      "provider recipe data",
      (input: ExplorePolicyInput) => ({
        ...input,
        confirmed: { provider: "codex", model: "model", effort: "high", command: "codex" },
      }),
      "missing-attestation",
    ],
  ] as const)("denies %s without mutating input", (_name, mutate, expectedReason) => {
    const input = validInput()
    const before = structuredClone(input)
    const candidate = mutate(input)

    expect(evaluateExplorePolicy(candidate)).toEqual({ kind: "denied", reason: expectedReason })
    expect(input).toEqual(before)
  })

  it("is deterministic and copies rather than freezing caller-owned nested values", () => {
    const input = validInput()
    const restrictions = input.restrictions as Record<string, unknown>
    const limits = input.limits as Record<string, unknown>
    const confirmed = input.confirmed as Record<string, unknown>

    const first = evaluateExplorePolicy(input)
    const second = evaluateExplorePolicy(input)

    expect(first).toEqual(second)
    expect(Object.isFrozen(restrictions)).toBe(false)
    expect(Object.isFrozen(limits)).toBe(false)
    expect(Object.isFrozen(confirmed)).toBe(false)
    if (first.kind !== "eligible") throw new Error("expected eligible policy")
    expect(first.policy.restrictions).not.toBe(restrictions)
    expect(first.policy.limits).not.toBe(limits)
    expect(first.policy.confirmed).not.toBe(confirmed)
  })

  it("fails closed for malformed or content-bearing top-level input", () => {
    const untypedEvaluator = evaluateExplorePolicy as (input: unknown) => ReturnType<
      typeof evaluateExplorePolicy
    >

    expect(untypedEvaluator(null)).toEqual({ kind: "denied", reason: "missing-attestation" })
    expect(untypedEvaluator({ ...validInput(), task: "read /private/repo" })).toEqual({
      kind: "denied",
      reason: "missing-attestation",
    })
  })
})

describe("closed explore denials", () => {
  it("constructs every known denial as an immutable decision", () => {
    for (const reason of EXPLORE_DENIAL_REASONS) {
      expect(isExploreDenialReason(reason)).toBe(true)
      const decision = createExploreDenial(reason)
      expect(decision).toEqual({ kind: "denied", reason })
      expect(Object.isFrozen(decision)).toBe(true)
    }
  })

  it("cannot expose an arbitrary raw string through the public helper", () => {
    expect(isExploreDenialReason("provider exploded: /private/task")).toBe(false)
    const untypedHelper = createExploreDenial as (reason: unknown) => ReturnType<
      typeof createExploreDenial
    >
    expect(untypedHelper("provider exploded: /private/task")).toEqual({
      kind: "denied",
      reason: "missing-attestation",
    })

    // @ts-expect-error Only the closed denial union is accepted by typed consumers.
    createExploreDenial("arbitrary-runtime-error")
  })
})
