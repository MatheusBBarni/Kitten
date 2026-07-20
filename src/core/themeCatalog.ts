/**
 * The finite, protocol-free authority for curated theme identity and provenance.
 *
 * Palette values remain UI-owned. This module performs no discovery or I/O and
 * imports no runtime, renderer, configuration, or telemetry dependencies.
 */

/** Immutable metadata carried by one curated theme preset. */
export interface ThemePreset<Id extends string = ThemePresetId> {
  readonly id: Id
  readonly family: string
  readonly variant: string | null
  readonly displayName: string
  readonly sourceUrl: string
  readonly licenseAttribution: string
}

/** The complete catalog in deterministic family-and-variant presentation order. */
export const THEME_PRESETS = [
  {
    id: "catppuccin-frappe",
    family: "Catppuccin",
    variant: "Frappe",
    displayName: "Catppuccin Frappe",
    sourceUrl: "https://github.com/catppuccin/catppuccin",
    licenseAttribution: "MIT",
  },
  {
    id: "catppuccin-latte",
    family: "Catppuccin",
    variant: "Latte",
    displayName: "Catppuccin Latte",
    sourceUrl: "https://github.com/catppuccin/catppuccin",
    licenseAttribution: "MIT",
  },
  {
    id: "catppuccin-macchiato",
    family: "Catppuccin",
    variant: "Macchiato",
    displayName: "Catppuccin Macchiato",
    sourceUrl: "https://github.com/catppuccin/catppuccin",
    licenseAttribution: "MIT",
  },
  {
    id: "catppuccin-mocha",
    family: "Catppuccin",
    variant: "Mocha",
    displayName: "Catppuccin Mocha",
    sourceUrl: "https://github.com/catppuccin/catppuccin",
    licenseAttribution: "MIT",
  },
  {
    id: "dracula-alucard",
    family: "Dracula",
    variant: "Alucard",
    displayName: "Dracula Alucard",
    sourceUrl: "https://github.com/dracula/dracula-theme",
    licenseAttribution: "MIT, Dracula Theme",
  },
  {
    id: "dracula",
    family: "Dracula",
    variant: "Dracula",
    displayName: "Dracula",
    sourceUrl: "https://github.com/dracula/dracula-theme",
    licenseAttribution: "MIT, Dracula Theme",
  },
  {
    id: "gruvbox-dark-hard",
    family: "Gruvbox Dark",
    variant: "Hard",
    displayName: "Gruvbox Dark Hard",
    sourceUrl: "https://github.com/morhetz/gruvbox",
    licenseAttribution: "MIT/X11, Pavel Pertsev",
  },
  {
    id: "gruvbox-dark-medium",
    family: "Gruvbox Dark",
    variant: "Medium",
    displayName: "Gruvbox Dark Medium",
    sourceUrl: "https://github.com/morhetz/gruvbox",
    licenseAttribution: "MIT/X11, Pavel Pertsev",
  },
  {
    id: "gruvbox-dark-soft",
    family: "Gruvbox Dark",
    variant: "Soft",
    displayName: "Gruvbox Dark Soft",
    sourceUrl: "https://github.com/morhetz/gruvbox",
    licenseAttribution: "MIT/X11, Pavel Pertsev",
  },
  {
    id: "nord",
    family: "Nord",
    variant: null,
    displayName: "Nord",
    sourceUrl: "https://github.com/nordtheme/nord",
    licenseAttribution: "MIT, Sven Greb / Nord",
  },
  {
    id: "one-dark",
    family: "One Dark",
    variant: null,
    displayName: "One Dark",
    sourceUrl: "https://github.com/atom/atom/tree/master/packages/one-dark-syntax",
    licenseAttribution: "MIT, Atom / GitHub",
  },
  {
    id: "rose-pine-dawn",
    family: "Rosé Pine",
    variant: "Dawn",
    displayName: "Rosé Pine Dawn",
    sourceUrl: "https://github.com/rose-pine/rose-pine-palette",
    licenseAttribution: "MIT, Rosé Pine",
  },
  {
    id: "rose-pine-main",
    family: "Rosé Pine",
    variant: "Main",
    displayName: "Rosé Pine Main",
    sourceUrl: "https://github.com/rose-pine/rose-pine-palette",
    licenseAttribution: "MIT, Rosé Pine",
  },
  {
    id: "rose-pine-moon",
    family: "Rosé Pine",
    variant: "Moon",
    displayName: "Rosé Pine Moon",
    sourceUrl: "https://github.com/rose-pine/rose-pine-palette",
    licenseAttribution: "MIT, Rosé Pine",
  },
  {
    id: "tokyo-night-day",
    family: "Tokyo Night",
    variant: "Day",
    displayName: "Tokyo Night Day",
    sourceUrl: "https://github.com/folke/tokyonight.nvim",
    licenseAttribution: "Apache-2.0, folke",
  },
  {
    id: "tokyo-night-moon",
    family: "Tokyo Night",
    variant: "Moon",
    displayName: "Tokyo Night Moon",
    sourceUrl: "https://github.com/folke/tokyonight.nvim",
    licenseAttribution: "Apache-2.0, folke",
  },
  {
    id: "tokyo-night",
    family: "Tokyo Night",
    variant: "Night",
    displayName: "Tokyo Night",
    sourceUrl: "https://github.com/folke/tokyonight.nvim",
    licenseAttribution: "Apache-2.0, folke",
  },
  {
    id: "tokyo-night-storm",
    family: "Tokyo Night",
    variant: "Storm",
    displayName: "Tokyo Night Storm",
    sourceUrl: "https://github.com/folke/tokyonight.nvim",
    licenseAttribution: "Apache-2.0, folke",
  },
] as const satisfies readonly ThemePreset<string>[]

/** A durable canonical preset identity derived from the catalog authority. */
export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"]

/** The canonical preset identities in the same deterministic order as the catalog. */
export const THEME_PRESET_IDS: readonly ThemePresetId[] = Object.freeze(
  THEME_PRESETS.map((preset) => preset.id),
)

/** Compatibility input only: aliases can target canonical identities, never aliases. */
export const THEME_PRESET_ALIASES = Object.freeze({}) satisfies Readonly<
  Record<string, ThemePresetId>
>

/** A declared compatibility input accepted by the catalog. */
export type ThemePresetAlias = keyof typeof THEME_PRESET_ALIASES

const PRESET_IDS = new Set<string>(THEME_PRESET_IDS)
const PRESETS_BY_ID = new Map<string, ThemePreset>(
  THEME_PRESETS.map((preset) => [preset.id, preset]),
)

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

/** Whether a string is one of the catalog's canonical identities. */
export function isThemePresetId(value: string): value is ThemePresetId {
  return PRESET_IDS.has(value)
}

/** Look up canonical metadata without treating an alias as a second identity. */
export function themePresetById(value: string): ThemePreset | null {
  return PRESETS_BY_ID.get(value) ?? null
}

/** Resolve canonical and explicitly declared compatibility input to canonical identity. */
export function canonicalThemePresetId(value: string): ThemePresetId | null {
  if (isThemePresetId(value)) return value
  if (!hasOwn(THEME_PRESET_ALIASES, value)) return null
  return THEME_PRESET_ALIASES[value as ThemePresetAlias]
}
