import { describe, expect, it } from "bun:test"

import {
  THEME_PRESET_ALIASES,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  canonicalThemePresetId,
  isThemePresetId,
  themePresetById,
  type ThemePresetId,
} from "./themeCatalog.ts"

const EXPECTED_IDS = [
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dracula-alucard",
  "dracula",
  "gruvbox-dark-hard",
  "gruvbox-dark-medium",
  "gruvbox-dark-soft",
  "nord",
  "one-dark",
  "rose-pine-dawn",
  "rose-pine-main",
  "rose-pine-moon",
  "tokyo-night-day",
  "tokyo-night-moon",
  "tokyo-night",
  "tokyo-night-storm",
] as const satisfies readonly ThemePresetId[]

describe("theme catalog", () => {
  it("declares exactly the approved unique canonical roster in deterministic order", () => {
    expect(THEME_PRESET_IDS).toEqual(EXPECTED_IDS)
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([...EXPECTED_IDS])
    expect(THEME_PRESETS).toHaveLength(18)
    expect(new Set(THEME_PRESET_IDS)).toHaveLength(18)
  })

  it("carries complete source metadata and null variants only for singleton families", () => {
    const familyCounts = new Map<string, number>()
    for (const preset of THEME_PRESETS) {
      familyCounts.set(preset.family, (familyCounts.get(preset.family) ?? 0) + 1)
      expect(preset.family.trim()).not.toBe("")
      expect(preset.displayName.trim()).not.toBe("")
      expect(preset.sourceUrl).toMatch(/^https:\/\/github\.com\//)
      expect(preset.licenseAttribution.trim()).not.toBe("")
    }

    for (const preset of THEME_PRESETS) {
      expect(preset.variant === null).toBe(familyCounts.get(preset.family) === 1)
    }
  })

  it("keeps source and attribution records aligned with the public catalog", () => {
    const familyProvenance = new Map(
      THEME_PRESETS.map((preset) => [
        preset.family,
        [preset.sourceUrl, preset.licenseAttribution] as const,
      ]),
    )

    expect(Object.fromEntries(familyProvenance)).toEqual({
      Catppuccin: ["https://github.com/catppuccin/catppuccin", "MIT"],
      Dracula: ["https://github.com/dracula/dracula-theme", "MIT, Dracula Theme"],
      "Gruvbox Dark": ["https://github.com/morhetz/gruvbox", "MIT/X11, Pavel Pertsev"],
      Nord: ["https://github.com/nordtheme/nord", "MIT, Sven Greb / Nord"],
      "One Dark": [
        "https://github.com/atom/atom/tree/master/packages/one-dark-syntax",
        "MIT, Atom / GitHub",
      ],
      "Rosé Pine": ["https://github.com/rose-pine/rose-pine-palette", "MIT, Rosé Pine"],
      "Tokyo Night": ["https://github.com/folke/tokyonight.nvim", "Apache-2.0, folke"],
    })
  })

  it("round-trips every canonical identity through type guards and lookup helpers", () => {
    for (const id of THEME_PRESET_IDS) {
      expect(isThemePresetId(id)).toBe(true)
      expect(canonicalThemePresetId(id)).toBe(id)
      expect(themePresetById(id)?.id).toBe(id)
    }

    expect(isThemePresetId("unknown")).toBe(false)
    expect(themePresetById("unknown")).toBeNull()
  })
})

describe("theme preset compatibility aliases", () => {
  it("targets only canonical identities without self-reference or alias chains", () => {
    const aliases = Object.entries(THEME_PRESET_ALIASES) as [string, ThemePresetId][]

    for (const [alias, target] of aliases) {
      expect(Object.prototype.hasOwnProperty.call(THEME_PRESET_ALIASES, alias)).toBe(true)
      expect(alias).not.toBe(target)
      expect(isThemePresetId(target)).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(THEME_PRESET_ALIASES, target)).toBe(false)
      expect(canonicalThemePresetId(alias)).toBe(target)
    }
  })

  it("rejects unknown and inherited object keys", () => {
    expect(canonicalThemePresetId("unknown")).toBeNull()
    expect(canonicalThemePresetId("toString")).toBeNull()
    expect(canonicalThemePresetId("__proto__")).toBeNull()
    expect(themePresetById("toString")).toBeNull()
    expect(themePresetById("__proto__")).toBeNull()
  })
})
