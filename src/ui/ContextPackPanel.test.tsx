// Suite: selected-session Context Pack workspace
// Invariant: pack custody comes from narrow selectors and every consequence uses ControllerActions.
// Boundary IN: real AppStore selectors, OpenTUI keyboard/focus, and the fake controller facade.
// Boundary OUT: materialization, persistence, recipient counting, and filesystem writes.

import { describe, expect, it } from "bun:test"

import type { ScrollBoxRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { applyOperatorMutation, assembleCandidate, contextSelectionKey, createDraft, sealCandidate } from "../core/contextPack.ts"
import type {
  ContextPackMutation,
  ContextPackState,
  ContextSelection,
  DraftContextPack,
  SessionId,
} from "../core/types.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  CONTEXT_PACK_EXACT_REVIEW_LABEL,
  CONTEXT_PACK_EXACT_SEALED_LABEL,
  CONTEXT_PACK_EXPORT_DESTINATION_LABEL,
  CONTEXT_PACK_SCROLLBOX_ID,
  CONTEXT_PACK_TITLE,
  ContextPackPanel,
} from "./ContextPackPanel.tsx"

const SOURCE_CONTENT = "export const contextPanel = true\n"
const SOURCE = {
  identity: "workspace:context-panel",
  digest: "a".repeat(64),
  bytes: new TextEncoder().encode(SOURCE_CONTENT).byteLength,
}

function mutate(draft: DraftContextPack, mutation: ContextPackMutation): DraftContextPack {
  const result = applyOperatorMutation(draft, mutation)
  if (result.kind !== "applied") throw new Error(`fixture mutation failed: ${result.kind}`)
  return result.draft
}

function custodyState(options: { stale?: boolean; includeReview?: boolean; includeSealed?: boolean } = {}): ContextPackState {
  const created = createDraft("Implement the /context workspace", { mode: "augment", budgetLimit: 80_000 })
  if (created.kind !== "created") throw new Error("fixture draft failed")
  let draft = created.draft
  for (const [section, text] of [
    ["architecture", "UI reads AppStore selectors"],
    ["selectedContext", "ContextPackPanel and central keymap"],
    ["relationships", "CockpitApp routes the selected session"],
    ["ambiguities", "Recipient evidence may be absent"],
    ["budgetOmissions", "Repository discovery remains out of scope"],
  ] as const) {
    draft = mutate(draft, { kind: "set_brief_section", section, text })
  }
  const selection: ContextSelection = {
    kind: "file_slice",
    path: "src/ui/ContextPackPanel.tsx",
    range: { startLine: 1, endLine: 40 },
    source: SOURCE,
    rationale: "Shows the operator the exact candidate",
    relationship: "Consumes selectors and ControllerActions",
  }
  draft = mutate(draft, { kind: "upsert_selection", selection })
  if (options.stale) draft = { ...draft, stale: { kind: "stale", reason: "source_changed" } }
  else draft = { ...draft, stale: { kind: "fresh" } }

  if (options.stale || (!options.includeReview && !options.includeSealed)) {
    return { draft, review: null, sealed: null, build: null }
  }
  const assembly = assembleCandidate(draft, [{
    selectionKey: contextSelectionKey(selection),
    source: SOURCE,
    content: SOURCE_CONTENT,
  }], {
    redact(text) {
      return { text: `${text}\n[REDACTED]`, count: 2 }
    },
  })
  if (assembly.kind !== "assembled") throw new Error(`fixture assembly failed: ${assembly.reason}`)
  const sealedResult = sealCandidate({
    draft,
    candidate: assembly.candidate,
    currentSourceFences: assembly.candidate.sourceFences,
    sealedAt: 1_700_000_000_000,
  })
  if (sealedResult.kind !== "sealed") throw new Error(`fixture seal failed: ${sealedResult.reason}`)
  return {
    draft,
    review: options.includeReview ? assembly.candidate : null,
    sealed: options.includeSealed ? sealedResult.sealed : null,
    build: null,
  }
}

function installContextPack(controller: FakeController, sessionId: SessionId, contextPack: ContextPackState): void {
  const state = controller.store.getState()
  controller.store.replaceSessions(state.workspace.order.map((id) => {
    const session = state.sessions[id]!
    const workspace = state.workspace.conversations[id]!
    return {
      seed: {
        id: session.id,
        providerKind: session.providerKind,
        title: session.title,
        cwd: session.cwd,
        task: session.task,
        worktreeBinding: session.worktreeBinding,
        acpSessionId: session.acpSessionId,
      },
      workspace,
      contextPack: id === sessionId ? contextPack : state.contextPacks[id],
    }
  }), state.workspace.selectedVisibleId)
  if (contextPack.review) {
    expect(controller.store.publishContextPackReview(sessionId, contextPack.review)).toBeTrue()
  }
}

async function renderPanel(
  controller: FakeController,
  onClose: () => void = () => {},
  sessionId: SessionId = "claude-code",
): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <ContextPackPanel sessionId={sessionId} onClose={onClose} />
    </CockpitProvider>,
    { width: 120, height: 60, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await setup.waitForFrame((frame) => frame.includes(CONTEXT_PACK_TITLE))
  return setup
}

describe("ContextPackPanel presentation", () => {
  it("renders exact draft, review, sealed, freshness, budget, brief, selection, redaction, and fit details", async () => {
    const state = custodyState({ includeReview: true, includeSealed: true })
    const controller = createFakeController({
      assessContextPackRecipientFit: () => ({ kind: "fit", exactCount: 1200, remaining: 6800 }),
    })
    installContextPack(controller, "claude-code", state)
    const setup = await renderPanel(controller)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Phase: Review candidate")
      expect(frame).toContain("Pack Budget: 80000 estimated tokens")
      expect(frame).toContain("Freshness: Fresh")
      expect(frame).toContain("Fixed Context Brief")
      expect(frame).toContain("Architecture: UI reads AppStore selectors")
      expect(frame).toContain("Relationships: CockpitApp routes the selected session")
      expect(frame).toContain("Budget Omissions: Repository discovery remains out of scope")
      expect(frame).toContain("src/ui/ContextPackPanel.tsx · lines 1-40")
      expect(frame).toContain("Rationale: Shows the operator the exact candidate")
      expect(frame).toContain("Relationship: Consumes selectors and ControllerActions")
      expect(frame).toContain(`Review bytes: ${state.review!.bytes}`)
      expect(frame).toContain("Redactions: 2")
      expect(frame).toContain(CONTEXT_PACK_EXACT_REVIEW_LABEL)
      const details = setup.renderer.root.findDescendantById(CONTEXT_PACK_SCROLLBOX_ID) as ScrollBoxRenderable
      await actAsync(() => details.scrollTo(details.scrollHeight))
      const fitFrame = await setup.waitForFrame((value) => value.includes("Recipient Fit: Fits — exact count 1200, remaining 6800"))
      expect(fitFrame).toContain("[REDACTED]")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("renders sealed-only custody and its exact immutable payload", async () => {
    const custody = custodyState({ includeSealed: true })
    const state: ContextPackState = { draft: null, review: null, sealed: custody.sealed, build: null }
    const controller = createFakeController({
      assessContextPackRecipientFit: () => ({ kind: "unavailable", reason: "stale_evidence" }),
    })
    installContextPack(controller, "claude-code", state)
    const setup = await renderPanel(controller)

    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Phase: Sealed")
      expect(frame).toContain(CONTEXT_PACK_EXACT_SEALED_LABEL)
      expect(frame).toContain("Recipient Fit: Unavailable — Stale evidence")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("uses textual stale, unavailable, and blocked labels and cannot bypass a disabled action", async () => {
    const controller = createFakeController()
    installContextPack(controller, "claude-code", custodyState({ stale: true }))
    const setup = await renderPanel(controller)

    try {
      const before = setup.captureCharFrame()
      expect(before).toContain("Freshness: Stale — Source changed")
      expect(before).toContain("Review candidate: unavailable")
      expect(before).toContain("Sealed pack: unavailable")
      expect(before).toContain("Build Context — unavailable — Missing evidence")

      await actAsync(() => setup.mockInput.pressEnter())
      const blocked = await setup.waitForFrame((frame) => frame.includes("Unavailable: Missing evidence"))
      expect(blocked).toContain("[focused] Build Context")
      expect(controller.calls.startContextBuild).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("shows visible keyboard focus and closes without changing pack custody", async () => {
    let closed = 0
    const controller = createFakeController()
    const state = custodyState({ includeReview: true, includeSealed: true })
    installContextPack(controller, "claude-code", state)
    const setup = await renderPanel(controller, () => { closed++ })

    try {
      expect(setup.captureCharFrame()).toContain("[focused] Build Context")
      await actAsync(() => setup.mockInput.pressTab())
      expect(await setup.waitForFrame((frame) => frame.includes("[focused] Review Context Pack"))).toContain("available")
      await actAsync(() => setup.mockInput.pressEscape())
      expect(closed).toBe(1)
      expect(controller.store.getState().contextPacks["claude-code"]).toEqual(state)
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})

describe("ContextPackPanel actions", () => {
  it("surfaces a typed denial returned after advisory availability without changing custody", async () => {
    const state = custodyState()
    const controller = createFakeController({
      contextBuildAvailability: () => ({ kind: "available" }),
      startContextBuild: () => ({ kind: "denied", reason: "build_active" }),
    })
    installContextPack(controller, "claude-code", state)
    const before = controller.store.getState().contextPacks["claude-code"]
    const setup = await renderPanel(controller)

    try {
      await actAsync(() => setup.mockInput.pressEnter())
      const denied = await setup.waitForFrame((frame) => frame.includes("Denied: Build active"))
      expect(denied).toContain("[focused] Build Context — available")
      expect(controller.calls.startContextBuild).toHaveLength(1)
      expect(controller.calls.startContextBuild[0]?.parentId).toBe("claude-code")
      expect(controller.store.getState().contextPacks["claude-code"]).toBe(before)
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("dispatches build, review, seal, Send Here, refinement, and confirmed export only to the addressed session", async () => {
    const state = custodyState({ includeReview: true, includeSealed: true })
    const sealed = state.sealed
    if (!sealed || !("manifest" in sealed)) throw new Error("fixture requires a live sealed pack")
    const controller = createFakeController({
      contextBuildAvailability: () => ({ kind: "available" }),
      startContextBuild: (input) => ({ kind: "started", childId: "context-child", draftRevision: input.draft.kind === "refine" ? 22 : 21 }),
      reviewContextPack: () => ({ kind: "reviewed", candidate: state.review! }),
      sealContextPack: () => ({ kind: "sealed", sealed }),
      assessContextPackRecipientFit: () => ({ kind: "fit", exactCount: 100, remaining: 900 }),
      sendContextPackHere: () => ({ kind: "sent", result: { stopReason: "end_turn" } }),
      exportContextPack: () => ({ kind: "exported", payloadBytes: state.sealed!.bytes, exportBytes: state.sealed!.bytes + 80 }),
    })
    installContextPack(controller, "claude-code", state)
    const setup = await renderPanel(controller)

    try {
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Started: Context Build revision 21"))
      await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Reviewed: revision"))
      await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Sealed: revision"))
      await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Sent Here: exact sealed payload dispatched"))
      await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Started: refinement revision 22"))
      await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes(CONTEXT_PACK_EXPORT_DESTINATION_LABEL))
      await actAsync(async () => setup.mockInput.pasteBracketedText("/operator/context.md"))
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Exported:"))

      expect(controller.calls.startContextBuild).toHaveLength(2)
      expect(controller.calls.startContextBuild.every(({ parentId }) => parentId === "claude-code")).toBeTrue()
      expect(controller.calls.reviewContextPack).toEqual(["claude-code"])
      expect(controller.calls.sealContextPack).toEqual([{ sessionId: "claude-code", candidateRevision: state.review!.revision }])
      expect(controller.calls.sendContextPackHere).toEqual(["claude-code"])
      expect(controller.calls.exportContextPack).toEqual([{
        sessionId: "claude-code",
        destination: "/operator/context.md",
        writeConfirmed: true,
        overwriteConfirmed: false,
      }])
      expect(controller.calls.startContextBuild.some(({ parentId }) => parentId === "codex")).toBeFalse()
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("requires a second explicit confirmation when export reports an existing destination", async () => {
    const state = custodyState({ includeReview: true, includeSealed: true })
    let attempts = 0
    const controller = createFakeController({
      assessContextPackRecipientFit: () => ({ kind: "unavailable", reason: "missing_evidence" }),
      exportContextPack: (input) => {
        attempts++
        return input.overwriteConfirmed
          ? { kind: "exported", payloadBytes: state.sealed!.bytes, exportBytes: state.sealed!.bytes + 80 }
          : { kind: "blocked", reason: "overwrite_confirmation_required" }
      },
    })
    installContextPack(controller, "claude-code", state)
    const setup = await renderPanel(controller)

    try {
      for (let index = 0; index < 5; index++) await actAsync(() => setup.mockInput.pressTab())
      await actAsync(() => setup.mockInput.pressEnter())
      await actAsync(async () => setup.mockInput.pasteBracketedText("/operator/existing.md"))
      await actAsync(() => setup.mockInput.pressEnter())
      expect(await setup.waitForFrame((frame) => frame.includes("Enter confirms overwrite"))).toContain("Blocked")
      expect(attempts).toBe(1)
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Exported:"))
      expect(attempts).toBe(2)
      expect(controller.calls.exportContextPack.at(-1)?.overwriteConfirmed).toBeTrue()
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})
