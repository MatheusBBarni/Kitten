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
import {
  nextSessionId,
  previousSessionId,
  type CloseChoice,
  type CloseConversationResult,
  type FileSelectorDiscoveryOutcome,
  type FileSelectorRenderState,
  type PromptInput,
  type StartDelegatedChildInput,
  type StatuslineWriteResult,
  type SwitchFocusOptions,
} from "../src/app/actions.ts"
import type { RepositoryFileList } from "../src/app/fileDiscovery.ts"
import { selectPromptHistory, type PromptHistoryDirection, type PromptHistorySelection } from "../src/core/promptHistory.ts"
import type { AgentRuntimeState, SessionController, ShellRuntimeState } from "../src/app/controller.ts"
import type { ClarificationOutcome, DefaultApplyResult, SessionId } from "../src/core/types.ts"
import type { StatuslineLayout } from "../src/core/statusline.ts"
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
  startDelegatedChild: StartDelegatedChildInput[]
  steerDelegatedChild: { childId: SessionId; text: string }[]
  cancelDelegatedChild: SessionId[]
  renameConversation: { sessionId: SessionId; displayName: string }[]
  selectConversation: SessionId[]
  selectConversationOptions: (SwitchFocusOptions | undefined)[]
  backgroundConversation: SessionId[]
  reopenConversation: SessionId[]
  closeConversation: { sessionId: SessionId; choice: CloseChoice }[]
  listRepositoryFiles: SessionId[]
  fileSelectorOpened: SessionId[]
  fileSelectorDiscovery: { sessionId: SessionId; outcome: FileSelectorDiscoveryOutcome; durationMs: number }[]
  fileSelectorQueryRendered: { sessionId: SessionId; state: FileSelectorRenderState; durationMs: number }[]
  fileSelectorSelected: { sessionId: SessionId; durationMs: number }[]
  fileSelectorCorrected: SessionId[]
  sendPrompt: { input: PromptInput; sessionId: SessionId | undefined }[]
  recordPromptHistory: { text: string; sessionId: SessionId | undefined }[]
  navigatePromptHistory: { direction: PromptHistoryDirection; sessionId: SessionId | undefined }[]
  cancel: (SessionId | undefined)[]
  setSessionConfigOption: { configId: string; value: string; sessionId: SessionId | undefined }[]
  applyProviderDefaults: SessionId[]
  acknowledgeStatuslineDisclosure: number
  confirmStatusline: StatuslineLayout[]
  providerDefaultContexts: Array<{
    sessionId: SessionId
    selectedSessionId: SessionId | null
    overlaySessionId: SessionId | null
  }>
  switchFocus: (SessionId | undefined)[]
  jumpToNextNeedy: number
  jumpToNextAttention: number
  startNewRun: number
  startFreshFromContext: { input: PromptInput | undefined; sessionId: SessionId | undefined }[]
  restore: PersistedRunRecord[]
  restoreModes: ResumeMode[]
  respondPermission: PermissionOutcome[]
  respondClarification: Array<{
    requestId: string
    generation: number
    outcome: ClarificationOutcome
  }>
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
  /** Explicit-session repository discovery seam for mounted selector tests. */
  listRepositoryFiles?: (
    sessionId: SessionId,
  ) => RepositoryFileList | Promise<RepositoryFileList>
  /** Deterministic terminal results emitted when a view requests provider defaults. */
  providerDefaultResults?: Partial<Record<SessionId, DefaultApplyResult>>
  /** Deterministic persistence outcomes for statusline UI tests. */
  acknowledgeStatuslineResult?: StatuslineWriteResult
  confirmStatuslineResult?: StatuslineWriteResult
  /** Deterministic delegated-launch result for pending and fail-soft UI tests. */
  startDelegatedChild?: (
    input: StartDelegatedChildInput,
    store: AppStore,
  ) => SessionId | null | Promise<SessionId | null>
  /** Deterministic normal-prompt boundary for transcript-driven statusline tests. */
  sendPrompt?: (
    input: PromptInput,
    sessionId: SessionId | undefined,
    store: AppStore,
  ) => PromptResult | null | Promise<PromptResult | null>
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
      mcp: { loaded: [], skipped: [] },
    },
    {
      sessionId: "codex",
      providerKind: "codex",
      displayName: "Codex",
      title: "Codex",
      cwd,
      ready: true,
      acpSessionId: "session-codex",
      mcp: { loaded: [], skipped: [] },
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
    startDelegatedChild: [],
    steerDelegatedChild: [],
    cancelDelegatedChild: [],
    renameConversation: [],
    selectConversation: [],
    selectConversationOptions: [],
    backgroundConversation: [],
    reopenConversation: [],
    closeConversation: [],
    listRepositoryFiles: [],
    fileSelectorOpened: [],
    fileSelectorDiscovery: [],
    fileSelectorQueryRendered: [],
    fileSelectorSelected: [],
    fileSelectorCorrected: [],
    sendPrompt: [],
    recordPromptHistory: [],
    navigatePromptHistory: [],
    cancel: [],
    setSessionConfigOption: [],
    applyProviderDefaults: [],
    acknowledgeStatuslineDisclosure: 0,
    confirmStatusline: [],
    providerDefaultContexts: [],
    switchFocus: [],
    jumpToNextNeedy: 0,
    jumpToNextAttention: 0,
    startNewRun: 0,
    startFreshFromContext: [],
    restore: [],
    restoreModes: [],
    respondPermission: [],
    respondClarification: [],
    dispose: 0,
  }

  const find = (sessionId: SessionId): AgentRuntimeState | undefined => runtimes.find((r) => r.sessionId === sessionId)
  let created = 0
  const rejectedFreshPrompts = new Map<SessionId, PromptInput>()

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
          mcp: { loaded: [], skipped: [] },
        })
        return sessionId
      },
      async startDelegatedChild(input): Promise<SessionId | null> {
        calls.startDelegatedChild.push(input)
        if (options.startDelegatedChild) return await options.startDelegatedChild(input, store)
        const parent = store.getState().sessions[input.parentId]
        if (!parent || input.task.trim().length === 0 || input.desiredOutcome.trim().length === 0) return null
        created += 1
        const sessionId = `fake-delegated-${created}`
        store.addDelegatedSession({
          seed: {
            id: sessionId,
            providerKind: parent.providerKind,
            title: `Delegated ${created}`,
            cwd: parent.cwd,
          },
          parentId: input.parentId,
          parentGeneration: 1,
          childGeneration: created + 1,
          task: input.task.trim(),
          desiredOutcome: input.desiredOutcome.trim(),
        })
        store.publishDelegatedChildState({
          parentId: input.parentId,
          childId: sessionId,
          parentGeneration: 1,
          childGeneration: created + 1,
          status: "running",
          sessionStatus: "working",
        })
        if (!store.getState().delegation.children[sessionId]) return null
        runtimes.push({
          sessionId,
          providerKind: parent.providerKind,
          displayName: `Delegated ${created}`,
          title: `Delegated ${created}`,
          cwd: parent.cwd,
          ready: true,
          acpSessionId: `fake-delegated-acp-${created}`,
          mcp: { loaded: [], skipped: [] },
        })
        return sessionId
      },
      async steerDelegatedChild(childId, text): Promise<PromptResult | null> {
        calls.steerDelegatedChild.push({ childId, text })
        const child = store.getState().delegation.children[childId]
        if (!child || child.terminal || text.trim().length === 0) return null
        return options.sendPrompt?.(text, childId, store) ?? null
      },
      async cancelDelegatedChild(childId): Promise<void> {
        calls.cancelDelegatedChild.push(childId)
        const child = store.getState().delegation.children[childId]
        if (!child || child.terminal) return
        store.publishDelegatedChildState({
          parentId: child.parentId,
          childId,
          parentGeneration: child.parentGeneration,
          childGeneration: child.childGeneration,
          status: "cancelled",
          sessionStatus: "idle",
          at: Date.now(),
        })
      },
      renameConversation(sessionId, displayName): void {
        calls.renameConversation.push({ sessionId, displayName })
        store.renameConversation(sessionId, displayName)
      },
      selectConversation(sessionId, selectionOptions): void {
        calls.selectConversation.push(sessionId)
        calls.selectConversationOptions.push(selectionOptions)
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
      async listRepositoryFiles(sessionId): Promise<RepositoryFileList> {
        calls.listRepositoryFiles.push(sessionId)
        return await (options.listRepositoryFiles?.(sessionId)
          ?? { kind: "unavailable", reason: "discovery_failed" })
      },
      fileSelectorOpened(sessionId): void {
        calls.fileSelectorOpened.push(sessionId)
      },
      fileSelectorDiscovery(sessionId, outcome, durationMs): void {
        calls.fileSelectorDiscovery.push({ sessionId, outcome, durationMs })
      },
      fileSelectorQueryRendered(sessionId, state, durationMs): void {
        calls.fileSelectorQueryRendered.push({ sessionId, state, durationMs })
      },
      fileSelectorSelected(sessionId, durationMs): void {
        calls.fileSelectorSelected.push({ sessionId, durationMs })
      },
      fileSelectorCorrected(sessionId): void {
        calls.fileSelectorCorrected.push(sessionId)
      },
      async sendPrompt(input: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        calls.sendPrompt.push({ input, sessionId })
        const result = await (options.sendPrompt?.(input, sessionId, store) ?? null)
        const target = sessionId ?? store.getState().workspace.selectedVisibleId ?? undefined
        if (result === null && target && store.getState().harnessDeliveryNotices[target]) {
          rejectedFreshPrompts.set(target, input)
        }
        return result
      },
      recordPromptHistory(text: string, sessionId?: SessionId): void {
        calls.recordPromptHistory.push({ text, sessionId })
        const target = sessionId ?? store.getState().workspace.selectedVisibleId ?? undefined
        if (!target || text.trim().length === 0 || !store.getState().sessions[target]) return
        store.applyEvent(target, { kind: "prompt_history", action: "record", text })
      },
      navigatePromptHistory(direction: PromptHistoryDirection, sessionId?: SessionId): PromptHistorySelection {
        calls.navigatePromptHistory.push({ direction, sessionId })
        const target = sessionId ?? store.getState().workspace.selectedVisibleId ?? undefined
        if (!target) return { text: null, historyIndex: null, total: 0 }
        const before = store.getState().sessions[target]?.promptHistory
        if (!before) return { text: null, historyIndex: null, total: 0 }
        store.applyEvent(target, { kind: "prompt_history", action: direction })
        const after = store.getState().sessions[target]!.promptHistory
        if (direction === "next" && before.cursor === null) {
          return { text: null, historyIndex: null, total: after.entries.length }
        }
        if (direction === "next" && before.cursor === before.entries.length - 1 && after.cursor === null) {
          return { text: "", historyIndex: null, total: after.entries.length }
        }
        return selectPromptHistory(after)
      },
      async cancel(sessionId?: SessionId): Promise<void> {
        calls.cancel.push(sessionId)
      },
      async setSessionConfigOption(configId: string, value: string, sessionId?: SessionId): Promise<boolean> {
        calls.setSessionConfigOption.push({ configId, value, sessionId })
        return true
      },
      async applyProviderDefaults(sessionId: SessionId) {
        calls.applyProviderDefaults.push(sessionId)
        const state = store.getState()
        calls.providerDefaultContexts.push({
          sessionId,
          selectedSessionId: state.workspace.selectedVisibleId,
          overlaySessionId: state.overlays.modelSelect?.sessionId ?? null,
        })
        const result = options.providerDefaultResults?.[sessionId] ?? { kind: "none" }
        store.applyEvent(sessionId, { kind: "default_apply_result", result })
        return result
      },
      async acknowledgeStatuslineDisclosure(): Promise<StatuslineWriteResult> {
        calls.acknowledgeStatuslineDisclosure++
        const result = options.acknowledgeStatuslineResult ?? { outcome: "saved" }
        if (result.outcome === "saved") {
          const current = store.getState().preferences.statusline
          store.setStatuslinePreference({ ...current, llmDisclosureAcknowledged: true })
        }
        return result
      },
      async confirmStatusline(layout): Promise<StatuslineWriteResult> {
        calls.confirmStatusline.push(layout)
        const result = options.confirmStatuslineResult ?? { outcome: "saved" }
        if (result.outcome === "saved") {
          const acknowledged = store.getState().preferences.statusline.llmDisclosureAcknowledged
          store.setStatuslinePreference({ llmDisclosureAcknowledged: acknowledged, layout })
        }
        return result
      },
      switchFocus(sessionId?: SessionId, options?: SwitchFocusOptions): void {
        calls.switchFocus.push(sessionId)
        const state = store.getState()
        const target =
          sessionId ??
          (state.workspace.selectedVisibleId
            ? options?.direction === "previous"
              ? previousSessionId(state.workspace.order, state.workspace.selectedVisibleId)
              : nextSessionId(state.workspace.order, state.workspace.selectedVisibleId)
            : options?.direction === "previous"
              ? state.workspace.order.at(-1)
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
      async startFreshFromContext(input?: PromptInput, sessionId?: SessionId): Promise<PromptResult | null> {
        const target = sessionId ?? store.getState().workspace.selectedVisibleId ?? undefined
        const recoveredInput = input ?? (target ? rejectedFreshPrompts.get(target) : undefined)
        calls.startFreshFromContext.push({ input: recoveredInput, sessionId })
        if (target) {
          store.setRestoration(target, null)
          if (store.getState().harnessDeliveryNotices[target]) {
            const generation = (store.getState().harnessDeliveries[target]?.generation ?? 0) + 1
            store.setHarnessDelivery(target, { version: "v1", generation, state: "pending" })
            if (recoveredInput) rejectedFreshPrompts.delete(target)
          }
        }
        return null
      },
      respondPermission(outcome: PermissionOutcome): void {
        calls.respondPermission.push(outcome)
        // The real controller settles the agent's promise and then advances its queue,
        // clearing the slot when nothing else is waiting. With no queue here, an answer
        // always closes the overlay - which is what lets a view test observe it close.
        store.closeApproval()
      },
      respondClarification(requestId, generation, outcome): void {
        calls.respondClarification.push({ requestId, generation, outcome })
        const active = store.getState().overlays.clarification
        if (active?.requestId === requestId && active.generation === generation) {
          store.closeClarification()
        }
      },
    },
    runtimes: () => runtimes,
    runtime: find,
    isReady: (sessionId) => find(sessionId)?.ready === true,
    updateProviderDefaults: () => {},
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
