/**
 * The JSX-bearing seam between the plain-TS entry point and the React view tree.
 *
 * Kept in a `.tsx` file so `src/index.ts` stays JSX-free, and free of process-level
 * side effects so an in-memory test renderer can be mounted and torn down without
 * touching the real terminal.
 */

import { type CliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

import type { SessionController } from "../app/controller.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { ConversationView } from "./ConversationView.tsx"

/**
 * Mount the cockpit for a booted controller into a renderer.
 *
 * Returns the React root so callers can unmount it independently of the renderer.
 */
export function renderCockpit(renderer: CliRenderer, controller: SessionController): ReturnType<typeof createRoot> {
  const root = createRoot(renderer)
  root.render(
    <CockpitApp controller={controller}>
      <ConversationView />
    </CockpitApp>,
  )
  return root
}
