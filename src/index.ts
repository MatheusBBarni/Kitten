/**
 * Kitten entry point.
 *
 * Boots the OpenTUI renderer, brings both agents up behind a `SessionController`,
 * and mounts the cockpit shell. Importing this module has no side effects: the boot
 * only happens when the file is executed directly (`import.meta.main`), so tests can
 * import it and drive `renderCockpit` against an in-memory test renderer instead.
 *
 * The renderer factory, the controller factory, and the exit handler are all
 * injectable, so the boot path and the Ctrl+C -> dispose -> exit wiring can be
 * exercised without touching the real terminal, spawning agent subprocesses, or
 * calling `process.exit`.
 */

import { createCliRenderer, type CliRenderer } from "@opentui/core"

import { createSessionController, type SessionController, type SessionControllerOptions } from "./app/controller.ts"
import { loadAppConfig } from "./config/configLoader.ts"
import type { AppConfig } from "./core/types.ts"
import { createAppStore } from "./store/appStore.ts"
import { createTelemetryRecorder, recordReadiness, type TelemetryRecorder } from "./telemetry/recorder.ts"
import { renderCockpit } from "./ui/main.tsx"

export { renderCockpit }

/** Factory that produces a ready-to-render OpenTUI renderer. */
export type RendererFactory = () => Promise<CliRenderer>

/** Factory that produces a booted controller with both agent connections wired up. */
export type ControllerFactory = () => Promise<SessionController>

/** A booted controller paired with its telemetry recorder. */
export interface CockpitSession {
  controller: SessionController
  /** The recorder wired to this run; a no-op when telemetry is disabled in config. */
  recorder: TelemetryRecorder
}

/** Factory that produces a booted {@link CockpitSession}. */
export type SessionFactory = () => Promise<CockpitSession>

/**
 * Create the interactive terminal renderer used for a real run.
 *
 * `exitOnCtrlC` (the OpenTUI default) destroys the renderer on Ctrl+C, which
 * restores the terminal; `main` wires the teardown on top of that. The underlying
 * factory is injectable for testing.
 */
export function createCockpitRenderer(factory: typeof createCliRenderer = createCliRenderer): Promise<CliRenderer> {
  return factory({
    exitOnCtrlC: true,
    targetFps: 30,
  })
}

/** Injectable seams for {@link createCockpitSession}, so it is testable without spawning. */
export interface CockpitSessionDeps {
  /** How to load the config; defaults to reading it from disk. */
  loadConfig?: () => Promise<AppConfig>
  /** How to build the controller; defaults to the real spawning controller. */
  buildController?: (options: SessionControllerOptions) => Promise<SessionController>
  /** How to build the recorder from the opt-in flag; defaults to the JSONL recorder. */
  createRecorder?: (enabled: boolean) => TelemetryRecorder
}

/**
 * Load the config, bring both agents up, and wire telemetry.
 *
 * `createSessionController` never rejects: an agent that fails to spawn or hand
 * shake becomes a not-ready runtime the status strip explains, and the other agent
 * stays fully usable. A malformed config file, in contrast, throws - Kitten never
 * silently falls back to defaults the user did not ask for.
 *
 * The recorder is created from the config's opt-in flag (a no-op when off), handed
 * the boot readiness snapshot, and subscribed to the store for the first-response and
 * re-explanation metrics. It is returned alongside the controller so the hand-off
 * flow can record through it.
 */
export async function createCockpitSession(deps: CockpitSessionDeps = {}): Promise<CockpitSession> {
  const config = await (deps.loadConfig ?? loadAppConfig)()
  const store = createAppStore()
  const recorder = (deps.createRecorder ?? ((enabled) => createTelemetryRecorder({ enabled })))(config.telemetryEnabled)
  const controller = await (deps.buildController ?? createSessionController)({ config, store })
  recordReadiness(recorder, controller.runtimes())
  recorder.watch(store)
  return { controller, recorder }
}

/** Default exit handler: exit the process cleanly once teardown has finished. */
export function exitProcess(): void {
  process.exit(0)
}

/** Injectable dependencies for {@link main}. */
export interface MainDeps {
  /** How to obtain the renderer; defaults to the real interactive renderer. */
  createRenderer?: RendererFactory
  /**
   * How to obtain just the controller. When given, telemetry is not wired (the tests
   * use this to drive a fake controller). Takes precedence over `createSession`.
   */
  createController?: ControllerFactory
  /** How to obtain the controller and its recorder; defaults to {@link createCockpitSession}. */
  createSession?: SessionFactory
  /** What to run once the cockpit has torn down; defaults to a clean process exit. */
  onExit?: () => void
}

/** What {@link main} hands back so a caller (or a test) can inspect the booted app. */
export interface BootedCockpit {
  renderer: CliRenderer
  controller: SessionController
  /** Resolves once the renderer has been destroyed and the agents disposed. */
  closed: Promise<void>
}

/**
 * Boot the cockpit for a real run.
 *
 * Ctrl+C destroys the renderer (restoring the terminal), which is the signal to tear
 * the agent subprocesses down before leaving. The exit waits on that teardown:
 * exiting first would orphan the spawned ACP adapters.
 */
export async function main(deps: MainDeps = {}): Promise<BootedCockpit> {
  const createRenderer = deps.createRenderer ?? createCockpitRenderer
  const onExit = deps.onExit ?? exitProcess

  const renderer = await createRenderer()

  let controller: SessionController
  let recorder: TelemetryRecorder | undefined
  try {
    if (deps.createController) {
      controller = await deps.createController()
    } else {
      const session = await (deps.createSession ?? createCockpitSession)()
      controller = session.controller
      recorder = session.recorder
    }
  } catch (error) {
    // The renderer already owns the terminal (raw mode, alternate screen). Give it
    // back before the error escapes, or the user's shell is left unusable.
    renderer.destroy()
    throw error
  }

  const closed = new Promise<void>((resolve) => {
    renderer.on("destroy", () => {
      // `dispose()` never throws, so one continuation covers both outcomes.
      void controller.dispose().then(() => {
        onExit()
        resolve()
      })
    })
  })

  renderCockpit(renderer, controller, recorder)
  return { renderer, controller, closed }
}

if (import.meta.main) {
  await main()
}
