// Suite: generation-scoped harness-delivery state
// Invariant: one fresh generation has at most one dispatch opportunity.
// Boundary IN: controller generation, harness version, and fixed failure decisions
// Boundary OUT: controller I/O, ACP encoding, rendered harness text, persistence, and UI

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import {
  beginDispatch,
  beginFresh,
  beginLoaded,
  completeDispatch,
  failBeforeDispatch,
  failIndeterminate,
  restoreHarnessDelivery,
  type HarnessDelivery,
  type HarnessFailureCategory,
} from "./harnessDelivery.ts"

const generation = 7

describe("harness delivery creation", () => {
  it("starts fresh and loaded generations with distinct delivery opportunities", () => {
    expect(beginFresh("v1", generation)).toEqual({
      version: "v1",
      generation,
      state: "pending",
    })
    expect(beginLoaded("v1", generation)).toEqual({
      version: "v1",
      generation,
      state: "not_required",
    })
  })

  it("never dispatches a loaded generation", () => {
    const loaded = beginLoaded("v1", generation)
    expect(beginDispatch(loaded, generation)).toBe(loaded)
    expect(completeDispatch(loaded, generation)).toBe(loaded)
    expect(failBeforeDispatch(loaded, generation, { retrySafe: false, category: "unsupported_profile" })).toBe(loaded)
    expect(failIndeterminate(loaded, generation)).toBe(loaded)
  })
})

describe("harness delivery dispatch", () => {
  it("moves only a matching pending generation into flight", () => {
    const pending = beginFresh("v1", generation)
    const inFlight = beginDispatch(pending, generation)

    expect(inFlight).toEqual({ version: "v1", generation, state: "in_flight" })
    expect(beginDispatch(pending, generation + 1)).toBe(pending)
    expect(beginDispatch(inFlight, generation)).toBe(inFlight)
  })

  it.each([
    { version: "v1", generation, state: "not_required" } as const,
    { version: "v1", generation, state: "delivered" } as const,
    { version: "v1", generation, state: "failed", failureCategory: "dispatch_indeterminate" } as const,
  ])("keeps terminal or loaded state $state closed", (delivery) => {
    expect(beginDispatch(delivery, generation)).toBe(delivery)
  })
})

describe("harness delivery settlement", () => {
  it("completes only a matching in-flight generation and keeps duplicate completion terminal", () => {
    const pending = beginFresh("v1", generation)
    const inFlight = beginDispatch(pending, generation)
    const delivered = completeDispatch(inFlight, generation)

    expect(delivered).toEqual({ version: "v1", generation, state: "delivered" })
    expect(completeDispatch(inFlight, generation + 1)).toBe(inFlight)
    expect(completeDispatch(delivered, generation)).toBe(delivered)
    expect(beginDispatch(delivered, generation)).toBe(delivered)
    expect(failIndeterminate(delivered, generation)).toBe(delivered)
  })

  it("keeps known retry-safe pre-dispatch failure pending", () => {
    const pending = beginFresh("v1", generation)
    expect(failBeforeDispatch(pending, generation, { retrySafe: true })).toBe(pending)
    expect(beginDispatch(pending, generation)).toEqual({ version: "v1", generation, state: "in_flight" })
  })

  it.each([
    "unsupported_profile",
    "harness_render_failed",
  ] satisfies readonly HarnessFailureCategory[])("terminalizes fixed pre-dispatch failure %s", (category) => {
    const pending = beginFresh("v1", generation)
    const failed = failBeforeDispatch(pending, generation, { retrySafe: false, category })

    expect(failed).toEqual({ version: "v1", generation, state: "failed", failureCategory: category })
    expect(beginDispatch(failed, generation)).toBe(failed)
    expect(completeDispatch(failed, generation)).toBe(failed)
    expect(failBeforeDispatch(failed, generation, { retrySafe: true })).toBe(failed)
    expect(failIndeterminate(failed, generation)).toBe(failed)
  })

  it("terminalizes post-invocation ambiguity without reopening dispatch", () => {
    const inFlight = beginDispatch(beginFresh("v1", generation), generation)
    const failed = failIndeterminate(inFlight, generation)

    expect(failed).toEqual({
      version: "v1",
      generation,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(failIndeterminate(inFlight, generation + 1)).toBe(inFlight)
    expect(beginDispatch(failed, generation)).toBe(failed)
    expect(completeDispatch(failed, generation)).toBe(failed)
  })

  it("does not classify a pending generation as post-invocation ambiguity", () => {
    const pending = beginFresh("v1", generation)
    expect(failIndeterminate(pending, generation)).toBe(pending)
  })
})

describe("replacement isolation and composite lifecycle", () => {
  it("starts replacement independently and rejects late work from the old generation", () => {
    const oldInFlight = beginDispatch(beginFresh("v1", generation), generation)
    const replacement = beginFresh("v1", generation + 1)

    expect(completeDispatch(replacement, generation)).toBe(replacement)
    expect(failIndeterminate(replacement, generation)).toBe(replacement)
    expect(failBeforeDispatch(replacement, generation, {
      retrySafe: false,
      category: "unsupported_profile",
    })).toBe(replacement)

    const replacementInFlight = beginDispatch(replacement, generation + 1)
    expect(replacementInFlight.state).toBe("in_flight")
    expect(completeDispatch(oldInFlight, generation).state).toBe("delivered")
    expect(replacementInFlight).toEqual({ version: "v1", generation: generation + 1, state: "in_flight" })
  })

  it("folds a fresh lifecycle to one terminal result and never creates a second opportunity", () => {
    const transitions = [
      (state: HarnessDelivery) => beginDispatch(state, generation),
      (state: HarnessDelivery) => completeDispatch(state, generation),
      (state: HarnessDelivery) => beginDispatch(state, generation),
      (state: HarnessDelivery) => failBeforeDispatch(state, generation, { retrySafe: true }),
      (state: HarnessDelivery) => failIndeterminate(state, generation),
      (state: HarnessDelivery) => completeDispatch(state, generation),
    ]
    const states = transitions.reduce<HarnessDelivery[]>((history, transition) => (
      [...history, transition(history.at(-1)!)]
    ), [beginFresh("v1", generation)])

    expect(states.map((state) => state.state)).toEqual([
      "pending",
      "in_flight",
      "delivered",
      "delivered",
      "delivered",
      "delivered",
      "delivered",
    ])
    expect(states.filter((state) => state.state === "in_flight")).toHaveLength(1)
  })
})

describe("persisted checkpoint restoration", () => {
  it("rebinds unresolved and failed facts to the current generation without reopening delivery", () => {
    expect(restoreHarnessDelivery(
      { version: "v1", generation: 99, state: "pending" },
      "v1",
      generation,
      "loaded",
    )).toEqual({
      version: "v1",
      generation,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(restoreHarnessDelivery(
      {
        version: "v1",
        generation: 99,
        state: "failed",
        failureCategory: "unsupported_profile",
      },
      "v1",
      generation,
      "fresh",
    )).toEqual({
      version: "v1",
      generation,
      state: "failed",
      failureCategory: "unsupported_profile",
    })
  })

  it("keeps successful loads not_required while fresh replacements get a new opportunity", () => {
    const delivered = { version: "v1", generation: 2, state: "delivered" } as const
    expect(restoreHarnessDelivery(delivered, "v1", generation, "loaded")).toEqual({
      version: "v1",
      generation,
      state: "not_required",
    })
    expect(restoreHarnessDelivery(delivered, "v1", generation, "fresh")).toEqual({
      version: "v1",
      generation,
      state: "pending",
    })
  })
})

describe("protocol-free content boundary", () => {
  it("keeps production state limited to fixed metadata and imports only the harness version type", () => {
    const source = readFileSync(new URL("./harnessDelivery.ts", import.meta.url), "utf8")
    const imports = source.split("\n").filter((line) => /^\s*import\s/u.test(line)).join("\n")
    const failed = failIndeterminate(beginDispatch(beginFresh("v1", generation), generation), generation)

    expect(imports).toBe('import type { HarnessPromptVersion } from "../core/harnessPrompt.ts"')
    expect(imports).not.toMatch(/@agentclientprotocol|agentConnection|acpTranslate|adapter/u)
    expect(Object.keys(failed).sort()).toEqual(["failureCategory", "generation", "state", "version"])
    expect(source).not.toMatch(/userBlocks|harnessText|rawError|errorMessage|acpSessionId|filePath/u)
    expect(source).not.toMatch(/\bBun\.|\bprocess\.|setTimeout\s*\(|setInterval\s*\(/u)
  })
})
