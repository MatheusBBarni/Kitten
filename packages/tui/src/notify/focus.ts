/**
 * Terminal focus tracking for the attention notifier (ADR-007).
 *
 * OpenTUI enables DECSET 1004 focus reporting and re-emits the terminal's focus-in /
 * focus-out as `focus` / `blur` events on the renderer. The notifier reads this to gate
 * the OS notification: fire only while Kitten is unfocused, so a desktop notification
 * never appears while the developer is looking straight at the cockpit.
 *
 * Focus reporting is not universal, so the source starts in an explicit `"unknown"`
 * state and only leaves it once the terminal actually reports focus. The notifier
 * treats `"unknown"` as "notify anyway" (the documented fallback), so a terminal that
 * never sends a focus event never silences a real need.
 */

import { CliRenderEvents } from "@opentui/core"

/** Whether Kitten currently holds terminal focus, or whether that is not yet known. */
export type FocusState = "focused" | "unfocused" | "unknown"

/** The injectable focus seam the notifier reads. */
export interface FocusSource {
  /** The current focus state; `"unknown"` until the terminal first reports focus. */
  current(): FocusState
}

/** The slice of the renderer the focus source subscribes to (an event emitter). */
export interface FocusEmitter {
  on(event: string, listener: () => void): void
}

/**
 * A focus source backed by an OpenTUI renderer's `focus` / `blur` events.
 *
 * Starts `"unknown"` and latches to `"focused"` / `"unfocused"` as the terminal
 * reports. Registering the listeners has no side effect beyond subscription, so this is
 * safe to build against an in-memory test renderer.
 */
export function createRendererFocusSource(renderer: FocusEmitter): FocusSource {
  let state: FocusState = "unknown"
  renderer.on(CliRenderEvents.FOCUS, () => {
    state = "focused"
  })
  renderer.on(CliRenderEvents.BLUR, () => {
    state = "unfocused"
  })
  return {
    current: () => state,
  }
}
