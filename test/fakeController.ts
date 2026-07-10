/**
 * A `SessionController` double for the UI tests.
 *
 * The views only ever see `store`, `runtimes()`, and `actions`, so a fake that keeps
 * a real `AppStore` and records the action calls exercises exactly the surface a view
 * touches - without spawning an agent subprocess or opening an ACP session.
 *
 * `switchFocus` really moves focus in the store, and `respondPermission` really closes
 * the approval slot, so a test can assert both that the action fired and that the view
 * repainted because of it.
 */

import type { PermissionOutcome, PromptResult } from "../src/agent/agentConnection.ts"
import { nextSessionId, type PromptInput } from "../src/app/actions.ts"
import type { AgentRuntimeState, SessionController } from "../src/app/controller.ts"
import type { SessionId } from "../src/core/types.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"
import { selectNextNeedy } from "../src/store/selectors.ts"

/** Every action call the cockpit made, in order. */
export interface RecordedCalls {
  sendPrompt: { input: PromptInput; sessionId: SessionId | undefined }[]
  cancel: (SessionId | undefined)[]
  switchFocus: (SessionId | undefined)[]
  jumpToNextNeedy: number
  respondPermission: PermissionOutcome[]
  dispose: number
}

/** A controller double plus the call log the assertions read. */
export interface FakeController extends SessionController {
  readonly calls: RecordedCalls
}

/** Construction options; both sessions are ready and idle by default. */
export interface FakeControllerOptions {
  /** Per-session standing, in cockpit order. */
  runtimes?: AgentRuntimeState[]
  /** The store to drive. Defaults to a fresh one. */
  store?: AppStore
}

/**
 * Both sessions up, ACP sessions open. The ordinary case. The working directory is
 * the process cwd (this repo, a git repository) so a runtime that flows through the
 * boot readiness gate passes its per-session repo check (ADR-005).
 */
export function readyRuntimes(): AgentRuntimeState[] {
  const cwd = process.cwd()
  return [
    {
      sessionId: "claude-code",
      providerKind: "claude-code",
      displayName: "Claude Code",
      title: "Claude Code",
      cwd,
      ready: true,
      acpSessionId: "session-claude",
    },
    {
      sessionId: "codex",
      providerKind: "codex",
      displayName: "Codex",
      title: "Codex",
      cwd,
      ready: true,
      acpSessionId: "session-codex",
    },
  ]
}

/** Build a `SessionController` that records what the UI asked it to do. */
export function createFakeController(options: FakeControllerOptions = {}): FakeController {
  const store = options.store ?? createAppStore()
  const runtimes = options.runtimes ?? readyRuntimes()
  const calls: RecordedCalls = {
    sendPrompt: [],
    cancel: [],
    switchFocus: [],
    jumpToNextNeedy: 0,
    respondPermission: [],
    dispose: 0,
  }

  const find = (sessionId: SessionId): AgentRuntimeState | undefined => runtimes.find((r) => r.sessionId === sessionId)

  return {
    store,
    calls,
    actions: {
      async sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        calls.sendPrompt.push({ input, sessionId })
        return null
      },
      async cancel(sessionId?: SessionId): Promise<void> {
        calls.cancel.push(sessionId)
      },
      switchFocus(sessionId?: SessionId): void {
        calls.switchFocus.push(sessionId)
        store.setFocus(sessionId ?? nextSessionId(store.getState().order, store.getState().focusedSessionId))
      },
      jumpToNextNeedy(): void {
        calls.jumpToNextNeedy++
        const target = selectNextNeedy(store.getState().focusedSessionId)(store.getState())
        if (target) store.setFocus(target)
      },
      respondPermission(outcome: PermissionOutcome): void {
        calls.respondPermission.push(outcome)
        // The real controller settles the agent's promise and then advances its queue,
        // clearing the slot when nothing else is waiting. With no queue here, an answer
        // always closes the overlay - which is what lets a view test observe it close.
        store.closeApproval()
      },
    },
    runtimes: () => runtimes,
    runtime: find,
    isReady: (sessionId) => find(sessionId)?.ready === true,
    async dispose(): Promise<void> {
      calls.dispose++
    },
  }
}
