import { describe, expect, it } from "bun:test"

/**
 * Smoke test: importing the entry module must resolve without throwing and must
 * NOT boot a renderer (import.meta.main is false under the test runner). This
 * also proves the OpenTUI native library loads under Bun.
 */
describe("src/index.ts entry module", () => {
  it("imports without throwing and exports its public API", async () => {
    const mod = await import("../src/index.ts")

    expect(typeof mod.main).toBe("function")
    expect(typeof mod.createCockpitRenderer).toBe("function")
    expect(typeof mod.renderCockpit).toBe("function")
  })
})
