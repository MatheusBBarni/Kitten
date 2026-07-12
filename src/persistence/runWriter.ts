import type { HandoffBundle, SessionId, Turn } from "../core/types.ts"
import type { AppState, AppStore, Unsubscribe } from "../store/appStore.ts"
import type { PersistedAgent, PersistedRunRecord } from "./runRecord.ts"
import type { RunStore } from "./runStore.ts"

/** The store quiet period before the latest run snapshot is persisted. */
export const DEFAULT_RUN_WRITE_DEBOUNCE_MS = 250

type TimerHandle = ReturnType<typeof setTimeout>

export interface RunWriterOptions {
  enabled: boolean
  runStore: RunStore
  /** Stable launch/project directory used to key this whole cockpit run. */
  projectCwd: string
  debounceMs?: number
  now?: () => number
  runId?: string
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (timer: TimerHandle) => void
  onError?: (error: unknown) => void
}

/** Store-subscription lifecycle for one cockpit run. */
export interface RunWriter {
  readonly enabled: boolean
  watch(store: AppStore): Unsubscribe
  dispose(): void
}

const NOOP_RUN_WRITER: RunWriter = {
  enabled: false,
  watch() {
    return () => {}
  },
  dispose() {},
}

/** Create one per-cockpit autosave writer, or a subscription-free no-op. */
export function createRunWriter(options: RunWriterOptions): RunWriter {
  if (!options.enabled) return NOOP_RUN_WRITER
  return new ActiveRunWriter(options)
}

class ActiveRunWriter implements RunWriter {
  readonly enabled = true
  private readonly runStore: RunStore
  private readonly projectCwd: string
  private readonly debounceMs: number
  private readonly now: () => number
  private readonly runId: string
  private readonly createdAt: number
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (timer: TimerHandle) => void
  private readonly onError: (error: unknown) => void
  private latestState: AppState | undefined
  private lastHandoffBundle: HandoffBundle | null = null
  private timer: TimerHandle | undefined
  private unsubscribe: Unsubscribe | undefined
  private dirty = false
  private disposed = false

  constructor(options: RunWriterOptions) {
    this.runStore = options.runStore
    this.projectCwd = options.projectCwd
    this.debounceMs = options.debounceMs ?? DEFAULT_RUN_WRITE_DEBOUNCE_MS
    this.now = options.now ?? (() => Date.now())
    this.runId = options.runId ?? crypto.randomUUID()
    this.createdAt = this.now()
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
    this.onError = options.onError ?? (() => {})
  }

  watch(store: AppStore): Unsubscribe {
    if (this.disposed || this.unsubscribe !== undefined) return () => {}

    this.observe(store.getState())
    const unsubscribe = store.subscribe((state) => this.observe(state))
    let stopped = false
    const stop = (): void => {
      if (stopped) return
      stopped = true
      unsubscribe()
      if (this.unsubscribe === stop) this.unsubscribe = undefined
    }
    this.unsubscribe = stop
    return stop
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    if (this.timer !== undefined) {
      this.clearTimer(this.timer)
      this.timer = undefined
    }
    this.persistLatest()
    try {
      this.runStore.flush()
    } catch (error) {
      this.reportError(error)
    }
  }

  private observe(state: AppState): void {
    this.latestState = state
    if (state.overlays.handoffPreview !== null) {
      this.lastHandoffBundle = state.overlays.handoffPreview.bundle
    }
    this.dirty = true
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = undefined
      if (!this.disposed) this.persistLatest()
    }, this.debounceMs)
  }

  private persistLatest(): void {
    if (!this.dirty || this.latestState === undefined) return
    try {
      this.runStore.save(this.snapshot(this.latestState))
      this.dirty = false
    } catch (error) {
      this.reportError(error)
    }
  }

  private snapshot(state: AppState): PersistedRunRecord {
    const focusedSessionId = state.workspace.selectedVisibleId
    if (focusedSessionId === null) throw new Error("Cannot persist an empty V1 workspace")
    const focused = state.sessions[focusedSessionId]
    if (!focused) throw new Error(`Cannot persist missing focused session: ${focusedSessionId}`)

    const agents: Record<SessionId, PersistedAgent> = {}
    for (const sessionId of state.workspace.order) {
      const session = state.sessions[sessionId]
      if (!session) continue
      agents[sessionId] = {
        sessionId: session.acpSessionId,
        status: session.status,
        messageCount: session.turns.length,
        lastPrompt: lastUserPrompt(session.turns),
      }
    }

    return {
      version: 1,
      runId: this.runId,
      // A run belongs to the launch project even when focus moves between sessions
      // configured with different working directories. Boot and the picker use this
      // same key to find it again.
      cwd: this.projectCwd,
      gitBranch: focused.branch ?? null,
      focusedAgentId: focusedSessionId,
      createdAt: this.createdAt,
      updatedAt: this.now(),
      agents,
      handoffBundle: this.lastHandoffBundle,
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error)
    } catch {
      // Persistence failures must not escape a timer or the controller's disposal path.
    }
  }
}

function lastUserPrompt(turns: readonly Turn[]): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn?.kind === "user") return turn.text
  }
  return ""
}
