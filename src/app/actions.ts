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
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption, type SessionId } from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"
import { selectNextNeedy } from "../store/selectors.ts"

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

/**
 * The recorder surface actions drive. Switch telemetry is optional so focused action
 * unit tests can keep injecting only the focus counter; the real recorder implements
 * both slices.
 */
export type ActionTelemetry = FocusTelemetry & Partial<SwitchTelemetry>

/** The default when no recorder is injected: record nothing. */
const NOOP_ACTION_TELEMETRY: ActionTelemetry = { focusSwitch() {} }

/** How a focus switch was initiated, so the overview-reliance metric can tell them apart. */
export interface SwitchFocusOptions {
  /** True when the switch came through `/sessions` rather than a direct `/switch`. */
  viaOverview?: boolean
}

/** The seams the actions need. The controller supplies all of them. */
export interface ActionDeps {
  store: AppStore
  /** Resolve a session's live connection, or `undefined` when it has none (not ready). */
  getSession(sessionId: SessionId): AgentSession | undefined
  /** Settle the permission request currently shown in the approval overlay. */
  resolvePermission(outcome: PermissionOutcome): void
  /** Ids for the user turns this surface records. Defaults to a random UUID. */
  newMessageId?: () => string
  /** Where a failing connection is reported. Defaults to swallowing the failure. */
  onError?: (sessionId: SessionId, error: unknown) => void
  /** Schedule an off-render-path branch refresh at focus and turn boundaries. */
  refreshBranch?: (sessionId: SessionId) => void
  /** The telemetry recorder to report navigation and adapter-confirmed switches to. */
  recorder?: ActionTelemetry
  /** Replace every live agent session with a fresh one. */
  startNewRun?: () => Promise<void>
  /** Replace one unavailable restored session with a fresh promptable session. */
  startFreshSession?: (sessionId: SessionId) => Promise<boolean>
}

/** The actions the UI is allowed to call. Nothing else reaches the agents. */
export interface ControllerActions {
  /**
   * Send a prompt to `sessionId` (default: the focused session), recording the user's
   * turn in the transcript first. Resolves with the agent's stop reason, or `null`
   * when nothing was sent (no live session, empty prompt) or the connection failed.
   */
  sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null>
  /** Interrupt the running turn on `sessionId` (default: the focused session). */
  cancel(sessionId?: SessionId): Promise<void>
  /**
   * Change one config option (model, reasoning effort, ...) on `sessionId` (default:
   * the focused session) and store the agent-confirmed full option set (ADR-004). The
   * store is updated only from what the adapter reports back, never optimistically:
   * on a live session it applies the returned set; a no-live-session call is a no-op
   * and a failed switch routes through `onError`, leaving the last confirmed state in
   * place so the overlay can mark the option `unverified`.
   */
  setSessionConfigOption(configId: string, value: string, sessionId?: SessionId): Promise<void>
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
  /** Leave a restored run by replacing every agent session with a fresh one. */
  startNewRun(): Promise<void>
  /** Start one fresh agent session and seed it with persisted context. */
  startFreshFromContext(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null>
  /** Answer the pending permission request with the user's decision. */
  respondPermission(outcome: PermissionOutcome): void
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
  const startNewRun = deps.startNewRun ?? (async () => {})
  const startFreshSession = deps.startFreshSession ?? (async () => false)

  const focused = (): SessionId => store.getState().focusedSessionId

  async function sendPrompt(
    input: PromptInput,
    sessionId: SessionId = focused(),
  ): Promise<PromptResult | null> {
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

  return {
    sendPrompt,

    async cancel(sessionId = focused()): Promise<void> {
      const session = getSession(sessionId)
      if (!session) return
      try {
        await session.connection.cancel(session.acpSessionId)
      } catch (error) {
        onError(sessionId, error)
      }
    },

    async setSessionConfigOption(configId, value, sessionId = focused()): Promise<void> {
      const session = getSession(sessionId)
      if (!session) return
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
        }
      } catch (error) {
        // A failed request has no adapter-confirmed value. It is therefore unverified,
        // never counted as confirmed from the developer's requested value alone.
        const kind = switchKind(previous)
        if (kind) recorder.recordSwitch?.(sessionId, kind, false, false)
        onError(sessionId, error)
      }
    },

    switchFocus(sessionId = nextSessionId(store.getState().order, focused()), options?: SwitchFocusOptions): void {
      const before = store.getState().focusedSessionId
      store.setFocus(sessionId)
      const after = store.getState().focusedSessionId
      // Only a switch that actually moved focus is a real navigation to count.
      if (after !== before) {
        recorder.focusSwitch(after, options?.viaOverview === true)
        refreshBranch(after)
      }
    },

    jumpToNextNeedy(): void {
      const target = selectNextNeedy(focused())(store.getState())
      if (!target) return
      store.setFocus(target)
      // Jump-to-next is reachable only from the overview, so it is always overview-driven.
      recorder.focusSwitch(target, true)
      refreshBranch(target)
    },

    async startNewRun(): Promise<void> {
      try {
        await startNewRun()
      } catch (error) {
        onError(focused(), error)
      }
    },

    async startFreshFromContext(input, sessionId = focused()): Promise<PromptResult | null> {
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
