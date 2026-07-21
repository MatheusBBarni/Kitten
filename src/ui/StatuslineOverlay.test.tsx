// Suite: `/statusline` keyboard modal
// Invariant: disclosure precedes the sole transcript request, every layout is reviewed, and only explicit confirmation persists.
// Boundary IN: real AppStore, OpenTUI keyboard routing/resizing, pure renderer, injected StatuslineFlow, and ControllerActions fake.
// Boundary OUT: real agent subprocesses and filesystem persistence.

import { describe, expect, it } from "bun:test"

import { RGBA, type TextareaRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
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
import { KEYMAP_HINT } from "./keymap.ts"
import { statuslineFooterBudget } from "./StatusStrip.tsx"
import { DARK_PALETTE } from "./theme.ts"
import {
  STATUSLINE_CONFIG_LABEL,
  STATUSLINE_DISCLOSURE,
  STATUSLINE_PREVIEW_LABEL,
  STATUSLINE_REQUEST_PROMPT,
  STATUSLINE_SAVED_LABEL,
  STATUSLINE_TITLE,
  StatuslineOverlay,
  statuslineConfigChange,
  statuslinePreviewBudget,
} from "./StatuslineOverlay.tsx"

const WIDTH = 80
const HEIGHT = 24
const PROPOSAL: StatuslineLayout = { separator: " | ", line: ["FOLDER", "BRANCH", "MODEL"] }

function foregroundOf(setup: TestRendererSetup, text: string): string | undefined {
  return setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text === text)
    ?.fg.toString()
}

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

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
  it("previews captured-session CONTEXT and persists only its literal identifier", async () => {
    const layout: StatuslineLayout = { separator: " · ", line: ["CONTEXT"] }
    const controller = createFakeController()
    controller.store.setStatuslinePreference({ llmDisclosureAcknowledged: true, layout: null })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStatusline({
      controller,
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "context only",
        layout,
        preset: null,
      },
    })

    const frame = setup.captureCharFrame()
    const projectedConfig = statuslineConfigChange(layout, true)
    expect(frame).toContain("ctx 38%")
    expect(projectedConfig).toContain('"line":["CONTEXT"]')
    expect(projectedConfig).not.toContain("38%")
    expect(projectedConfig).not.toContain("124000")
    expect(projectedConfig).not.toContain("200000")

    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((candidate) => !candidate.includes(STATUSLINE_TITLE))
    expect(setup.controller.calls.confirmStatusline).toEqual([layout])
    expect(setup.controller.store.getState().preferences.statusline.layout).toEqual(layout)
    expect(JSON.stringify(setup.controller.store.getState().preferences.statusline)).not.toContain("38%")
    await destroyMounted(setup.renderer)
  })

  it.each([
    ["unavailable", null],
    ["selector-invalid", { used: -10_000, size: 200_000 }],
  ] as const)("canonically omits %s captured-session CONTEXT", async (_case, usage) => {
    const controller = createFakeController()
    if (usage !== null) controller.store.applyEvent("claude-code", { kind: "usage", ...usage })
    const setup = await renderStatusline({
      controller,
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "provider context folder",
        layout: { separator: " · ", line: ["PROVIDER", { kind: "CONTEXT", color: "#123456" }, "FOLDER"] },
        preset: null,
      },
    })

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`Claude · ${process.cwd().split("/").at(-1)}`)
    expect(frame).not.toContain("ctx ")
    expect(frame).not.toContain(" ·  · ")
    await destroyMounted(setup.renderer)
  })

  it("retains captured-session CONTEXT when global focus changes", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    controller.store.applyEvent("codex", { kind: "usage", used: 50_000, size: 200_000 })
    controller.store.backgroundConversation("codex")
    const setup = await renderStatusline({
      controller,
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "context only",
        layout: { separator: " · ", line: ["CONTEXT"] },
        preset: null,
      },
    })

    expect(setup.captureCharFrame()).toContain("ctx 38%")
    await actAsync(() => controller.store.reopenConversation("codex"))
    const refocused = await setup.waitForFrame((frame) => frame.includes("ctx 38%"))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(refocused).not.toContain("ctx 75%")
    await destroyMounted(setup.renderer)
  })

  it("shows the rendered line and exact config change, then confirms once", async () => {
    const controller = createFakeController()
    controller.store.setStatuslinePreference({ llmDisclosureAcknowledged: true, layout: null })
    const setup = await renderStatusline({
      controller,
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
    expect(statuslineConfigChange(PROPOSAL, true)).toBe(
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

  it("matches footer field and separator colors while showing the exact canonical config change", async () => {
    const layout: StatuslineLayout = {
      separator: " | ",
      line: [{ kind: "FOLDER", color: "#123456" }, "PROVIDER"],
    }
    const setup = await renderStatusline({
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "color the folder",
        layout,
        preset: null,
      },
    })
    const folder = process.cwd().split("/").at(-1)!

    expect(setup.captureCharFrame()).toContain(`${folder} | Claude`)
    expect(foregroundOf(setup, folder)).toBe(paletteColor("#123456"))
    expect(foregroundOf(setup, " | ")).toBe(paletteColor(DARK_PALETTE.muted))
    expect(foregroundOf(setup, "Claude")).toBe(paletteColor(DARK_PALETTE.text))
    expect(statuslineConfigChange(layout, true)).toBe(
      '{"statusline":{"llmDisclosureAcknowledged":true,"separator":" | ","line":[{"kind":"FOLDER","color":"#123456"},"PROVIDER"]}}',
    )

    await destroyMounted(setup.renderer)
  })

  it("previews an unacknowledged preset as the value that confirmation will save", async () => {
    const setup = await renderStatusline()
    await actAsync(() => setup.mockInput.pressArrow("down"))
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => frame.includes("declined the agent request"))

    await actAsync(() => setup.mockInput.pressEnter())
    const preview = await setup.waitForFrame((frame) => frame.includes("Workspace recovery layout"))
    expect(preview).toContain('"llmDisclosureAcknowledged":false')

    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => !frame.includes(STATUSLINE_TITLE))
    expect(setup.controller.calls.confirmStatusline).toEqual([STATUSLINE_RECOVERY_PRESETS[0]!.layout])
    expect(setup.controller.store.getState().preferences.statusline.llmDisclosureAcknowledged).toBe(false)
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
  it("uses the active footer's width budget for the review preview", () => {
    expect(statuslinePreviewBudget(WIDTH)).toBe(statuslineFooterBudget(WIDTH, KEYMAP_HINT))
    expect(statuslinePreviewBudget(WIDTH)).toBe(72)
  })

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
        fields: [{ id: "one", label: "One", mode: "single", required: true, allowsCustom: false, options: [{ id: "a", label: "A" }] }],
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

  it("keeps a colored preview on one line at both 80 and 64 columns", async () => {
    const controller = createFakeController({
      runtimes: readyRuntimes().map((runtime) => ({ ...runtime, cwd: "/workspace/parity" })),
    })
    const setup = await renderStatusline({
      controller,
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "colored parity",
        layout: { separator: " · ", line: [{ kind: "FOLDER", color: "#123456" }, "PROVIDER"] },
        preset: null,
      },
    })

    const wide = setup.captureCharFrame()
    expect(wide.split("\n").filter((line) => line.includes("parity · Claude"))).toHaveLength(1)
    expect(foregroundOf(setup, "parity")).toBe(paletteColor("#123456"))

    await actAsync(() => setup.resize(64, HEIGHT))
    const constrained = await setup.waitForFrame((frame) => frame.includes("parity · Claude"))
    expect(constrained.split("\n").filter((line) => line.includes("parity · Claude"))).toHaveLength(1)
    expect(constrained).not.toContain("਀")
    expect(foregroundOf(setup, "parity")).toBe(paletteColor("#123456"))

    await destroyMounted(setup.renderer)
  })

  it("drops trailing captured-session CONTEXT at narrow width without malformed separators", async () => {
    const controller = createFakeController({
      runtimes: readyRuntimes().map((runtime) => ({ ...runtime, cwd: "/workspace/parity" })),
    })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStatusline({
      controller,
      overlay: {
        sessionId: "claude-code",
        phase: "preview",
        requestText: "folder and context",
        layout: { separator: " · ", line: ["FOLDER", "CONTEXT"] },
        preset: null,
      },
    })
    expect(setup.captureCharFrame()).toContain("parity · ctx 38%")

    await actAsync(() => setup.resize(23, HEIGHT))
    const narrow = await setup.waitForFrame((frame) => frame.includes("parity"))
    expect(narrow).not.toContain("ctx ")
    expect(narrow).not.toContain(" ·  · ")
    await destroyMounted(setup.renderer)
  })
})
