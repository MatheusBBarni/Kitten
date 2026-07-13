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
import { nextSessionId, type CloseChoice, type CloseConversationResult, type PromptInput } from "../src/app/actions.ts"
import type { AgentRuntimeState, SessionController, ShellRuntimeState } from "../src/app/controller.ts"
import type { SessionId } from "../src/core/types.ts"
import {
  persistedSelectedConversationId,
  type PersistedRunRecord,
} from "../src/persistence/runRecord.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"
import { selectNextNeedy } from "../src/store/selectors.ts"
import type { ResumeMode } from "../src/telemetry/recorder.ts"

/** Every action call the cockpit made, in order. */
export interface RecordedCalls {
  createConversation: number
  renameConversation: { sessionId: SessionId; displayName: string }[]
  selectConversation: SessionId[]
  backgroundConversation: SessionId[]
  reopenConversation: SessionId[]
  closeConversation: { sessionId: SessionId; choice: CloseChoice }[]
  sendPrompt: { input: PromptInput; sessionId: SessionId | undefined }[]
  cancel: (SessionId | undefined)[]
  setSessionConfigOption: { configId: string; value: string; sessionId: SessionId | undefined }[]
  switchFocus: (SessionId | undefined)[]
  jumpToNextNeedy: number
  jumpToNextAttention: number
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
  const store = options.store ?? createAppStore({ selectedVisibleId: "claude-code" })
  const runtimes = options.runtimes ?? readyRuntimes()
  for (const runtime of runtimes) {
    if (runtime.ready) store.setConversationAvailability(runtime.sessionId, { kind: "ready" })
  }
  const calls: RecordedCalls = {
    createConversation: 0,
    renameConversation: [],
    selectConversation: [],
    backgroundConversation: [],
    reopenConversation: [],
    closeConversation: [],
    sendPrompt: [],
    cancel: [],
    setSessionConfigOption: [],
    switchFocus: [],
    jumpToNextNeedy: 0,
    jumpToNextAttention: 0,
    startNewRun: 0,
    startFreshFromContext: [],
    restore: [],
    restoreModes: [],
    respondPermission: [],
    dispose: 0,
  }

  const find = (sessionId: SessionId): AgentRuntimeState | undefined => runtimes.find((r) => r.sessionId === sessionId)
  let created = 0

  async function closeConversation(sessionId: SessionId, choice: CloseChoice): Promise<CloseConversationResult> {
    calls.closeConversation.push({ sessionId, choice })
    const conversation = store.getState().workspace.conversations[sessionId]
    if (!conversation) return { outcome: "ignored" }
    if (choice === "background") {
      store.backgroundConversation(sessionId)
      return { outcome: "backgrounded" }
    }
    if (choice === "keep-open") return { outcome: "kept-open" }
    store.removeSession(sessionId)
    const runtimeIndex = runtimes.findIndex((runtime) => runtime.sessionId === sessionId)
    if (runtimeIndex >= 0) runtimes.splice(runtimeIndex, 1)
    return { outcome: "closed" }
  }

  return {
    store,
    shell: options.shell ?? { ready: false, error: "shell unavailable in controller test double" },
    calls,
    actions: {
      async createConversation(): Promise<SessionId | null> {
        calls.createConversation++
        const selected = store.getState().workspace.selectedVisibleId
        const source = selected
          ? store.getState().sessions[selected]
          : store.getState().sessions[runtimes[0]?.sessionId ?? ""]
        if (!source) {
          store.setWorkspaceNotice({ code: "no-provider-available" })
          return null
        }
        created += 1
        const sessionId = `fake-created-${created}`
        store.addSession({
          id: sessionId,
          providerKind: source.providerKind,
          title: `Conversation ${created}`,
          cwd: source.cwd,
        }, { availability: { kind: "ready" } })
        runtimes.push({
          sessionId,
          providerKind: source.providerKind,
          displayName: `Conversation ${created}`,
          title: `Conversation ${created}`,
          cwd: source.cwd,
          ready: true,
          acpSessionId: `fake-acp-${created}`,
        })
        return sessionId
      },
      renameConversation(sessionId, displayName): void {
        calls.renameConversation.push({ sessionId, displayName })
        store.renameConversation(sessionId, displayName)
      },
      selectConversation(sessionId): void {
        calls.selectConversation.push(sessionId)
        store.selectConversation(sessionId)
      },
      backgroundConversation(sessionId): void {
        calls.backgroundConversation.push(sessionId)
        store.backgroundConversation(sessionId)
      },
      reopenConversation(sessionId): void {
        calls.reopenConversation.push(sessionId)
        store.reopenConversation(sessionId)
      },
      closeConversation,
      async sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        calls.sendPrompt.push({ input, sessionId })
        return null
      },
      async cancel(sessionId?: SessionId): Promise<void> {
        calls.cancel.push(sessionId)
      },
      async setSessionConfigOption(configId: string, value: string, sessionId?: SessionId): Promise<boolean> {
        calls.setSessionConfigOption.push({ configId, value, sessionId })
        return true
      },
      switchFocus(sessionId?: SessionId): void {
        calls.switchFocus.push(sessionId)
        const state = store.getState()
        const target =
          sessionId ??
          (state.workspace.selectedVisibleId
            ? nextSessionId(state.workspace.order, state.workspace.selectedVisibleId)
            : state.workspace.order[0])
        if (target) store.setFocus(target)
      },
      jumpToNextNeedy(): void {
        calls.jumpToNextNeedy++
        const target = selectNextNeedy(store.getState().workspace.selectedVisibleId)(store.getState())
        if (target) {
          const conversation = store.getState().workspace.conversations[target]
          if (conversation?.lifecycle === "background") store.reopenConversation(target)
          else store.selectConversation(target)
        }
      },
      jumpToNextAttention(): void {
        calls.jumpToNextAttention++
        const target = selectNextNeedy(store.getState().workspace.selectedVisibleId)(store.getState())
        if (target) {
          const conversation = store.getState().workspace.conversations[target]
          if (conversation?.lifecycle === "background") store.reopenConversation(target)
          else store.selectConversation(target)
        }
      },
      async startNewRun(): Promise<void> {
        calls.startNewRun++
        for (const sessionId of store.getState().workspace.order) store.setRestoration(sessionId, null)
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
    closeConversation,
    async restore(record, mode = "last-run"): Promise<void> {
      calls.restore.push(record)
      calls.restoreModes.push(mode)
      const selectedConversationId = persistedSelectedConversationId(record)
      if (selectedConversationId !== null) store.setFocus(selectedConversationId)
    },
    async dispose(): Promise<void> {
      calls.dispose++
    },
  }
}
