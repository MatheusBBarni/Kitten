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

describe("ControllerActions default fail-closed seams", () => {
  it("refuses an unmanaged worktree when the controller does not install a cleanup seam", async () => {
    const store = createAppStore()
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
    })

    await expect(actions.cleanupManagedWorktree("child")).resolves.toEqual({
      kind: "refused",
      reason: "not_managed",
    })
  })
})

describe("ControllerActions Hard Stop continuation boundary", () => {
  it("queues exact blocks, acknowledges exact recovery, and gives local recovery Escape precedence", async () => {
    const store = createAppStore({ selectedVisibleId: "alpha" })
    store.addSession({ id: "alpha", providerKind: "codex", title: "Alpha", cwd: "/repo" }, {
      availability: { kind: "ready" },
    })
    const queued: unknown[] = []
    const acknowledged: unknown[] = []
    let recoverLocally = false
    let hardStops = 0
    let steeringTerminalizations = 0
    const actions = createControllerActions({
      store,
      getSession: (sessionId) => ({ sessionId, acpSessionId: "acp-alpha", connection }),
      resolvePermission() {},
      queuePostInterruptContinuation: (sessionId, blocks) => {
        queued.push(sessionId, blocks)
        return { kind: "queued", requestId: "continuation-1" }
      },
      acknowledgePostInterruptRecovery: (sessionId, requestId) => {
        acknowledged.push(sessionId, requestId)
      },
      recoverPostInterruptContinuation: () => recoverLocally,
      beginHardStop: () => {
        hardStops += 1
        return true
      },
      terminalizeSteering: () => {
        steeringTerminalizations += 1
      },
    })

    expect(actions.queuePostInterruptContinuation("   ", "alpha")).toEqual({
      kind: "unavailable",
      reason: "empty",
    })
    expect(actions.queuePostInterruptContinuation("continue exactly  ", "alpha")).toEqual({
      kind: "queued",
      requestId: "continuation-1",
    })
    expect(queued).toEqual([
      "alpha",
      [{ type: "text", text: "continue exactly  " }],
    ])
    actions.acknowledgePostInterruptRecovery("alpha", "continuation-1")
    expect(acknowledged).toEqual(["alpha", "continuation-1"])

    await actions.cancel("alpha")
    expect(hardStops).toBe(1)
    expect(steeringTerminalizations).toBe(1)
    recoverLocally = true
    await actions.cancel("alpha")
    expect(hardStops).toBe(1)
    expect(steeringTerminalizations).toBe(1)
  })
})

describe("ControllerActions Cursor recheck boundary", () => {
  it("contains a rejected controller seam and reports it only through onError", async () => {
    const store = createAppStore()
    const failure = new Error("recheck seam failed")
    const errors: Array<{ sessionId: string; error: unknown }> = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
      recheckCursor: async () => {
        throw failure
      },
      onError: (sessionId, error) => errors.push({ sessionId, error }),
    })

    expect(() => actions.recheckCursor("cursor-target")).not.toThrow()
    await Bun.sleep(0)

    expect(errors).toEqual([{ sessionId: "cursor-target", error: failure }])
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

describe("ControllerActions Context Pack custody boundary", () => {
  it("forwards every typed review, seal, fit, and Send Here result to the addressed session", async () => {
    const store = createAppStore({
      seeds: [{ id: "alpha", providerKind: "codex", title: "Alpha", cwd: "/repo" }],
    })
    const calls: unknown[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
      reviewContextPack: async (sessionId) => {
        calls.push(["review", sessionId])
        return { kind: "blocked", reason: "over_budget" }
      },
      mutateContextPackFileMembership: async (input) => {
        calls.push(["membership", input])
        return { kind: "stale", readRevision: input.readRevision, currentRevision: input.readRevision + 1 }
      },
      sealContextPack: async (sessionId, revision) => {
        calls.push(["seal", sessionId, revision])
        return { kind: "blocked", reason: "candidate_revision_mismatch" }
      },
      assessContextPackRecipientFit: (sessionId) => {
        calls.push(["fit", sessionId])
        return { kind: "insufficient", exactCount: 900, remaining: -10 }
      },
      sendContextPackHere: async (sessionId) => {
        calls.push(["send", sessionId])
        return {
          kind: "blocked",
          reason: "recipient_fit",
          fit: { kind: "unavailable", reason: "stale_evidence" },
        }
      },
      exportContextPack: async (input) => {
        calls.push(["export", input])
        return { kind: "blocked", reason: "overwrite_confirmation_required" }
      },
    })

    expect(await actions.reviewContextPack("alpha")).toEqual({ kind: "blocked", reason: "over_budget" })
    const membershipInput = {
      sessionId: "alpha",
      path: "src/a.ts",
      readRevision: 7,
      operation: "add",
    } as const
    expect(await actions.mutateContextPackFileMembership(membershipInput)).toEqual({
      kind: "stale",
      readRevision: 7,
      currentRevision: 8,
    })
    expect(await actions.sealContextPack("alpha", 7)).toEqual({
      kind: "blocked",
      reason: "candidate_revision_mismatch",
    })
    expect(actions.assessContextPackRecipientFit("alpha")).toEqual({
      kind: "insufficient",
      exactCount: 900,
      remaining: -10,
    })
    expect(await actions.sendContextPackHere("alpha")).toEqual({
      kind: "blocked",
      reason: "recipient_fit",
      fit: { kind: "unavailable", reason: "stale_evidence" },
    })
    const exportInput = {
      sessionId: "alpha",
      destination: "/operator/context.md",
      writeConfirmed: true,
      overwriteConfirmed: false,
    } as const
    expect(await actions.exportContextPack(exportInput)).toEqual({
      kind: "blocked",
      reason: "overwrite_confirmation_required",
    })
    expect(calls).toEqual([
      ["review", "alpha"],
      ["membership", membershipInput],
      ["seal", "alpha", 7],
      ["fit", "alpha"],
      ["send", "alpha"],
      ["export", exportInput],
    ])
  })

  it("contains rejected custody seams and fails closed without rejecting into the UI", async () => {
    const store = createAppStore()
    const errors: unknown[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission() {},
      reviewContextPack: async () => { throw new Error("review failed") },
      mutateContextPackFileMembership: async () => { throw new Error("membership failed") },
      sealContextPack: async () => { throw new Error("seal failed") },
      assessContextPackRecipientFit: () => { throw new Error("fit failed") },
      sendContextPackHere: async () => { throw new Error("send failed") },
      exportContextPack: async () => { throw new Error("EACCES /private/operator/path") },
      onError: (_sessionId, error) => errors.push(error),
    })

    expect(await actions.reviewContextPack("alpha")).toEqual({
      kind: "blocked",
      reason: "draft_unavailable",
    })
    expect(await actions.mutateContextPackFileMembership({
      sessionId: "alpha",
      path: "src/a.ts",
      readRevision: 1,
      operation: "remove",
    })).toEqual({ kind: "denied", reason: "mutation_failed" })
    expect(await actions.sealContextPack("alpha", 0)).toEqual({
      kind: "blocked",
      reason: "review_unavailable",
    })
    expect(actions.assessContextPackRecipientFit("alpha")).toEqual({
      kind: "unavailable",
      reason: "missing_evidence",
    })
    expect(await actions.sendContextPackHere("alpha")).toEqual({
      kind: "blocked",
      reason: "dispatch_failed",
    })
    expect(await actions.exportContextPack({
      sessionId: "alpha",
      destination: "/private/operator/path",
      writeConfirmed: true,
      overwriteConfirmed: false,
    })).toEqual({ kind: "blocked", reason: "filesystem_failure" })
    expect(errors).toHaveLength(4)
  })
})
