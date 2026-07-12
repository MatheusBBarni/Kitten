import { describe, expect, it } from "bun:test"

import type { HandoffBundle } from "../core/types.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"
import type { PersistedRunRecord } from "./runRecord.ts"
import { createRunWriter } from "./runWriter.ts"
import type { RunStore } from "./runStore.ts"

// Suite: run autosave writer
// Invariant: enabled store state converges to one pointers-only run snapshot and disabled state performs no work.
// Boundary IN: AppStore subscription, snapshot mapping, debounce, retained bundle, and writer disposal
// Boundary OUT: real filesystem I/O (owned by test/cockpitSession.test.ts and test/runStore.integration.test.ts)

function controlledTimer(): {
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  flush: () => void
  pending: () => boolean
} {
  let callback: (() => void) | undefined
  const handle = 1 as unknown as ReturnType<typeof setTimeout>
  return {
    setTimer(next) {
      callback = next
      return handle
    },
    clearTimer(timer) {
      expect(timer).toBe(handle)
      callback = undefined
    },
    flush() {
      const next = callback
      callback = undefined
      next?.()
    },
    pending: () => callback !== undefined,
  }
}

function recordingRunStore(): RunStore & {
  records: PersistedRunRecord[]
  flushCalls: number
} {
  const records: PersistedRunRecord[] = []
  return {
    records,
    flushCalls: 0,
    save(record) {
      records.push(record)
    },
    list() {
      return []
    },
    load() {
      return null
    },
    delete() {},
    deleteAll() {},
    flush() {
      this.flushCalls += 1
    },
  }
}

function seededStore(): AppStore {
  const store = createAppStore({
    seeds: [
      { id: "claude", providerKind: "claude-code", title: "Claude", cwd: "/work/kitten" },
      { id: "codex", providerKind: "codex", title: "Codex", cwd: "/work/kitten" },
    ],
    selectedVisibleId: "claude",
  })
  store.startSession("claude", "claude-acp-session")
  store.startSession("codex", "codex-acp-session")
  return store
}

function writerHarness(): {
  store: AppStore
  runStore: ReturnType<typeof recordingRunStore>
  timer: ReturnType<typeof controlledTimer>
  writer: ReturnType<typeof createRunWriter>
} {
  const store = seededStore()
  const runStore = recordingRunStore()
  const timer = controlledTimer()
  const times = [1_000, 2_000]
  const writer = createRunWriter({
    enabled: true,
    runStore,
    projectCwd: "/work/kitten",
    runId: "run-03",
    now: () => times.shift() ?? 3_000,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  })
  writer.watch(store)
  return { store, runStore, timer, writer }
}

const HANDOFF_BUNDLE: HandoffBundle = {
  intent: "continue",
  summary: "Finish the parser fix.",
  files: [{ path: "src/parser.ts", reason: "edited" }],
  pendingDiffs: [],
  redactionCount: 0,
}

describe("createRunWriter", () => {
  it("keys a whole cockpit run to its launch project rather than the focused session", () => {
    const store = createAppStore({
      seeds: [
        { id: "claude", providerKind: "claude-code", title: "Claude", cwd: "/work/alpha" },
        { id: "codex", providerKind: "codex", title: "Codex", cwd: "/work/beta" },
      ],
      selectedVisibleId: "claude",
    })
    const runStore = recordingRunStore()
    const timer = controlledTimer()
    const writer = createRunWriter({
      enabled: true,
      runStore,
      projectCwd: "/work/monorepo",
      runId: "run-project",
      now: () => 1_000,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    writer.watch(store)
    timer.flush()
    store.setFocus("codex")
    timer.flush()

    expect(runStore.records.map((record) => record.cwd)).toEqual(["/work/monorepo", "/work/monorepo"])
    writer.dispose()
  })

  it("maps session pointers and metadata without transcript turns", () => {
    const { store, runStore, timer, writer } = writerHarness()
    store.applyEvent("claude", { kind: "branch", branch: "feat/parser" })
    store.applyEvent("claude", { kind: "user_message", messageId: "u1", text: "fix the parser" })
    store.applyEvent("claude", { kind: "agent_message", messageId: "a1", textDelta: "working" })
    store.applyEvent("claude", {
      kind: "tool_call",
      call: { toolCallId: "t1", kind: "read", title: "Read parser", status: "completed", locations: [] },
    })

    timer.flush()

    expect(runStore.records).toHaveLength(1)
    expect(runStore.records[0]).toEqual({
      version: 1,
      runId: "run-03",
      cwd: "/work/kitten",
      gitBranch: "feat/parser",
      focusedAgentId: "claude",
      createdAt: 1_000,
      updatedAt: 2_000,
      agents: {
        claude: {
          sessionId: "claude-acp-session",
          status: "idle",
          messageCount: 3,
          lastPrompt: "fix the parser",
        },
        codex: {
          sessionId: "codex-acp-session",
          status: "idle",
          messageCount: 0,
          lastPrompt: "",
        },
      },
      handoffBundle: null,
    })
    expect(JSON.stringify(runStore.records[0])).not.toContain('"turns"')
    writer.dispose()
  })

  it("coalesces five rapid commits into one save", () => {
    const { store, runStore, timer, writer } = writerHarness()

    for (let index = 0; index < 5; index += 1) {
      store.applyEvent("claude", { kind: "user_message", messageId: `u${index}`, text: `prompt ${index}` })
    }
    expect(runStore.records).toHaveLength(0)
    expect(timer.pending()).toBe(true)

    timer.flush()

    expect(runStore.records).toHaveLength(1)
    expect(runStore.records[0]?.agents.claude?.messageCount).toBe(5)
    writer.dispose()
  })

  it("retains the last observed hand-off bundle after the overlay closes", () => {
    const { store, runStore, timer, writer } = writerHarness()
    store.openHandoffPreview({
      sourceSessionId: "claude",
      targetSessionId: "codex",
      bundle: HANDOFF_BUNDLE,
      targetConfigOptions: [],
    })
    store.closeHandoffPreview()

    timer.flush()

    expect(runStore.records.at(-1)?.handoffBundle).toEqual(HANDOFF_BUNDLE)
    writer.dispose()
  })

  it("does not subscribe or save when disabled", () => {
    const state = seededStore().getState()
    let subscribeCalls = 0
    const store = {
      getState: () => state,
      subscribe: () => {
        subscribeCalls += 1
        return () => {}
      },
    } as unknown as AppStore
    const runStore = recordingRunStore()
    const writer = createRunWriter({ enabled: false, runStore, projectCwd: "/work/kitten" })

    const stop = writer.watch(store)
    stop()
    writer.dispose()

    expect(subscribeCalls).toBe(0)
    expect(runStore.records).toEqual([])
    expect(runStore.flushCalls).toBe(0)
  })

  it("saves pending state and flushes the run store once on dispose", () => {
    const { store, runStore, timer, writer } = writerHarness()
    store.applyEvent("claude", { kind: "user_message", messageId: "u1", text: "persist before exit" })

    writer.dispose()
    writer.dispose()
    timer.flush()

    expect(runStore.records).toHaveLength(1)
    expect(runStore.records[0]?.agents.claude?.lastPrompt).toBe("persist before exit")
    expect(runStore.flushCalls).toBe(1)
  })

  it("uses production clock, identity, and timer defaults for a boot snapshot", () => {
    const store = seededStore()
    const runStore = recordingRunStore()
    const writer = createRunWriter({ enabled: true, runStore, projectCwd: "/work/kitten" })

    writer.watch(store)
    writer.dispose()

    expect(runStore.records).toHaveLength(1)
    expect(runStore.records[0]?.runId).not.toBe("")
    expect(runStore.records[0]?.createdAt).toBeGreaterThan(0)
  })

  it("contains save, flush, and error-reporter failures during disposal", () => {
    const timer = controlledTimer()
    let reported = 0
    const failingStore: RunStore = {
      save() {
        throw new Error("save failed")
      },
      list: () => [],
      load: () => null,
      delete() {},
      deleteAll() {},
      flush() {
        throw new Error("flush failed")
      },
    }
    const writer = createRunWriter({
      enabled: true,
      runStore: failingStore,
      projectCwd: "/work/kitten",
      runId: "failing-run",
      now: () => 1,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onError: () => {
        reported += 1
        throw new Error("reporter failed")
      },
    })
    writer.watch(seededStore())

    expect(() => writer.dispose()).not.toThrow()
    expect(reported).toBe(2)
  })
})
