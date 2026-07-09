import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { FOCUS_MARKER, StatusStrip, STATUS_LABELS } from "./StatusStrip.tsx"

/** Mount the strip alone, on a single row, so assertions read one line of frame. */
async function renderStrip(controller: ReturnType<typeof createFakeController>) {
  return testRender(
    <CockpitProvider controller={controller}>
      <StatusStrip />
    </CockpitProvider>,
    { width: 80, height: 3 },
  )
}

describe("StatusStrip", () => {
  it("shows working for the busy agent and idle for the other", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)
    await waitForFrame((f) => f.includes("Claude Code"))

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    })

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.working))
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.working}`)
    expect(frame).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })

  it("shows awaiting approval while an agent is blocked on the user", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)
    await waitForFrame((f) => f.includes("Codex"))

    await actAsync(() => {
      controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    })

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.awaiting_approval))
    expect(frame).toContain(`Codex: ${STATUS_LABELS.awaiting_approval}`)

    await destroyMounted(renderer)
  })

  it("marks an agent that never came up as not ready, whatever its session status says", async () => {
    const runtimes: AgentRuntimeState[] = [
      readyRuntimes()[0]!,
      { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", ready: false, error: "codex-acp: command not found" },
    ]
    const controller = createFakeController({ runtimes })
    const { renderer, waitForFrame } = await renderStrip(controller)

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.not_ready))
    expect(frame).toContain(`Codex: ${STATUS_LABELS.not_ready}`)
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.idle}`)
    expect(frame).not.toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })

  it("marks only the focused agent, and moves the marker when focus moves", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)

    const initial = await waitForFrame((f) => f.includes(FOCUS_MARKER))
    expect(initial).toContain(`${FOCUS_MARKER} Claude Code`)
    expect(initial).not.toContain(`${FOCUS_MARKER} Codex`)

    await actAsync(() => {
      controller.actions.switchFocus()
    })

    const switched = await waitForFrame((f) => f.includes(`${FOCUS_MARKER} Codex`))
    expect(switched).not.toContain(`${FOCUS_MARKER} Claude Code`)

    await destroyMounted(renderer)
  })

  it("keeps the keymap hint visible next to both agents", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)

    const frame = await waitForFrame((f) => f.includes("F1 help"))
    expect(frame).toContain("^O switch")

    await destroyMounted(renderer)
  })

  it("fits both agents' longest state, plus the hint, into 80 columns", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderStrip(controller)

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "awaiting_approval" })
      controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    })

    const frame = await waitForFrame((f) => f.includes(`Codex: ${STATUS_LABELS.awaiting_approval}`))
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.awaiting_approval}`)
    expect(frame).toContain("F1 help")

    const strip = captureCharFrame().split("\n")[0] ?? ""
    expect([...strip].length).toBe(80)

    await destroyMounted(renderer)
  })
})
