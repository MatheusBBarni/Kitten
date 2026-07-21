import { describe, expect, it } from "bun:test"

import type { AgentConfig } from "../core/types.ts"
import {
  CERTIFIED_NATIVE_STEERING_RECIPES,
  classifySteeringCapability,
  type CertifiedNativeSteeringRecipe,
  type NativeSteeringAdapterImplementation,
} from "./steeringCapability.ts"

const RECIPE = {
  id: "codex",
  displayName: "Codex",
  command: "npx",
  args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
  env: { INITIAL_AGENT_MODE: "agent-full-access" },
} satisfies AgentConfig

const CERTIFICATION: CertifiedNativeSteeringRecipe = {
  adapterId: "codex-acp-native-steering-v1",
  providerKind: "codex",
  command: RECIPE.command,
  args: RECIPE.args,
  env: RECIPE.env,
  adapterPackage: "@agentclientprotocol/codex-acp",
  adapterVersion: "1.1.2",
}

const IMPLEMENTATION: NativeSteeringAdapterImplementation = {
  adapterId: CERTIFICATION.adapterId,
  terminalAcknowledgement: true,
}

describe("steering capability classification", () => {
  it("ships unavailable for every built-in recipe until an audited native adapter exists", () => {
    expect(CERTIFIED_NATIVE_STEERING_RECIPES).toEqual([])
    expect(classifySteeringCapability(RECIPE)).toEqual({ status: "unavailable" })
  })

  it("requires both an exact certified recipe and its terminal-acknowledgement implementation", () => {
    expect(classifySteeringCapability(RECIPE, [CERTIFICATION])).toEqual({ status: "unavailable" })
    expect(classifySteeringCapability(RECIPE, [], [IMPLEMENTATION])).toEqual({ status: "unavailable" })
    expect(classifySteeringCapability(RECIPE, [CERTIFICATION], [IMPLEMENTATION])).toEqual({
      status: "native",
      adapterId: CERTIFICATION.adapterId,
      adapterPackage: CERTIFICATION.adapterPackage,
      adapterVersion: CERTIFICATION.adapterVersion,
    })
  })

  it("rejects floating or incomplete certification even when the recipe and implementation agree", () => {
    const floatingRecipe = {
      ...RECIPE,
      args: ["-y", "@agentclientprotocol/codex-acp@latest"],
    }
    const floatingCertification = {
      ...CERTIFICATION,
      args: floatingRecipe.args,
      adapterVersion: "latest",
    }
    expect(
      classifySteeringCapability(floatingRecipe, [floatingCertification], [IMPLEMENTATION]),
    ).toEqual({ status: "unavailable" })
  })

  it.each([
    ["unknown recipe", { ...RECIPE, args: ["-y", "@agentclientprotocol/other-acp@1.1.2"] }],
    ["floating version", { ...RECIPE, args: ["-y", "@agentclientprotocol/codex-acp@latest"] }],
    ["custom command", { ...RECIPE, command: "/opt/bin/codex-acp" }],
    ["reordered arguments", { ...RECIPE, args: [...RECIPE.args].reverse() }],
    ["extended arguments", { ...RECIPE, args: [...RECIPE.args, "--debug"] }],
    ["changed environment", { ...RECIPE, env: { ...RECIPE.env, CODEX_HOME: "/tmp" } }],
  ])("keeps a %s unavailable", (_case, recipe) => {
    expect(classifySteeringCapability(recipe, [CERTIFICATION], [IMPLEMENTATION])).toEqual({
      status: "unavailable",
    })
  })

  it("does not infer capability from display metadata or an unmatched adapter implementation", () => {
    const renamed: AgentConfig = { ...RECIPE, displayName: "Native steering enabled" }
    expect(
      classifySteeringCapability(
        renamed,
        [CERTIFICATION],
        [{ adapterId: "different-adapter", terminalAcknowledgement: true }],
      ),
    ).toEqual({ status: "unavailable" })
  })
})
