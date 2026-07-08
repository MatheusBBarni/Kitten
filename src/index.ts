/**
 * Kitten entry point.
 *
 * Boots the OpenTUI renderer and mounts the placeholder cockpit (task_01).
 * Importing this module has no side effects: the renderer only boots when the
 * file is executed directly (`import.meta.main`), so tests can import it and
 * drive `renderCockpit` against an in-memory test renderer instead.
 *
 * The renderer factory and exit handler are injectable so the boot path and the
 * Ctrl+C -> destroy -> exit wiring can be exercised in tests without touching
 * the real terminal or calling `process.exit`.
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core"

import { renderCockpit } from "./app/bootstrap.tsx"

export { renderCockpit }

/** Factory that produces a ready-to-render OpenTUI renderer. */
export type RendererFactory = () => Promise<CliRenderer>

/**
 * Create the interactive terminal renderer used for a real run.
 *
 * `exitOnCtrlC` (the OpenTUI default) destroys the renderer on Ctrl+C, which
 * restores the terminal; `main` wires the process exit on top of that. The
 * underlying factory is injectable for testing.
 */
export function createCockpitRenderer(factory: typeof createCliRenderer = createCliRenderer): Promise<CliRenderer> {
  return factory({
    exitOnCtrlC: true,
    targetFps: 30,
  })
}

/** Default exit handler: exit the process cleanly once the renderer is destroyed. */
export function exitProcess(): void {
  process.exit(0)
}

/** Injectable dependencies for {@link main}. */
export interface MainDeps {
  /** How to obtain the renderer; defaults to the real interactive renderer. */
  createRenderer?: RendererFactory
  /** What to run once the renderer is destroyed; defaults to a clean process exit. */
  onExit?: () => void
}

/**
 * Boot the cockpit for a real run and exit the process when the renderer is
 * destroyed (e.g. after Ctrl+C triggers `renderer.destroy()`).
 *
 * Returns the renderer so callers and tests can inspect or tear it down.
 */
export async function main(deps: MainDeps = {}): Promise<CliRenderer> {
  const createRenderer = deps.createRenderer ?? createCockpitRenderer
  const onExit = deps.onExit ?? exitProcess

  const renderer = await createRenderer()
  // Ctrl+C -> renderer.destroy() (exitOnCtrlC) -> restore terminal, then exit cleanly.
  renderer.on("destroy", onExit)
  renderCockpit(renderer)
  return renderer
}

if (import.meta.main) {
  await main()
}
