import { describe, expect, it } from "bun:test"

import tsconfig from "../tsconfig.json" with { type: "json" }

/**
 * ADR-004 mandates the `@opentui/react` JSX runtime. These assertions guard the
 * two settings the binding needs so a later edit cannot silently break JSX.
 */
describe("tsconfig JSX runtime (ADR-004)", () => {
  const options = tsconfig.compilerOptions as Record<string, unknown>

  it("uses the react-jsx automatic runtime", () => {
    expect(options.jsx).toBe("react-jsx")
  })

  it("points jsxImportSource at @opentui/react", () => {
    expect(options.jsxImportSource).toBe("@opentui/react")
  })

  it("enables strict type-checking", () => {
    expect(options.strict).toBe(true)
  })
})
