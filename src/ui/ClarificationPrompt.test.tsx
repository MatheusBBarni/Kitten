// Suite: clarification dialog keyboard workflow
// Invariant: an active clarification exclusively settles its captured request once with deliberate protocol-free values or cancellation
// Boundary IN: real OpenTUI renderer, CockpitApp mount, store projection, focused input, and ControllerActions fake
// Boundary OUT: ACP response mapping and controller coordinator lifecycle, owned by agentConnection/controller suites

import { describe, expect, it } from "bun:test"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import type {
  ClarificationMultiField,
  ClarificationPayload,
  ClarificationSingleField,
  SessionId,
} from "../core/types.ts"
import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { APPROVAL_TITLE } from "./ApprovalPrompt.tsx"
import {
  CLARIFICATION_REQUIRED_ERROR,
  CLARIFICATION_SELECTION_MARKER,
  clarificationTitleFor,
} from "./ClarificationPrompt.tsx"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import { CLARIFICATION_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"

const WIDTH = 80
const HEIGHT = 24
const REQUEST_ID = "clarification-1"
const GENERATION = 7
const DRAFT_MARKER = "zzq"

const SINGLE_PAYLOAD: ClarificationPayload = {
  prompt: "Choose the implementation boundary",
  fields: [
    {
      id: "boundary",
      label: "Implementation boundary",
      description: "Where should orchestration live?",
      mode: "single",
      allowsCustom: false,
      required: true,
      options: [
        { id: "controller", label: "Controller", description: "Own the lifecycle centrally." },
        { id: "store", label: "Store", description: "Project it as app state." },
        { id: "view", label: "View", description: "Keep it local to the dialog." },
      ],
    },
  ],
}

const MULTI_PAYLOAD: ClarificationPayload = {
  prompt: "Choose compatible deliverables",
  fields: [
    {
      id: "deliverables",
      label: "Deliverables",
      description: "Select every compatible item.",
      mode: "multi",
      allowsCustom: false,
      required: true,
      options: [
        { id: "tests", label: "Tests", description: "Add focused coverage." },
        { id: "docs", label: "Docs", description: "Update the user guide." },
      ],
    },
  ],
}

const TEXT_PAYLOAD: ClarificationPayload = {
  prompt: "What should the agent preserve?",
  fields: [
    {
      id: "notes",
      label: "Custom response",
      description: "Use text when the offered choices do not fit.",
      mode: "text",
      required: true,
    },
  ],
}

const MIXED_PAYLOAD: ClarificationPayload = {
  prompt: "Choose a boundary and explain it",
  fields: [
    SINGLE_PAYLOAD.fields[0]!,
    TEXT_PAYLOAD.fields[0]!,
  ],
}

const RICH_PAYLOAD: ClarificationPayload = {
  title: "Release boundary",
  context: "Choose the safest change for this run.",
  prompt: "Confirm the implementation plan",
  fields: [
    {
      ...(SINGLE_PAYLOAD.fields[0] as ClarificationSingleField),
      label: "Architecture",
      description: "Select one boundary or add a precise alternative.",
      allowsCustom: true,
    },
    {
      ...(MULTI_PAYLOAD.fields[0] as ClarificationMultiField),
      label: "Required deliverables",
      description: "Select all that apply and add any missing deliverable.",
      allowsCustom: true,
    },
  ],
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return setup
}

async function openClarification(
  controller: FakeController,
  payload: ClarificationPayload,
  sessionId: SessionId = "claude-code",
): Promise<void> {
  await actAsync(() => {
    controller.store.openClarification({
      requestId: REQUEST_ID,
      generation: GENERATION,
      sessionId,
      title: "kitten task",
      cwd: "/workspace/kitten",
      payload,
    })
  })
}

async function renderWithClarification(
  controller: FakeController,
  payload: ClarificationPayload,
): Promise<TestRendererSetup> {
  const setup = await renderCockpit(controller)
  await openClarification(controller, payload)
  await setup.waitForFrame((frame) => frame.includes(clarificationTitleFor("Claude Code")))
  return setup
}

describe("ClarificationPrompt contents and priority", () => {
  it("renders the requesting session, cwd, prompt, field labels, descriptions, cancellation, and non-color marker above another overlay", async () => {
    const controller = createFakeController()
    controller.store.openApproval({
      sessionId: "codex",
      title: "other session",
      cwd: "/workspace/other",
      request: {
        sessionId: "codex-session",
        toolCall: { toolCallId: "call-1", title: "Edit a file" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      },
    })
    const { renderer, captureCharFrame } = await renderWithClarification(controller, SINGLE_PAYLOAD)

    const frame = captureCharFrame()
    expect(frame).toContain(clarificationTitleFor("Claude Code"))
    expect(frame).toContain("kitten task")
    expect(frame).toContain("/workspace/kitten")
    expect(frame).toContain(SINGLE_PAYLOAD.prompt)
    expect(frame).toContain("Implementation boundary")
    expect(frame).toContain("Where should orchestration live?")
    expect(frame).toContain("Controller")
    expect(frame).toContain("Own the lifecycle centrally.")
    expect(frame).toContain(`${CLARIFICATION_SELECTION_MARKER} 1.`)
    expect(frame).toContain("↑↓ move  Tab/Shift+Tab field/text")
    expect(frame).toContain("Esc cancel request")
    expect(frame).not.toContain(APPROVAL_TITLE)
    expect(frame.toLocaleLowerCase()).not.toContain("permission")

    await destroyMounted(renderer)
  })

  it("attributes a background request to its own session without moving cockpit focus", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)
    await openClarification(controller, SINGLE_PAYLOAD, "codex")

    const frame = await setup.waitForFrame((value) => value.includes(clarificationTitleFor("Codex")))
    expect(frame).not.toContain(clarificationTitleFor("Claude Code"))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await destroyMounted(setup.renderer)
  })

  it("renders form metadata, field metadata, required indicators, and custom-answer affordances", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderWithClarification(controller, RICH_PAYLOAD)

    const frame = captureCharFrame()
    expect(frame).toContain("Release boundary")
    expect(frame).toContain("Choose the safest change for this run.")
    expect(frame).toContain("Architecture *")
    expect(frame).toContain("Select one boundary or add a precise alternative.")
    expect(frame).toContain("Required deliverables *")
    expect(frame).toContain("Custom answer:")
    expect(frame.toLocaleLowerCase()).not.toContain("mcp")
    expect(frame.toLocaleLowerCase()).not.toContain("generation")

    await destroyMounted(renderer)
  })
})

describe("ClarificationPrompt outcomes", () => {
  it("submits exactly one stable single option after arrow and digit navigation", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, SINGLE_PAYLOAD)

    await actAsync(() => {
      mockInput.pressArrow("down")
    })
    await waitForFrame((frame) => frame.includes(`${CLARIFICATION_SELECTION_MARKER} 2.`))
    await actAsync(async () => {
      await mockInput.typeText("3")
    })
    await waitForFrame((frame) => frame.includes(`${CLARIFICATION_SELECTION_MARKER} 3.`))
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toEqual([
      {
        requestId: REQUEST_ID,
        generation: GENERATION,
        outcome: { kind: "submitted", answers: { boundary: { selectedOptionIds: ["view"] } } },
      },
    ])

    await destroyMounted(renderer)
  })

  it("toggles multiple options without settling and submits every selected value on Enter", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, MULTI_PAYLOAD)

    await actAsync(async () => {
      await mockInput.typeText(" ")
    })
    expect(controller.calls.respondClarification).toHaveLength(0)
    expect(await waitForFrame((frame) => frame.includes("[x] 1."))).toContain("Tests")

    await actAsync(() => {
      mockInput.pressArrow("down")
    })
    await actAsync(async () => {
      await mockInput.typeText(" ")
    })
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toEqual([
      {
        requestId: REQUEST_ID,
        generation: GENERATION,
        outcome: {
          kind: "submitted",
          answers: { deliverables: { selectedOptionIds: ["tests", "docs"] } },
        },
      },
    ])

    await destroyMounted(renderer)
  })

  it("focuses text input, receives printable keys, and submits only its text value", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, TEXT_PAYLOAD)

    await actAsync(async () => {
      await mockInput.typeText("Keep the reducer pure")
    })
    await waitForFrame((frame) => frame.includes("Keep the reducer pure"))
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toEqual([
      {
        requestId: REQUEST_ID,
        generation: GENERATION,
        outcome: {
          kind: "submitted",
          answers: { notes: { selectedOptionIds: [], customText: "Keep the reducer pure" } },
        },
      },
    ])

    await destroyMounted(renderer)
  })

  it("moves field focus to text with Tab and submits the complete mixed form", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, MIXED_PAYLOAD)

    await actAsync(() => {
      mockInput.pressTab()
    })
    await actAsync(async () => {
      await mockInput.typeText("Keep lifecycle ownership central")
    })
    await waitForFrame((frame) => frame.includes("Keep lifecycle ownership central"))
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toEqual([
      {
        requestId: REQUEST_ID,
        generation: GENERATION,
        outcome: {
          kind: "submitted",
          answers: {
            boundary: { selectedOptionIds: ["controller"] },
            notes: { selectedOptionIds: [], customText: "Keep lifecycle ownership central" },
          },
        },
      },
    ])

    await destroyMounted(renderer)
  })

  it("submits a single selection with allowed custom text kept separate", async () => {
    const payload: ClarificationPayload = { ...RICH_PAYLOAD, fields: [RICH_PAYLOAD.fields[0]!] }
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, payload)

    await actAsync(() => {
      mockInput.pressArrow("down")
      mockInput.pressTab()
    })
    await actAsync(async () => {
      await mockInput.typeText("Keep the bridge controller-owned")
    })
    await waitForFrame((frame) => frame.includes("Keep the bridge controller-owned"))
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification.at(-1)?.outcome).toEqual({
      kind: "submitted",
      answers: {
        boundary: {
          selectedOptionIds: ["store"],
          customText: "Keep the bridge controller-owned",
        },
      },
    })

    await destroyMounted(renderer)
  })

  it("submits multiple selections with allowed custom text kept separate", async () => {
    const payload: ClarificationPayload = { ...RICH_PAYLOAD, fields: [RICH_PAYLOAD.fields[1]!] }
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, payload)

    await actAsync(async () => {
      await mockInput.typeText(" ")
    })
    await actAsync(() => {
      mockInput.pressTab()
    })
    await actAsync(async () => {
      await mockInput.typeText("Changelog")
    })
    await waitForFrame((frame) => frame.includes("Changelog"))
    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification.at(-1)?.outcome).toEqual({
      kind: "submitted",
      answers: {
        deliverables: { selectedOptionIds: ["tests"], customText: "Changelog" },
      },
    })

    await destroyMounted(renderer)
  })

  it("keeps a required empty multi field open instead of emitting an invalid answer", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, MULTI_PAYLOAD)

    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toHaveLength(0)
    const frame = await waitForFrame((value) => value.includes(CLARIFICATION_REQUIRED_ERROR))
    expect(frame).toContain("Enter submit")
    expect(frame).toContain("Esc cancel request")

    await destroyMounted(renderer)
  })

  it("resolves Escape as one terminal cancellation even when duplicate keys arrive together", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, SINGLE_PAYLOAD)

    await actAsync(() => {
      mockInput.pressEscape()
      mockInput.pressEscape()
    })

    expect(controller.calls.respondClarification).toEqual([
      { requestId: REQUEST_ID, generation: GENERATION, outcome: { kind: "cancelled" } },
    ])
    expect(controller.calls.cancel).toHaveLength(0)
    expect(await waitForFrame((frame) => !frame.includes(CLARIFICATION_HINT))).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("resolves explicit Skip separately from Escape cancellation", async () => {
    const controller = createFakeController()
    const { renderer, mockInput } = await renderWithClarification(controller, RICH_PAYLOAD)

    await actAsync(() => {
      mockInput.pressKey("s", { ctrl: true })
    })

    expect(controller.calls.respondClarification).toEqual([
      { requestId: REQUEST_ID, generation: GENERATION, outcome: { kind: "skipped" } },
    ])

    await destroyMounted(renderer)
  })

  it("does not let keys overwrite a timed-out projection or settle a stale request identity", async () => {
    const controller = createFakeController()
    const setup = await renderWithClarification(controller, RICH_PAYLOAD)

    await actAsync(() => {
      controller.actions.respondClarification(REQUEST_ID, GENERATION, { kind: "timed_out" })
      setup.mockInput.pressEnter()
      setup.mockInput.pressEscape()
      setup.mockInput.pressKey("s", { ctrl: true })
    })
    expect(controller.calls.respondClarification).toEqual([
      { requestId: REQUEST_ID, generation: GENERATION, outcome: { kind: "timed_out" } },
    ])

    await actAsync(() => {
      controller.store.openClarification({
        requestId: "clarification-new",
        generation: GENERATION + 1,
        sessionId: "codex",
        title: "new owner",
        cwd: "/workspace/new",
        payload: SINGLE_PAYLOAD,
      })
    })
    await setup.waitForFrame((frame) => frame.includes(clarificationTitleFor("Codex")))
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    expect(controller.calls.respondClarification.at(-1)).toEqual({
      requestId: "clarification-new",
      generation: GENERATION + 1,
      outcome: { kind: "cancelled" },
    })

    await destroyMounted(setup.renderer)
  })
})

describe("ClarificationPrompt focus isolation", () => {
  it("consumes shell chords, help input, and composer text until a terminal result returns focus", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithClarification(controller, SINGLE_PAYLOAD)

    await actAsync(async () => {
      mockInput.pressKey("`", { ctrl: true })
      await mockInput.typeText("/help")
      await mockInput.typeText(DRAFT_MARKER)
    })

    expect(controller.store.getState().focusedPane.kind).toBe("agent")
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.recordPromptHistory).toHaveLength(0)
    expect(await waitForFrame((frame) => frame.includes("Esc cancel request"))).not.toContain(HELP_TITLE)

    await actAsync(() => {
      controller.actions.respondClarification(REQUEST_ID, GENERATION, { kind: "cancelled" })
    })
    const closed = await waitForFrame((frame) => !frame.includes(CLARIFICATION_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })
})
