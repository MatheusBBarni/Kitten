import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"
import { useMemo } from "react"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { selectSessionStatus } from "../store/selectors.ts"
import { CockpitProvider, useAppSelector, useController } from "./cockpitContext.tsx"

/** Counts how many times each agent's status subscriber actually re-rendered. */
const renders: Record<string, number> = {}

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
})
