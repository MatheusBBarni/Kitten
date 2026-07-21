import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
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
import { MODEL_SELECT_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER, PROMPT_WORKSPACE_TITLE } from "./PromptEditor.tsx"
import { BACKGROUND_STATUS_LABEL, EMPTY_WORKSPACE_STATUS_LABEL } from "./StatusStrip.tsx"

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
    expect(frame).toContain(PROMPT_WORKSPACE_TITLE)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)
    expect(controller.runtimes()).toEqual([])
    expect(controller.store.getState().workspace.selectedVisibleId).toBeNull()
    await destroyMounted(setup.renderer)
  })

  it("keeps background-only controls inert and re-enables them for the reopened SessionId", async () => {
    const store = createAppStore({
      seeds: [{ id: "bg", providerKind: "codex", title: "Background", cwd: process.cwd() }],
      selectedVisibleId: "bg",
    })
    store.backgroundConversation("bg")
    const runtimes: AgentRuntimeState[] = [{
      sessionId: "bg",
      providerKind: "codex",
      displayName: "Background",
      title: "Background",
      cwd: process.cwd(),
      ready: true,
      acpSessionId: "bg-acp",
    }]
    const controller = createFakeController({ store, runtimes })
    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: 120,
      height: 20,
      kittyKeyboard: true,
    })

    const empty = await setup.waitForFrame((frame) => frame.includes(EMPTY_WORKSPACE_STATUS_LABEL))
    expect(empty).toContain(PROMPT_WORKSPACE_TITLE)
    expect(empty).toContain(`${BACKGROUND_STATUS_LABEL}: 1`)
    expect(empty).not.toContain(MODEL_SELECT_HINT)

    await actAsync(async () => {
      await setup.mockInput.typeText("/model")
      setup.mockInput.pressEnter()
      setup.mockInput.pressEscape()
      controller.store.openModelSelect({ sessionId: "bg" })
    })
    expect(controller.store.getState().overlays.modelSelect).toBeNull()
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.cancel).toEqual([])

    await actAsync(() => controller.actions.reopenConversation("bg"))
    await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
    await actAsync(async () => {
      await setup.mockInput.typeText("continue background work")
      setup.mockInput.pressEnter()
    })
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("bg")
    expect(controller.calls.sendPrompt).toEqual([{ input: "continue background work", sessionId: undefined }])

    await actAsync(async () => setup.mockInput.typeText("/model"))
    await setup.waitForFrame((frame) => frame.includes("Commands") && frame.includes("/model"))
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((frame) => frame.includes(MODEL_SELECT_HINT))
    expect(controller.store.getState().overlays.modelSelect).toEqual({ sessionId: "bg" })

    await destroyMounted(setup.renderer)
  })
})
