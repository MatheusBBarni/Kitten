import { describe, expect, it } from "bun:test"

import type { AgentConfig } from "../core/types.ts"
import { HARD_STOP_CONTINUATION_ADAPTER_IMPLEMENTATIONS } from "../agent/hardStopContinuation.ts"
import {
  CERTIFIED_HARD_STOP_CONTINUATION_RECIPES,
  classifyHardStopContinuationCapability,
  type CertifiedHardStopContinuationRecipe,
  type HardStopContinuationAdapterImplementation,
} from "./hardStopContinuationCapability.ts"

const RECIPE = {
  id: "codex",
  displayName: "Codex",
  command: "npx",
  args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
  env: { INITIAL_AGENT_MODE: "agent-full-access" },
} satisfies AgentConfig

const CERTIFICATION: CertifiedHardStopContinuationRecipe = {
  implementationId: "codex-acp-hard-stop-v1",
  providerKind: "codex",
  command: RECIPE.command,
  args: RECIPE.args,
  env: RECIPE.env,
  adapterPackage: "@agentclientprotocol/codex-acp",
  adapterVersion: "1.1.2",
  reviewed: true,
}

const IMPLEMENTATION: HardStopContinuationAdapterImplementation = {
  implementationId: CERTIFICATION.implementationId,
  providerKind: CERTIFICATION.providerKind,
  adapterPackage: CERTIFICATION.adapterPackage,
  adapterVersion: CERTIFICATION.adapterVersion,
  cancellationAccepted: true,
  terminalSettlement: true,
}

describe("Hard Stop continuation capability", () => {
  it("ships unavailable until both reviewed recipe and adapter-local evidence exist", () => {
    expect(CERTIFIED_HARD_STOP_CONTINUATION_RECIPES).toEqual([])
    expect(HARD_STOP_CONTINUATION_ADAPTER_IMPLEMENTATIONS).toEqual([])
    expect(classifyHardStopContinuationCapability(RECIPE)).toEqual({
      status: "unavailable",
      reason: "unreviewed_recipe",
    })
  })

  it("admits only a matching complete certification and implementation", () => {
    expect(classifyHardStopContinuationCapability(RECIPE, [CERTIFICATION], [IMPLEMENTATION])).toEqual({
      status: "supported",
    })
    expect(classifyHardStopContinuationCapability(RECIPE, [CERTIFICATION])).toEqual({
      status: "unavailable",
      reason: "missing_implementation",
    })
  })

  it.each([
    ["cancellation acceptance", { ...IMPLEMENTATION, cancellationAccepted: false }],
    ["terminal settlement", { ...IMPLEMENTATION, terminalSettlement: false }],
  ])("rejects incomplete %s evidence", (_case, implementation) => {
    expect(classifyHardStopContinuationCapability(RECIPE, [CERTIFICATION], [implementation])).toEqual({
      status: "unavailable",
      reason: "incomplete_attestation",
    })
  })

  it("rejects unknown and unreviewed recipes", () => {
    expect(
      classifyHardStopContinuationCapability(
        { ...RECIPE, args: ["-y", "@agentclientprotocol/other-acp@1.1.2"] },
        [CERTIFICATION],
        [IMPLEMENTATION],
      ),
    ).toEqual({ status: "unavailable", reason: "unknown_recipe" })

    expect(
      classifyHardStopContinuationCapability(
        RECIPE,
        [{ ...CERTIFICATION, reviewed: false }],
        [IMPLEMENTATION],
      ),
    ).toEqual({ status: "unavailable", reason: "unreviewed_recipe" })
  })

  it("rejects adapter release drift before consulting implementation evidence", () => {
    const drifted = {
      ...RECIPE,
      args: ["-y", "@agentclientprotocol/codex-acp@1.1.3"],
    }
    expect(classifyHardStopContinuationCapability(drifted, [CERTIFICATION], [IMPLEMENTATION])).toEqual({
      status: "unavailable",
      reason: "adapter_release_mismatch",
    })
  })

  it.each([
    ["command", { ...RECIPE, command: "/opt/bin/npx" }],
    ["ordered arguments", { ...RECIPE, args: [...RECIPE.args].reverse() }],
    ["extended arguments", { ...RECIPE, args: [...RECIPE.args, "--debug"] }],
    ["environment", { ...RECIPE, env: { ...RECIPE.env, CODEX_HOME: "/tmp" } }],
  ])("rejects %s drift", (_case, recipe) => {
    expect(classifyHardStopContinuationCapability(recipe, [CERTIFICATION], [IMPLEMENTATION])).toEqual({
      status: "unavailable",
      reason: "recipe_mismatch",
    })
  })

  it("rejects stale or mismatched adapter-local evidence", () => {
    expect(
      classifyHardStopContinuationCapability(
        RECIPE,
        [CERTIFICATION],
        [{ ...IMPLEMENTATION, adapterVersion: "1.1.1" }],
      ),
    ).toEqual({ status: "unavailable", reason: "attestation_mismatch" })

    expect(
      classifyHardStopContinuationCapability(
        RECIPE,
        [CERTIFICATION],
        [IMPLEMENTATION, { ...IMPLEMENTATION, terminalSettlement: false }],
      ),
    ).toEqual({ status: "unavailable", reason: "attestation_mismatch" })
  })

  it("exposes a content-free, protocol-free verdict", () => {
    const verdict = classifyHardStopContinuationCapability(RECIPE, [CERTIFICATION], [IMPLEMENTATION])
    expect(Object.keys(verdict)).toEqual(["status"])
    expect(JSON.stringify(verdict)).not.toMatch(
      /adapter|acp|payload|prompt|content|error|session|implementation|provider/iu,
    )

    const unavailable = classifyHardStopContinuationCapability(RECIPE)
    expect(Object.keys(unavailable).sort()).toEqual(["reason", "status"])
    expect(JSON.stringify(unavailable)).not.toMatch(
      /adapter|acp|payload|prompt|content|error|session|implementation|provider/iu,
    )
  })
})
