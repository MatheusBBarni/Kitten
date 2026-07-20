import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import {
  THEME_PRESET_ALIASES,
  THEME_PRESET_IDS,
  type ThemePresetId,
} from "../core/themeCatalog.ts"
import { createAppStore } from "../store/appStore.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  CATPPUCCIN_LATTE_PALETTE,
  CATPPUCCIN_MOCHA_PALETTE,
  DARK_PALETTE,
  LIGHT_PALETTE,
  PALETTES,
  PRESET_PALETTES,
  paletteFor,
  resolvePalette,
  syntaxStyleFor,
  usePalette,
  type CockpitPalette,
} from "./theme.ts"

/** Renders the effective palette, so live preference updates are visible in a frame. */
function PaletteProbe() {
  const palette = usePalette()
  return (
    <text>
      {`id=${palette.id} mode=${palette.mode} accent=${palette.accent} banner=${palette.banner.mascot}/${palette.banner.detail} context=${palette.context.ok}/${palette.context.warn}/${palette.context.critical}`}
    </text>
  )
}

/** Exercises the many palette consumers mounted by the cockpit shell together. */
function PaletteFanoutProbe() {
  return (
    <>
      {Array.from({ length: 11 }, (_, index) => (
        <PaletteProbe key={index} />
      ))}
    </>
  )
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  }

  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** Approximate the xterm-256 fallback used when truecolor is unavailable. */
function ansi256Fallback(hex: string): string {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  const cubeSteps = [0, 95, 135, 175, 215, 255]
  const candidates: number[][] = []

  for (const red of cubeSteps) {
    for (const green of cubeSteps) {
      for (const blue of cubeSteps) candidates.push([red, green, blue])
    }
  }
  for (let index = 0; index < 24; index += 1) {
    const gray = 8 + index * 10
    candidates.push([gray, gray, gray])
  }

  const fallback = candidates.reduce((closest, candidate) => {
    const distance = candidate.reduce((sum, channel, index) => sum + (channel - rgb[index]!) ** 2, 0)
    const closestDistance = closest.reduce((sum, channel, index) => sum + (channel - rgb[index]!) ** 2, 0)
    return distance < closestDistance ? candidate : closest
  })

  return `#${fallback.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
}

function foregroundsOnSurface(palette: CockpitPalette): readonly string[] {
  return [
    palette.text,
    palette.muted,
    palette.accent,
    ...Object.values(palette.banner),
    ...Object.values(palette.context),
    ...Object.values(palette.status),
    ...Object.values(palette.tool),
    ...Object.values(palette.syntax),
  ]
}

const THEME_PRESET_ALIAS_ENTRIES = Object.entries(THEME_PRESET_ALIASES) as [string, ThemePresetId][]

describe("paletteFor", () => {
  it("returns the light palette for a light terminal", () => {
    expect(paletteFor("light")).toBe(LIGHT_PALETTE)
  })

  it("falls back to dark when the terminal reports no theme", () => {
    expect(paletteFor("dark")).toBe(DARK_PALETTE)
    expect(paletteFor(null)).toBe(DARK_PALETTE)
    expect(paletteFor(undefined)).toBe(DARK_PALETTE)
  })

  it("gives every agent state its own color in every palette", () => {
    for (const palette of Object.values(PALETTES) satisfies CockpitPalette[]) {
      const tones = Object.values(palette.status)
      expect(new Set(tones).size).toBe(tones.length)
    }
  })

  it("gives every tool-call state its own color in every palette", () => {
    for (const palette of Object.values(PALETTES) satisfies CockpitPalette[]) {
      const tones = Object.values(palette.tool)
      expect(new Set(tones).size).toBe(tones.length)
    }
  })

  it("tints the user's message band a shade off the surface in every palette", () => {
    for (const palette of Object.values(PALETTES) satisfies CockpitPalette[]) {
      // A band distinct from the surface, so the user's turn reads as its own block, but
      // not the text color, so words never vanish into their own background.
      expect(palette.userMessageSurface).not.toBe(palette.surface)
      expect(palette.userMessageSurface).not.toBe(palette.text)
    }
  })

  it("provides distinct semantic banner and context tones in every palette", () => {
    for (const palette of Object.values(PALETTES) satisfies CockpitPalette[]) {
      const bannerTones = Object.values(palette.banner)
      const contextTones = Object.values(palette.context)

      expect(bannerTones.every((tone) => tone.length > 0)).toBe(true)
      expect(contextTones.every((tone) => tone.length > 0)).toBe(true)
      expect(new Set(bannerTones).size).toBe(bannerTones.length)
      expect(new Set(contextTones).size).toBe(contextTones.length)
    }
  })

  it("uses readable chrome tones in the built-in dark and light modes", () => {
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      const chromeTones = [palette.accent, ...Object.values(palette.banner), ...Object.values(palette.context)]
      for (const tone of chromeTones) expect(contrastRatio(tone, palette.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps built-in chrome readable after xterm-256 fallback quantization", () => {
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      const fallbackSurface = ansi256Fallback(palette.surface)
      const chromeTones = [palette.accent, ...Object.values(palette.banner), ...Object.values(palette.context)]
      for (const tone of chromeTones) {
        expect(contrastRatio(ansi256Fallback(tone), fallbackSurface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it("retunes the built-in modes to non-empty, mode-specific warm accents", () => {
    expect(DARK_PALETTE.accent).not.toBe("")
    expect(LIGHT_PALETTE.accent).not.toBe("")
    expect(DARK_PALETTE.accent).not.toBe(LIGHT_PALETTE.accent)
    expect(paletteFor("light").accent).toBe(LIGHT_PALETTE.accent)
    expect(paletteFor(null).accent).toBe(DARK_PALETTE.accent)
  })
})

describe("PALETTES", () => {
  it("indexes every palette by its stable id", () => {
    expect(PALETTES.dark).toBe(DARK_PALETTE)
    expect(PALETTES.light).toBe(LIGHT_PALETTE)
    expect(PALETTES["catppuccin-mocha"]).toBe(CATPPUCCIN_MOCHA_PALETTE)
    expect(PALETTES["catppuccin-latte"]).toBe(CATPPUCCIN_LATTE_PALETTE)
    for (const [id, palette] of Object.entries(PALETTES)) expect(palette.id).toBe(id)
  })

  it("exactly covers the canonical catalog with matching palette ids", () => {
    expect(Object.keys(PRESET_PALETTES)).toEqual([...THEME_PRESET_IDS])
    for (const id of THEME_PRESET_IDS) expect(PRESET_PALETTES[id].id).toBe(id)
  })

  it("provides every semantic role for every canonical preset", () => {
    for (const palette of Object.values(PRESET_PALETTES)) {
      expect(palette.mode === "dark" || palette.mode === "light").toBe(true)
      expect(foregroundsOnSurface(palette).every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true)
      expect(/^#[0-9A-F]{6}$/.test(palette.border)).toBe(true)
      expect(/^#[0-9A-F]{6}$/.test(palette.userMessageSurface)).toBe(true)
      expect(/^#[0-9A-F]{6}$/.test(palette.selectionSurface)).toBe(true)
    }
  })

  it("keeps every rendered foreground pair readable in truecolor", () => {
    for (const palette of Object.values(PRESET_PALETTES)) {
      for (const color of foregroundsOnSurface(palette)) {
        expect(contrastRatio(color, palette.surface)).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(palette.text, palette.userMessageSurface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.text, palette.selectionSurface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("keeps every rendered foreground pair readable after ANSI-256 fallback", () => {
    for (const palette of Object.values(PRESET_PALETTES)) {
      const surface = ansi256Fallback(palette.surface)
      for (const color of foregroundsOnSurface(palette)) {
        expect(contrastRatio(ansi256Fallback(color), surface)).toBeGreaterThanOrEqual(4.5)
      }
      expect(
        contrastRatio(ansi256Fallback(palette.text), ansi256Fallback(palette.userMessageSurface)),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(ansi256Fallback(palette.text), ansi256Fallback(palette.selectionSurface)),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("preserves distinct message, selection, status, and tool affordances in both color modes", () => {
    for (const palette of Object.values(PRESET_PALETTES)) {
      expect(new Set([palette.surface, palette.userMessageSurface, palette.selectionSurface]).size).toBe(3)
      expect(
        new Set([palette.surface, palette.userMessageSurface, palette.selectionSurface].map(ansi256Fallback)).size,
      ).toBe(3)

      for (const tones of [Object.values(palette.status), Object.values(palette.tool)]) {
        expect(new Set(tones).size).toBe(tones.length)
        expect(new Set(tones.map(ansi256Fallback)).size).toBe(tones.length)
      }
    }
  })
})

describe("resolvePalette", () => {
  it("follows the terminal for auto", () => {
    expect(resolvePalette("auto", "dark")).toBe(DARK_PALETTE)
    expect(resolvePalette("auto", "light")).toBe(LIGHT_PALETTE)
  })

  it("pins the built-in light and dark palettes regardless of terminal mode", () => {
    expect(resolvePalette("light", "dark")).toBe(LIGHT_PALETTE)
    expect(resolvePalette("dark", "light")).toBe(DARK_PALETTE)
  })

  it("selects every canonical preset regardless of terminal mode", () => {
    for (const id of THEME_PRESET_IDS) {
      expect(resolvePalette(id, "dark")).toBe(PRESET_PALETTES[id])
      expect(resolvePalette(id, "light")).toBe(PRESET_PALETTES[id])
    }
  })

  it("canonicalizes every declared alias to the canonical palette object", () => {
    for (const [alias, canonicalId] of THEME_PRESET_ALIAS_ENTRIES) {
      expect(resolvePalette(alias, "dark")).toBe(PRESET_PALETTES[canonicalId])
      expect(resolvePalette(alias, "light")).toBe(PRESET_PALETTES[canonicalId])
    }
  })

  it("falls back to the terminal palette for an unknown id", () => {
    expect(resolvePalette("removed-preset", "dark")).toBe(DARK_PALETTE)
    expect(resolvePalette("__proto__", "light")).toBe(LIGHT_PALETTE)
  })
})

describe("syntaxStyleFor", () => {
  it("registers real token styles rather than an empty style", () => {
    // A bare `SyntaxStyle.create()` has none, which would leave code one flat color.
    expect(syntaxStyleFor(DARK_PALETTE).getStyleCount()).toBeGreaterThan(0)
    expect(syntaxStyleFor(DARK_PALETTE).getStyle("comment")).toBeDefined()
  })

  it("reuses one native style per palette id and keeps palette ids distinct", () => {
    expect(syntaxStyleFor(DARK_PALETTE)).toBe(syntaxStyleFor(DARK_PALETTE))
    expect(syntaxStyleFor(CATPPUCCIN_MOCHA_PALETTE)).toBe(syntaxStyleFor(CATPPUCCIN_MOCHA_PALETTE))
    expect(syntaxStyleFor(DARK_PALETTE)).not.toBe(syntaxStyleFor(CATPPUCCIN_MOCHA_PALETTE))
  })

  it("uses one stable cache entry per canonical preset and its declared aliases", () => {
    const canonicalStyles = THEME_PRESET_IDS.map((id) => syntaxStyleFor(resolvePalette(id, "dark")))
    expect(new Set(canonicalStyles).size).toBe(THEME_PRESET_IDS.length)

    for (const [alias, canonicalId] of THEME_PRESET_ALIAS_ENTRIES) {
      expect(syntaxStyleFor(resolvePalette(alias, "dark"))).toBe(
        syntaxStyleFor(PRESET_PALETTES[canonicalId]),
      )
    }
  })

  it("colors code differently in each effective palette", () => {
    const darkKeyword = syntaxStyleFor(DARK_PALETTE).getStyle("keyword")?.fg?.toString()
    const latteKeyword = syntaxStyleFor(CATPPUCCIN_LATTE_PALETTE).getStyle("keyword")?.fg?.toString()
    expect(darkKeyword).toBeDefined()
    expect(darkKeyword).not.toBe(latteKeyword)
  })

  it("registers every Markdown grammar capture in dark and light palettes", () => {
    const markupScopes = [
      "markup.heading",
      "markup.heading.1",
      "markup.heading.2",
      "markup.heading.3",
      "markup.heading.4",
      "markup.heading.5",
      "markup.heading.6",
      "markup.strong",
      "markup.italic",
      "markup.strikethrough",
      "markup.raw",
      "markup.raw.block",
      "markup.list",
      "markup.list.checked",
      "markup.list.unchecked",
      "markup.quote",
      "markup.link",
      "markup.link.label",
      "markup.link.url",
    ]

    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      const syntaxStyle = syntaxStyleFor(palette)
      for (const scope of markupScopes) {
        expect(syntaxStyle.getStyle(scope)).toBeDefined()
        expect(syntaxStyle.getStyle(scope)?.fg).toBeDefined()
        expect(syntaxStyle.getStyle(scope)?.bg).toBeUndefined()
      }
    }
  })

  it("styles Markdown headings and emphasis with supported attributes", () => {
    const syntaxStyle = syntaxStyleFor(DARK_PALETTE)

    expect(syntaxStyle.getStyle("markup.heading.1")?.bold).toBe(true)
    expect(syntaxStyle.getStyle("markup.strong")?.bold).toBe(true)
    expect(syntaxStyle.getStyle("markup.italic")?.italic).toBe(true)
  })

  it("styles Markdown links and dims strikethrough without a strike attribute", () => {
    const syntaxStyle = syntaxStyleFor(DARK_PALETTE)
    const linkUrl = syntaxStyle.getStyle("markup.link.url")
    const strikethrough = syntaxStyle.getStyle("markup.strikethrough")

    expect(linkUrl?.fg).toBeDefined()
    expect(strikethrough?.fg).toBeDefined()
    expect(strikethrough?.dim).toBe(true)
    expect(strikethrough).not.toHaveProperty("strikethrough")
  })

  it("uses theme-aware Markdown heading foregrounds", () => {
    const darkHeading = syntaxStyleFor(DARK_PALETTE).getStyle("markup.heading.1")?.fg?.toString()
    const lightHeading = syntaxStyleFor(LIGHT_PALETTE).getStyle("markup.heading.1")?.fg?.toString()

    expect(darkHeading).toBeDefined()
    expect(lightHeading).toBeDefined()
    expect(darkHeading).not.toBe(lightHeading)
  })

  it("does not invent unsupported Markdown heading levels", () => {
    expect(syntaxStyleFor(DARK_PALETTE).getStyle("markup.heading.7")).toBeUndefined()
  })
})

describe("usePalette", () => {
  it("shares one renderer theme listener across palette consumers", async () => {
    const store = createAppStore({ preferences: { theme: "auto" } })
    const controller = createFakeController({ store })
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <PaletteFanoutProbe />
      </CockpitProvider>,
      { width: 160, height: 24 },
    )

    expect(await waitForFrame((f) => f.includes("id=dark"))).toContain(DARK_PALETTE.accent)
    expect(renderer.listenerCount("theme_mode")).toBe(1)

    await actAsync(() => {
      renderer.emit("theme_mode", "light")
    })

    expect(await waitForFrame((f) => f.includes("id=light"))).toContain(LIGHT_PALETTE.accent)
    expect(renderer.listenerCount("theme_mode")).toBe(1)

    await destroyMounted(renderer)
  })

  it("repaints when the store preference changes from auto to Catppuccin Mocha", async () => {
    const store = createAppStore()
    const controller = createFakeController({ store })
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <PaletteProbe />
      </CockpitProvider>,
      { width: 160, height: 4 },
    )

    expect(await waitForFrame((f) => f.includes("id=dark"))).toContain(DARK_PALETTE.accent)

    await actAsync(() => {
      store.setThemePreference("catppuccin-mocha")
    })

    expect(await waitForFrame((f) => f.includes("id=catppuccin-mocha"))).toContain(CATPPUCCIN_MOCHA_PALETTE.accent)

    await destroyMounted(renderer)
  })

  it("keeps a selected canonical preset pinned while terminal mode changes", async () => {
    const store = createAppStore({ preferences: { theme: "tokyo-night-day" } })
    const controller = createFakeController({ store })
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <PaletteProbe />
      </CockpitProvider>,
      { width: 160, height: 4 },
    )

    const initialFrame = await waitForFrame((frame) => frame.includes("id=tokyo-night-day"))
    expect(initialFrame).toContain(PRESET_PALETTES["tokyo-night-day"].accent)

    await actAsync(() => {
      renderer.emit("theme_mode", "light")
    })

    const repaintedFrame = await waitForFrame((frame) => frame.includes("id=tokyo-night-day"))
    expect(repaintedFrame).toContain(PRESET_PALETTES["tokyo-night-day"].accent)

    await destroyMounted(renderer)
  })

  it("re-resolves auto when the terminal reports a light theme", async () => {
    const store = createAppStore({ preferences: { theme: "auto" } })
    const controller = createFakeController({ store })
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <PaletteProbe />
      </CockpitProvider>,
      { width: 160, height: 4 },
    )

    const darkFrame = await waitForFrame((f) => f.includes("id=dark"))
    expect(darkFrame).toContain(DARK_PALETTE.accent)
    for (const tone of [...Object.values(DARK_PALETTE.banner), ...Object.values(DARK_PALETTE.context)]) {
      expect(darkFrame).toContain(tone)
    }

    await actAsync(() => {
      renderer.emit("theme_mode", "light")
    })

    const lightFrame = await waitForFrame((f) => f.includes("id=light"))
    expect(lightFrame).toContain(LIGHT_PALETTE.accent)
    for (const tone of [...Object.values(LIGHT_PALETTE.banner), ...Object.values(LIGHT_PALETTE.context)]) {
      expect(lightFrame).toContain(tone)
    }

    await destroyMounted(renderer)
  })
})
