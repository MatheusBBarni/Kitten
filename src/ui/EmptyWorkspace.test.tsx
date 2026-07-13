import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { createAppStore } from "../store/appStore.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import { EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import {
  BACKGROUND_WORK_LABEL,
  EMPTY_WORKSPACE_TITLE,
  EmptyWorkspace,
  NEW_CONVERSATION_LABEL,
  NO_PROVIDER_NOTICE,
} from "./EmptyWorkspace.tsx"
import { PROMPT_DISABLED_TITLE } from "./PromptEditor.tsx"

function pointOf(frame: string, text: string): { x: number; y: number } {
  const lines = frame.replace(/\n$/, "").split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${text} in frame`)
  return { x: lines[y]!.indexOf(text) + 1, y }
}

describe("EmptyWorkspace", () => {
  it("offers New Conversation and renders the no-provider notice after a null result", async () => {
    const controller = createFakeController({ store: createAppStore({ seeds: [] }), runtimes: [] })
    const setup = await testRender(
      <CockpitProvider controller={controller}><EmptyWorkspace /></CockpitProvider>,
      { width: 60, height: 8, kittyKeyboard: true },
    )
    const initial = await setup.waitForFrame((frame) => frame.includes(EMPTY_WORKSPACE_TITLE))
    expect(initial).toContain(NEW_CONVERSATION_LABEL)
    expect(initial).not.toContain(NO_PROVIDER_NOTICE)

    const point = pointOf(initial, NEW_CONVERSATION_LABEL)
    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    const failed = await setup.waitForFrame((frame) => frame.includes(NO_PROVIDER_NOTICE))

    expect(controller.calls.createConversation).toBe(1)
    expect(failed).toContain(NO_PROVIDER_NOTICE)
    expect(controller.store.getState().workspace.order).toEqual([])
    await destroyMounted(setup.renderer)
  })

  it("keeps background work reachable through Sessions", async () => {
    const store = createAppStore({ seeds: [{ id: "bg", providerKind: "codex", title: "Background", cwd: "/work" }] })
    store.backgroundConversation("bg")
    const controller = createFakeController({ store, runtimes: [] })
    const setup = await testRender(
      <CockpitProvider controller={controller}><EmptyWorkspace /></CockpitProvider>,
      { width: 60, height: 8, kittyKeyboard: true },
    )
    const frame = await setup.waitForFrame((value) => value.includes(BACKGROUND_WORK_LABEL))

    const point = pointOf(frame, BACKGROUND_WORK_LABEL)
    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))

    expect(controller.store.getState().overlays.sessions).toBe(true)
    expect(controller.store.getState().workspace.selectedVisibleId).toBeNull()
    await destroyMounted(setup.renderer)
  })

  it("mounts as the cockpit workspace without fabricating a transcript or runtime", async () => {
    const controller = createFakeController({ store: createAppStore({ seeds: [] }), runtimes: [] })
    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: 60,
      height: 14,
      kittyKeyboard: true,
    })
    const frame = await setup.waitForFrame((value) => value.includes(EMPTY_WORKSPACE_TITLE))

    expect(frame).toContain(NEW_CONVERSATION_LABEL)
    expect(frame).toContain(PROMPT_DISABLED_TITLE)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)
    expect(controller.runtimes()).toEqual([])
    expect(controller.store.getState().workspace.selectedVisibleId).toBeNull()
    await destroyMounted(setup.renderer)
  })
})
