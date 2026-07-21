import { describe, expect, it } from "bun:test"

import {
  THEME_PRESET_ALIASES,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  type ThemePresetId,
} from "../src/core/themeCatalog.ts"

const catalogDocument = await Bun.file(new URL("../../../docs/theme-catalog.md", import.meta.url)).text()
const readme = await Bun.file(new URL("../../../README.md", import.meta.url)).text()
const context = await Bun.file(new URL("../../../CONTEXT.md", import.meta.url)).text()

interface DocumentedPreset {
  readonly family: string
  readonly variant: string
  readonly displayName: string
  readonly id: string
  readonly source: string
  readonly licenseAttribution: string
}

function section(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading)
  const end = markdown.indexOf(nextHeading, start + heading.length)
  if (start < 0 || end < 0) return ""
  return markdown.slice(start, end)
}

function countLiteral(source: string, value: string): number {
  return source.split(value).length - 1
}

function documentedPresets(): readonly DocumentedPreset[] {
  return section(catalogDocument, "## Presets", "## Stable IDs and compatibility")
    .split("\n")
    .filter((line) => /^\| .*`[^`]+`.* \|$/u.test(line))
    .map((line) => {
      const [family, variant, displayName, rawId, source, licenseAttribution] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
      return {
        family: family!,
        variant: variant!,
        displayName: displayName!,
        id: rawId!.slice(1, -1),
        source: source!,
        licenseAttribution: licenseAttribution!,
      }
    })
}

describe("Theme Catalog documentation contract", () => {
  it("documents the 18 canonical presets exactly once in catalog order", () => {
    const rows = documentedPresets()

    expect(rows).toHaveLength(18)
    expect(rows.map(({ id }) => id)).toEqual([...THEME_PRESET_IDS])
    expect(new Set(rows.map(({ id }) => id))).toHaveLength(THEME_PRESET_IDS.length)

    for (const preset of THEME_PRESETS) {
      const row = rows.find(({ id }) => id === preset.id)
      expect(row).toMatchObject({
        family: preset.family,
        variant: preset.variant ?? "Single preset",
        displayName: preset.displayName,
      })
      expect(countLiteral(catalogDocument, `\`${preset.id}\``)).toBe(1)
    }
  })

  it("keeps every documented source and attribution aligned with the core catalog", () => {
    const rows = documentedPresets()

    for (const preset of THEME_PRESETS) {
      const row = rows.find(({ id }) => id === preset.id)
      expect(row?.source).toContain(`](${preset.sourceUrl})`)
      expect(row?.licenseAttribution).toBe(preset.licenseAttribution)
    }
  })

  it("publishes compatibility, Settings, accessibility, and finite-catalog guarantees", () => {
    const compatibility = section(catalogDocument, "## Stable IDs and compatibility", "## Settings behavior")
    const settings = section(catalogDocument, "## Settings behavior", "## Accessibility and catalog boundary")
    const boundary = catalogDocument.slice(catalogDocument.indexOf("## Accessibility and catalog boundary"))
    const aliases = Object.entries(THEME_PRESET_ALIASES) as [string, ThemePresetId][]

    expect(compatibility).toContain("Aliases are compatibility input only")
    expect(compatibility).toContain("resolves it to the mapped canonical ID")
    expect(compatibility).toContain("does not rewrite the user's configuration file during boot")
    expect(compatibility).toContain("A later explicit theme selection in Settings persists the selected canonical ID")
    if (aliases.length === 0) {
      expect(compatibility).toContain("The current catalog declares no aliases")
    } else {
      for (const [alias, canonical] of aliases) {
        expect(compatibility).toContain(`\`${alias}\``)
        expect(compatibility).toContain(`\`${canonical}\``)
      }
    }

    expect(settings).toContain("deterministic alphabetical order")
    expect(settings).toContain("Family headings are non-selectable")
    expect(settings).toContain("Arrow-key navigation")
    expect(settings).toContain("bounded, vertically scrolling list")
    expect(settings).toContain("applies it instantly")
    expect(settings).toContain("Provenance is documentation-first")

    expect(boundary).toContain("minimum 4.5:1 contrast ratio")
    expect(boundary).toContain("does not support custom or imported themes")
    expect(boundary).toContain("never downloads palettes at runtime")
    expect(boundary).toContain("excludes theme marketplaces")
  })

  it("keeps README and product context linked to one canonical catalog", () => {
    const link = "[Theme Catalog](docs/theme-catalog.md)"

    expect(countLiteral(readme, link)).toBe(1)
    expect(countLiteral(context, link)).toBe(1)
    for (const preset of THEME_PRESETS) {
      expect(readme).not.toContain(`\`${preset.id}\``)
      expect(context).not.toContain(`\`${preset.id}\``)
    }
  })
})
