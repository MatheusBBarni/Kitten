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

import type { ThemeMode } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useState } from "react"

import type { AgentStatus } from "../core/types.ts"

/** The status-strip slot for an agent whose connection never came up (task_07). */
export const NOT_READY = "not_ready"

/** Every state the status strip can paint: the domain statuses plus not-ready. */
export type StatusTone = AgentStatus | typeof NOT_READY

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
    not_ready: "#F26D6D",
  },
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
    not_ready: "#A32020",
  },
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
