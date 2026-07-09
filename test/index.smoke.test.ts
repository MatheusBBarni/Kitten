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

  it("allocates nothing from the native render library on import", async () => {
    // The whole cockpit tree hangs off this import. A view that builds a native
    // handle (a `SyntaxStyle`, a renderer) at module scope would run it here, long
    // before `main()` decides a terminal exists. Importing must stay inert.
    const proc = Bun.spawnSync([
      "bun",
      "-e",
      `
      const { resolveRenderLib } = await import("@opentui/core")
      let allocations = 0
      const lib = resolveRenderLib()
      const original = lib.createSyntaxStyle.bind(lib)
      lib.createSyntaxStyle = (...args) => { allocations++; return original(...args) }
      await import("${import.meta.dir}/../src/index.ts")
      if (allocations !== 0) throw new Error("import allocated " + allocations + " syntax style(s)")
      `,
    ])

    expect(proc.stderr.toString()).toBe("")
    expect(proc.exitCode).toBe(0)
  })
})
