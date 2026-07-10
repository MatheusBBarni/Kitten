import { describe, expect, it } from "bun:test"

import { createSessionState, sessionReducer } from "./sessionReducer.ts"
import type { ConfigOption, DomainSessionEvent, SessionState, ToolCallTurn } from "./types.ts"

/**
 * Fixture-driven tests for the pure `SessionState` reducer. The core has no I/O,
 * so every case is exercised by feeding event fixtures and asserting the resulting
 * immutable state. No ACP SDK is imported anywhere in `src/core`.
 */

const initial = (): SessionState => createSessionState({ id: "claude-code", providerKind: "claude-code", title: "claude-code", cwd: "/w", acpSessionId: "session-1" })

/** Fold a sequence of events over a fresh session state. */
const fold = (events: DomainSessionEvent[], start: SessionState = initial()): SessionState =>
  events.reduce(sessionReducer, start)

/** Pull the tool-call turns out of a state for focused assertions. */
const toolTurns = (state: SessionState): ToolCallTurn[] =>
  state.turns.filter((t): t is ToolCallTurn => t.kind === "tool_call")

describe("createSessionState", () => {
  it("starts empty and idle for the given session seed", () => {
    const state = createSessionState({ id: "codex", providerKind: "codex", title: "codex", cwd: "/w", acpSessionId: "s-42" })
    expect(state).toEqual({
      id: "codex",
      providerKind: "codex",
      title: "codex",
      cwd: "/w",
      task: undefined,
      acpSessionId: "s-42",
      turns: [],
      status: "idle",
      referencedFiles: new Map(),
      pendingDiffs: [],
      plan: [],
      configOptions: [],
    })
  })

  it("defaults configOptions to an empty array", () => {
    expect(initial().configOptions).toEqual([])
  })
})

describe("agent_message", () => {
  it("appends a new agent turn for a new messageId", () => {
    const state = fold([{ kind: "agent_message", messageId: "m1", textDelta: "Hello" }])
    expect(state.turns).toEqual([{ kind: "agent", messageId: "m1", text: "Hello" }])
  })

  it("concatenates textDelta onto the existing turn for the same messageId", () => {
    const state = fold([
      { kind: "agent_message", messageId: "m1", textDelta: "Hel" },
      { kind: "agent_message", messageId: "m1", textDelta: "lo world" },
    ])
    expect(state.turns).toEqual([{ kind: "agent", messageId: "m1", text: "Hello world" }])
  })

  it("starts a fresh turn when a new messageId interrupts the previous one", () => {
    const state = fold([
      { kind: "agent_message", messageId: "m1", textDelta: "first" },
      { kind: "agent_message", messageId: "m2", textDelta: "second" },
      // A late delta for m1 does not merge because m1 is no longer the last turn.
      { kind: "agent_message", messageId: "m1", textDelta: "!" },
    ])
    expect(state.turns).toEqual([
      { kind: "agent", messageId: "m1", text: "first" },
      { kind: "agent", messageId: "m2", text: "second" },
      { kind: "agent", messageId: "m1", text: "!" },
    ])
  })
})

describe("user_message", () => {
  it("appends a user turn without merging", () => {
    const state = fold([
      { kind: "user_message", messageId: "u1", text: "do the thing" },
      { kind: "user_message", messageId: "u1", text: "again" },
    ])
    expect(state.turns).toEqual([
      { kind: "user", messageId: "u1", text: "do the thing" },
      { kind: "user", messageId: "u1", text: "again" },
    ])
  })
})

describe("tool_call upsert semantics", () => {
  it("merges an update by toolCallId, preserving omitted fields and clearing null fields", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit config",
          status: "pending",
          locations: ["src/config.ts"],
          diff: { path: "src/config.ts", unified: "@@ -1 +1 @@\n-a\n+b" },
        },
      },
      {
        // Only status changes; kind/title/locations are omitted and must be preserved.
        // diff is explicitly null and must be cleared.
        kind: "tool_call",
        call: { toolCallId: "t1", status: "completed", diff: null },
      },
    ])

    const turns = toolTurns(state)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.record).toEqual({
      toolCallId: "t1",
      kind: "edit",
      title: "Edit config",
      status: "completed",
      locations: ["src/config.ts"],
    })
    expect(turns[0]!.record.diff).toBeUndefined()
  })

  it("defaults missing fields when the first event for an id is partial", () => {
    const state = fold([{ kind: "tool_call", call: { toolCallId: "t9", status: "in_progress" } }])
    expect(toolTurns(state)[0]!.record).toEqual({
      toolCallId: "t9",
      kind: "other",
      title: "",
      status: "in_progress",
      locations: [],
    })
  })

  it("preserves transcript position when a later update merges an earlier tool call", () => {
    const state = fold([
      { kind: "tool_call", call: { toolCallId: "t1", kind: "read", title: "read", status: "completed", locations: [] } },
      { kind: "agent_message", messageId: "m1", textDelta: "thinking" },
      { kind: "tool_call", call: { toolCallId: "t1", status: "failed" } },
    ])
    expect(state.turns.map((t) => (t.kind === "tool_call" ? t.record.toolCallId : t.kind))).toEqual([
      "t1",
      "agent",
    ])
    expect(toolTurns(state)[0]!.record.status).toBe("failed")
  })
})

describe("referencedFiles derivation", () => {
  it("marks an edit-kind tool call location as edited and records its pending diff", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit file",
          status: "pending",
          locations: ["src/a.ts"],
          diff: { path: "src/a.ts", unified: "@@ -1 +1 @@\n-x\n+y" },
        },
      },
    ])
    expect(state.referencedFiles.get("src/a.ts")).toBe("edited")
    expect(state.pendingDiffs).toEqual([
      { toolCallId: "t1", path: "src/a.ts", unified: "@@ -1 +1 @@\n-x\n+y" },
    ])
  })

  it("marks a read-kind tool call location as read and creates no pending diff", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: { toolCallId: "t2", kind: "read", title: "Read file", status: "completed", locations: ["src/b.ts"] },
      },
    ])
    expect(state.referencedFiles.get("src/b.ts")).toBe("read")
    expect(state.pendingDiffs).toEqual([])
  })

  it("keeps a path edited even after a later read of the same path", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: { toolCallId: "t1", kind: "edit", title: "e", status: "pending", locations: ["src/x.ts"] },
      },
      {
        kind: "tool_call",
        call: { toolCallId: "t2", kind: "read", title: "r", status: "completed", locations: ["src/x.ts"] },
      },
    ])
    expect(state.referencedFiles.get("src/x.ts")).toBe("edited")
  })

  it("drops a pending diff once the edit tool call completes (applied)", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "e",
          status: "in_progress",
          locations: ["src/x.ts"],
          diff: { path: "src/x.ts", unified: "d" },
        },
      },
      { kind: "tool_call", call: { toolCallId: "t1", status: "completed" } },
    ])
    expect(state.pendingDiffs).toEqual([])
  })
})

describe("plan and status events", () => {
  it("stores the latest plan without altering turns", () => {
    const withTurn = fold([{ kind: "agent_message", messageId: "m1", textDelta: "hi" }])
    const state = sessionReducer(withTurn, {
      kind: "plan",
      entries: [{ content: "step one", status: "in_progress" }],
    })
    expect(state.plan).toEqual([{ content: "step one", status: "in_progress" }])
    expect(state.turns).toEqual(withTurn.turns)
  })

  it("updates status without altering turns", () => {
    const withTurn = fold([{ kind: "agent_message", messageId: "m1", textDelta: "hi" }])
    const state = sessionReducer(withTurn, { kind: "status", status: "awaiting_approval" })
    expect(state.status).toBe("awaiting_approval")
    expect(state.turns).toEqual(withTurn.turns)
  })
})

describe("config_options events", () => {
  const modelOption: ConfigOption = {
    id: "cfg-model",
    category: "model",
    label: "Model",
    currentValue: "opus",
    options: [
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
    ],
  }
  const effortOption: ConfigOption = {
    id: "cfg-effort",
    category: "thought_level",
    label: "Reasoning effort",
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  }

  it("replaces an empty configOptions with exactly the advertised options", () => {
    const state = fold([{ kind: "config_options", options: [modelOption, effortOption] }])
    expect(state.configOptions).toEqual([modelOption, effortOption])
  })

  it("fully replaces the prior set on a second event (no merge, no duplicates)", () => {
    const nextModel: ConfigOption = { ...modelOption, currentValue: "sonnet" }
    const state = fold([
      { kind: "config_options", options: [modelOption, effortOption] },
      { kind: "config_options", options: [nextModel] },
    ])
    expect(state.configOptions).toEqual([nextModel])
  })

  it("leaves turns, status, and pendingDiffs unchanged when applied", () => {
    const withWork = fold([
      { kind: "status", status: "awaiting_approval" },
      { kind: "user_message", messageId: "u1", text: "go" },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "e",
          status: "pending",
          locations: ["src/x.ts"],
          diff: { path: "src/x.ts", unified: "d" },
        },
      },
    ])
    const state = sessionReducer(withWork, { kind: "config_options", options: [modelOption] })
    expect(state.turns).toEqual(withWork.turns)
    expect(state.status).toBe(withWork.status)
    expect(state.pendingDiffs).toEqual(withWork.pendingDiffs)
    expect(state.configOptions).toEqual([modelOption])
  })

  it("returns a new object and does not mutate the input state", () => {
    const before = initial()
    sessionReducer(before, { kind: "config_options", options: [modelOption] })
    expect(before.configOptions).toEqual([])
  })
})

describe("purity", () => {
  it("does not mutate the input state", () => {
    const before = initial()
    const snapshot = JSON.parse(JSON.stringify({ ...before, referencedFiles: [...before.referencedFiles] }))
    sessionReducer(before, { kind: "agent_message", messageId: "m1", textDelta: "x" })
    expect(before.turns).toEqual([])
    expect([...before.referencedFiles]).toEqual(snapshot.referencedFiles)
  })
})

describe("integration: folding a scripted multi-event sequence", () => {
  it("yields the expected final SessionState", () => {
    const events: DomainSessionEvent[] = [
      { kind: "status", status: "working" },
      { kind: "user_message", messageId: "u1", text: "Refactor the config loader" },
      { kind: "agent_message", messageId: "a1", textDelta: "On it. " },
      { kind: "agent_message", messageId: "a1", textDelta: "Reading the file first." },
      {
        kind: "tool_call",
        call: {
          toolCallId: "read-1",
          kind: "read",
          title: "Read config loader",
          status: "completed",
          locations: ["src/config/loader.ts"],
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "edit-1",
          kind: "edit",
          title: "Rewrite loader",
          status: "pending",
          locations: ["src/config/loader.ts"],
          diff: { path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
        },
      },
      { kind: "status", status: "awaiting_approval" },
    ]

    const state = fold(events)

    expect(state.status).toBe("awaiting_approval")
    expect(state.turns).toEqual([
      { kind: "user", messageId: "u1", text: "Refactor the config loader" },
      { kind: "agent", messageId: "a1", text: "On it. Reading the file first." },
      {
        kind: "tool_call",
        record: {
          toolCallId: "read-1",
          kind: "read",
          title: "Read config loader",
          status: "completed",
          locations: ["src/config/loader.ts"],
        },
      },
      {
        kind: "tool_call",
        record: {
          toolCallId: "edit-1",
          kind: "edit",
          title: "Rewrite loader",
          status: "pending",
          locations: ["src/config/loader.ts"],
          diff: { path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
        },
      },
    ])
    // The file was read then edited; the edit wins.
    expect([...state.referencedFiles]).toEqual([["src/config/loader.ts", "edited"]])
    expect(state.pendingDiffs).toEqual([
      { toolCallId: "edit-1", path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
    ])
  })

  it("folds user_message -> config_options -> status into the expected final state", () => {
    const options: ConfigOption[] = [
      {
        id: "cfg-model",
        category: "model",
        label: "Model",
        currentValue: "sonnet",
        options: [
          { value: "opus", name: "Opus" },
          { value: "sonnet", name: "Sonnet" },
        ],
      },
    ]
    const events: DomainSessionEvent[] = [
      { kind: "user_message", messageId: "u1", text: "switch model" },
      { kind: "config_options", options },
      { kind: "status", status: "working" },
    ]

    const state = fold(events)

    expect(state.status).toBe("working")
    expect(state.configOptions).toEqual(options)
    expect(state.turns).toEqual([{ kind: "user", messageId: "u1", text: "switch model" }])
  })
})
