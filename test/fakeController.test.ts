import { describe, expect, it } from "bun:test"

import { createFakeController } from "./fakeController.ts"

/**
 * The UI tests assert against this double's call log and its store, so the double
 * itself has to behave: record every call, and really move focus when asked.
 */
describe("createFakeController", () => {
  it("records every action the cockpit invokes", async () => {
    const controller = createFakeController()

    expect(await controller.actions.sendPrompt("hello")).toBeNull()
    controller.actions.fileSelectorOpened("codex")
    controller.actions.fileSelectorDiscovery("codex", "ready", 18)
    controller.actions.fileSelectorQueryRendered("codex", "results", 4)
    controller.actions.fileSelectorSelected("codex", 240)
    controller.actions.fileSelectorCorrected("codex")
    await controller.actions.cancel("codex")
    controller.actions.respondPermission({ outcome: "cancelled" })
    controller.actions.respondClarification("clarification-1", 3, { kind: "cancelled" })
    const exportInput = {
      sessionId: "codex",
      destination: "/operator/context.md",
      writeConfirmed: true,
      overwriteConfirmed: false,
    } as const
    expect(await controller.actions.exportContextPack(exportInput)).toEqual({
      kind: "blocked",
      reason: "sealed_unavailable",
    })
    await controller.dispose()

    expect(controller.calls.sendPrompt).toEqual([{ input: "hello", sessionId: undefined }])
    expect(controller.calls.fileSelectorOpened).toEqual(["codex"])
    expect(controller.calls.fileSelectorDiscovery).toEqual([{ sessionId: "codex", outcome: "ready", durationMs: 18 }])
    expect(controller.calls.fileSelectorQueryRendered).toEqual([{ sessionId: "codex", state: "results", durationMs: 4 }])
    expect(controller.calls.fileSelectorSelected).toEqual([{ sessionId: "codex", durationMs: 240 }])
    expect(controller.calls.fileSelectorCorrected).toEqual(["codex"])
    expect(controller.calls.cancel).toEqual(["codex"])
    expect(controller.calls.respondPermission).toEqual([{ outcome: "cancelled" }])
    expect(controller.calls.respondClarification).toEqual([{
      requestId: "clarification-1",
      generation: 3,
      outcome: { kind: "cancelled" },
    }])
    expect(controller.calls.exportContextPack).toEqual([exportInput])
    expect(controller.calls.dispose).toBe(1)
  })

  it("models the expanded lifecycle action boundary for UI tests", async () => {
    const controller = createFakeController()
    const created = await controller.actions.createConversation()
    expect(created).toBe("fake-created-1")
    expect(controller.isReady(created!)).toBe(true)

    controller.actions.renameConversation(created!, "  Fresh tab  ")
    controller.actions.backgroundConversation(created!)
    controller.actions.reopenConversation(created!)
    expect(controller.store.getState().workspace.conversations[created!]?.displayName).toBe("Fresh tab")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(created)

    expect(await controller.actions.closeConversation(created!, "close")).toEqual({ outcome: "closed" })
    expect(controller.runtime(created!)).toBeUndefined()
    expect(controller.calls.createConversation).toBe(1)
    expect(controller.calls.closeConversation).toEqual([{ sessionId: created!, choice: "close" }])
  })

  it("models delegated launch, steer, and idempotent cancellation for UI tests", async () => {
    const controller = createFakeController({
      sendPrompt: async () => ({ stopReason: "end_turn" }),
    })
    const childId = await controller.actions.startDelegatedChild({
      parentId: "claude-code",
      task: "Inspect the fake boundary",
      desiredOutcome: "A deterministic child snapshot",
    })

    expect(childId).toBe("fake-delegated-1")
    expect(controller.runtime(childId!)).toMatchObject({ ready: true, cwd: process.cwd() })
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")
    expect(await controller.actions.steerDelegatedChild(childId!, "Continue")).toEqual({ stopReason: "end_turn" })

    await controller.actions.cancelDelegatedChild(childId!)
    await controller.actions.cancelDelegatedChild(childId!)
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("cancelled")
    expect(await controller.actions.steerDelegatedChild(childId!, "Too late")).toBeNull()
    expect(controller.calls.startDelegatedChild).toHaveLength(1)
    expect(controller.calls.steerDelegatedChild).toEqual([
      { childId: childId!, text: "Continue" },
      { childId: childId!, text: "Too late" },
    ])
    expect(controller.calls.cancelDelegatedChild).toEqual([childId!, childId!])
  })

  it("records managed cleanup targets and publishes bounded review outcomes", async () => {
    const controller = createFakeController({
      cleanupManagedWorktree: () => ({ kind: "refused", reason: "dirty" }),
    })
    controller.store.addSession({
      id: "managed-child",
      providerKind: "codex",
      title: "Managed child",
      cwd: "/repo/.kitten/worktrees/managed-child",
      worktreeBinding: {
        kind: "managed",
        id: "binding-managed-child",
        repoRoot: "/repo",
        worktreePath: "/repo/.kitten/worktrees/managed-child",
        branch: "kitten/managed-child",
        baseBranch: "main",
        baseSha: "0123456789abcdef",
        ownerSessionId: "managed-child",
        availability: "available",
      },
    })

    expect(await controller.actions.cleanupManagedWorktree("managed-child")).toEqual({
      kind: "refused",
      reason: "dirty",
    })
    expect(controller.calls.cleanupManagedWorktree).toEqual(["managed-child"])
    expect(controller.store.getState().sessions["managed-child"]?.worktreeBinding).toMatchObject({
      availability: "cleanup_refused",
      reason: "dirty",
    })
  })

  it("keeps typed explore availability and launch separate from the legacy delegation seam", async () => {
    const controller = createFakeController({
      exploreAvailability: (parentId) => parentId === "claude-code"
        ? { kind: "available" }
        : { kind: "denied", reason: "parent-ineligible" },
      startExploreChild: (input) => ({ kind: "started", childId: `explore-${input.parentId}` }),
    })

    expect(controller.actions.exploreAvailability("claude-code")).toEqual({ kind: "available" })
    expect(controller.actions.exploreAvailability("codex")).toEqual({
      kind: "denied",
      reason: "parent-ineligible",
    })
    expect(await controller.actions.startExploreChild({
      parentId: "claude-code",
      task: "Inspect",
      desiredOutcome: "Report",
    })).toEqual({ kind: "started", childId: "explore-claude-code" })
    expect(controller.calls.startExploreChild).toEqual([{
      parentId: "claude-code",
      task: "Inspect",
      desiredOutcome: "Report",
    }])
    expect(controller.calls.startDelegatedChild).toEqual([])
  })

  it("records statusline acknowledgement and confirmation without an ACP connection", async () => {
    const controller = createFakeController({ runtimes: [] })
    const layout = { separator: " | ", line: ["FOLDER", "MODEL"] } as const

    expect(await controller.actions.acknowledgeStatuslineDisclosure()).toEqual({ outcome: "saved" })
    expect(await controller.actions.confirmStatusline(layout)).toEqual({ outcome: "saved" })

    expect(controller.calls.acknowledgeStatuslineDisclosure).toBe(1)
    expect(controller.calls.confirmStatusline).toEqual([layout])
    expect(controller.store.getState().preferences.statusline).toEqual({
      llmDisclosureAcknowledged: true,
      layout,
    })
  })

  it("applies history actions through the real store contract selectors read", () => {
    const controller = createFakeController()

    controller.actions.recordPromptHistory("first")
    controller.actions.recordPromptHistory("second", "codex")

    expect(controller.actions.navigatePromptHistory("previous", "codex")).toEqual({
      text: "second",
      historyIndex: 0,
      total: 1,
    })
    expect(controller.store.getState().sessions.codex!.promptHistory).toEqual({
      entries: ["second"],
      cursor: 0,
    })
    expect(controller.store.getState().sessions["claude-code"]!.promptHistory).toEqual({
      entries: ["first"],
      cursor: null,
    })
    expect(controller.calls.recordPromptHistory).toEqual([
      { text: "first", sessionId: undefined },
      { text: "second", sessionId: "codex" },
    ])
    expect(controller.calls.navigatePromptHistory).toEqual([{ direction: "previous", sessionId: "codex" }])
  })

  it("closes the approval slot on an answer, like the real controller does", () => {
    const controller = createFakeController()
    controller.store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: { sessionId: "s1", toolCall: { toolCallId: "call-1" }, options: [] },
    })

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })

    expect(controller.store.getState().overlays.approval).toBeNull()
  })

  it("closes only the matching clarification projection", () => {
    const controller = createFakeController()
    controller.store.openClarification({
      requestId: "clarification-1",
      generation: 4,
      sessionId: "codex",
      title: "Codex",
      cwd: "/workspace/kitten",
      payload: {
        prompt: "Choose",
        fields: [{ id: "choice", label: "Choice", mode: "text", required: true }],
      },
    })

    controller.actions.respondClarification("missing", 4, { kind: "cancelled" })
    expect(controller.store.getState().overlays.clarification?.requestId).toBe("clarification-1")

    controller.actions.respondClarification("clarification-1", 4, { kind: "cancelled" })
    expect(controller.store.getState().overlays.clarification).toBeNull()
  })

  it("cycles focus in the store, like the real controller does", () => {
    const controller = createFakeController()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    controller.actions.switchFocus()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    controller.actions.switchFocus("claude-code")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(controller.calls.switchFocus).toEqual([undefined, "claude-code"])
  })

  it("reports both agents ready by default", () => {
    const controller = createFakeController()
    expect(controller.runtimes().map((r) => r.sessionId)).toEqual(["claude-code", "codex"])
    expect(controller.isReady("codex")).toBe(true)
    expect(controller.runtime("codex")?.displayName).toBe("Codex")
  })

  it("reports an agent the config does not name as neither present nor ready", () => {
    const controller = createFakeController({ runtimes: [] })
    expect(controller.runtime("codex")).toBeUndefined()
    expect(controller.isReady("codex")).toBe(false)
  })
})
