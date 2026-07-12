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
import type { AgentRuntimeState, SessionController, ShellRuntimeState } from "../src/app/controller.ts"
import type { SessionId } from "../src/core/types.ts"
import type { PersistedRunRecord } from "../src/persistence/runRecord.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"
import { selectNextNeedy } from "../src/store/selectors.ts"
import type { ResumeMode } from "../src/telemetry/recorder.ts"

/** Every action call the cockpit made, in order. */
export interface RecordedCalls {
  sendPrompt: { input: PromptInput; sessionId: SessionId | undefined }[]
  cancel: (SessionId | undefined)[]
  setSessionConfigOption: { configId: string; value: string; sessionId: SessionId | undefined }[]
  switchFocus: (SessionId | undefined)[]
  jumpToNextNeedy: number
  startNewRun: number
  startFreshFromContext: { input: PromptInput; sessionId: SessionId | undefined }[]
  restore: PersistedRunRecord[]
  restoreModes: ResumeMode[]
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
  /** Shell standing exposed to shell-aware views. Defaults to unavailable. */
  shell?: ShellRuntimeState
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
  // Most view tests intentionally exercise Claude turns. Keep that fixture focus
  // explicit so production's Codex-first default is covered by real-store tests.
  const store = options.store ?? createAppStore({ focusedSessionId: "claude-code" })
  const runtimes = options.runtimes ?? readyRuntimes()
  const calls: RecordedCalls = {
    sendPrompt: [],
    cancel: [],
    setSessionConfigOption: [],
    switchFocus: [],
    jumpToNextNeedy: 0,
    startNewRun: 0,
    startFreshFromContext: [],
    restore: [],
    restoreModes: [],
    respondPermission: [],
    dispose: 0,
  }

  const find = (sessionId: SessionId): AgentRuntimeState | undefined => runtimes.find((r) => r.sessionId === sessionId)

  return {
    store,
    shell: options.shell ?? { ready: false, error: "shell unavailable in controller test double" },
    calls,
    actions: {
      async sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        calls.sendPrompt.push({ input, sessionId })
        return null
      },
      async cancel(sessionId?: SessionId): Promise<void> {
        calls.cancel.push(sessionId)
      },
      async setSessionConfigOption(configId: string, value: string, sessionId?: SessionId): Promise<void> {
        calls.setSessionConfigOption.push({ configId, value, sessionId })
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
      async startNewRun(): Promise<void> {
        calls.startNewRun++
        for (const sessionId of store.getState().order) store.setRestoration(sessionId, null)
      },
      async startFreshFromContext(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        calls.startFreshFromContext.push({ input, sessionId })
        if (sessionId) store.setRestoration(sessionId, null)
        return null
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
    async restore(record, mode = "last-run"): Promise<void> {
      calls.restore.push(record)
      calls.restoreModes.push(mode)
      store.setFocus(record.focusedAgentId)
    },
    async dispose(): Promise<void> {
      calls.dispose++
    },
  }
}
