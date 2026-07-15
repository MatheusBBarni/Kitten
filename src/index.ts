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

import { createCliRenderer, type CliRenderer, type KeyEvent } from "@opentui/core"
import { join } from "node:path"

import {
  ASK_USER_MCP_INSTRUCTIONS,
  ASK_USER_MCP_MODE_FLAG,
  createAskUserMcpRegistrar,
} from "./agent/askUserMcp.ts"
import { runKittenMcp } from "./agent/kittenMcp.ts"
import { createSessionController, type AgentRuntimeState, type SessionController, type SessionControllerOptions } from "./app/controller.ts"
import {
  formatMcpSelfCheckLine,
  formatReloadProbeLine,
  reloadProbePassed,
  runSelfCheck,
  SELF_CHECK_MISSING_EVIDENCE_ENV,
} from "./app/selfCheck.ts"
import { configureTreeSitterWorker } from "./app/treeSitterWorker.ts"
import { bannerVariant, markFirstRunSeen, readFirstRunSeen, type BannerVariant } from "./config/appState.ts"
import { loadAppConfig, resolveSessions, type UserConfig } from "./config/configLoader.ts"
import { watchUserConfig, type ConfigWatcher } from "./config/configWatcher.ts"
import { persistUserConfig } from "./config/configWriter.ts"
import {
  buildFirstRunReport,
  formatFirstRunReport,
  isInsideRepo,
  sessionSetup,
  type AgentSetupState,
  type FirstRunGuidanceOptions,
  type FirstRunReport,
} from "./config/firstRun.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type AppConfig, type ProviderKind, type ProviderModelDefault, type SessionId, type ThemePreference } from "./core/types.ts"
import type { StatuslineLayout } from "./core/statusline.ts"
import { createOsNotificationChannel } from "./notify/channel.ts"
import { createRendererFocusSource } from "./notify/focus.ts"
import { createNotifier } from "./notify/notifier.ts"
import {
  createRunStore,
  resolveSessionsBasePath,
  type RunStore,
} from "./persistence/runStore.ts"
import { createRunWriter } from "./persistence/runWriter.ts"
import { createAppStore, type AppStore } from "./store/appStore.ts"
import { selectThemePreference } from "./store/selectors.ts"
import { createTelemetryRecorder, recordReadiness, type TelemetryRecorder } from "./telemetry/recorder.ts"
import { renderBootBanner, type BootBannerDisposer, type BootBannerOptions } from "./ui/bootBanner.tsx"
import { renderCockpit } from "./ui/main.tsx"
import { registerSyntaxParsers } from "./ui/syntaxParsers.ts"
import { KITTEN_VERSION } from "./version.ts"

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
  /** The persistence boundary shared with the `/resume` picker. */
  runStore?: RunStore
  /** Project identity used for project-scoped saved-run lookup. */
  cwd?: string
}

/** Factory that produces a booted {@link CockpitSession}. */
export type SessionFactory = () => Promise<CockpitSession>

/**
 * Create the interactive terminal renderer used for a real run.
 *
 * OpenTUI's automatic Ctrl+C exit is disabled so pane focus can route the chord:
 * the shell receives byte 0x03, while `main` retains the agent-focused teardown.
 * The underlying factory is injectable for testing.
 */
export function createCockpitRenderer(factory: typeof createCliRenderer = createCliRenderer): Promise<CliRenderer> {
  return factory({
    exitOnCtrlC: false,
    targetFps: 30,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
  })
}

/** Promote keyboard capability only after the renderer parses a Kitty-source event. */
export function wireKeyboardCapability(renderer: CliRenderer, onKittyConfirmed: () => void): () => void {
  const onKeypress = (key: KeyEvent): void => {
    if (key.source === "kitty") onKittyConfirmed()
  }

  renderer.keyInput.on("keypress", onKeypress)
  const stop = (): void => {
    renderer.keyInput.off("keypress", onKeypress)
  }
  renderer.once("destroy", stop)
  return stop
}

/** Route Ctrl+C at the renderer boundary without stealing it from the focused shell. */
export function wireCtrlCRouting(renderer: CliRenderer, controller: SessionController): () => void {
  const onKeypress = (key: KeyEvent): void => {
    if (!key.ctrl || key.name !== "c") return
    if (controller.store.getState().focusedPane.kind === "shell") return
    key.preventDefault()
    renderer.destroy()
  }

  renderer.keyInput.on("keypress", onKeypress)
  const stop = (): void => {
    renderer.keyInput.off("keypress", onKeypress)
  }
  renderer.once("destroy", stop)
  return stop
}

/** Injectable seams for {@link createCockpitSession}, so it is testable without spawning. */
export interface CockpitSessionDeps {
  /** Project directory used for session resolution and resume lookup. */
  cwd?: string
  /** Already-loaded immutable config; takes precedence over `loadConfig`. */
  config?: AppConfig
  /** How to load the config; defaults to reading it from disk. */
  loadConfig?: () => Promise<AppConfig>
  /** How to build the controller; defaults to the real spawning controller. */
  buildController?: (options: SessionControllerOptions) => Promise<SessionController>
  /** How to build the recorder from the opt-in flag; defaults to the JSONL recorder. */
  createRecorder?: (enabled: boolean) => TelemetryRecorder
  /** How to build the run store from the persistence flag; defaults to the XDG-state store. */
  createRunStore?: (enabled: boolean) => RunStore
  /** How to persist a settled preference change; defaults to the atomic config writer. */
  persistConfig?: (patch: { theme: ThemePreference }) => Promise<void>
  /** How to persist explicit statusline acknowledgement and confirmation writes. */
  persistStatuslineConfig?: (patch: NonNullable<UserConfig["statusline"]>) => Promise<void>
  /** How to persist one provider's confirmed model/reasoning defaults. */
  persistProviderDefaultsConfig?: (patch: Partial<Record<ProviderKind, ProviderModelDefault>>) => Promise<void>
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
  const cwd = deps.cwd ?? process.cwd()
  const config = deps.config ?? (await (deps.loadConfig ?? loadAppConfig)())
  const recorder = (deps.createRecorder ?? ((enabled) => createTelemetryRecorder({ enabled })))(config.telemetryEnabled)
  const runStore = (deps.createRunStore ?? ((enabled) => createRunStore({ enabled })))(config.persistenceEnabled)
  const store = createAppStore({
    seeds: resolveSessions(config, { launchCwd: cwd }).map((entry) => entry.seed),
    preferences: { theme: config.theme, statusline: config.statusline },
  })
  const baseController = await (deps.buildController ?? createSessionController)({
    config,
    recorder,
    store,
    cwd,
    // Startup always creates fresh ACP sessions. Saved runs are restored only from
    // the explicit `/resume` picker, never by selecting one during boot.
    sendInitialTasks: true,
    applyProviderDefaultsOnFreshSession: true,
  })

  recordReadiness(recorder, baseController.runtimes())
  const stopRecorder = recorder.watch(baseController.store)
  const runWriter = createRunWriter({ enabled: config.persistenceEnabled, runStore, projectCwd: cwd })
  const stopRunWriter = runWriter.watch(baseController.store)

  const persistConfig = deps.persistConfig ?? ((patch) => persistUserConfig(patch))
  const persistStatuslineConfig = deps.persistStatuslineConfig ??
    ((statusline) => persistUserConfig({ statusline }))
  const persistProviderDefaultsConfig = deps.persistProviderDefaultsConfig ??
    ((providerDefaults) => persistUserConfig({ providerDefaults }))
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer))
  const persistDebounceMs = deps.persistDebounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS
  let disposed = false
  let pendingTheme: ThemePreference | undefined
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let writeChain = Promise.resolve()
  let providerDefaults = cloneProviderDefaults(config.providerDefaults)

  function persistConfirmedProviderDefault(sessionId: SessionId, configId: string): void {
    const runtime = baseController.runtime(sessionId)
    const option = baseController.store.getState().sessions[sessionId]?.configOptions.find((candidate) => candidate.id === configId)
    if (!runtime || !option) return

    const field = option.category === MODEL_CATEGORY ? "model" : option.category === EFFORT_CATEGORY ? "effort" : undefined
    if (!field) return

    const current = providerDefaults[runtime.providerKind]
    if (current?.[field] === option.currentValue) return

    const nextProviderDefault = { ...current, [field]: option.currentValue }
    providerDefaults = { ...providerDefaults, [runtime.providerKind]: nextProviderDefault }
    baseController.updateProviderDefaults(providerDefaults)

    // The writer re-reads and atomically merges this small provider patch, so a
    // concurrent edit to another provider's defaults is retained.
    writeChain = writeChain.then(async () => {
      try {
        await persistProviderDefaultsConfig({ [runtime.providerKind]: nextProviderDefault })
        recorder.configWrite("modal")
      } catch {
        recorder.configWriteError("modal")
      }
    })
  }

  function queueStatuslineWrite(
    patch: () => NonNullable<UserConfig["statusline"]>,
    apply: () => void,
  ): Promise<{ outcome: "saved" } | { outcome: "error"; message: string }> {
    const write = writeChain.then(async () => {
      if (disposed) return { outcome: "error" as const, message: "Statusline preferences are unavailable." }
      try {
        await persistStatuslineConfig(patch())
        if (disposed) return { outcome: "error" as const, message: "Statusline preferences are unavailable." }
        apply()
        return { outcome: "saved" as const }
      } catch (error) {
        return { outcome: "error" as const, message: errorMessage(error) }
      }
    })
    writeChain = write.then(() => undefined)
    return write
  }

  const acknowledgeStatuslineDisclosure = () => queueStatuslineWrite(
    () => ({ llmDisclosureAcknowledged: true }),
    () => {
      const current = baseController.store.getState().preferences.statusline
      baseController.store.setStatuslinePreference({ ...current, llmDisclosureAcknowledged: true })
    },
  )

  const confirmStatusline = (layout: StatuslineLayout) => queueStatuslineWrite(
    () => {
      const acknowledged = baseController.store.getState().preferences.statusline.llmDisclosureAcknowledged
      return {
        llmDisclosureAcknowledged: acknowledged,
        separator: layout.separator,
        line: layout.line,
      }
    },
    () => {
      const acknowledged = baseController.store.getState().preferences.statusline.llmDisclosureAcknowledged
      baseController.store.setStatuslinePreference({ llmDisclosureAcknowledged: acknowledged, layout })
    },
  )

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
      if (disposed) return
      baseController.store.setThemePreference(nextConfig.theme)
      baseController.store.setStatuslinePreference(nextConfig.statusline)
      providerDefaults = cloneProviderDefaults(nextConfig.providerDefaults)
      baseController.updateProviderDefaults(providerDefaults)
    })
  } catch (error) {
    stopPreference()
    stopRecorder()
    stopRunWriter()
    runWriter.dispose()
    if (persistTimer !== undefined) clearTimer(persistTimer)
    await baseController.dispose()
    throw error
  }

  let disposal: Promise<void> | undefined
  const controller: SessionController = {
    store: baseController.store,
    actions: {
      ...baseController.actions,
      async setSessionConfigOption(configId, value, sessionId): Promise<boolean> {
        // Resolve before awaiting the agent so a later focus change cannot persist a
        // confirmed setting under the wrong provider.
        const targetSessionId = sessionId ?? baseController.store.getState().workspace.selectedVisibleId
        const changed = await baseController.actions.setSessionConfigOption(configId, value, sessionId)
        if (changed && targetSessionId && !disposed) persistConfirmedProviderDefault(targetSessionId, configId)
        return changed
      },
      acknowledgeStatuslineDisclosure,
      confirmStatusline,
    },
    shell: baseController.shell,
    runtimes: () => baseController.runtimes(),
    runtime: (sessionId) => baseController.runtime(sessionId),
    isReady: (sessionId) => baseController.isReady(sessionId),
    updateProviderDefaults: (defaults) => baseController.updateProviderDefaults(defaults),
    closeConversation: (sessionId, choice) => baseController.closeConversation(sessionId, choice),
    restore: (record, mode) => baseController.restore(record, mode),
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
        stopRunWriter()
        runWriter.dispose()
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

  return { controller, recorder, runStore, cwd }
}

/** Default exit handler: exit the process cleanly once teardown has finished. */
export function exitProcess(): void {
  process.exit(0)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cloneProviderDefaults(
  defaults: AppConfig["providerDefaults"],
): Partial<Record<ProviderKind, ProviderModelDefault>> {
  return Object.fromEntries(
    Object.entries(defaults).map(([provider, preference]) => [provider, { ...preference }]),
  ) as Partial<Record<ProviderKind, ProviderModelDefault>>
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

/**
 * Reconcile the legacy "one ready runtime" gate with Session Tabs restoration.
 *
 * Fresh startup failures remain blocking. An empty workspace, or one whose remaining
 * descriptors are unavailable only because restore/provider resolution failed, is a
 * valid product surface with recovery affordances and must be allowed to mount.
 */
export function applyWorkspaceBootPolicy(report: FirstRunReport, store: AppStore): FirstRunReport {
  if (!report.insideRepo || report.anyReady) return report
  const workspace = store.getState().workspace
  const restoreUnavailable = workspace.order.every((sessionId) => {
    const availability = workspace.conversations[sessionId]?.availability
    return availability?.kind === "unavailable" &&
      (availability.reasonCode === "restore-unavailable" || availability.reasonCode === "provider-unavailable")
  })
  if (!restoreUnavailable) return report
  return { ...report, gaps: [], blocked: false }
}

/** Print first-run guidance to stderr. */
export function printFirstRunGuidance(report: FirstRunReport, options?: FirstRunGuidanceOptions): void {
  for (const line of formatFirstRunReport(report, options)) process.stderr.write(`${line}\n`)
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
   * Prepare OpenTUI's tree-sitter worker before the Markdown-capable cockpit mounts.
   * The transient boot banner is text-only, so this seam intentionally runs after
   * that first visible feedback has been mounted.
   */
  configureTreeSitterWorker?: typeof configureTreeSitterWorker
  /** Register static parser capabilities after worker setup and before cockpit rendering. */
  registerSyntaxParsers?: typeof registerSyntaxParsers
  /**
   * How to obtain just the controller. When given, telemetry is not wired (the tests
   * use this to drive a fake controller). Takes precedence over `createSession`.
   */
  createController?: ControllerFactory
  /** How to obtain the controller and its recorder; defaults to {@link createCockpitSession}. */
  createSession?: SessionFactory
  /** How to load the immutable boot config; defaults to the normal config loader. */
  loadConfig?: () => Promise<AppConfig>
  /** How to read the optional first-run marker; defaults to fail-soft runtime state. */
  readFirstRunSeen?: () => boolean
  /** How to persist the first successful run; defaults to fail-soft runtime state. */
  markFirstRunSeen?: () => void
  /** How to mount the transient handshake tree; injectable for lifecycle tests. */
  renderBootBanner?: (renderer: CliRenderer, options: BootBannerOptions) => BootBannerDisposer
  /** What to run once the cockpit has torn down; defaults to a clean process exit. */
  onExit?: () => void
  /** The working directory Kitten treats as the project; defaults to `process.cwd()`. */
  cwd?: string
  /** Whether `cwd` is inside a repository; defaults to walking up for a `.git` entry. */
  checkRepo?: (cwd: string) => boolean
  /** How first-run guidance is surfaced; defaults to stderr. */
  reportFirstRun?: (report: FirstRunReport, options?: FirstRunGuidanceOptions) => void
  /** What to run when the first-run gate blocks boot; defaults to a non-zero exit. */
  onBlocked?: (report: FirstRunReport) => void
  /** How the attention notifier is wired; defaults to {@link wireAttentionNotifier}. */
  wireNotifier?: (renderer: CliRenderer, store: AppStore) => void
  /** How renderer key events promote ephemeral Kitty capability; injectable for lifecycle tests. */
  wireKeyboardCapability?: (renderer: CliRenderer, onKittyConfirmed: () => void) => void
  /** Cockpit render seam used to prove parser registration order without native allocation. */
  renderCockpit?: typeof renderCockpit
}

/** What {@link main} hands back so a caller (or a test) can inspect the booted app. */
export interface BootedCockpit {
  renderer: CliRenderer
  controller: SessionController
  /** Resolves once the renderer has been destroyed and the agents disposed. */
  closed: Promise<void>
}

/** Results that can be prepared concurrently before the cockpit root mounts. */
interface PreparedCockpitSession {
  controller: SessionController
  recorder?: TelemetryRecorder
  sessionPicker?: { runStore: RunStore; cwd: string }
}

/**
 * Boot the cockpit for a real run.
 *
 * Two first-run gates run before the cockpit mounts. The repo requirement is checked
 * first and costs nothing: outside a repository Kitten refuses to launch, so no
 * renderer is created and no agent is spawned. After the agents come up, boot stops
 * again if a fresh workspace has no ready runtime. Empty and restore-unavailable
 * Session Tabs workspaces remain mountable so users can recover or create work;
 * either way the user gets the exact reason instead of an inert screen. When a gate
 * blocks, `main` returns `null` rather than a booted cockpit.
 *
 * On a clean run, agent-focused Ctrl+C destroys the renderer (restoring the terminal),
 * which is the signal to tear the agent subprocesses down before leaving. Shell focus
 * reserves that chord for the PTY. The exit waits on teardown so adapters are not orphaned.
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
  let sessionPicker: { runStore: RunStore; cwd: string } | undefined
  let disposeBootBanner: BootBannerDisposer | undefined
  let firstRunSeen = false
  let idleBannerVariant: BannerVariant = "full"
  let firstRunGuidance: FirstRunGuidanceOptions | undefined
  try {
    const config = await (deps.loadConfig ?? loadAppConfig)()
    firstRunSeen = (deps.readFirstRunSeen ?? readFirstRunSeen)()
    if (!firstRunSeen) {
      firstRunGuidance = {
        persistenceEnabled: config.persistenceEnabled,
        sessionsPath: join(resolveSessionsBasePath(), "sessions"),
        askUserMcpEnabled: true,
      }
    }
    idleBannerVariant = bannerVariant(config.welcomeBanner, firstRunSeen)
    disposeBootBanner = (deps.renderBootBanner ?? renderBootBanner)(renderer, {
      preference: config.welcomeBanner,
      theme: config.theme,
      firstRunSeen,
      agents: resolveSessions(config, { launchCwd: cwd }).map(({ spawn }) => ({
        displayName: spawn.displayName,
        state: "connecting" as const,
      })),
      cwd,
    })

    // The boot banner contains only plain text, whereas the cockpit can mount
    // Markdown immediately. Start the standalone-worker setup and the agent
    // handshakes together behind that visible feedback, then wait for both before
    // swapping in the Markdown-capable cockpit. Neither preparation path renders,
    // so they are independent and safely overlap on the critical path.
    const workerSetup = (deps.configureTreeSitterWorker ?? configureTreeSitterWorker)()
    const sessionSetup: Promise<PreparedCockpitSession> = deps.createController
      ? deps.createController().then((nextController) => ({ controller: nextController }))
      : (deps.createSession
          ? deps.createSession()
          : createCockpitSession({ config, cwd })
        ).then((session) => ({
          controller: session.controller,
          recorder: session.recorder,
          sessionPicker: session.runStore ? { runStore: session.runStore, cwd: session.cwd ?? cwd } : undefined,
        }))
    const [workerResult, sessionResult] = await Promise.allSettled([workerSetup, sessionSetup])

    if (workerResult.status === "rejected") {
      if (sessionResult.status === "fulfilled") await sessionResult.value.controller.dispose()
      throw workerResult.reason
    }
    if (sessionResult.status === "rejected") throw sessionResult.reason

    ;(deps.registerSyntaxParsers ?? registerSyntaxParsers)()

    controller = sessionResult.value.controller
    recorder = sessionResult.value.recorder
    sessionPicker = sessionResult.value.sessionPicker
  } catch (error) {
    // The renderer already owns the terminal (raw mode, alternate screen). Give it
    // back before the error escapes, or the user's shell is left unusable.
    disposeBootBanner?.()
    renderer.destroy()
    throw error
  }

  // Readiness gate: with no agent ready, restore the terminal and explain the gaps
  // rather than mounting a cockpit that cannot respond.
  const report = applyWorkspaceBootPolicy(
    buildFirstRunReport({
      insideRepo: true,
      agents: controller.runtimes().map((state) => runtimeSetup(state, checkRepo)),
    }),
    controller.store,
  )
  if (report.blocked) {
    disposeBootBanner?.()
    renderer.destroy()
    await controller.dispose()
    reportFirstRun(report, firstRunGuidance)
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
  ;(deps.wireKeyboardCapability ?? wireKeyboardCapability)(renderer, () => {
    controller.store.confirmKittyKeyboard()
  })
  wireCtrlCRouting(renderer, controller)

  disposeBootBanner?.()
  if (!firstRunSeen) {
    reportFirstRun(report, firstRunGuidance)
    const markSeen = deps.markFirstRunSeen ?? markFirstRunSeen
    markSeen()
  }
  ;(deps.renderCockpit ?? renderCockpit)(renderer, controller, recorder, idleBannerVariant, sessionPicker)
  return { renderer, controller, closed }
}

/** Whether the CLI was asked to run the headless boot self-check. */
export function wantsSelfCheck(argv: readonly string[]): boolean {
  return argv.includes("--self-check")
}

/** Whether this executable is the provider-facing stdio MCP child. */
export function wantsAskUserMcp(argv: readonly string[]): boolean {
  return argv.includes(ASK_USER_MCP_MODE_FLAG)
}

export interface ReservedChildModeOptions {
  readonly run?: () => Promise<void>
  readonly writeError?: (output: string) => void
  readonly exit?: (code: number) => void
}

/** Dispatch the reserved MCP child before any normal application boot gate. */
export async function dispatchReservedChildMode(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  options: ReservedChildModeOptions = {},
): Promise<boolean> {
  if (!wantsAskUserMcp(argv)) return false
  const run = options.run ?? (() => runKittenMcp({
    instructions: ASK_USER_MCP_INSTRUCTIONS,
    registrars: [createAskUserMcpRegistrar(env)],
  }))
  try {
    await run()
  } catch {
    ;(options.writeError ?? ((output) => process.stderr.write(output)))("ASK_USER MCP FAILED: unavailable\n")
    ;(options.exit ?? ((code) => process.exit(code)))(1)
  }
  return true
}

/** Whether the CLI was asked to print Kitten's release version. */
export function wantsVersion(argv: readonly string[]): boolean {
  return argv.includes("--version")
}

/** Whether the CLI was asked to print usage and install guidance. */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help")
}

export interface CliFlagDispatchOptions {
  /** Output seam used by tests and the real stdout stream. */
  write?: (output: string) => void
  /** Exit seam used by tests and the real process. */
  exit?: (code: number) => void
}

function formatCliHelp(): string {
  return `Examples:
  npx @matheusbbarni/kitten       Try Kitten without installing
  kitten                          Launch in the current Git repository
  kitten --self-check             Run the headless boot check

Kitten ${KITTEN_VERSION}

Usage:
  kitten [--version | --help | --self-check]

Options:
  --version                       Print the installed version
  --help                          Print this help
  --self-check                    Verify Kitten can boot headlessly

Install or upgrade:
  npm / npx channel:              npm i -g @matheusbbarni/kitten@latest
  standalone binary channel:     curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | sh
`
}

/** Handle metadata-only flags before boot; return false to continue into the cockpit. */
export function dispatchCliFlags(argv: readonly string[], options: CliFlagDispatchOptions = {}): boolean {
  const write = options.write ?? ((output: string) => process.stdout.write(output))
  const exit = options.exit ?? ((code: number) => process.exit(code))

  if (wantsVersion(argv)) {
    write(`${KITTEN_VERSION}\n`)
    exit(0)
    return true
  }
  if (wantsHelp(argv)) {
    write(formatCliHelp())
    exit(0)
    return true
  }
  return false
}

/** Whether self-check should run the manual/nightly real-adapter reload gate. */
export function wantsReloadProbe(argv: readonly string[]): boolean {
  return argv.includes("--reload-probe")
}

if (import.meta.main) {
  if (!await dispatchReservedChildMode(process.argv, process.env)) {
    const cliFlagHandled = dispatchCliFlags(process.argv)
    if (!cliFlagHandled && wantsSelfCheck(process.argv)) {
      try {
        const { frame, reloadProbe, mcp } = await runSelfCheck({
          reloadProbe: wantsReloadProbe(process.argv) ? {} : false,
          missingEvidenceKey: process.env[SELF_CHECK_MISSING_EVIDENCE_ENV],
        })
        const probeLines = reloadProbe.map(formatReloadProbeLine)
        const mcpLines = mcp.map(formatMcpSelfCheckLine)
        process.stdout.write(`${frame}\n${mcpLines.concat(probeLines).map((line) => `${line}\n`).join("")}`)
        if (!reloadProbePassed(reloadProbe)) {
          process.stderr.write("SELF-CHECK FAILED: reload confirmation probe reported one or more failures\n")
          process.exit(1)
        }
        process.stdout.write("SELF-CHECK OK\n")
        process.exit(0)
      } catch (error) {
        process.stderr.write(`SELF-CHECK FAILED: ${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(1)
      }
    } else if (!cliFlagHandled) {
      await main()
    }
  }
}
