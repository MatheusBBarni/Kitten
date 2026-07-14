import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"
import { useMemo } from "react"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import {
  selectSessionStatus,
  selectStatuslineOverlay,
  selectStatuslinePreference,
} from "../store/selectors.ts"
import { CockpitProvider, useAppSelector, useController } from "./cockpitContext.tsx"

/** Counts how many times each agent's status subscriber actually re-rendered. */
const renders: Record<string, number> = {}
let statuslineRenders = 0

function StatusProbe({ agentId }: { agentId: "claude-code" | "codex" }) {
  const selector = useMemo(() => selectSessionStatus(agentId), [agentId])
  const status = useAppSelector(selector)
  renders[agentId] = (renders[agentId] ?? 0) + 1
  return <text>{`${agentId}=${status}`}</text>
}

function ControllerProbe() {
  const controller = useController()
  return <text>{`agents=${controller.runtimes().length}`}</text>
}

function StatuslineStateProbe() {
  const preference = useAppSelector(selectStatuslinePreference)
  const overlay = useAppSelector(selectStatuslineOverlay)
  statuslineRenders++
  return (
    <text>{`ack=${preference.llmDisclosureAcknowledged};phase=${overlay?.phase ?? "closed"}`}</text>
  )
}

describe("useController", () => {
  it("exposes the controller the provider was given", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <ControllerProbe />
      </CockpitProvider>,
      { width: 40, height: 4 },
    )

    expect(await waitForFrame((f) => f.includes("agents=2"))).toContain("agents=2")
    await destroyMounted(renderer)
  })
})

describe("useAppSelector", () => {
  it("re-renders only the subscriber whose slice changed", async () => {
    const controller = createFakeController()
    renders["claude-code"] = 0
    renders["codex"] = 0

    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <StatusProbe agentId="claude-code" />
        <StatusProbe agentId="codex" />
      </CockpitProvider>,
      { width: 40, height: 6 },
    )
    await waitForFrame((f) => f.includes("codex=idle"))

    const before = { ...renders }

    // A whole conversation streaming into one agent must not wake the other's view.
    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
      controller.store.applyEvent("claude-code", { kind: "agent_message", messageId: "m1", textDelta: "hello" })
    })

    expect(await waitForFrame((f) => f.includes("claude-code=working"))).toContain("codex=idle")
    expect(renders["claude-code"]).toBeGreaterThan(before["claude-code"]!)
    expect(renders["codex"]).toBe(before["codex"]!)

    await destroyMounted(renderer)
  })

  it("ignores a store change that leaves the selected slice untouched", async () => {
    const controller = createFakeController()
    renders["claude-code"] = 0
    renders["codex"] = 0

    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <StatusProbe agentId="codex" />
      </CockpitProvider>,
      { width: 40, height: 4 },
    )
    await waitForFrame((f) => f.includes("codex=idle"))
    const before = renders["codex"]!

    await actAsync(() => {
      controller.store.applyEvent("codex", { kind: "status", status: "idle" })
      controller.store.setFocus("codex")
    })

    expect(renders["codex"]).toBe(before)
    await destroyMounted(renderer)
  })

  it("composes reactive statusline preference and modal transitions without streamed-update renders", async () => {
    const controller = createFakeController()
    statuslineRenders = 0
    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <StatuslineStateProbe />
      </CockpitProvider>,
      { width: 48, height: 2 },
    )
    expect(await waitForFrame((frame) => frame.includes("ack=false;phase=closed"))).toContain(
      "ack=false;phase=closed",
    )

    await actAsync(() => {
      controller.store.setStatuslinePreference({ llmDisclosureAcknowledged: true, layout: null })
    })
    expect(await waitForFrame((frame) => frame.includes("ack=true;phase=closed"))).toContain(
      "ack=true;phase=closed",
    )

    await actAsync(() => {
      controller.store.openStatusline({
        sessionId: "claude-code",
        phase: "preview",
        requestText: "folder then model",
        layout: { separator: " · ", line: ["FOLDER", "MODEL"] },
        preset: null,
      })
    })
    expect(await waitForFrame((frame) => frame.includes("ack=true;phase=preview"))).toContain(
      "ack=true;phase=preview",
    )
    const beforeStream = statuslineRenders

    await actAsync(() => {
      controller.store.applyEvent("codex", {
        kind: "agent_message",
        messageId: "other-stream",
        textDelta: "unrelated token",
      })
    })
    expect(statuslineRenders).toBe(beforeStream)

    await actAsync(() => controller.store.closeStatusline())
    expect(await waitForFrame((frame) => frame.includes("ack=true;phase=closed"))).toContain(
      "ack=true;phase=closed",
    )
    expect(statuslineRenders).toBeGreaterThan(beforeStream)

    await destroyMounted(renderer)
  })
})
