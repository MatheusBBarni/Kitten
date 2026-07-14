// Suite: `/statusline` keyboard modal
// Invariant: disclosure precedes the sole transcript request, every layout is reviewed, and only explicit confirmation persists.
// Boundary IN: real AppStore, OpenTUI keyboard routing/resizing, pure renderer, injected StatuslineFlow, and ControllerActions fake.
// Boundary OUT: real agent subprocesses and filesystem persistence.

import { describe, expect, it } from "bun:test"

import type { TextareaRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { StatuslineFlow } from "../app/statuslineFlow.ts"
import {
  STATUSLINE_RECOVERY_PRESETS,
  type StatuslineLayout,
  type StatuslineProposalResult,
} from "../core/statusline.ts"
import { createAppStore, type StatuslineOverlay as StatuslineOverlayState } from "../store/appStore.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { ClarificationPrompt } from "./ClarificationPrompt.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  STATUSLINE_CONFIG_LABEL,
  STATUSLINE_DISCLOSURE,
  STATUSLINE_PREVIEW_LABEL,
  STATUSLINE_REQUEST_PROMPT,
  STATUSLINE_SAVED_LABEL,
  STATUSLINE_TITLE,
  StatuslineOverlay,
  statuslineConfigChange,
} from "./StatuslineOverlay.tsx"

const WIDTH = 80
const HEIGHT = 24
const PROPOSAL: StatuslineLayout = { separator: " | ", line: ["FOLDER", "BRANCH", "MODEL"] }

interface RenderOptions {
  overlay?: StatuslineOverlayState
  proposal?: StatuslineProposalResult
  controller?: FakeController
  editor?: { current: TextareaRenderable | null }
  mountPriorityOverlays?: boolean
}

async function renderStatusline(options: RenderOptions = {}) {
  const controller = options.controller ?? createFakeController()
  const overlay = options.overlay ?? { sessionId: "claude-code", phase: "disclosure" }
  const editor = options.editor ?? { current: null }
  const requests: Array<{ text: string; sessionId: string }> = []
  const flow: StatuslineFlow = {
    async request(text, sessionId) {
      requests.push({ text, sessionId })
      return options.proposal ?? { kind: "proposal", layout: PROPOSAL }
    },
  }
  controller.store.openStatusline(overlay)

  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <box style={{ width: "100%", height: "100%", flexDirection: "column" }}>
        <textarea ref={editor} focused />
        <StatuslineOverlay flow={flow} />
        {options.mountPriorityOverlays ? <ApprovalPrompt /> : null}
        {options.mountPriorityOverlays ? <ClarificationPrompt /> : null}
      </box>
    </CockpitProvider>,
    { width: WIDTH, height: HEIGHT, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await setup.waitForFrame((frame) => frame.includes(STATUSLINE_TITLE))
  return { controller, editor, flow, requests, ...setup }
}

async function typeRequest(setup: Awaited<ReturnType<typeof renderStatusline>>, text: string): Promise<void> {
  await actAsync(async () => setup.mockInput.typeText(text))
  await setup.waitForFrame((frame) => frame.includes(text))
}

describe("StatuslineOverlay disclosure and request", () => {
  it("acknowledges once before requesting one visible normal-transcript proposal", async () => {
    const setup = await renderStatusline()
    expect(setup.captureCharFrame()).toContain("normal transcript")
    expect(STATUSLINE_DISCLOSURE).toContain("stores neither the request nor the reply")

    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => frame.includes(STATUSLINE_REQUEST_PROMPT))
    expect(setup.controller.calls.acknowledgeStatuslineDisclosure).toBe(1)
    expect(setup.requests).toHaveLength(0)

    await typeRequest(setup, "folder branch and model")
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => frame.includes(STATUSLINE_PREVIEW_LABEL))

    expect(setup.requests).toEqual([{ text: "folder branch and model", sessionId: "claude-code" }])
    expect(setup.controller.calls.sendPrompt).toHaveLength(0)
    await destroyMounted(setup.renderer)
  })

  it("declines into exactly the three recovery presets without acknowledgement or request", async () => {
    const setup = await renderStatusline()
    await actAsync(() => setup.mockInput.pressArrow("down"))
    await actAsync(() => setup.mockInput.pressEnter())
    const frame = await setup.waitForFrame((candidate) => candidate.includes("declined the agent request"))

    for (const preset of STATUSLINE_RECOVERY_PRESETS) expect(frame).toContain(preset.name)
    expect(frame).not.toContain("Acknowledge and continue")
    expect(setup.controller.calls.acknowledgeStatuslineDisclosure).toBe(0)
    expect(setup.requests).toHaveLength(0)
    await destroyMounted(setup.renderer)
  })
})

describe("StatuslineOverlay review and recovery", () => {
  it("shows the rendered line and exact config change, then confirms once", async () => {
    const setup = await renderStatusline({
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "workspace first",
        layout: PROPOSAL,
        preset: null,
      },
    })
    const frame = setup.captureCharFrame()
    expect(frame).toContain(STATUSLINE_PREVIEW_LABEL)
    expect(frame).toContain(STATUSLINE_CONFIG_LABEL)
    expect(statuslineConfigChange(PROPOSAL)).toBe(
      '{"statusline":{"llmDisclosureAcknowledged":true,"separator":" | ","line":["FOLDER","BRANCH","MODEL"]}}',
    )
    expect(frame).toContain('"llmDisclosureAcknowledged":true')
    expect(frame).toContain('"line":["FOLDER","BRANCH","MODEL"]')
    expect(frame).toContain(STATUSLINE_SAVED_LABEL)

    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((candidate) => !candidate.includes(STATUSLINE_TITLE))
    expect(setup.controller.calls.confirmStatusline).toEqual([PROPOSAL])
    expect(setup.controller.store.getState().preferences.statusline.layout).toEqual(PROPOSAL)
    await destroyMounted(setup.renderer)
  })

  it("cancels a valid proposal without confirming it", async () => {
    const setup = await renderStatusline({
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "workspace first",
        layout: PROPOSAL,
        preset: null,
      },
    })
    await actAsync(() => setup.mockInput.pressArrow("down"))
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((candidate) => !candidate.includes(STATUSLINE_TITLE))

    expect(setup.controller.calls.confirmStatusline).toHaveLength(0)
    expect(setup.controller.store.getState().preferences.statusline.layout).toBeNull()
    await destroyMounted(setup.renderer)
  })

  for (const outcome of ["invalid-response", "unavailable"] as const) {
    it(`explains ${outcome} and exposes exactly Workspace, Agent, and Compact`, async () => {
      const setup = await renderStatusline({
        overlay: { sessionId: "claude-code", phase: "request", requestText: "" },
        proposal: { kind: outcome, reason: `${outcome} recovery reason` },
      })
      await typeRequest(setup, "compact please")
      await actAsync(() => setup.mockInput.pressEnter())
      const frame = await setup.waitForFrame((candidate) => candidate.includes(`${outcome} recovery reason`))

      expect(STATUSLINE_RECOVERY_PRESETS.map(({ name }) => name)).toEqual(["Workspace", "Agent", "Compact"])
      for (const preset of STATUSLINE_RECOVERY_PRESETS) expect(frame).toContain(preset.name)
      expect(setup.requests).toHaveLength(1)
      await destroyMounted(setup.renderer)
    })
  }

  it("routes a preset through the same preview and confirmation path", async () => {
    const setup = await renderStatusline({
      overlay: {
        sessionId: "claude-code",
        phase: "presets",
        requestText: "",
        reason: "Local recovery",
        selectedPreset: null,
      },
    })
    await actAsync(() => setup.mockInput.pressArrow("down"))
    await actAsync(() => setup.mockInput.pressArrow("down"))
    expect(setup.controller.store.getState().overlays.statusline).toMatchObject({ selectedPreset: "Compact" })
    await actAsync(() => setup.mockInput.pressEnter())
    const preview = await setup.waitForFrame((frame) => frame.includes("Compact recovery layout"))
    expect(preview).toContain(STATUSLINE_PREVIEW_LABEL)
    expect(preview).toContain(STATUSLINE_CONFIG_LABEL)

    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => !frame.includes(STATUSLINE_TITLE))
    expect(setup.controller.calls.confirmStatusline).toEqual([STATUSLINE_RECOVERY_PRESETS[2]!.layout])
    await destroyMounted(setup.renderer)
  })

  it("turns acknowledgement and confirmation errors into visible failure states", async () => {
    const controller = createFakeController({
      acknowledgeStatuslineResult: { outcome: "error", message: "ack write failed" },
    })
    const acknowledgement = await renderStatusline({ controller })
    await actAsync(() => acknowledgement.mockInput.pressEnter())
    expect(await acknowledgement.waitForFrame((frame) => frame.includes("ack write failed"))).toContain("Open recovery layouts")
    await destroyMounted(acknowledgement.renderer)

    const confirmController = createFakeController({
      confirmStatuslineResult: { outcome: "error", message: "layout write failed" },
    })
    const confirmation = await renderStatusline({
      controller: confirmController,
      overlay: { sessionId: "claude-code", phase: "preview", requestText: "x", layout: PROPOSAL, preset: null },
    })
    await actAsync(() => confirmation.mockInput.pressEnter())
    expect(await confirmation.waitForFrame((frame) => frame.includes("layout write failed"))).toContain("Open recovery layouts")
    expect(confirmController.store.getState().preferences.statusline.layout).toBeNull()
    await destroyMounted(confirmation.renderer)
  })

  it("keeps failure recovery and cancellation visually aligned with keyboard selection", async () => {
    const setup = await renderStatusline({
      overlay: { sessionId: "claude-code", phase: "failure", requestText: "x", reason: "write failed" },
    })
    expect(setup.captureCharFrame()).toContain("▸ Open recovery layouts")
    await actAsync(() => setup.mockInput.pressArrow("down"))
    expect(await setup.waitForFrame((frame) => frame.includes("▸ Cancel"))).toContain("▸ Cancel")
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => !frame.includes(STATUSLINE_TITLE))
    await destroyMounted(setup.renderer)
  })
})

describe("StatuslineOverlay keyboard and width behavior", () => {
  it("consumes text, arrows, Enter, and Escape instead of editing the focused composer", async () => {
    const editor: { current: TextareaRenderable | null } = { current: null }
    const setup = await renderStatusline({
      editor,
      overlay: { sessionId: "claude-code", phase: "request", requestText: "" },
    })
    await typeRequest(setup, "zzq")
    expect(editor.current?.plainText).toBe("")

    await actAsync(() => setup.mockInput.pressArrow("up"))
    expect(setup.controller.store.getState().overlays.statusline).toMatchObject({ requestText: "zzq" })
    await actAsync(() => setup.mockInput.pressEscape())
    await setup.waitForFrame((frame) => !frame.includes(STATUSLINE_TITLE))
    expect(editor.current?.plainText).toBe("")
    await destroyMounted(setup.renderer)
  })

  it("yields unchanged state to approval and then clarification precedence", async () => {
    const setup = await renderStatusline({
      overlay: { sessionId: "claude-code", phase: "request", requestText: "preserved" },
      mountPriorityOverlays: true,
    })
    await actAsync(() => setup.controller.store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: process.cwd(),
      request: {
        sessionId: "claude-code",
        toolCall: { toolCallId: "approval-statusline", kind: "other", title: "Approve" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      },
    }))
    await setup.waitForFrame((frame) => frame.includes("Approve"))
    await actAsync(() => setup.mockInput.pressEnter())
    expect(setup.controller.calls.respondPermission).toHaveLength(1)
    expect(setup.controller.store.getState().overlays.statusline).toMatchObject({ requestText: "preserved" })

    await actAsync(() => setup.controller.store.openClarification({
      requestId: "clarification-statusline",
      generation: 1,
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: process.cwd(),
      payload: {
        prompt: "Choose one",
        fields: [{ id: "one", label: "One", mode: "single", required: true, options: [{ id: "a", label: "A" }] }],
      },
    }))
    await setup.waitForFrame((frame) => frame.includes("Choose one"))
    await actAsync(() => setup.mockInput.pressEnter())
    expect(setup.controller.calls.respondClarification).toHaveLength(1)
    expect(setup.controller.store.getState().overlays.statusline).toMatchObject({ requestText: "preserved" })
    await destroyMounted(setup.renderer)
  })

  it("reacts to terminal width while keeping the preview on one line", async () => {
    const longPathLayout: StatuslineLayout = { separator: " · ", line: ["FULL_PATH", "BRANCH"] }
    const setup = await renderStatusline({
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "full path",
        layout: longPathLayout,
        preset: null,
      },
    })
    const wide = setup.captureCharFrame()
    expect(wide).toContain(process.cwd())
    expect(wide.split("\n").filter((line) => line.includes(process.cwd()))).toHaveLength(1)

    await actAsync(() => setup.resize(30, HEIGHT))
    const narrow = await setup.waitForFrame((frame) => frame.includes("(no fields fit)"))
    expect(narrow.split("\n").filter((line) => line.includes("(no fields fit)"))).toHaveLength(1)
    await destroyMounted(setup.renderer)
  })
})
