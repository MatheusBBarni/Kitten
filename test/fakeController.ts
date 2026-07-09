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
import { nextAgentId, type PromptInput } from "../src/app/actions.ts"
import type { AgentRuntimeState, SessionController } from "../src/app/controller.ts"
import type { AgentId } from "../src/core/types.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"

/** Every action call the cockpit made, in order. */
export interface RecordedCalls {
  sendPrompt: { input: PromptInput; agentId: AgentId | undefined }[]
  cancel: (AgentId | undefined)[]
  switchFocus: (AgentId | undefined)[]
  respondPermission: PermissionOutcome[]
  dispose: number
}

/** A controller double plus the call log the assertions read. */
export interface FakeController extends SessionController {
  readonly calls: RecordedCalls
}

/** Construction options; both agents are ready and idle by default. */
export interface FakeControllerOptions {
  /** Per-agent standing, in cockpit order. */
  runtimes?: AgentRuntimeState[]
  /** The store to drive. Defaults to a fresh one. */
  store?: AppStore
}

/** Both agents up, sessions open. The ordinary case. */
export function readyRuntimes(): AgentRuntimeState[] {
  return [
    { agentId: "claude-code", displayName: "Claude Code", ready: true, sessionId: "session-claude" },
    { agentId: "codex", displayName: "Codex", ready: true, sessionId: "session-codex" },
  ]
}

/** Build a `SessionController` that records what the UI asked it to do. */
export function createFakeController(options: FakeControllerOptions = {}): FakeController {
  const store = options.store ?? createAppStore()
  const runtimes = options.runtimes ?? readyRuntimes()
  const calls: RecordedCalls = { sendPrompt: [], cancel: [], switchFocus: [], respondPermission: [], dispose: 0 }

  const find = (agentId: AgentId): AgentRuntimeState | undefined => runtimes.find((r) => r.agentId === agentId)

  return {
    store,
    calls,
    actions: {
      async sendPrompt(input: PromptInput, agentId?: AgentId): Promise<PromptResult | null> {
        calls.sendPrompt.push({ input, agentId })
        return null
      },
      async cancel(agentId?: AgentId): Promise<void> {
        calls.cancel.push(agentId)
      },
      switchFocus(agentId?: AgentId): void {
        calls.switchFocus.push(agentId)
        store.setFocus(agentId ?? nextAgentId(store.getState().focusedAgentId))
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
    isReady: (agentId) => find(agentId)?.ready === true,
    async dispose(): Promise<void> {
      calls.dispose++
    },
  }
}
