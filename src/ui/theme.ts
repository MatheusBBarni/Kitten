/**
 * The cockpit palette, resolved against the terminal's own theme.
 *
 * Terminals report their background through an OSC query, which OpenTUI turns
 * into a `ThemeMode` on the renderer plus a `theme_mode` event when it changes
 * mid-run. Kitten never hard-codes a background: it picks foreground colors that
 * stay legible against whichever mode is reported, and re-picks them live when
 * the user flips their terminal from dark to light.
 *
 * Terminals that answer nothing (or answer late) leave `renderer.themeMode` null.
 * Dark is the safe default there: a dark-tuned palette on a light terminal is
 * merely low-contrast, while the reverse can be unreadable.
 */

import { SyntaxStyle, type CliRenderer, type ThemeMode, type ThemeTokenStyle } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useSyncExternalStore } from "react"

import {
  canonicalThemePresetId,
  type ThemePresetId,
} from "../core/themeCatalog.ts"
import type { SessionStatus, ThemePreference, ToolCallStatus } from "../core/types.ts"
import { selectThemePreference } from "../store/selectors.ts"
import { useAppSelector } from "./cockpitContext.tsx"

/** The status-strip slot for an agent whose connection never came up (task_07). */
export const NOT_READY = "not_ready"

/** Every state the status strip can paint: the domain statuses plus not-ready. */
export type StatusTone = SessionStatus | typeof NOT_READY

/** The full set of colors any cockpit view is allowed to use. */
export interface CockpitPalette {
  /** Stable registry key, also used for syntax-style caching. */
  readonly id: string
  /** The mode this palette was resolved for. */
  readonly mode: ThemeMode
  /** Primary reading color. */
  readonly text: string
  /** Secondary color for hints and chrome labels. */
  readonly muted: string
  /** Emphasis: the focused agent's marker, help keys, overlay borders. */
  readonly accent: string
  /** Branded welcome-banner illustration and supporting-detail tones. */
  readonly banner: Readonly<{
    mascot: string
    detail: string
  }>
  /** Context-window thresholds: normal, early warning, and near-full. */
  readonly context: Readonly<{
    ok: string
    warn: string
    critical: string
  }>
  /** Box borders. */
  readonly border: string
  /** The cockpit background. */
  readonly surface: string
  /** One color per agent state, so the strip reads at a glance. */
  readonly status: Readonly<Record<StatusTone, string>>
  /** One color per tool-call state, so a transcript row reads at a glance. */
  readonly tool: Readonly<Record<ToolCallStatus, string>>
  /**
   * The tinted band a user message sits on.
   *
   * A background is a cell attribute, not a glyph, so it never reaches
   * `getSelectedText()` the way a box border would - the band sets the user's turn
   * apart without dragging box-drawing characters into their clipboard. Kept a shade
   * off `surface` so the band reads as its own thing, and dark enough (light enough,
   * on a light terminal) that `text` stays legible on top of it.
   */
  readonly userMessageSurface: string
  /** Background for the currently selected row in an interactive list. */
  readonly selectionSurface: string
  /** Syntax colors, kept in the palette so code has no independent color source. */
  readonly syntax: Readonly<{
    keyword: string
    string: string
    number: string
    function: string
    type: string
    variable: string
  }>
}

/** Tuned against a dark terminal background. */
export const DARK_PALETTE: CockpitPalette = {
  id: "dark",
  mode: "dark",
  text: "#E6E6E6",
  muted: "#8A8A8A",
  accent: "#E58A52",
  banner: {
    mascot: "#F2B880",
    detail: "#D6A06C",
  },
  context: {
    ok: "#69C779",
    warn: "#E9A23B",
    critical: "#F26D6D",
  },
  border: "#3A3A3A",
  surface: "#1C1C1C",
  status: {
    idle: "#5FA8D3",
    working: "#4EC9B0",
    awaiting_clarification: "#C586C0",
    awaiting_approval: "#F5C542",
    // Done, your move: a calm green, distinct from working's teal.
    finished: "#6FBF73",
    // A session that crashed mid-run: a red distinct from the boot-time not-ready red.
    error: "#E06C75",
    not_ready: "#F26D6D",
  },
  tool: {
    pending: "#8A8A8A",
    in_progress: "#4EC9B0",
    completed: "#6FBF73",
    failed: "#F26D6D",
  },
  // A dark navy a step off `surface` (#1C1C1C): bluer and slightly lighter, so the
  // band is visible without shouting, and `text` (#E6E6E6) sits at high contrast on it.
  userMessageSurface: "#22303F",
  selectionSurface: "#2A2A2A",
  syntax: {
    keyword: "#C586C0",
    string: "#CE9178",
    number: "#B5CEA8",
    function: "#DCDCAA",
    type: "#4EC9B0",
    variable: "#9CDCFE",
  },
}

/** Tuned against a light terminal background: same hues, darkened for contrast. */
export const LIGHT_PALETTE: CockpitPalette = {
  id: "light",
  mode: "light",
  text: "#1C1C1C",
  muted: "#5A5A5A",
  accent: "#9A3F0F",
  banner: {
    mascot: "#7C3212",
    detail: "#6F4A2A",
  },
  context: {
    ok: "#2E6B33",
    warn: "#8A5D00",
    critical: "#A32020",
  },
  border: "#C9C9C9",
  surface: "#F4F4F4",
  status: {
    idle: "#1F5C86",
    working: "#136B55",
    awaiting_clarification: "#7B2D8E",
    awaiting_approval: "#8A5D00",
    // Done, your move: a darkened green for contrast on a light terminal.
    finished: "#2E6B33",
    // A session that crashed mid-run: a red distinct from the boot-time not-ready red.
    error: "#8C1D18",
    not_ready: "#A32020",
  },
  tool: {
    pending: "#5A5A5A",
    in_progress: "#136B55",
    completed: "#2E6B33",
    failed: "#A32020",
  },
  // A soft blue a step off `surface` (#F4F4F4): faintly darker with a blue lean, so the
  // band is visible without shouting, and `text` (#1C1C1C) sits at high contrast on it.
  userMessageSurface: "#E4ECF7",
  selectionSurface: "#E0E4E8",
  syntax: {
    keyword: "#7B2D8E",
    string: "#8A3B12",
    number: "#2E6B33",
    function: "#6A5A00",
    type: "#136B55",
    variable: "#1F5C86",
  },
}

interface PresetPaletteSwatches {
  readonly id: ThemePresetId
  readonly mode: ThemeMode
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly border: string
  readonly surface: string
  readonly userMessageSurface: string
  readonly selectionSurface: string
  readonly red: string
  readonly orange: string
  readonly yellow: string
  readonly green: string
  readonly cyan: string
  readonly blue: string
  readonly purple: string
  readonly pink: string
}

/**
 * Project one source palette into every cockpit semantic role.
 *
 * The role mapping stays fixed so status, tool, and syntax meaning does not drift
 * between presets. Individual swatches are source colors unless a slightly lighter
 * dark-mode or darker light-mode foreground is required by the rendered 4.5:1 gate.
 */
function definePresetPalette(swatches: PresetPaletteSwatches): CockpitPalette {
  return {
    id: swatches.id,
    mode: swatches.mode,
    text: swatches.text,
    muted: swatches.muted,
    accent: swatches.accent,
    banner: { mascot: swatches.yellow, detail: swatches.orange },
    context: { ok: swatches.green, warn: swatches.yellow, critical: swatches.red },
    border: swatches.border,
    surface: swatches.surface,
    status: {
      idle: swatches.blue,
      working: swatches.cyan,
      awaiting_clarification: swatches.purple,
      awaiting_approval: swatches.yellow,
      finished: swatches.green,
      error: swatches.red,
      not_ready: swatches.pink,
    },
    tool: {
      pending: swatches.muted,
      in_progress: swatches.cyan,
      completed: swatches.green,
      failed: swatches.red,
    },
    userMessageSurface: swatches.userMessageSurface,
    selectionSurface: swatches.selectionSurface,
    syntax: {
      keyword: swatches.purple,
      string: swatches.orange,
      number: swatches.green,
      function: swatches.yellow,
      type: swatches.cyan,
      variable: swatches.blue,
    },
  }
}

export const CATPPUCCIN_FRAPPE_PALETTE = definePresetPalette({
  id: "catppuccin-frappe", mode: "dark", surface: "#303446", text: "#C6D0F5", muted: "#B5BFE2",
  accent: "#CA9EE6", border: "#737994", userMessageSurface: "#414559", selectionSurface: "#51576D",
  red: "#F58B91", orange: "#EF9F76", yellow: "#E5C890", green: "#A6D189",
  cyan: "#81C8BE", blue: "#8CAAEE", purple: "#CA9EE6", pink: "#F4B8E4",
})

/** Catppuccin's light flavor, with foregrounds darkened only for terminal contrast. */
export const CATPPUCCIN_LATTE_PALETTE = definePresetPalette({
  id: "catppuccin-latte", mode: "light", surface: "#EFF1F5", text: "#4C4F69", muted: "#5C5F77",
  accent: "#6C1FCF", border: "#BCC0CC", userMessageSurface: "#E4E4E4", selectionSurface: "#D7D7D7",
  red: "#AF0038", orange: "#9A4A00", yellow: "#946000", green: "#2B7A34",
  cyan: "#0E6F73", blue: "#1E5ACC", purple: "#6C1FCF", pink: "#87005F",
})

export const CATPPUCCIN_MACCHIATO_PALETTE = definePresetPalette({
  id: "catppuccin-macchiato", mode: "dark", surface: "#24273A", text: "#CAD3F5", muted: "#B8C0E0",
  accent: "#C6A0F6", border: "#6E738D", userMessageSurface: "#363A4F", selectionSurface: "#494D64",
  red: "#ED8796", orange: "#F5A97F", yellow: "#EED49F", green: "#A6DA95",
  cyan: "#8BD5CA", blue: "#8AADF4", purple: "#C6A0F6", pink: "#F5BDE6",
})

/** Catppuccin's dark Mocha flavor, with colors chosen for its `base` surface. */
export const CATPPUCCIN_MOCHA_PALETTE = definePresetPalette({
  id: "catppuccin-mocha", mode: "dark", surface: "#1E1E2E", text: "#CDD6F4", muted: "#A6ADC8",
  accent: "#CBA6F7", border: "#585B70", userMessageSurface: "#313244", selectionSurface: "#45475A",
  red: "#F38BA8", orange: "#FAB387", yellow: "#F9E2AF", green: "#A6E3A1",
  cyan: "#94E2D5", blue: "#89B4FA", purple: "#CBA6F7", pink: "#F5C2E7",
})

/** Dracula's light Alucard variant, using contrast-safe dark source hues. */
export const DRACULA_ALUCARD_PALETTE = definePresetPalette({
  id: "dracula-alucard", mode: "light", surface: "#FFFBEB", text: "#1F1F1F", muted: "#5C5745",
  accent: "#644AC9", border: "#C9C2A8", userMessageSurface: "#F1EBD7", selectionSurface: "#E2DAC0",
  red: "#A51D16", orange: "#8A3F0D", yellow: "#795E00", green: "#12660A",
  cyan: "#00647F", blue: "#1E4E9E", purple: "#644AC9", pink: "#8E1F62",
})

export const DRACULA_PALETTE = definePresetPalette({
  id: "dracula", mode: "dark", surface: "#282A36", text: "#F8F8F2", muted: "#B3B7D1",
  accent: "#BD93F9", border: "#73789B", userMessageSurface: "#383A4B", selectionSurface: "#44475A",
  red: "#FF8787", orange: "#FFB86C", yellow: "#F1FA8C", green: "#50FA7B",
  cyan: "#8BE9FD", blue: "#80A8FF", purple: "#BD93F9", pink: "#FF79C6",
})

export const GRUVBOX_DARK_HARD_PALETTE = definePresetPalette({
  id: "gruvbox-dark-hard", mode: "dark", surface: "#1D2021", text: "#EBDBB2", muted: "#BDAE93",
  accent: "#D3869B", border: "#665C54", userMessageSurface: "#282828", selectionSurface: "#3C3836",
  red: "#FB5C4C", orange: "#FE8019", yellow: "#FABD2F", green: "#B8BB26",
  cyan: "#8EC07C", blue: "#83AFB8", purple: "#D3869B", pink: "#F48FB1",
})

export const GRUVBOX_DARK_MEDIUM_PALETTE = definePresetPalette({
  id: "gruvbox-dark-medium", mode: "dark", surface: "#282828", text: "#EBDBB2", muted: "#BDAE93",
  accent: "#D3869B", border: "#665C54", userMessageSurface: "#32302F", selectionSurface: "#45403D",
  red: "#FF6B5A", orange: "#FE8A2B", yellow: "#FBC64A", green: "#C0C43A",
  cyan: "#98CA88", blue: "#91B0A5", purple: "#DE96AA", pink: "#F59AB8",
})

export const GRUVBOX_DARK_SOFT_PALETTE = definePresetPalette({
  id: "gruvbox-dark-soft", mode: "dark", surface: "#32302F", text: "#F2E5BC", muted: "#C7B99D",
  accent: "#E3A3B7", border: "#7C6F64", userMessageSurface: "#3C3836", selectionSurface: "#504945",
  red: "#FF7B69", orange: "#FF9850", yellow: "#FFD05A", green: "#C9CD4C",
  cyan: "#A7D89A", blue: "#A2BFB7", purple: "#E3A3C5", pink: "#F7A8C4",
})

export const NORD_PALETTE = definePresetPalette({
  id: "nord", mode: "dark", surface: "#2E3440", text: "#ECEFF4", muted: "#D8DEE9",
  accent: "#D7AFD7", border: "#66758C", userMessageSurface: "#3B4252", selectionSurface: "#4C566A",
  red: "#FF8787", orange: "#D8A58F", yellow: "#EBCB8B", green: "#A3BE8C",
  cyan: "#88C0D0", blue: "#81A1C1", purple: "#D7AFD7", pink: "#FF87D7",
})

export const ONE_DARK_PALETTE = definePresetPalette({
  id: "one-dark", mode: "dark", surface: "#282C34", text: "#D7DAE0", muted: "#ABB2BF",
  accent: "#C678DD", border: "#5C6370", userMessageSurface: "#323842", selectionSurface: "#3E4451",
  red: "#E87B84", orange: "#D19A66", yellow: "#E5C07B", green: "#98C379",
  cyan: "#56B6C2", blue: "#61AFEF", purple: "#C678DD", pink: "#FF87D7",
})

export const ROSE_PINE_DAWN_PALETTE = definePresetPalette({
  id: "rose-pine-dawn", mode: "light", surface: "#FAF4ED", text: "#575279", muted: "#6E6A86",
  accent: "#6E58A5", border: "#C8BFC0", userMessageSurface: "#E4E4E4", selectionSurface: "#CFEFF0",
  red: "#870000", orange: "#99513E", yellow: "#7C5B14", green: "#3F621F",
  cyan: "#216578", blue: "#285EAF", purple: "#6E58A5", pink: "#87005F",
})

export const ROSE_PINE_MAIN_PALETTE = definePresetPalette({
  id: "rose-pine-main", mode: "dark", surface: "#191724", text: "#E0DEF4", muted: "#A09CB8",
  accent: "#C4A7E7", border: "#6E6A86", userMessageSurface: "#262331", selectionSurface: "#403D52",
  red: "#EB6F92", orange: "#EB9A8F", yellow: "#F6C177", green: "#A9D18E",
  cyan: "#9CCFD8", blue: "#6FB3C8", purple: "#C4A7E7", pink: "#F09BC1",
})

export const ROSE_PINE_MOON_PALETTE = definePresetPalette({
  id: "rose-pine-moon", mode: "dark", surface: "#232136", text: "#E0DEF4", muted: "#A09CB8",
  accent: "#C4A7E7", border: "#6E6A86", userMessageSurface: "#2A273F", selectionSurface: "#44415A",
  red: "#FF8787", orange: "#EA9A97", yellow: "#F6C177", green: "#A9D18E",
  cyan: "#9CCFD8", blue: "#69B2D0", purple: "#C4A7E7", pink: "#F09BC1",
})

export const TOKYO_NIGHT_DAY_PALETTE = definePresetPalette({
  id: "tokyo-night-day", mode: "light", surface: "#E6E7ED", text: "#343B58", muted: "#4C505E",
  accent: "#5A4A78", border: "#B7B8C3", userMessageSurface: "#D7D7D7", selectionSurface: "#C6C6C6",
  red: "#870000", orange: "#8A4C20", yellow: "#765500", green: "#485E30",
  cyan: "#166775", blue: "#2E5CB8", purple: "#5A4A78", pink: "#87005F",
})

export const TOKYO_NIGHT_MOON_PALETTE = definePresetPalette({
  id: "tokyo-night-moon", mode: "dark", surface: "#222436", text: "#C8D3F5", muted: "#A9B1D6",
  accent: "#C099FF", border: "#636DA6", userMessageSurface: "#2F334D", selectionSurface: "#444A73",
  red: "#FF757F", orange: "#FF966C", yellow: "#FFC777", green: "#C3E88D",
  cyan: "#86E1FC", blue: "#82AAFF", purple: "#C099FF", pink: "#FF8FD8",
})

export const TOKYO_NIGHT_PALETTE = definePresetPalette({
  id: "tokyo-night", mode: "dark", surface: "#1A1B26", text: "#C0CAF5", muted: "#A9B1D6",
  accent: "#BB9AF7", border: "#565F89", userMessageSurface: "#24283B", selectionSurface: "#3B4261",
  red: "#F7768E", orange: "#FF9E64", yellow: "#E0AF68", green: "#9ECE6A",
  cyan: "#7DCFFF", blue: "#7AA2F7", purple: "#BB9AF7", pink: "#FF8FD8",
})

export const TOKYO_NIGHT_STORM_PALETTE = definePresetPalette({
  id: "tokyo-night-storm", mode: "dark", surface: "#24283B", text: "#C0CAF5", muted: "#A9B1D6",
  accent: "#BB9AF7", border: "#565F89", userMessageSurface: "#2F3549", selectionSurface: "#414868",
  red: "#F7768E", orange: "#FF9E64", yellow: "#E0AF68", green: "#9ECE6A",
  cyan: "#7DCFFF", blue: "#7AA2F7", purple: "#BB9AF7", pink: "#FF8FD8",
})

/** The exhaustive UI-owned registry for every canonical catalog identity. */
export const PRESET_PALETTES = {
  "catppuccin-frappe": CATPPUCCIN_FRAPPE_PALETTE,
  "catppuccin-latte": CATPPUCCIN_LATTE_PALETTE,
  "catppuccin-macchiato": CATPPUCCIN_MACCHIATO_PALETTE,
  "catppuccin-mocha": CATPPUCCIN_MOCHA_PALETTE,
  "dracula-alucard": DRACULA_ALUCARD_PALETTE,
  dracula: DRACULA_PALETTE,
  "gruvbox-dark-hard": GRUVBOX_DARK_HARD_PALETTE,
  "gruvbox-dark-medium": GRUVBOX_DARK_MEDIUM_PALETTE,
  "gruvbox-dark-soft": GRUVBOX_DARK_SOFT_PALETTE,
  nord: NORD_PALETTE,
  "one-dark": ONE_DARK_PALETTE,
  "rose-pine-dawn": ROSE_PINE_DAWN_PALETTE,
  "rose-pine-main": ROSE_PINE_MAIN_PALETTE,
  "rose-pine-moon": ROSE_PINE_MOON_PALETTE,
  "tokyo-night-day": TOKYO_NIGHT_DAY_PALETTE,
  "tokyo-night-moon": TOKYO_NIGHT_MOON_PALETTE,
  "tokyo-night": TOKYO_NIGHT_PALETTE,
  "tokyo-night-storm": TOKYO_NIGHT_STORM_PALETTE,
} as const satisfies Readonly<Record<ThemePresetId, CockpitPalette>>

/**
 * Palettes exposed through the existing flat Settings consumer.
 *
 * The complete catalog resolves through `PRESET_PALETTES`; keeping this compatibility
 * aggregate bounded preserves the current non-scrollable picker until its catalog-row
 * projection takes ownership of selection in the dedicated Settings task.
 */
export const PALETTES: Readonly<
  Record<"dark" | "light" | "catppuccin-latte" | "catppuccin-mocha", CockpitPalette>
> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
  "catppuccin-mocha": CATPPUCCIN_MOCHA_PALETTE,
  "catppuccin-latte": CATPPUCCIN_LATTE_PALETTE,
}

/** Resolve a palette; an unreported theme (`null`) falls back to dark. */
export function paletteFor(mode: ThemeMode | null | undefined): CockpitPalette {
  return mode === "light" ? LIGHT_PALETTE : DARK_PALETTE
}

/** Resolve the user preference ahead of the terminal's current mode. */
export function resolvePalette(pref: ThemePreference | string, mode: ThemeMode): CockpitPalette {
  if (pref === "auto") return paletteFor(mode)
  if (pref === "dark") return DARK_PALETTE
  if (pref === "light") return LIGHT_PALETTE
  const canonicalId = canonicalThemePresetId(pref)
  return canonicalId === null ? paletteFor(mode) : PRESET_PALETTES[canonicalId]
}

interface ThemeModeStore {
  readonly getSnapshot: () => ThemeMode
  readonly subscribe: (onStoreChange: () => void) => () => void
}

/**
 * One live theme-mode subscription per renderer.
 *
 * A palette is used by most cockpit leaves, so subscribing from every hook
 * consumer breaches EventEmitter's listener limit in a real cockpit. The store
 * fans one renderer event out to React subscribers and releases that event again
 * when the last palette consumer unmounts.
 */
const THEME_MODE_STORES = new WeakMap<CliRenderer, ThemeModeStore>()

function themeModeStoreFor(renderer: CliRenderer): ThemeModeStore {
  const existing = THEME_MODE_STORES.get(renderer)
  if (existing) return existing

  let mode: ThemeMode = renderer.themeMode ?? "dark"
  const subscribers = new Set<() => void>()
  let listening = false

  const notify = (): void => {
    for (const subscriber of subscribers) subscriber()
  }

  const setMode = (next: ThemeMode): void => {
    if (mode === next) return
    mode = next
    notify()
  }

  const onThemeMode = (next: ThemeMode): void => setMode(next)

  const store: ThemeModeStore = {
    getSnapshot: () => mode,
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange)

      if (!listening && !renderer.isDestroyed) {
        renderer.on("theme_mode", onThemeMode)
        listening = true
        // The OSC query may have completed between render and subscription.
        setMode(renderer.themeMode ?? "dark")
      }

      return () => {
        subscribers.delete(onStoreChange)
        if (listening && subscribers.size === 0) {
          renderer.off("theme_mode", onThemeMode)
          listening = false
        }
      }
    },
  }

  THEME_MODE_STORES.set(renderer, store)
  return store
}

/**
 * The terminal's current theme mode, kept live.
 *
 * The renderer may resolve its OSC query after mount, so the initial value is
 * read synchronously and then corrected by the shared `theme_mode` event.
 */
export function useThemeMode(): ThemeMode {
  const renderer = useRenderer()
  const store = themeModeStoreFor(renderer)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** The effective palette for the live preference and terminal theme. */
export function usePalette(): CockpitPalette {
  const preference = useAppSelector(selectThemePreference)
  const mode = useThemeMode()
  return resolvePalette(preference, mode)
}

/**
 * How code is colored inside `<markdown>` fenced blocks and `<diff>` hunks.
 *
 * Keyed by tree-sitter capture name. OpenTUI ships no default theme - a bare
 * `SyntaxStyle.create()` has no styles registered at all, so code would render in one
 * flat color - and the cockpit's no-hard-coded-color rule applies to code just as it
 * does to chrome. Hues track the palette so a light terminal reads as well as a dark
 * one.
 */
function syntaxThemeFor(palette: CockpitPalette): ThemeTokenStyle[] {
  return [
    { scope: ["comment"], style: { foreground: palette.muted, italic: true } },
    { scope: ["keyword", "keyword.function", "keyword.return"], style: { foreground: palette.syntax.keyword } },
    { scope: ["string", "string.special"], style: { foreground: palette.syntax.string } },
    { scope: ["number", "constant", "constant.builtin"], style: { foreground: palette.syntax.number } },
    { scope: ["function", "function.method", "function.builtin"], style: { foreground: palette.syntax.function } },
    { scope: ["type", "type.builtin"], style: { foreground: palette.syntax.type } },
    { scope: ["variable", "variable.parameter", "property"], style: { foreground: palette.syntax.variable } },
    { scope: ["operator", "punctuation", "punctuation.delimiter"], style: { foreground: palette.muted } },
    {
      scope: [
        "markup.heading",
        "markup.heading.1",
        "markup.heading.2",
        "markup.heading.3",
        "markup.heading.4",
        "markup.heading.5",
        "markup.heading.6",
      ],
      style: { foreground: palette.accent, bold: true },
    },
    { scope: ["markup.strong"], style: { foreground: palette.text, bold: true } },
    { scope: ["markup.italic"], style: { foreground: palette.text, italic: true } },
    { scope: ["markup.strikethrough"], style: { foreground: palette.muted, dim: true } },
    { scope: ["markup.raw", "markup.raw.block"], style: { foreground: palette.syntax.string } },
    {
      scope: ["markup.list", "markup.list.checked", "markup.list.unchecked"],
      style: { foreground: palette.accent },
    },
    { scope: ["markup.quote"], style: { foreground: palette.muted, italic: true } },
    {
      scope: ["markup.link", "markup.link.label"],
      style: { foreground: palette.status.idle, underline: true },
    },
    { scope: ["markup.link.url"], style: { foreground: palette.muted } },
  ]
}

/**
 * One {@link SyntaxStyle} per effective palette id, built on first use.
 *
 * `SyntaxStyle.fromTheme` allocates through the native render library, so it must not
 * run at module load: `src/index.ts` promises that importing it has no side effects.
 * The handles are immutable and outlive any single renderer, so caching them for the
 * life of the process is safe and spares a native allocation per message.
 */
const SYNTAX_STYLES = new Map<string, SyntaxStyle>()

/** The syntax style for an effective palette, created once and reused by its id. */
export function syntaxStyleFor(palette: CockpitPalette): SyntaxStyle {
  const cached = SYNTAX_STYLES.get(palette.id)
  if (cached) return cached
  const style = SyntaxStyle.fromTheme(syntaxThemeFor(palette))
  SYNTAX_STYLES.set(palette.id, style)
  return style
}

/** The syntax style for the effective palette. Re-renders when that palette changes. */
export function useSyntaxStyle(): SyntaxStyle {
  return syntaxStyleFor(usePalette())
}
