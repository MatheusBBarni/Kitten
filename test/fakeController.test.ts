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
    await controller.actions.cancel("codex")
    controller.actions.respondPermission({ outcome: "cancelled" })
    await controller.dispose()

    expect(controller.calls.sendPrompt).toEqual([{ input: "hello", sessionId: undefined }])
    expect(controller.calls.cancel).toEqual(["codex"])
    expect(controller.calls.respondPermission).toEqual([{ outcome: "cancelled" }])
    expect(controller.calls.dispose).toBe(1)
  })

  it("closes the approval slot on an answer, like the real controller does", () => {
    const controller = createFakeController()
    controller.store.openApproval({
      sessionId: "claude-code",
      request: { sessionId: "s1", toolCall: { toolCallId: "call-1" }, options: [] },
    })

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })

    expect(controller.store.getState().overlays.approval).toBeNull()
  })

  it("cycles focus in the store, like the real controller does", () => {
    const controller = createFakeController()
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

    controller.actions.switchFocus()
    expect(controller.store.getState().focusedSessionId).toBe("codex")

    controller.actions.switchFocus("claude-code")
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
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
