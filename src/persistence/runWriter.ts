import type { HandoffBundle, Turn } from "../core/types.ts"
import type { AppState, AppStore, Unsubscribe } from "../store/appStore.ts"
import type {
  PersistedConversationV2,
  PersistedRunRecordV2,
  PersistedWorkspaceConversationV2,
} from "./runRecord.ts"
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
  private observedRestorationBundle: HandoffBundle | null | undefined
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
    // A restored run's fallback context is not displayed as a hand-off overlay.
    // Track its lifecycle separately so the first autosave keeps it, while an
    // explicit start-new-run transition to null clears the old context.
    if (this.observedRestorationBundle !== state.restorationBundle) {
      this.observedRestorationBundle = state.restorationBundle
      this.lastHandoffBundle = state.restorationBundle
    }
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

  private snapshot(state: AppState): PersistedRunRecordV2 {
    const conversations: Record<string, PersistedConversationV2> = {}
    const workspaceConversations: Record<string, PersistedWorkspaceConversationV2> = {}
    const order: string[] = []
    for (const sessionId of state.workspace.order) {
      const session = state.sessions[sessionId]
      const workspaceConversation = state.workspace.conversations[sessionId]
      if (!session || !workspaceConversation) continue
      order.push(sessionId)
      conversations[sessionId] = {
        sessionId,
        providerKind: session.providerKind,
        cwd: session.cwd,
        initialTitle: session.title,
        acpSessionId: session.acpSessionId,
        status: session.status,
        messageCount: session.turns.length,
        lastPrompt: lastUserPrompt(session.turns),
      }
      workspaceConversations[sessionId] = {
        sessionId,
        displayName: workspaceConversation.displayName,
        lifecycle: workspaceConversation.lifecycle,
        createdOrdinal: workspaceConversation.createdOrdinal,
        attention: {
          seen: workspaceConversation.attention.seen,
          sequence: workspaceConversation.attention.sequence,
        },
      }
    }

    const selectedVisibleId = state.workspace.selectedVisibleId
    const selected = selectedVisibleId === null ? undefined : state.sessions[selectedVisibleId]

    return {
      version: 2,
      runId: this.runId,
      // A run belongs to the launch project even when focus moves between sessions
      // configured with different working directories. Boot and the picker use this
      // same key to find it again.
      cwd: this.projectCwd,
      gitBranch: selected?.branch ?? null,
      createdAt: this.createdAt,
      updatedAt: this.now(),
      conversations,
      workspace: {
        conversations: workspaceConversations,
        order,
        selectedVisibleId,
      },
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
