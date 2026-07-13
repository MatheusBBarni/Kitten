import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { SessionSeed, SessionStatus } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { selectVisibleTabs, type WorkspaceConversationView } from "../store/selectors.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import { SESSIONS_TITLE } from "./SessionsOverlay.tsx"
import {
  layoutTabStrip,
  SHARED_WORKSPACE_LABEL,
  TAB_MARKER,
  TAB_OVERFLOW_LABEL,
  TAB_SELECTED_MARKER,
  TabWorkspace,
} from "./TabWorkspace.tsx"

function pointOf(frame: string, text: string): { x: number; y: number } {
  const lines = frame.replace(/\n$/, "").split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${text} in frame`)
  return { x: lines[y]!.indexOf(text) + 1, y }
}

function view(id: string, selected = false): WorkspaceConversationView {
  return {
    id,
    displayName: id,
    label: id,
    lifecycle: "visible",
    providerKind: "codex",
    cwd: `/work/${id}`,
    status: "idle",
    selected,
    needsAttention: false,
    attentionSeen: true,
    availability: { kind: "ready" },
    teardownState: "open",
    duplicateIndex: 1,
    duplicateCount: 1,
    sharedWorkspaceCount: 1,
  }
}

function fleet(count: number, sameCwd = false): { seeds: SessionSeed[]; runtimes: AgentRuntimeState[] } {
  const seeds: SessionSeed[] = Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    providerKind: index % 2 === 0 ? "claude-code" : "codex",
    title: `Session ${index + 1}`,
    cwd: sameCwd ? "/work/shared" : `/work/${index + 1}`,
  }))
  return {
    seeds,
    runtimes: seeds.map((seed) => ({
      sessionId: seed.id,
      providerKind: seed.providerKind,
      displayName: seed.title,
      title: seed.title,
      cwd: seed.cwd,
      ready: true,
      acpSessionId: `acp-${seed.id}`,
    })),
  }
}

async function renderStrip(controller: FakeController, width = 120) {
  const setup = await testRender(
    <CockpitProvider controller={controller}><TabWorkspace /></CockpitProvider>,
    { width, height: 4, kittyKeyboard: true },
  )
  await setup.renderOnce()
  return setup
}

describe("TabWorkspace presentation", () => {
  it("renders workspace order with selected and non-color status cues", async () => {
    const { seeds, runtimes } = fleet(5)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    const statuses: SessionStatus[] = ["idle", "working", "awaiting_approval", "error", "finished"]
    statuses.forEach((status, index) => controller.store.applyEvent(`s${index + 1}`, { kind: "status", status }))
    const setup = await renderStrip(controller, 240)
    const frame = setup.captureCharFrame()

    expect(frame.indexOf("Session 1")).toBeLessThan(frame.indexOf("Session 5"))
    expect(frame).toContain(TAB_SELECTED_MARKER)
    expect(frame).toContain(TAB_MARKER)
    for (const cue of ["idle", "working", "approval", "error", "finished"]) expect(frame).toContain(cue)

    await destroyMounted(setup.renderer)
  })

  it("shows deterministic duplicate labels and shared-workspace cues from selectors", async () => {
    const { seeds, runtimes } = fleet(2, true)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.renameConversation("s1", "Build")
    controller.store.renameConversation("s2", "Build")
    const setup = await renderStrip(controller)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Build (1)")
    expect(frame).toContain("Build (2)")
    expect(frame.split(`${SHARED_WORKSPACE_LABEL}×2`)).toHaveLength(3)

    await destroyMounted(setup.renderer)
  })

  it("selects exactly one mouse-down target through ControllerActions", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)
    const point = pointOf(setup.captureCharFrame(), `${TAB_MARKER} Codex`)

    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))

    expect(controller.calls.selectConversation).toEqual(["codex"])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await destroyMounted(setup.renderer)
  })

  it("keeps a selected tab, never wraps, and exposes hidden work through overflow", () => {
    const tabs = [view("one"), view("two"), view("three", true), view("four")]
    const layout = layoutTabStrip(tabs, 50, 1)

    expect(layout.visible.some((tab) => tab.id === "three")).toBe(true)
    expect(layout.visible.length).toBeLessThan(tabs.length)
    expect(layout.hiddenCount).toBe(tabs.length - layout.visible.length)
    expect(layout.overflowLabel).toContain(TAB_OVERFLOW_LABEL)
    expect(layout.overflowLabel).toContain("bg 1")
  })

  it("does not publish a tab-list change when only transcript content streams", () => {
    const controller = createFakeController()
    let notifications = 0
    const stop = controller.store.subscribeSelector(selectVisibleTabs, () => notifications++)

    controller.store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "stream" })

    expect(notifications).toBe(0)
    stop()
  })
})

describe("mounted cockpit tab integration", () => {
  it("mouse-selects a different transcript while background work remains live", async () => {
    const { seeds, runtimes } = fleet(3)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.applyEvent("s1", { kind: "user_message", messageId: "one", text: "first transcript" })
    controller.store.applyEvent("s2", { kind: "user_message", messageId: "two", text: "second transcript" })
    controller.store.backgroundConversation("s3")
    const setup = await testRender(<CockpitApp controller={controller} welcomeBannerVariant="none" />, {
      width: 100,
      height: 20,
      kittyKeyboard: true,
    })
    const first = await setup.waitForFrame((frame) => frame.includes("first transcript"))
    const point = pointOf(first, `${TAB_MARKER} Session 2`)

    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    const selected = await setup.waitForFrame((frame) => frame.includes("second transcript"))
    controller.store.applyEvent("s3", { kind: "agent_message", messageId: "bg", textDelta: "still live" })

    expect(selected).not.toContain("first transcript")
    expect(controller.store.getState().sessions.s3?.turns[0]).toMatchObject({ text: "still live" })
    expect(controller.store.getState().workspace.conversations.s3?.lifecycle).toBe("background")
    await destroyMounted(setup.renderer)
  })

  it("keeps a single-row strip after resize and reaches every hidden conversation via Sessions", async () => {
    const { seeds, runtimes } = fleet(4)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: 100,
      height: 20,
      kittyKeyboard: true,
    })
    await setup.waitForFrame((frame) => frame.includes("Session 1"))

    await actAsync(() => setup.resize(38, 20))
    const narrow = await setup.waitForFrame((frame) => frame.includes(TAB_OVERFLOW_LABEL))
    const tabRows = narrow.split("\n").filter((line) => line.includes(TAB_SELECTED_MARKER) || line.includes(TAB_MARKER))
    expect(tabRows.length).toBeLessThanOrEqual(1)

    const point = pointOf(narrow, TAB_OVERFLOW_LABEL)
    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    const overlay = await setup.waitForFrame((frame) => frame.includes(SESSIONS_TITLE) && frame.includes("Session 4"))
    for (const seed of seeds) expect(overlay).toContain(seed.title)

    await destroyMounted(setup.renderer)
  })
})
