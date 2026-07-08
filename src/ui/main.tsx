/**
 * The JSX-bearing seam between the plain-TS entry point and the React view tree.
 *
 * Kept in a `.tsx` file so `src/index.ts` stays JSX-free, and free of process-level
 * side effects so an in-memory test renderer can be mounted and torn down without
 * touching the real terminal.
 */

import { type CliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import type { ReactNode } from "react"

import type { SessionController } from "../app/controller.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { ConversationView } from "./ConversationView.tsx"

/**
 * The cockpit element tree for a booted controller.
 *
 * The one place the concrete view tree is assembled, so both the live renderer and the
 * headless boot self-check mount exactly the same thing.
 */
export function cockpitElement(controller: SessionController, recorder?: TelemetryRecorder): ReactNode {
  return (
    <CockpitApp controller={controller} recorder={recorder}>
      <ConversationView />
    </CockpitApp>
  )
}

/**
 * Mount the cockpit for a booted controller into a renderer.
 *
 * Returns the React root so callers can unmount it independently of the renderer.
 * An optional telemetry recorder is threaded to the hand-off flow; omitting it (as the
 * UI tests do) leaves the cockpit recording nothing.
 */
export function renderCockpit(
  renderer: CliRenderer,
  controller: SessionController,
  recorder?: TelemetryRecorder,
): ReturnType<typeof createRoot> {
  const root = createRoot(renderer)
  root.render(cockpitElement(controller, recorder))
  return root
}
