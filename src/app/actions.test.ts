import { describe, expect, it } from "bun:test"

import type { AgentConnection } from "../agent/agentConnection.ts"
import { createAppStore } from "../store/appStore.ts"
import { createControllerActions } from "./actions.ts"

const connection = { id: "codex" } as AgentConnection

function setup() {
  const store = createAppStore({
    seeds: [
      { id: "alpha", providerKind: "codex", title: "Alpha", cwd: "/repo" },
      { id: "beta", providerKind: "claude-code", title: "Beta", cwd: "/repo" },
    ],
    selectedVisibleId: "alpha",
  })
  store.setConversationAvailability("alpha", { kind: "ready" })
  store.setConversationAvailability("beta", { kind: "ready" })
  store.applyEvent("alpha", { kind: "status", status: "working" })
  let prepared = 0
  const captured: string[] = []
  const actions = createControllerActions({
    store,
    getSession: (sessionId) => ({ sessionId, acpSessionId: `acp-${sessionId}`, connection }),
    preparePromptDispatch: () => {
      prepared += 1
      return { invoke: async () => ({ stopReason: "end_turn" }) }
    },
    enqueueSteering: (sessionId, blocks) => {
      captured.push(sessionId, ...blocks.map((block) => block.text))
      store.selectConversation("beta")
      store.applyEvent(sessionId, {
        kind: "steering_enqueue",
        activeTurnId: "turn-alpha",
        requestId: "request-alpha",
        generation: 4,
        blocks,
      })
      return { kind: "queued", requestId: "request-alpha" }
    },
    resolvePermission() {},
    newMessageId: () => "ordinary-user-message",
  })
  return { store, actions, captured, prepared: () => prepared }
}

describe("ControllerActions steering boundary", () => {
  it("rejects an active ordinary prompt before transcript mutation or dispatch preparation", async () => {
    const test = setup()
    const before = test.store.getState().sessions.alpha!.turns

    await expect(test.actions.sendPrompt("competing prompt")).resolves.toBeNull()

    expect(test.prepared()).toBe(0)
    expect(test.store.getState().sessions.alpha!.turns).toBe(before)
  })

  it("accepts non-empty steering for the focused session captured at invocation", () => {
    const test = setup()

    expect(test.actions.steer("  preserve exact direction  ")).toEqual({
      kind: "queued",
      requestId: "request-alpha",
    })
    expect(test.captured).toEqual(["alpha", "  preserve exact direction  "])
    expect(test.store.getState().workspace.selectedVisibleId).toBe("beta")
    expect(test.store.getState().sessions.alpha!.steering.queue[0]?.blocks).toEqual([
      { type: "text", text: "  preserve exact direction  " },
    ])
    expect(test.store.getState().sessions.beta!.steering.queue).toEqual([])
  })

  it("fails softly for empty, inactive, and recovering submissions", () => {
    const test = setup()
    expect(test.actions.steer("   ")).toEqual({ kind: "unavailable", reason: "empty" })

    test.store.applyEvent("alpha", { kind: "status", status: "idle" })
    expect(test.actions.steer("later", "alpha")).toEqual({ kind: "unavailable", reason: "inactive" })

    test.store.applyEvent("alpha", { kind: "status", status: "working" })
    test.actions.steer("recover me", "alpha")
    test.store.applyEvent("alpha", {
      kind: "steering_recover",
      requestId: "request-alpha",
      generation: 4,
    })
    expect(test.actions.steer("do not overwrite", "alpha")).toEqual({
      kind: "unavailable",
      reason: "recovering",
    })
  })

  it("acknowledges only the matching recovery payload", () => {
    const test = setup()
    test.actions.steer("recover me", "alpha")
    test.store.applyEvent("alpha", {
      kind: "steering_recover",
      requestId: "request-alpha",
      generation: 4,
    })

    test.actions.acknowledgeSteeringRecovery("alpha", "stale")
    expect(test.store.getState().sessions.alpha!.steering.recovery).not.toBeNull()
    test.actions.acknowledgeSteeringRecovery("alpha", "request-alpha")
    expect(test.store.getState().sessions.alpha!.steering.recovery).toBeNull()
  })
})
describe("ControllerActions Context Build boundary", () => {
  const input = {
    parentId: "alpha",
    draft: { kind: "start_fresh", original: "Curate the controller lifecycle" },
  } as const

  it("fails closed when no controller-owned explore-v2 seam is installed", async () => {
    const store = createAppStore({
      seeds: [{ id: "alpha", providerKind: "codex", title: "Alpha", cwd: "/repo" }],
    })
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
    })

    expect(actions.contextBuildAvailability(input)).toEqual({
      kind: "denied",
      reason: "missing_evidence",
    })
    await expect(actions.startContextBuild(input)).resolves.toEqual({
      kind: "denied",
      reason: "missing_evidence",
    })
  })

  it("contains a rejected launch and reports it without rejecting into the caller", async () => {
    const store = createAppStore({
      seeds: [{ id: "alpha", providerKind: "codex", title: "Alpha", cwd: "/repo" }],
    })
    const failure = new Error("launch seam failed")
    const errors: unknown[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
      contextBuildAvailability: () => ({ kind: "available" }),
      startContextBuild: async () => { throw failure },
      onError: (_sessionId, error) => errors.push(error),
    })

    expect(actions.contextBuildAvailability(input)).toEqual({ kind: "available" })
    await expect(actions.startContextBuild(input)).resolves.toEqual({
      kind: "denied",
      reason: "startup_failed",
    })
    expect(errors).toEqual([failure])
  })
})
