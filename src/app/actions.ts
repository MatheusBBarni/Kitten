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
import type { SessionId } from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"

/** What a caller may send: raw text, or already-composed prompt blocks (hand-off). */
export type PromptInput = string | PromptBlock[]

/** One session's live ACP connection: the connection to drive and the ACP id to drive it on. */
export interface AgentSession {
  readonly sessionId: SessionId
  readonly acpSessionId: string
  readonly connection: AgentConnection
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
  /** Focus `sessionId`, or cycle to the next session when omitted. Sessions stay live. */
  switchFocus(sessionId?: SessionId): void
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

  const focused = (): SessionId => store.getState().focusedSessionId

  return {
    async sendPrompt(input, sessionId = focused()): Promise<PromptResult | null> {
      const session = getSession(sessionId)
      if (!session) return null
      const blocks = composePromptBlocks(input)
      if (blocks.length === 0) return null

      // ACP never echoes the user's prompt back as a session update, so the
      // transcript only shows this turn if the controller records it.
      store.applyEvent(sessionId, { kind: "user_message", messageId: newMessageId(), text: joinBlocks(blocks) })
      try {
        return await session.connection.prompt(session.acpSessionId, blocks)
      } catch (error) {
        onError(sessionId, error)
        return null
      }
    },

    async cancel(sessionId = focused()): Promise<void> {
      const session = getSession(sessionId)
      if (!session) return
      try {
        await session.connection.cancel(session.acpSessionId)
      } catch (error) {
        onError(sessionId, error)
      }
    },

    switchFocus(sessionId = nextSessionId(store.getState().order, focused())): void {
      store.setFocus(sessionId)
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
