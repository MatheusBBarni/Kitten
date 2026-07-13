/**
 * Headless boot self-check for the compiled artifact (ADR-006).
 *
 * ADR-006 ships Kitten as a per-platform standalone binary, and its stated risk is
 * that OpenTUI's native (Zig) core, embedded via FFI, fails to load on a target.
 * This self-check exercises the whole boot pipeline inside the built binary without
 * a terminal: it loads the config, mounts the cockpit into an in-memory renderer,
 * and waits for a frame to paint. If the native core cannot load, the render pass
 * crashes here - in CI, on a real machine per
 * target - instead of in front of the first user.
 *
 * Plain `--self-check` never spawns configured agents: release/build smoke tests use
 * a process-free adapter. The explicit `--reload-probe` phase available through
 * `bun run selfcheck:reload` is the manual/nightly exception: it starts fresh real
 * connections to verify each adapter's advertised session-reload contract.
 */

import { CodeRenderable, getTreeSitterClient, type BaseRenderable, type CapturedFrame } from "@opentui/core"

import { createAgentConnection, type AgentConnection } from "../agent/agentConnection.ts"
import { loadAppConfig, resolveSessions } from "../config/configLoader.ts"
import { resolveMcpServers } from "../config/mcpResolver.ts"
import type { AgentConfig, AppConfig, DomainSessionEvent } from "../core/types.ts"
import { selfCheckElement } from "../ui/main.tsx"
import { createSessionController } from "./controller.ts"
import { configureTreeSitterWorker } from "./treeSitterWorker.ts"

/** Plain prose used to discover the active default foreground in the captured frame. */
export const SELF_CHECK_DEFAULT_TOKEN = "selfCheckDefaultText"

/** Identifier that must receive TypeScript highlighting inside the Markdown fence. */
export const SELF_CHECK_MARKDOWN_TOKEN = "compiledMarkdownToken"

/** Identifier that must receive TypeScript highlighting inside the unified diff. */
export const SELF_CHECK_DIFF_TOKEN = "compiledDiffToken"

/** Deterministic Markdown fixture mounted by the real cockpit during self-check. */
export const SELF_CHECK_MARKDOWN = `${SELF_CHECK_DEFAULT_TOKEN}\n\n\`\`\`typescript\nconst ${SELF_CHECK_MARKDOWN_TOKEN} = true\n\`\`\``

/** Deterministic diff fixture mounted beside the Markdown fixture. */
export const SELF_CHECK_DIFF = [
  "--- a/src/selfCheck.ts",
  "+++ b/src/selfCheck.ts",
  "@@ -0,0 +1 @@",
  `+const ${SELF_CHECK_DIFF_TOKEN} = true`,
].join("\n")

/** What the self-check reports back to the CLI dispatcher. */
export interface SelfCheckResult {
  /** The captured frame that satisfied the wait predicate. */
  frame: string
  /** Captured foregrounds proving both syntax paths differ from body text. */
  highlights: SelfCheckHighlights
  /** Empty for the process-free smoke test; populated by the opt-in real-adapter probe. */
  reloadProbe: ReloadProbeResult[]
}

export type ReloadProbeOutcome = "reload confirmed" | "capability absent" | "reload failed"

/** One configured session's advertised capability and observed replay outcome. */
export interface ReloadProbeResult {
  configuredSessionId: string
  displayName: string
  /** `null` means the initial handshake failed before the capability was advertised. */
  canLoadSession: boolean | null
  outcome: ReloadProbeOutcome
  detail?: string
}

/** Injectable boundaries for deterministic unit and in-process ACP integration tests. */
export interface ReloadProbeDeps {
  createConnection?: (config: AgentConfig) => AgentConnection
  /** Wait for replay that arrives after `session/load` resolves. */
  awaitReplay?: (historySignal: Promise<void>) => Promise<boolean>
}

/** Foreground evidence returned only after the in-process assertion succeeds. */
export interface SelfCheckHighlights {
  defaultForeground: string
  markdownForeground: string
  diffForeground: string
}

/** Injectable seams so the self-check is unit-testable in-process. */
export interface SelfCheckDeps {
  /** How to load the config; defaults to reading it from disk. */
  loadConfig?: () => Promise<AppConfig>
  /** Renderer dimensions for the headless frame. */
  width?: number
  height?: number
  /** Configure the embedded worker before any renderable can create a client. */
  configureWorker?: () => Promise<string | null>
  /** Absent/false keeps the compiled smoke test process-free. */
  reloadProbe?: ReloadProbeDeps | false
}

const RELOAD_PROBE_PROMPT = "Reply with exactly: kitten reload probe."
const REPLAY_TIMEOUT_MS = 3_000

/**
 * Exercise `session/load` for every resolved configured session.
 *
 * Confirmation requires a second connection and at least one replayed history event;
 * lifecycle/config notifications alone do not prove that conversation history came
 * back. Failures are isolated per session so one broken adapter cannot hide another
 * session's verdict.
 */
export async function runReloadConfirmationProbe(
  config: AppConfig,
  deps: ReloadProbeDeps = {},
): Promise<ReloadProbeResult[]> {
  const createConnection = deps.createConnection ?? ((agent) => createAgentConnection({ config: agent }))
  const awaitReplay = deps.awaitReplay ?? awaitReplayWithTimeout
  const mcpServers = resolveMcpServers(config.mcpServers).resolved
  const reports: ReloadProbeResult[] = []

  for (const { seed, spawn } of resolveSessions(config)) {
    let creator: AgentConnection | null = null
    let loader: AgentConnection | null = null
    let unsubscribe: (() => void) | undefined
    let canLoadSession: boolean | null = null

    try {
      creator = createConnection(spawn)
      const ready = await creator.connect()
      if (!ready.ready) {
        reports.push(failedProbe(seed.id, spawn.displayName, null, `connect failed: ${ready.error}`))
        continue
      }

      canLoadSession = ready.canLoadSession
      if (!canLoadSession) {
        reports.push({
          configuredSessionId: seed.id,
          displayName: spawn.displayName,
          canLoadSession,
          outcome: "capability absent",
        })
        continue
      }

      const sessionId = await creator.newSession(seed.cwd, mcpServers)
      await creator.prompt(sessionId, [{ type: "text", text: RELOAD_PROBE_PROMPT }])
      await disposeQuietly(creator)
      creator = null

      loader = createConnection(spawn)
      const reloadReady = await loader.connect()
      if (!reloadReady.ready) {
        reports.push(failedProbe(seed.id, spawn.displayName, canLoadSession, `fresh connect failed: ${reloadReady.error}`))
        continue
      }
      if (!reloadReady.canLoadSession) {
        reports.push({
          configuredSessionId: seed.id,
          displayName: spawn.displayName,
          canLoadSession: false,
          outcome: "capability absent",
          detail: "fresh connection did not advertise loadSession",
        })
        continue
      }

      let replayedHistory = false
      let resolveHistory!: () => void
      const historySignal = new Promise<void>((resolve) => {
        resolveHistory = resolve
      })
      unsubscribe = loader.onUpdate((event) => {
        if (!isHistoryEvent(event)) return
        replayedHistory = true
        resolveHistory()
      })

      await loader.loadSession(sessionId, seed.cwd, mcpServers)
      replayedHistory ||= await awaitReplay(historySignal)
      reports.push(
        replayedHistory
          ? {
              configuredSessionId: seed.id,
              displayName: spawn.displayName,
              canLoadSession,
              outcome: "reload confirmed",
            }
          : failedProbe(seed.id, spawn.displayName, canLoadSession, "session/load streamed no history"),
      )
    } catch (error) {
      reports.push(failedProbe(seed.id, spawn.displayName, canLoadSession, oneLineError(error)))
    } finally {
      unsubscribe?.()
      await disposeQuietly(loader)
      await disposeQuietly(creator)
    }
  }

  return reports
}

/** Format the stable, human-readable pass/fail contract used by the CLI. */
export function formatReloadProbeLine(report: ReloadProbeResult): string {
  const verdict = report.outcome === "reload confirmed" ? "PASS" : "FAIL"
  const capability = report.canLoadSession === null ? "unknown" : String(report.canLoadSession)
  const detail = report.detail ? `: ${report.detail}` : ""
  return `[${verdict}] ${report.displayName} (${report.configuredSessionId}): loadSession=${capability} — ${report.outcome}${detail}`
}

export function reloadProbePassed(reports: readonly ReloadProbeResult[]): boolean {
  return reports.every((report) => report.outcome === "reload confirmed")
}

/**
 * A connection that never spawns a process and always reports not-ready.
 *
 * The controller stops at the failed handshake, so `connect` is the only method it
 * calls; the rest exist to satisfy the interface and to make "this agent was never
 * started" an explicit, honest state rather than a thrown surprise.
 */
export function createOfflineConnection(config: AgentConfig): AgentConnection {
  return {
    id: config.id,
    async connect() {
      return { ready: false, error: "not started (boot self-check does not spawn agents)" }
    },
    async newSession() {
      throw new Error("offline connection has no session")
    },
    async loadSession() {
      throw new Error("offline connection cannot load a session")
    },
    async prompt() {
      throw new Error("offline connection cannot prompt")
    },
    async cancel() {},
    async setSessionConfigOption() {
      throw new Error("offline connection cannot set config options")
    },
    onUpdate() {
      return () => {}
    },
    onPermission() {},
    onClarification: () => () => {},
    async dispose() {},
  }
}

/** A process-free connection that opens the cockpit's normal ready content region. */
export function createSelfCheckConnection(config: AgentConfig): AgentConnection {
  const connection = createOfflineConnection(config)
  return {
    ...connection,
    async connect() {
      return { ready: true, protocolVersion: 1, canLoadSession: false }
    },
    async newSession() {
      return `self-check-${config.id}`
    },
  }
}

/**
 * Load the config, mount the cockpit headlessly, and wait for it to paint.
 *
 * Resolves with the frame that painted, or rejects if the render never produces the
 * expected frame (a broken native core, a mount error) - the CLI turns a rejection
 * into a non-zero exit so CI fails loudly per target.
 */
export async function runSelfCheck(deps: SelfCheckDeps = {}): Promise<SelfCheckResult> {
  await (deps.configureWorker ?? configureTreeSitterWorker)()
  const config = await (deps.loadConfig ?? loadAppConfig)()
  const reloadProbe = deps.reloadProbe === undefined || deps.reloadProbe === false
    ? []
    : await runReloadConfirmationProbe(config, deps.reloadProbe)
  const controller = await createSessionController({ config, createConnection: createSelfCheckConnection })

  // Imported lazily so merely importing this module (and the entry point) allocates
  // nothing from the native render library - the smoke test guards that invariant.
  // `testRender` drives the React commit into the in-memory renderer, the same path
  // the UI integration tests trust; the frame it paints is the proof the native core
  // loaded and the cockpit reached first paint.
  const { testRender } = await import("@opentui/react/test-utils")
  const { act } = await import("react")
  const { renderer, waitForFrame, flush, captureSpans } = await testRender(
    selfCheckElement(controller, {
      markdown: SELF_CHECK_MARKDOWN,
      diff: { path: "src/selfCheck.ts", unified: SELF_CHECK_DIFF },
    }),
    {
      width: deps.width ?? 80,
      height: deps.height ?? 24,
    },
  )

  try {
    let result: SelfCheckResult | undefined
    await act(async () => {
      await waitForFrame((candidate) => candidate.includes("Kitten") && candidate.includes(SELF_CHECK_DEFAULT_TOKEN))
      await Promise.all(collectCodeRenderables(renderer.root).map((code) => code.highlightingDone))
      await flush()
      const frame = await waitForFrame(
        (candidate) => candidate.includes(SELF_CHECK_MARKDOWN_TOKEN) && candidate.includes(SELF_CHECK_DIFF_TOKEN),
      )
      result = { frame, highlights: assertSelfCheckHighlights(captureSpans()), reloadProbe }
    })
    if (!result) throw new Error("self-check did not produce highlight evidence")
    return result
  } finally {
    const treeSitterClient = getTreeSitterClient()
    await act(async () => {
      renderer.destroy()
      // CliRenderer starts this teardown without awaiting it. Await the same client
      // so a following in-process test cannot inherit a half-destroyed singleton.
      await treeSitterClient.destroy()
      await controller.dispose()
    })
  }
}

/** Assert that both known syntax tokens differ from the frame's body-text color. */
export function assertSelfCheckHighlights(frame: CapturedFrame): SelfCheckHighlights {
  const defaultForeground = foregroundFor(frame, SELF_CHECK_DEFAULT_TOKEN)
  const markdownForeground = foregroundFor(frame, SELF_CHECK_MARKDOWN_TOKEN)
  const diffForeground = foregroundFor(frame, SELF_CHECK_DIFF_TOKEN)

  for (const [surface, foreground] of [
    ["Markdown fence", markdownForeground],
    ["diff", diffForeground],
  ] as const) {
    if (foreground === defaultForeground) {
      throw new Error(`${surface} token rendered with the default foreground; tree-sitter highlighting is unavailable`)
    }
  }

  return { defaultForeground, markdownForeground, diffForeground }
}

function foregroundFor(frame: CapturedFrame, token: string): string {
  const span = frame.lines.flatMap((line) => line.spans).find((candidate) => candidate.text.includes(token))
  if (!span) throw new Error(`self-check token was not rendered: ${token}`)
  return span.fg.toString()
}

function collectCodeRenderables(root: BaseRenderable): CodeRenderable[] {
  const renderables = root instanceof CodeRenderable ? [root] : []
  for (const child of root.getChildren()) renderables.push(...collectCodeRenderables(child))
  return renderables
}

function isHistoryEvent(event: DomainSessionEvent): boolean {
  return event.kind === "user_message" || event.kind === "agent_message" || event.kind === "tool_call" || event.kind === "plan"
}

function failedProbe(
  configuredSessionId: string,
  displayName: string,
  canLoadSession: boolean | null,
  detail: string,
): ReloadProbeResult {
  return { configuredSessionId, displayName, canLoadSession, outcome: "reload failed", detail }
}

async function awaitReplayWithTimeout(historySignal: Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), REPLAY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([historySignal.then(() => true), timedOut])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function disposeQuietly(connection: AgentConnection | null): Promise<void> {
  if (!connection) return
  try {
    await connection.dispose()
  } catch {
    // The probe verdict belongs to handshake/load/replay. Teardown is best-effort so
    // a dying adapter cannot prevent remaining configured sessions from being tested.
  }
}

function oneLineError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim()
}
