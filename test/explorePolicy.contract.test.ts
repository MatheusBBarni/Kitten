import { expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import {
  EXPLORE_RESTRICTIONS,
  evaluateExplorePolicy,
  type ExplorePolicyInput,
} from "../src/core/explorePolicy.ts"

it("exports a usable core policy contract without importing outer layers", () => {
  const source = readFileSync(new URL("../src/core/explorePolicy.ts", import.meta.url), "utf8")
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])

  expect(imports).toEqual(["./types.ts"])
  expect(imports.join("\n")).not.toMatch(
    /agentclientprotocol|\/agent\/|\/config\/|react|telemetry|persistence|sessionPersistence/,
  )

  const input: ExplorePolicyInput = {
    role: "explore",
    restrictions: { ...EXPLORE_RESTRICTIONS },
    limits: { perParent: 1, global: 1 },
    attestationVersion: "contract-v1",
    confirmed: { provider: "claude-code", model: "claude", effort: "high" },
  }
  expect(evaluateExplorePolicy(input).kind).toBe("eligible")
})
