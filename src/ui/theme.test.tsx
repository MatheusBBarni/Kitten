import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { DARK_PALETTE, LIGHT_PALETTE, paletteFor, usePalette, type CockpitPalette } from "./theme.ts"

/** Renders whichever palette the terminal theme currently resolves to. */
function PaletteProbe() {
  const palette = usePalette()
  return <text>{`mode=${palette.mode} accent=${palette.accent}`}</text>
}

describe("paletteFor", () => {
  it("returns the light palette for a light terminal", () => {
    expect(paletteFor("light")).toBe(LIGHT_PALETTE)
  })

  it("falls back to dark when the terminal reports no theme", () => {
    expect(paletteFor("dark")).toBe(DARK_PALETTE)
    expect(paletteFor(null)).toBe(DARK_PALETTE)
    expect(paletteFor(undefined)).toBe(DARK_PALETTE)
  })

  it("gives every agent state its own color in both modes", () => {
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE] satisfies CockpitPalette[]) {
      const tones = Object.values(palette.status)
      expect(new Set(tones).size).toBe(tones.length)
    }
  })
})

describe("usePalette", () => {
  it("starts dark and repaints when the terminal reports a light theme", async () => {
    const { renderer, waitForFrame } = await testRender(<PaletteProbe />, { width: 60, height: 4 })

    expect(await waitForFrame((f) => f.includes("mode=dark"))).toContain(DARK_PALETTE.accent)

    await actAsync(() => {
      renderer.emit("theme_mode", "light")
    })

    expect(await waitForFrame((f) => f.includes("mode=light"))).toContain(LIGHT_PALETTE.accent)

    await destroyMounted(renderer)
  })
})
