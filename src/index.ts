#!/usr/bin/env bun
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

import { createSessionController, type AgentRuntimeState, type SessionController, type SessionControllerOptions } from "./app/controller.ts"
import { runSelfCheck } from "./app/selfCheck.ts"
import { loadAppConfig, resolveSessions } from "./config/configLoader.ts"
import { watchUserConfig, type ConfigWatcher } from "./config/configWatcher.ts"
import { persistUserConfig } from "./config/configWriter.ts"
import {
  buildFirstRunReport,
  formatFirstRunReport,
  isInsideRepo,
  sessionSetup,
  type AgentSetupState,
  type FirstRunReport,
} from "./config/firstRun.ts"
import type { AppConfig, ThemePreference } from "./core/types.ts"
import { createOsNotificationChannel } from "./notify/channel.ts"
import { createRendererFocusSource } from "./notify/focus.ts"
import { createNotifier } from "./notify/notifier.ts"
import { createAppStore, type AppStore } from "./store/appStore.ts"
import { selectThemePreference } from "./store/selectors.ts"
import { createTelemetryRecorder, recordReadiness, type TelemetryRecorder } from "./telemetry/recorder.ts"
import { renderCockpit } from "./ui/main.tsx"

export { renderCockpit }

const DEFAULT_PERSIST_DEBOUNCE_MS = 100

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
  /** How to persist a settled preference change; defaults to the atomic config writer. */
  persistConfig?: (patch: { theme: ThemePreference }) => Promise<void>
  /** How to observe reloaded user config; defaults to the filesystem config watcher. */
  watchConfig?: (onConfig: (config: AppConfig) => void) => ConfigWatcher
  /** Quiet period before the latest preference is persisted. */
  persistDebounceMs?: number
  /** Timer seams for deterministic debounce and teardown tests. */
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

/**
 * Load the config, bring both agents up, and wire telemetry plus reactive config.
 *
 * `createSessionController` never rejects: an agent that fails to spawn or hand
 * shake becomes a not-ready runtime the status strip explains, and the other agent
 * stays fully usable. A malformed config file, in contrast, throws - Kitten never
 * silently falls back to defaults the user did not ask for.
 *
 * The loaded theme seeds the same store the controller drives. Theme changes are
 * applied synchronously in memory, then coalesced into an atomic config-layer write;
 * watcher reloads flow back through the idempotent store action, so the write's own
 * reload is a no-op. All subscriptions, the watcher, and a queued write are owned by
 * the returned controller's disposal seam.
 */
export async function createCockpitSession(deps: CockpitSessionDeps = {}): Promise<CockpitSession> {
  const config = await (deps.loadConfig ?? loadAppConfig)()
  const recorder = (deps.createRecorder ?? ((enabled) => createTelemetryRecorder({ enabled })))(config.telemetryEnabled)
  const store = createAppStore({
    seeds: resolveSessions(config).map((entry) => entry.seed),
    preferences: { theme: config.theme },
  })
  const baseController = await (deps.buildController ?? createSessionController)({ config, recorder, store })
  recordReadiness(recorder, baseController.runtimes())
  const stopRecorder = recorder.watch(baseController.store)

  const persistConfig = deps.persistConfig ?? ((patch) => persistUserConfig(patch))
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
  const persistDebounceMs = deps.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS
  let disposed = false
  let pendingTheme: ThemePreference | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let writeChain = Promise.resolve()

  const stopPreference = baseController.store.subscribeSelector(selectThemePreference, (theme) => {
    recorder.themeSet(theme)
    pendingTheme = theme
    if (persistTimer !== undefined) clearTimer(persistTimer)
    persistTimer = setTimer(() => {
      persistTimer = undefined
      const themeToPersist = pendingTheme
      pendingTheme = undefined
      if (disposed || themeToPersist === undefined) return

      // Serialize settled writes so a slow filesystem operation cannot race a later
      // theme change and commit stale bytes after the newer preference.
      writeChain = writeChain.then(async () => {
        try {
          await persistConfig({ theme: themeToPersist })
          recorder.configWrite("modal")
        } catch {
          recorder.configWriteError("modal")
        }
      })
    }, persistDebounceMs)
  })

  let watcher: ConfigWatcher
  try {
    watcher = (deps.watchConfig ?? ((onConfig) => watchUserConfig(onConfig)))((nextConfig) => {
      if (!disposed) baseController.store.setThemePreference(nextConfig.theme)
    })
  } catch (error) {
    stopPreference()
    stopRecorder()
    if (persistTimer !== undefined) clearTimer(persistTimer)
    await baseController.dispose()
    throw error
  }

  let disposal: Promise<void> | undefined
  const controller: SessionController = {
    store: baseController.store,
    actions: baseController.actions,
    runtimes: () => baseController.runtimes(),
    runtime: (sessionId) => baseController.runtime(sessionId),
    isReady: (sessionId) => baseController.isReady(sessionId),
    dispose(): Promise<void> {
      if (disposal) return disposal
      disposal = (async () => {
        disposed = true
        try {
          watcher.close()
        } catch {
          // Teardown remains best-effort, matching the controller's never-throwing
          // disposal contract even if an injected watcher is already invalid.
        }
        stopPreference()
        stopRecorder()
        if (persistTimer !== undefined) {
          clearTimer(persistTimer)
          persistTimer = undefined
          pendingTheme = undefined
        }
        await writeChain
        await baseController.dispose()
      })()
      return disposal
    },
  }

  return { controller, recorder }
}

/** Default exit handler: exit the process cleanly once teardown has finished. */
export function exitProcess(): void {
  process.exit(0)
}

/**
 * Reduce a live runtime standing to the setup state the first-run flow reads, folding
 * in the per-session repository check (ADR-005): a connected session whose own `cwd`
 * is not inside a repository is reported not-ready with a directory-specific reason,
 * without blocking a sibling session that is usable.
 */
export function runtimeSetup(state: AgentRuntimeState, insideRepo?: (cwd: string) => boolean): AgentSetupState {
  return sessionSetup(
    {
      agentId: state.providerKind,
      displayName: state.displayName,
      title: state.title,
      cwd: state.cwd,
      ready: state.ready,
      ...(state.ready ? {} : { error: state.error }),
    },
    { insideRepo },
  )
}

/** Print first-run guidance to stderr; the terminal must already be restored. */
export function printFirstRunGuidance(report: FirstRunReport): void {
  for (const line of formatFirstRunReport(report)) process.stderr.write(`${line}\n`)
}

/** Default block handler: leave with a non-zero status so a launcher sees the failure. */
export function exitBlocked(): void {
  process.exit(1)
}

/**
 * Wire the layered attention notifier for a run (ADR-007).
 *
 * Subscribes the notifier to the same store the telemetry recorder watches, reading
 * terminal focus from the renderer's DECSET-1004 events and delivering through the
 * per-OS native channel. Best-effort by construction: the channel swallows its own
 * failures and the bell is the universal fallback, so this never throws into boot.
 */
export function wireAttentionNotifier(renderer: CliRenderer, store: AppStore): void {
  const notifier = createNotifier({
    channel: createOsNotificationChannel(),
    focus: createRendererFocusSource(renderer),
  })
  notifier.watch(store)
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
  /** The working directory Kitten treats as the project; defaults to `process.cwd()`. */
  cwd?: string
  /** Whether `cwd` is inside a repository; defaults to walking up for a `.git` entry. */
  checkRepo?: (cwd: string) => boolean
  /** How first-run guidance is surfaced when boot is blocked; defaults to stderr. */
  reportFirstRun?: (report: FirstRunReport) => void
  /** What to run when the first-run gate blocks boot; defaults to a non-zero exit. */
  onBlocked?: (report: FirstRunReport) => void
  /** How the attention notifier is wired; defaults to {@link wireAttentionNotifier}. */
  wireNotifier?: (renderer: CliRenderer, store: AppStore) => void
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
 * Two first-run gates run before the cockpit mounts. The repo requirement is checked
 * first and costs nothing: outside a repository Kitten refuses to launch, so no
 * renderer is created and no agent is spawned. After the agents come up, boot stops
 * again if none is ready, since a cockpit with two dead agents can do no useful work;
 * either way the user gets the exact reason instead of an inert screen. When a gate
 * blocks, `main` returns `null` rather than a booted cockpit.
 *
 * On a clean run, Ctrl+C destroys the renderer (restoring the terminal), which is the
 * signal to tear the agent subprocesses down before leaving. The exit waits on that
 * teardown: exiting first would orphan the spawned ACP adapters.
 */
export async function main(deps: MainDeps = {}): Promise<BootedCockpit | null> {
  const createRenderer = deps.createRenderer ?? createCockpitRenderer
  const onExit = deps.onExit ?? exitProcess
  const cwd = deps.cwd ?? process.cwd()
  const checkRepo = deps.checkRepo ?? isInsideRepo
  const reportFirstRun = deps.reportFirstRun ?? printFirstRunGuidance
  const onBlocked = deps.onBlocked ?? exitBlocked

  // Repo gate: cheapest check first, before touching the terminal or spawning agents.
  if (!checkRepo(cwd)) {
    const report = buildFirstRunReport({ insideRepo: false, agents: [] })
    reportFirstRun(report)
    onBlocked(report)
    return null
  }

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

  // Readiness gate: with no agent ready, restore the terminal and explain the gaps
  // rather than mounting a cockpit that cannot respond.
  const report = buildFirstRunReport({
    insideRepo: true,
    agents: controller.runtimes().map((state) => runtimeSetup(state, checkRepo)),
  })
  if (report.blocked) {
    renderer.destroy()
    await controller.dispose()
    reportFirstRun(report)
    onBlocked(report)
    return null
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

  // Wire the attention notifier alongside telemetry: it watches the same store and
  // reads terminal focus from the renderer. Best-effort, so it never blocks the mount.
  ;(deps.wireNotifier ?? wireAttentionNotifier)(renderer, controller.store)

  renderCockpit(renderer, controller, recorder)
  return { renderer, controller, closed }
}

/** Whether the CLI was asked to run the headless boot self-check. */
export function wantsSelfCheck(argv: readonly string[]): boolean {
  return argv.includes("--self-check")
}

if (import.meta.main) {
  if (wantsSelfCheck(process.argv)) {
    try {
      const { frame } = await runSelfCheck()
      process.stdout.write(`${frame}\nSELF-CHECK OK\n`)
      process.exit(0)
    } catch (error) {
      process.stderr.write(`SELF-CHECK FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    }
  } else {
    await main()
  }
}
