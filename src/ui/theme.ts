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
  syntax: {
    keyword: "#7B2D8E",
    string: "#8A3B12",
    number: "#2E6B33",
    function: "#6A5A00",
    type: "#136B55",
    variable: "#1F5C86",
  },
}

/** Catppuccin's dark Mocha flavor, with colors chosen for its `base` surface. */
export const CATPPUCCIN_MOCHA_PALETTE: CockpitPalette = {
  id: "catppuccin-mocha",
  mode: "dark",
  text: "#CDD6F4",
  muted: "#A6ADC8",
  accent: "#CBA6F7",
  banner: {
    mascot: "#F9E2AF",
    detail: "#FAB387",
  },
  context: {
    ok: "#A6E3A1",
    warn: "#F9E2AF",
    critical: "#F38BA8",
  },
  border: "#585B70",
  surface: "#1E1E2E",
  status: {
    idle: "#89B4FA",
    working: "#94E2D5",
    awaiting_clarification: "#CBA6F7",
    awaiting_approval: "#F9E2AF",
    finished: "#A6E3A1",
    error: "#F38BA8",
    not_ready: "#EBA0AC",
  },
  tool: {
    pending: "#A6ADC8",
    in_progress: "#94E2D5",
    completed: "#A6E3A1",
    failed: "#F38BA8",
  },
  userMessageSurface: "#313244",
  syntax: {
    keyword: "#CBA6F7",
    string: "#FAB387",
    number: "#A6E3A1",
    function: "#F9E2AF",
    type: "#94E2D5",
    variable: "#89B4FA",
  },
}

/** Catppuccin's light Latte flavor, with text shades darkened for terminal contrast. */
export const CATPPUCCIN_LATTE_PALETTE: CockpitPalette = {
  id: "catppuccin-latte",
  mode: "light",
  text: "#4C4F69",
  muted: "#5C5F77",
  accent: "#8839EF",
  banner: {
    mascot: "#B44900",
    detail: "#946000",
  },
  context: {
    ok: "#2B7A34",
    warn: "#946000",
    critical: "#D20F39",
  },
  border: "#BCC0CC",
  surface: "#EFF1F5",
  status: {
    idle: "#1E5ACC",
    working: "#0E6F73",
    awaiting_clarification: "#8839EF",
    awaiting_approval: "#946000",
    finished: "#2B7A34",
    error: "#D20F39",
    not_ready: "#BD2735",
  },
  tool: {
    pending: "#5C5F77",
    in_progress: "#0E6F73",
    completed: "#2B7A34",
    failed: "#D20F39",
  },
  userMessageSurface: "#E6E9EF",
  syntax: {
    keyword: "#8839EF",
    string: "#B44900",
    number: "#2B7A34",
    function: "#946000",
    type: "#0E6F73",
    variable: "#1E5ACC",
  },
}

/** All palettes users can select, keyed by the stable id persisted in preferences. */
export const PALETTES: Readonly<Record<string, CockpitPalette>> = {
  [DARK_PALETTE.id]: DARK_PALETTE,
  [LIGHT_PALETTE.id]: LIGHT_PALETTE,
  [CATPPUCCIN_MOCHA_PALETTE.id]: CATPPUCCIN_MOCHA_PALETTE,
  [CATPPUCCIN_LATTE_PALETTE.id]: CATPPUCCIN_LATTE_PALETTE,
}

/** Resolve a palette; an unreported theme (`null`) falls back to dark. */
export function paletteFor(mode: ThemeMode | null | undefined): CockpitPalette {
  return mode === "light" ? LIGHT_PALETTE : DARK_PALETTE
}

/** Resolve the user preference ahead of the terminal's current mode. */
export function resolvePalette(pref: ThemePreference | string, mode: ThemeMode): CockpitPalette {
  if (pref === "auto") return paletteFor(mode)
  const palette = Object.prototype.hasOwnProperty.call(PALETTES, pref) ? PALETTES[pref] : undefined
  return palette ?? paletteFor(mode)
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
