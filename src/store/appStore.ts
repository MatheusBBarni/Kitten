/**
 * The reactive application store.
 *
 * Kitten keeps all mutable UI-facing state in one external store with targeted
 * subscriptions (ADR-004). React never owns this state: components read it through
 * narrow selectors (see `./selectors.ts`) and re-render only when the exact slice
 * they read changes. That is what keeps a streaming token from re-rendering the
 * whole transcript.
 *
 * The store sits above the pure core and below the UI (ADR-003):
 *
 * - It never writes a `SessionState` by hand. Every domain event is applied by the
 *   core `sessionReducer`, which stays the single writer of session state.
 * - It performs no batching. The Agent Adapter Layer already coalesces streamed
 *   message chunks to at most one `DomainSessionEvent` per frame, so `applyEvent`
 *   applies its event synchronously and notifies subscribers immediately.
 * - It imports no ACP wire type. `PermissionRequest` is the adapter's already
 *   translated, protocol-free view of a permission prompt, imported type-only.
 *
 * State is immutable throughout: every action produces a new `AppState` with
 * structural sharing, so an untouched agent's slice keeps its identity and its
 * subscribers stay silent.
 */

import type { PermissionRequest } from "../agent/agentConnection.ts"
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import { createShellState, shellReducer } from "../core/shellReducer.ts"
import {
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_KINDS,
  type ConfigOption,
  type DomainSessionEvent,
  type HandoffBundle,
  type ProviderKind,
  type SessionId,
  type SessionSeed,
  type SessionState,
  type ShellEvent,
  type ShellState,
  type ThemePreference,
} from "../core/types.ts"

/** Every provider kind Kitten seeds a default session for, in cockpit order (ADR-001). */
export const AGENT_IDS: readonly ProviderKind[] = PROVIDER_KINDS

/** Releases a subscription. Calling it more than once is a no-op. */
export type Unsubscribe = () => void

/**
 * The approval overlay slot: one session's pending permission request, labeled with
 * the session it belongs to. `title` and `cwd` name the requesting session and its
 * working directory so a multi-session approval can never be answered for the wrong
 * agent (the labeling UI is task_07).
 */
export interface ApprovalOverlay {
  sessionId: SessionId
  title: string
  cwd: string
  request: PermissionRequest
}

/** The hand-off preview slot: the bundle awaiting the user's curation and confirm. */
export interface HandoffPreviewOverlay {
  sourceSessionId: SessionId
  targetSessionId: SessionId
  bundle: HandoffBundle
  /** The target's allowlisted model/effort options when the preview opened. */
  targetConfigOptions: ConfigOption[]
}

/**
 * The hand-off target-picker slot: the source session while the developer chooses
 * which session receives the hand-off (task_06). It carries no target of its own -
 * the picker draws its candidate list from {@link SessionState} and readiness - and
 * exists only while there is a genuine choice to make (three or more ready sessions).
 * With a single possible recipient the flow skips this step and opens the preview
 * directly, keeping the two-agent hand-off one keystroke.
 */
export interface HandoffTargetOverlay {
  sourceSessionId: SessionId
}

/**
 * The model/effort selector slot: the session whose model and reasoning effort the
 * developer is choosing (ADR-004). It carries no options of its own - the overlay
 * draws its list from that session's {@link SessionState.configOptions} through
 * {@link visibleConfigOptions}, always rendering the agent-confirmed state - so the
 * slot need only name which session the picker is open for.
 */
export interface ModelSelectOverlay {
  sessionId: SessionId
}

/** The V1 settings modal state. Future categories add tabs here. */
export interface SettingsOverlay {
  tab: "theme"
}

/** Reactive user preferences that views can subscribe to independently of sessions. */
export interface Preferences {
  theme: ThemePreference
}

/** Whether a restored session is promptable or only its saved context remains. */
export type RestorationMode = "live" | "unavailable"

/** The pane that currently owns keyboard input (ADR-005). */
export type FocusedPane = { kind: "agent"; agentId: SessionId } | { kind: "shell" }

/**
 * The overlay slots. At most one overlay of each kind exists at a time; the UI
 * (tasks 11 and 12) decides how to stack them. `null` means "closed".
 *
 * `sessions` and `sessionPicker` are plain booleans rather than payload slots: each
 * overlay draws its data from a separate source, so its slot need only say whether
 * it is open.
 */
export interface OverlayState {
  approval: ApprovalOverlay | null
  handoffPreview: HandoffPreviewOverlay | null
  /** The hand-off target picker, open only while the developer is choosing a recipient. */
  handoffTarget: HandoffTargetOverlay | null
  /** The model/effort selector, open only while the developer is choosing a model or effort. */
  modelSelect: ModelSelectOverlay | null
  /** The settings modal, open on its active settings tab. */
  settings: SettingsOverlay | null
  sessions: boolean
  /** The resumable-session picker carries no payload; it reads runs from the run store. */
  sessionPicker: boolean
}

/**
 * The whole application state.
 *
 * Sessions are keyed by their Kitten {@link SessionId}, with an explicit `order`
 * array fixing display order (ADR-004): a plain object plus an order array, not a
 * `Map`, so the store keeps its immutable structural-sharing and `Object.is`
 * selector-equality invariants. Two sessions may share a provider kind; each has a
 * distinct id. Per-session status lives in `sessions[id].status`, written by the
 * reducer, so the status strip and the transcript can never disagree. Read it with
 * the `selectSessionStatus` selector.
 */
export interface AppState {
  sessions: Record<SessionId, SessionState>
  /** The session ids in stable display order. */
  order: SessionId[]
  /** The active conversation, retained while the shell owns keyboard focus. */
  focusedSessionId: SessionId
  focusedPane: FocusedPane
  shell: ShellState
  preferences: Preferences
  overlays: OverlayState
  restoration: Record<SessionId, RestorationMode | null>
  /** The persisted hand-off context for the currently restored cockpit run. */
  restorationBundle: HandoffBundle | null
}

/** A function projecting a narrow slice out of the state, for `subscribeSelector`. */
export type Selector<T> = (state: AppState) => T

/** The store's public surface: reads, subscriptions, and actions. */
export interface AppStore {
  /** The current state. Always a fresh object when anything changed. */
  getState(): AppState
  /** Subscribe to every state change. Prefer {@link subscribeSelector}. */
  subscribe(listener: (state: AppState, previous: AppState) => void): Unsubscribe
  /**
   * Subscribe to one narrow slice. The listener runs only when the selected value
   * changes under `isEqual` (default `Object.is`), so a token appended to agent A's
   * transcript never notifies a subscriber reading agent B's status.
   */
  subscribeSelector<T>(
    selector: Selector<T>,
    listener: (value: T, previous: T) => void,
    isEqual?: (a: T, b: T) => boolean,
  ): Unsubscribe

  /** Apply one already-coalesced domain event to that session's slice. */
  applyEvent(sessionId: SessionId, event: DomainSessionEvent): void
  /** Apply one semantic shell event through the pure shell reducer. */
  applyShellEvent(event: ShellEvent): void
  /** Bind a session to a (new) ACP session id, resetting its transcript and status. */
  startSession(sessionId: SessionId, acpSessionId: string): void
  /** Move keyboard focus to a session. Focusing the focused session is a no-op. */
  setFocus(sessionId: SessionId): void
  /** Move keyboard focus to an agent or the shell. Reapplying the same pane is a no-op. */
  setFocusedPane(pane: FocusedPane): void

  /** Open the approval overlay for a pending permission request. */
  openApproval(overlay: ApprovalOverlay): void
  /** Clear the approval slot. Closing a closed slot is a no-op. */
  closeApproval(): void
  /** Open the hand-off preview overlay for the assembled bundle. */
  openHandoffPreview(overlay: HandoffPreviewOverlay): void
  /** Clear the hand-off preview slot. Closing a closed slot is a no-op. */
  closeHandoffPreview(): void
  /** Open the hand-off target picker for the source session. */
  openHandoffTarget(overlay: HandoffTargetOverlay): void
  /** Clear the hand-off target-picker slot. Closing a closed slot is a no-op. */
  closeHandoffTarget(): void
  /** Open the model/effort selector for the given session. */
  openModelSelect(overlay: ModelSelectOverlay): void
  /** Clear the model/effort selector slot. Closing a closed slot is a no-op. */
  closeModelSelect(): void
  /** Open the settings modal on its requested tab (Theme in V1). */
  openSettings(overlay?: SettingsOverlay): void
  /** Clear the settings slot. Closing a closed slot is a no-op. */
  closeSettings(): void
  /** Open the Ctrl+S sessions overview. Opening an open overview is a no-op. */
  openSessions(): void
  /** Close the sessions overview. Closing a closed overview is a no-op. */
  closeSessions(): void
  /** Open the resumable-session picker. Opening an open picker is a no-op. */
  openSessionPicker(): void
  /** Close the resumable-session picker. Closing a closed picker is a no-op. */
  closeSessionPicker(): void
  /** Set one session's restoration status without changing its transcript. */
  setRestoration(sessionId: SessionId, mode: RestorationMode | null): void
  /** Replace the persisted context exposed by degraded restored panes. */
  setRestorationBundle(bundle: HandoffBundle | null): void
  /** Change the reactive theme preference. Reapplying the current value is a no-op. */
  setThemePreference(theme: ThemePreference): void
}

/** Construction options. Defaults to one seeded session per provider kind. */
export interface AppStoreOptions {
  /**
   * The sessions to seed, in display order. Defaults to one per provider kind in the
   * process working directory (today's two-session boot).
   */
  seeds?: SessionSeed[]
  /** Which session holds focus at startup. Defaults to the first seeded session. */
  focusedSessionId?: SessionId
  /** Reactive user-preference seed. Defaults to following the terminal theme. */
  preferences?: Preferences
}

/** Create an {@link AppStore} holding one empty session slice per seed. */
export function createAppStore(options: AppStoreOptions = {}): AppStore {
  return new AppStoreImpl(options)
}

class AppStoreImpl implements AppStore {
  private state: AppState
  private readonly listeners = new Set<(state: AppState, previous: AppState) => void>()

  constructor(options: AppStoreOptions) {
    const seeds = options.seeds ?? defaultSessionSeeds()
    const sessions = {} as Record<SessionId, SessionState>
    const restoration = {} as Record<SessionId, RestorationMode | null>
    const order: SessionId[] = []
    for (const seed of seeds) {
      sessions[seed.id] = createSessionState(seed)
      restoration[seed.id] = null
      order.push(seed.id)
    }
    this.state = {
      sessions,
      order,
      focusedSessionId: options.focusedSessionId ?? order[0]!,
      focusedPane: { kind: "agent", agentId: options.focusedSessionId ?? order[0]! },
      shell: createShellState(),
      preferences: { theme: options.preferences?.theme ?? "auto" },
      overlays: {
        approval: null,
        handoffPreview: null,
        handoffTarget: null,
        modelSelect: null,
        settings: null,
        sessions: false,
        sessionPicker: false,
      },
      restoration,
      restorationBundle: null,
    }
  }

  getState(): AppState {
    return this.state
  }

  subscribe(listener: (state: AppState, previous: AppState) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  subscribeSelector<T>(
    selector: Selector<T>,
    listener: (value: T, previous: T) => void,
    isEqual: (a: T, b: T) => boolean = Object.is,
  ): Unsubscribe {
    let current = selector(this.state)
    return this.subscribe((state) => {
      const next = selector(state)
      if (isEqual(current, next)) return
      const previous = current
      current = next
      listener(next, previous)
    })
  }

  applyEvent(sessionId: SessionId, event: DomainSessionEvent): void {
    const session = this.state.sessions[sessionId]
    if (!session) return
    const next = sessionReducer(session, event)
    if (next === session) return
    this.commit({ ...this.state, sessions: { ...this.state.sessions, [sessionId]: next } })
  }

  applyShellEvent(event: ShellEvent): void {
    const next = shellReducer(this.state.shell, event)
    if (next === this.state.shell) return
    this.commit({ ...this.state, shell: next })
  }

  startSession(sessionId: SessionId, acpSessionId: string): void {
    const existing = this.state.sessions[sessionId]
    if (!existing) return
    // Reset the transcript and bind the ACP id, but keep the session's identity
    // (provider kind, title, cwd, task) fixed at seed time.
    const fresh = createSessionState({
      id: existing.id,
      providerKind: existing.providerKind,
      title: existing.title,
      cwd: existing.cwd,
      task: existing.task,
      acpSessionId,
    })
    this.commit({ ...this.state, sessions: { ...this.state.sessions, [sessionId]: fresh } })
  }

  setFocus(sessionId: SessionId): void {
    this.setFocusedPane({ kind: "agent", agentId: sessionId })
  }

  setFocusedPane(pane: FocusedPane): void {
    if (pane.kind === "agent" && !this.state.sessions[pane.agentId]) return
    const current = this.state.focusedPane
    if (current.kind === "shell" && pane.kind === "shell") return
    if (current.kind === "agent" && pane.kind === "agent" && current.agentId === pane.agentId) return
    this.commit({
      ...this.state,
      focusedSessionId: pane.kind === "agent" ? pane.agentId : this.state.focusedSessionId,
      focusedPane: pane,
    })
  }

  openApproval(overlay: ApprovalOverlay): void {
    this.setOverlays({ approval: overlay })
  }

  closeApproval(): void {
    if (this.state.overlays.approval === null) return
    this.setOverlays({ approval: null })
  }

  openHandoffPreview(overlay: HandoffPreviewOverlay): void {
    this.setOverlays({ handoffPreview: overlay })
  }

  closeHandoffPreview(): void {
    if (this.state.overlays.handoffPreview === null) return
    this.setOverlays({ handoffPreview: null })
  }

  openHandoffTarget(overlay: HandoffTargetOverlay): void {
    this.setOverlays({ handoffTarget: overlay })
  }

  closeHandoffTarget(): void {
    if (this.state.overlays.handoffTarget === null) return
    this.setOverlays({ handoffTarget: null })
  }

  openModelSelect(overlay: ModelSelectOverlay): void {
    this.setOverlays({ modelSelect: overlay })
  }

  closeModelSelect(): void {
    if (this.state.overlays.modelSelect === null) return
    this.setOverlays({ modelSelect: null })
  }

  openSettings(overlay: SettingsOverlay = { tab: "theme" }): void {
    this.setOverlays({ settings: overlay })
  }

  closeSettings(): void {
    if (this.state.overlays.settings === null) return
    this.setOverlays({ settings: null })
  }

  openSessions(): void {
    if (this.state.overlays.sessions) return
    this.setOverlays({ sessions: true })
  }

  closeSessions(): void {
    if (!this.state.overlays.sessions) return
    this.setOverlays({ sessions: false })
  }

  openSessionPicker(): void {
    if (this.state.overlays.sessionPicker) return
    this.setOverlays({ sessionPicker: true })
  }

  closeSessionPicker(): void {
    if (!this.state.overlays.sessionPicker) return
    this.setOverlays({ sessionPicker: false })
  }

  setRestoration(sessionId: SessionId, mode: RestorationMode | null): void {
    if (!this.state.sessions[sessionId] || this.state.restoration[sessionId] === mode) return
    this.commit({
      ...this.state,
      restoration: { ...this.state.restoration, [sessionId]: mode },
    })
  }

  setRestorationBundle(bundle: HandoffBundle | null): void {
    if (this.state.restorationBundle === bundle) return
    this.commit({ ...this.state, restorationBundle: bundle })
  }

  setThemePreference(theme: ThemePreference): void {
    if (this.state.preferences.theme === theme) return
    this.commit({ ...this.state, preferences: { ...this.state.preferences, theme } })
  }

  /** Replace one or both overlay slots, leaving the rest of the state identical. */
  private setOverlays(patch: Partial<OverlayState>): void {
    this.commit({ ...this.state, overlays: { ...this.state.overlays, ...patch } })
  }

  /**
   * Publish a new state. Listeners are notified from a snapshot of the set, so a
   * listener that unsubscribes (or subscribes) during notification cannot disturb
   * the current pass.
   */
  private commit(next: AppState): void {
    if (next === this.state) return
    const previous = this.state
    this.state = next
    for (const listener of [...this.listeners]) {
      listener(next, previous)
    }
  }
}

/**
 * The default seed fleet: one session per provider kind in the process working
 * directory, titled by the provider display name. Each session's {@link SessionId}
 * is seeded equal to its provider kind, which is unambiguous while there is exactly
 * one session per provider; the config-driven sessions list (task_02) assigns
 * distinct ids for repeated providers without any change here.
 */
export function defaultSessionSeeds(cwd: string = process.cwd()): SessionSeed[] {
  return AGENT_IDS.map((providerKind) => ({
    id: providerKind,
    providerKind,
    title: PROVIDER_DISPLAY_NAMES[providerKind],
    cwd,
  }))
}
