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

import { SyntaxStyle, type ThemeMode, type ThemeTokenStyle } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useState } from "react"

import type { SessionStatus, ToolCallStatus } from "../core/types.ts"

/** The status-strip slot for an agent whose connection never came up (task_07). */
export const NOT_READY = "not_ready"

/** Every state the status strip can paint: the domain statuses plus not-ready. */
export type StatusTone = SessionStatus | typeof NOT_READY

/** The full set of colors any cockpit view is allowed to use. */
export interface CockpitPalette {
  /** The mode this palette was resolved for. */
  readonly mode: ThemeMode
  /** Primary reading color. */
  readonly text: string
  /** Secondary color for hints and chrome labels. */
  readonly muted: string
  /** Emphasis: the focused agent's marker, help keys, overlay borders. */
  readonly accent: string
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
}

/** Tuned against a dark terminal background. */
export const DARK_PALETTE: CockpitPalette = {
  mode: "dark",
  text: "#E6E6E6",
  muted: "#8A8A8A",
  accent: "#F5C542",
  border: "#3A3A3A",
  surface: "#1C1C1C",
  status: {
    idle: "#5FA8D3",
    working: "#4EC9B0",
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
}

/** Tuned against a light terminal background: same hues, darkened for contrast. */
export const LIGHT_PALETTE: CockpitPalette = {
  mode: "light",
  text: "#1C1C1C",
  muted: "#5A5A5A",
  accent: "#8A5D00",
  border: "#C9C9C9",
  surface: "#F4F4F4",
  status: {
    idle: "#1F5C86",
    working: "#136B55",
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
}

/** Resolve a palette; an unreported theme (`null`) falls back to dark. */
export function paletteFor(mode: ThemeMode | null | undefined): CockpitPalette {
  return mode === "light" ? LIGHT_PALETTE : DARK_PALETTE
}

/**
 * The terminal's current theme mode, kept live.
 *
 * The renderer may resolve its OSC query after mount, so the initial value is
 * read synchronously and then corrected by the `theme_mode` event.
 */
export function useThemeMode(): ThemeMode {
  const renderer = useRenderer()
  const [mode, setMode] = useState<ThemeMode>(() => renderer.themeMode ?? "dark")

  useEffect(() => {
    const onThemeMode = (next: ThemeMode): void => setMode(next)
    renderer.on("theme_mode", onThemeMode)
    // The query may have completed between the initial render and this effect.
    if (renderer.themeMode) setMode(renderer.themeMode)
    return () => {
      renderer.off("theme_mode", onThemeMode)
    }
  }, [renderer])

  return mode
}

/** The palette for the terminal's current theme. Re-renders the caller on a flip. */
export function usePalette(): CockpitPalette {
  return paletteFor(useThemeMode())
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
  const dark = palette.mode === "dark"
  return [
    { scope: ["comment"], style: { foreground: palette.muted, italic: true } },
    { scope: ["keyword", "keyword.function", "keyword.return"], style: { foreground: dark ? "#C586C0" : "#7B2D8E" } },
    { scope: ["string", "string.special"], style: { foreground: dark ? "#CE9178" : "#8A3B12" } },
    { scope: ["number", "constant", "constant.builtin"], style: { foreground: dark ? "#B5CEA8" : "#2E6B33" } },
    { scope: ["function", "function.method", "function.builtin"], style: { foreground: dark ? "#DCDCAA" : "#6A5A00" } },
    { scope: ["type", "type.builtin"], style: { foreground: dark ? "#4EC9B0" : "#136B55" } },
    { scope: ["variable", "variable.parameter", "property"], style: { foreground: dark ? "#9CDCFE" : "#1F5C86" } },
    { scope: ["operator", "punctuation", "punctuation.delimiter"], style: { foreground: palette.muted } },
  ]
}

/**
 * One {@link SyntaxStyle} per theme mode, built on first use.
 *
 * `SyntaxStyle.fromTheme` allocates through the native render library, so it must not
 * run at module load: `src/index.ts` promises that importing it has no side effects.
 * The handles are immutable and outlive any single renderer, so caching them for the
 * life of the process is safe and spares a native allocation per message.
 */
const SYNTAX_STYLES = new Map<ThemeMode, SyntaxStyle>()

/** The syntax style for a theme mode, created once and reused. */
export function syntaxStyleFor(mode: ThemeMode): SyntaxStyle {
  const cached = SYNTAX_STYLES.get(mode)
  if (cached) return cached
  const style = SyntaxStyle.fromTheme(syntaxThemeFor(paletteFor(mode)))
  SYNTAX_STYLES.set(mode, style)
  return style
}

/** The syntax style for the terminal's current theme. Re-renders the caller on a flip. */
export function useSyntaxStyle(): SyntaxStyle {
  return syntaxStyleFor(useThemeMode())
}
