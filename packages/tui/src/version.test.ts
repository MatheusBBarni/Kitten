// Suite: Kitten version source
// Invariant: every runtime version consumer reads the exact package.json version.
// Boundary IN: the bundled JSON import exposed by src/version.ts.
// Boundary OUT: CLI process dispatch and ACP handshake wiring, covered by their owning suites.

import { describe, expect, it } from "bun:test"

import pkg from "../package.json" with { type: "json" }

import { KITTEN_VERSION } from "./version.ts"

describe("KITTEN_VERSION", () => {
  it("equals package.json's version", () => {
    expect(KITTEN_VERSION).toBe(pkg.version)
  })
})
