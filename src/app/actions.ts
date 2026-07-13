/**
 * The action surface the UI calls.
 *
 * Every user intent - send a prompt, interrupt the agent, move focus, answer a
 * permission request - passes through here, so no view ever touches an
 * `AgentConnection` or writes session state by hand (ADR-003). The actions read
 * the focused agent from the store, resolve it to a live ACP session through an
 * injected lookup, and drive that agent's connection.
 *
 * Every action degrades rather than throws. An agent whose connection never came
 * up has no session, so `sendPrompt`/`cancel` on it are no-ops; a connection that
 * fails mid-call reports through `onError` and leaves the other agent untouched.
 * A UI callback fired from a keypress must never reject into the React tree.
 */

import type { AgentConnection, PermissionOutcome, PromptBlock, PromptResult } from "../agent/agentConnection.ts"
import {
  selectPromptHistory,
  type PromptHistoryDirection,
  type PromptHistorySelection,
} from "../core/promptHistory.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ClarificationOutcome, type ConfigOption, type SessionId } from "../core/types.ts"
import { visibleConversationIds } from "../core/workspace.ts"
import type { AppStore } from "../store/appStore.ts"
import { selectNextNeedy } from "../store/selectors.ts"
import type { RepositoryFileList, RepositoryFileSource } from "./fileDiscovery.ts"

/** What a caller may send: raw text, or already-composed prompt blocks (hand-off). */
export type PromptInput = string | PromptBlock[]

/** One session's live ACP connection: the connection to drive and the ACP id to drive it on. */
export interface AgentSession {
  readonly sessionId: SessionId
  readonly acpSessionId: string
  readonly connection: AgentConnection
}

/**
 * The narrow slice of the telemetry recorder the actions drive: a focus switch, tagged
 * with whether it came through the `/sessions` overview (task_09). Declared here rather than
 * imported so the action surface depends only on what it calls; the full recorder
 * satisfies it structurally.
 */
export interface FocusTelemetry {
  focusSwitch(sessionId: SessionId, viaOverview: boolean): void
}

/** The switch-outcome slice of telemetry the action surface can report. */
export interface SwitchTelemetry {
  recordSwitch(sessionId: SessionId, kind: "model" | "effort", confirmed: boolean, effortChanged: boolean): void
}

/** Content-free prompt-history outcomes emitted by composer-only actions. */
export interface PromptHistoryTelemetry {
  /** Count one accepted composer submission; the recorder emits eligibility at two. */
  promptHistorySubmitted(sessionId: SessionId): void
  /** A history navigation selected an entry for the composer. */
  promptHistoryRecalled(sessionId: SessionId): void
  /** Down navigation left the newest recalled entry and cleared the composer. */
  promptHistoryCleared(sessionId: SessionId): void
  /** A recalled entry was changed before its next accepted composer submission. */
  promptHistoryEditedResend(sessionId: SessionId): void
}

/** Fixed discovery outcomes allowed through the UI-facing telemetry facade. */
export type FileSelectorDiscoveryOutcome = "ready" | "unavailable"

/** Fixed warm-query render states allowed through the UI-facing telemetry facade. */
export type FileSelectorRenderState = "results" | "empty" | "unavailable"

/** Content-free file-selector facts forwarded to the recorder by controller actions. */
export interface FileSelectorTelemetry {
  fileSelectorOpened(sessionId: SessionId): void
  fileSelectorDiscovery(
    sessionId: SessionId,
    outcome: FileSelectorDiscoveryOutcome,
    durationMs: number,
  ): void
  fileSelectorQueryRendered(
    sessionId: SessionId,
    state: FileSelectorRenderState,
    durationMs: number,
  ): void
  fileSelectorSelected(sessionId: SessionId, durationMs: number): void
  fileSelectorCorrected(sessionId: SessionId): void
}

/**
 * The recorder surface actions drive. Switch telemetry is optional so focused action
 * unit tests can keep injecting only the focus counter; the real recorder implements
 * both slices.
 */
export type ActionTelemetry = FocusTelemetry & Partial<SwitchTelemetry & PromptHistoryTelemetry & FileSelectorTelemetry>

/** The default when no recorder is injected: record nothing. */
const NOOP_ACTION_TELEMETRY: ActionTelemetry = { focusSwitch() {} }

/** How a focus switch was initiated, so the overview-reliance metric can tell them apart. */
export interface SwitchFocusOptions {
  /** True when the switch came through `/sessions` rather than a direct `/switch`. */
  viaOverview?: boolean
}

/** The explicit lifecycle outcome selected by tab-management UI. */
export type CloseChoice = "close" | "background" | "cancel" | "keep-open"

/** Finite close results keep UI callers fail-soft without hiding teardown uncertainty. */
export type CloseConversationResult =
  | { outcome: "closed" }
  | { outcome: "backgrounded" }
  | { outcome: "kept-open" }
  | { outcome: "teardown-failed" }
  | { outcome: "ignored" }

/** The seams the actions need. The controller supplies all of them. */
export interface ActionDeps {
  store: AppStore
  /** Resolve a session's live connection, or `undefined` when it has none (not ready). */
  getSession(sessionId: SessionId): AgentSession | undefined
  /** Settle the permission request currently shown in the approval overlay. */
  resolvePermission(outcome: PermissionOutcome): void
  /** Settle only the active clarification whose stable identity still matches. */
  resolveClarification?: (
    requestId: string,
    generation: number,
    outcome: ClarificationOutcome,
  ) => void
  /** Ids for the user turns this surface records. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Where a failing connection is reported. Defaults to swallowing the failure. */
  onError?: (sessionId: SessionId, error: unknown) => void
  /** Schedule an off-render-path branch refresh at focus and turn boundaries. */
  refreshBranch?: (sessionId: SessionId) => void
  /** The telemetry recorder to report navigation and adapter-confirmed switches to. */
  recorder?: ActionTelemetry
  /** Repository discovery owned and injected by the controller. */
  repositoryFileSource?: RepositoryFileSource
  /** Replace every live agent session with a fresh one. */
  startNewRun?: () => Promise<void>
  /** Replace one unavailable restored session with a fresh promptable session. */
  startFreshSession?: (sessionId: SessionId) => Promise<boolean>
  /** Create and start one controller-owned conversation runtime. */
  createConversation?: () => Promise<SessionId | null>
  /** Apply an explicit close outcome through the controller-owned teardown path. */
  closeConversation?: (sessionId: SessionId, choice: CloseChoice) => Promise<CloseConversationResult>
}

/** The actions the UI is allowed to call. Nothing else reaches the agents. */
export interface ControllerActions {
  /** Create a fresh visible conversation, or return `null` when none can be created. */
  createConversation(): Promise<SessionId | null>
  /** Rename an existing non-Closed conversation after whitespace normalization. */
  renameConversation(sessionId: SessionId, displayName: string): void
  /** Select one Visible conversation. Unknown, Background, and Closed ids are no-ops. */
  selectConversation(sessionId: SessionId, options?: SwitchFocusOptions): void
  /** Move one Visible conversation to background without touching its runtime. */
  backgroundConversation(sessionId: SessionId): void
  /** Reopen and select one Background conversation. */
  reopenConversation(sessionId: SessionId, options?: SwitchFocusOptions): void
  /** Apply an explicit, fail-soft close-policy outcome. */
  closeConversation(sessionId: SessionId, choice: CloseChoice): Promise<CloseConversationResult>
  /** List safe repository-relative files for one explicitly addressed configured session. */
  listRepositoryFiles(sessionId: SessionId): Promise<RepositoryFileList>
  /** Record that a valid file-selector token opened for one addressed session. */
  fileSelectorOpened(sessionId: SessionId): void
  /** Record a fixed discovery outcome and caller-owned duration. */
  fileSelectorDiscovery(
    sessionId: SessionId,
    outcome: FileSelectorDiscoveryOutcome,
    durationMs: number,
  ): void
  /** Record one fixed warm-query render state and caller-owned duration. */
  fileSelectorQueryRendered(
    sessionId: SessionId,
    state: FileSelectorRenderState,
    durationMs: number,
  ): void
  /** Record acceptance and the caller-owned open-to-selection duration. */
  fileSelectorSelected(sessionId: SessionId, durationMs: number): void
  /** Record that one pending accepted reference was corrected before submission. */
  fileSelectorCorrected(sessionId: SessionId): void
  /**
   * Send a prompt to `sessionId` (default: the focused session), recording the user's
   * turn in the transcript first. Resolves with the agent's stop reason, or `null`
   * when nothing was sent (no live session, empty prompt) or the connection failed.
   */
  sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null>
  /** Record one accepted plain-composer submission in the addressed session. */
  recordPromptHistory(text: string, sessionId?: SessionId): void
  /** Navigate the addressed session's history and return the post-reducer selection. */
  navigatePromptHistory(direction: PromptHistoryDirection, sessionId?: SessionId): PromptHistorySelection
  /** Interrupt the running turn on `sessionId` (default: the focused session). */
  cancel(sessionId?: SessionId): Promise<void>
  /**
   * Change one config option (model, reasoning effort, ...) on `sessionId` (default:
   * the focused session) and store the agent-confirmed full option set (ADR-004). The
   * store is updated only from what the adapter reports back, never optimistically:
   * on a live session it applies the returned set; a no-live-session call is a no-op
   * and a failed switch routes through `onError`, leaving the last confirmed state in
   * place so the overlay can mark the option `unverified`. Resolves `true` only when
   * the agent reports the requested value back.
   */
  setSessionConfigOption(configId: string, value: string, sessionId?: SessionId): Promise<boolean>
  /**
   * Focus `sessionId`, or cycle to the next session when omitted. Sessions stay live.
   * `options.viaOverview` records the switch as one made through the `/sessions` overview
   * (task_09); the default is a blind cycle.
   */
  switchFocus(sessionId?: SessionId, options?: SwitchFocusOptions): void
  /**
   * Move focus to the next session that needs the developer (ADR-006), ranked
   * `awaiting_approval` before `error` before `finished` and walking `order` forward
   * from the focused session. A no-op when no other session needs attention.
   */
  jumpToNextNeedy(): void
  /** Reopen/select the next eligible attention conversation, including background work. */
  jumpToNextAttention(): void
  /** Leave a restored run by replacing every agent session with a fresh one. */
  startNewRun(): Promise<void>
  /** Start one fresh agent session and seed it with persisted context. */
  startFreshFromContext(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null>
  /** Answer the pending permission request with the user's decision. */
  respondPermission(outcome: PermissionOutcome): void
  /** Answer or cancel only the matching active clarification request. */
  respondClarification(
    requestId: string,
    generation: number,
    outcome: ClarificationOutcome,
  ): void
}

/**
 * Normalize a prompt into ACP text blocks, dropping a prompt with no content so a
 * stray Enter cannot start an empty turn. Pre-composed blocks pass through, minus
 * any empty ones.
 */
export function composePromptBlocks(input: PromptInput): PromptBlock[] {
  const blocks = typeof input === "string" ? [{ type: "text" as const, text: input }] : input
  return blocks.filter((block) => block.text.trim().length > 0)
}

/** Build the action surface over one store and one agent-session lookup. */
export function createControllerActions(deps: ActionDeps): ControllerActions {
  const { store, getSession } = deps
  const newMessageId = deps.newMessageId ?? (() => crypto.randomUUID())
  const onError = deps.onError ?? (() => {})
  const refreshBranch = deps.refreshBranch ?? (() => {})
  const recorder = deps.recorder ?? NOOP_ACTION_TELEMETRY
  const repositoryFileSource = deps.repositoryFileSource
  const startNewRun = deps.startNewRun ?? (async () => {})
  const startFreshSession = deps.startFreshSession ?? (async () => false)
  const createConversation = deps.createConversation ?? (async () => null)
  const closeConversation = deps.closeConversation ?? (async () => ({ outcome: "ignored" as const }))

  const focused = (): SessionId | undefined =>
    store.getState().workspace.selectedVisibleId ?? undefined

  async function sendPrompt(
    input: PromptInput,
    requestedSessionId?: SessionId,
  ): Promise<PromptResult | null> {
    const sessionId = requestedSessionId ?? focused()
    if (!sessionId) return null
    const session = getSession(sessionId)
    if (!session) return null
    const blocks = composePromptBlocks(input)
    if (blocks.length === 0) return null

    // ACP never echoes the user's prompt back as a session update, so the
    // transcript only shows this turn if the controller records it.
    store.applyEvent(sessionId, {
      kind: "user_message",
      messageId: newMessageId(),
      text: joinBlocks(blocks),
    })
    try {
      return await session.connection.prompt(session.acpSessionId, blocks)
    } catch (error) {
      onError(sessionId, error)
      return null
    } finally {
      // A settled prompt is the turn boundary. The injected refresh schedules its
      // own async work, so the prompt result never waits on git.
      refreshBranch(sessionId)
    }
  }

  function selectConversation(sessionId: SessionId, options?: SwitchFocusOptions): void {
    const before = store.getState().workspace.selectedVisibleId
    store.selectConversation(sessionId)
    const after = store.getState().workspace.selectedVisibleId
    if (after !== before && after !== null) {
      recorder.focusSwitch(after, options?.viaOverview === true)
      refreshBranch(after)
    }
  }

  function reopenConversation(sessionId: SessionId, options?: SwitchFocusOptions): void {
    const before = store.getState().workspace.selectedVisibleId
    store.reopenConversation(sessionId)
    const after = store.getState().workspace.selectedVisibleId
    if (after !== before && after === sessionId) {
      recorder.focusSwitch(after, options?.viaOverview === true)
      refreshBranch(after)
    }
  }

  function jumpToNextAttention(): void {
    const target = selectNextNeedy(focused() ?? null)(store.getState())
    if (!target) return
    const lifecycle = store.getState().workspace.conversations[target]?.lifecycle
    if (lifecycle === "background") reopenConversation(target, { viaOverview: true })
    else selectConversation(target, { viaOverview: true })
  }

  function recordComposerPrompt(text: string, requestedSessionId?: SessionId): void {
    const sessionId = requestedSessionId ?? focused()
    const history = sessionId ? store.getState().sessions[sessionId]?.promptHistory : undefined
    if (!sessionId || text.trim().length === 0 || !history) return

    // Compare inside the action layer while the reducer still owns the active cursor.
    // Prompt text remains in session memory and never crosses the recorder boundary.
    const recalled = history.cursor === null ? undefined : history.entries[history.cursor]
    if (recalled !== undefined && recalled !== text) recorder.promptHistoryEditedResend?.(sessionId)

    store.applyEvent(sessionId, { kind: "prompt_history", action: "record", text })
    recorder.promptHistorySubmitted?.(sessionId)
  }

  function navigateComposerHistory(
    direction: PromptHistoryDirection,
    requestedSessionId?: SessionId,
  ): PromptHistorySelection {
    const sessionId = requestedSessionId ?? focused()
    if (!sessionId) return { text: null, historyIndex: null, total: 0 }
    const before = store.getState().sessions[sessionId]?.promptHistory
    if (!before) return { text: null, historyIndex: null, total: 0 }

    store.applyEvent(sessionId, { kind: "prompt_history", action: direction })
    const after = store.getState().sessions[sessionId]!.promptHistory

    if (direction === "next" && before.cursor === null) {
      return { text: null, historyIndex: null, total: after.entries.length }
    }
    if (direction === "next" && before.cursor === before.entries.length - 1 && after.cursor === null) {
      recorder.promptHistoryCleared?.(sessionId)
      return { text: "", historyIndex: null, total: after.entries.length }
    }

    const selection = selectPromptHistory(after)
    if (selection.text !== null) recorder.promptHistoryRecalled?.(sessionId)
    return selection
  }

  return {
    async createConversation(): Promise<SessionId | null> {
      try {
        return await createConversation()
      } catch {
        return null
      }
    },

    renameConversation(sessionId, displayName): void {
      store.renameConversation(sessionId, displayName)
    },

    selectConversation,

    backgroundConversation(sessionId): void {
      store.backgroundConversation(sessionId)
    },

    reopenConversation,

    async closeConversation(sessionId, choice): Promise<CloseConversationResult> {
      try {
        return await closeConversation(sessionId, choice)
      } catch (error) {
        onError(sessionId, error)
        return { outcome: "teardown-failed" }
      }
    },

    async listRepositoryFiles(sessionId): Promise<RepositoryFileList> {
      // Capture from configured session state before awaiting. Live ACP lookup and
      // current focus are deliberately irrelevant to repository discovery.
      const cwd = store.getState().sessions[sessionId]?.cwd
      if (!cwd) return { kind: "unavailable", reason: "unknown_session" }
      if (!repositoryFileSource) return { kind: "unavailable", reason: "discovery_failed" }
      try {
        return await repositoryFileSource.list(cwd)
      } catch {
        return { kind: "unavailable", reason: "discovery_failed" }
      }
    },

    fileSelectorOpened(sessionId): void {
      recorder.fileSelectorOpened?.(sessionId)
    },

    fileSelectorDiscovery(sessionId, outcome, durationMs): void {
      recorder.fileSelectorDiscovery?.(sessionId, outcome, durationMs)
    },

    fileSelectorQueryRendered(sessionId, state, durationMs): void {
      recorder.fileSelectorQueryRendered?.(sessionId, state, durationMs)
    },

    fileSelectorSelected(sessionId, durationMs): void {
      recorder.fileSelectorSelected?.(sessionId, durationMs)
    },

    fileSelectorCorrected(sessionId): void {
      recorder.fileSelectorCorrected?.(sessionId)
    },

    sendPrompt,

    recordPromptHistory: recordComposerPrompt,

    navigatePromptHistory: navigateComposerHistory,

    async cancel(requestedSessionId?: SessionId): Promise<void> {
      const sessionId = requestedSessionId ?? focused()
      if (!sessionId) return
      const session = getSession(sessionId)
      if (!session) return
      try {
        await session.connection.cancel(session.acpSessionId)
      } catch (error) {
        onError(sessionId, error)
      }
    },

    async setSessionConfigOption(configId, value, requestedSessionId?: SessionId): Promise<boolean> {
      const sessionId = requestedSessionId ?? focused()
      if (!sessionId) return false
      const session = getSession(sessionId)
      if (!session) return false
      // Keep the pre-call option only long enough to identify the allowlisted category
      // and whether an effort value actually changed. Neither value reaches telemetry.
      const previous = store.getState().sessions[sessionId]?.configOptions.find((option) => option.id === configId)
      try {
        // The agent echoes the full refreshed option set; apply that confirmed state
        // (never the requested value) so the store reflects only what the agent reports.
        const options = await session.connection.setSessionConfigOption(session.acpSessionId, configId, value)
        const reported = options.find((option) => option.id === configId)
        const kind = switchKind(reported ?? previous)
        // Store first so the recorder's watcher establishes the adapter-confirmed value
        // as its baseline before an effort-retention window is armed below.
        store.applyEvent(sessionId, { kind: "config_options", options })
        if (kind) {
          const confirmed = reported?.currentValue === value
          recorder.recordSwitch?.(
            sessionId,
            kind,
            confirmed,
            kind === "effort" && confirmed && reported?.currentValue !== previous?.currentValue,
          )
          return confirmed
        }
        return reported?.currentValue === value
      } catch (error) {
        // A failed request has no adapter-confirmed value. It is therefore unverified,
        // never counted as confirmed from the developer's requested value alone.
        const kind = switchKind(previous)
        if (kind) recorder.recordSwitch?.(sessionId, kind, false, false)
        onError(sessionId, error)
        return false
      }
    },

    switchFocus(sessionId, options?: SwitchFocusOptions): void {
      const currentState = store.getState()
      const current = currentState.workspace.selectedVisibleId
      const visible = visibleConversationIds(currentState.workspace)
      const target =
        sessionId ??
        (current
          ? nextSessionId(visible, current)
          : visible[0])
      if (!target) return
      selectConversation(target, options)
    },

    jumpToNextNeedy(): void {
      jumpToNextAttention()
    },

    jumpToNextAttention,

    async startNewRun(): Promise<void> {
      try {
        await startNewRun()
      } catch (error) {
        const sessionId = focused()
        if (sessionId) onError(sessionId, error)
      }
    },

    async startFreshFromContext(input, requestedSessionId?: SessionId): Promise<PromptResult | null> {
      const sessionId = requestedSessionId ?? focused()
      if (!sessionId) return null
      const blocks = composePromptBlocks(input)
      if (blocks.length === 0) return null
      try {
        if (!(await startFreshSession(sessionId))) return null
      } catch (error) {
        onError(sessionId, error)
        return null
      }
      return sendPrompt(blocks, sessionId)
    },

    respondPermission(outcome: PermissionOutcome): void {
      deps.resolvePermission(outcome)
    },

    respondClarification(requestId, generation, outcome): void {
      try {
        deps.resolveClarification?.(requestId, generation, outcome)
      } catch {
        // UI callbacks are fail-soft; a stale or failed resolver never escapes the view.
      }
    },
  }
}

/** The next session in display order, wrapping around. */
export function nextSessionId(order: readonly SessionId[], current: SessionId): SessionId {
  if (order.length === 0) return current
  const index = order.indexOf(current)
  return order[(index + 1) % order.length]!
}

/** The transcript text for a multi-block prompt: one block per line. */
function joinBlocks(blocks: PromptBlock[]): string {
  return blocks.map((block) => block.text).join("\n")
}

/** Map only the two allowlisted config categories to their content-free metric kind. */
function switchKind(option: ConfigOption | undefined): "model" | "effort" | undefined {
  if (option?.category === MODEL_CATEGORY) return "model"
  if (option?.category === EFFORT_CATEGORY) return "effort"
  return undefined
}
