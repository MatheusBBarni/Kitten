/**
 * Cockpit bootstrap: the JSX-bearing seam between the plain-TS entry point and
 * the React view tree. Kept in a `.tsx` file so `src/index.ts` stays JSX-free.
 */

import { type CliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

import { CockpitApp } from "./CockpitApp.tsx"

/**
 * Mount the placeholder cockpit into a renderer.
 *
 * Free of process-level side effects so an in-memory test renderer can be
 * mounted and torn down without touching the real terminal or exiting the
 * process. Returns the React root so callers can unmount if needed.
 */
export function renderCockpit(renderer: CliRenderer): ReturnType<typeof createRoot> {
  const root = createRoot(renderer)
  root.render(<CockpitApp />)
  return root
}
