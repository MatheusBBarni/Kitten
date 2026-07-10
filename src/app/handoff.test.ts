import { describe, expect, it } from "bun:test"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import type { PromptBlock } from "../agent/agentConnection.ts"
import type { BundleAssembler } from "../core/bundleAssembler.ts"
import { REDACTION_PLACEHOLDER } from "../core/secretRedactor.ts"
import type { HandoffBundle, ProviderKind, SessionId, ToolCallUpdate } from "../core/types.ts"
import type { AgentRuntimeState } from "./controller.ts"
import {
  composeHandoffBlocks,
  createHandoffEdits,
  createHandoffFlow,
  FILES_HEADING,
  HANDOFF_INSTRUCTION,
  includedDiffs,
  includedFiles,
  pendingDiffHeading,
  type HandoffEdits,
} from "./handoff.ts"

/** A credential of a shape the redactor recognizes, planted in the source transcript. */
const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"

const UNIFIED = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,1 +1,1 @@", "-const b = 2", "+const b = 3"].join("\n")

/** An `edit` tool call proposing a diff it has not yet applied. */
function editCall(overrides: Partial<ToolCallUpdate> = {}): ToolCallUpdate {
  return {
    toolCallId: "call-edit",
    kind: "edit",
    title: "Bump b",
    status: "pending",
    locations: ["src/app.ts"],
    diff: { path: "src/app.ts", unified: UNIFIED },
    ...overrides,
  }
}

/**
 * A controller whose focused agent has a transcript worth handing over: one user turn,
 * one agent turn, a file it read, and a diff it proposed.
 */
function controllerWithWork(options: { runtimes?: AgentRuntimeState[]; sessionId?: SessionId } = {}): FakeController {
  const controller = createFakeController({ runtimes: options.runtimes })
  const sessionId = options.sessionId ?? "claude-code"
  const { store } = controller
  store.setFocus(sessionId)
  store.applyEvent(sessionId, { kind: "user_message", messageId: "m1", text: "bump b" })
  store.applyEvent(sessionId, { kind: "agent_message", messageId: "m2", textDelta: "On it." })
  store.applyEvent(sessionId, {
    kind: "tool_call",
    call: { toolCallId: "call-read", kind: "read", title: "Read config", status: "completed", locations: ["cfg.json"] },
  })
  store.applyEvent(sessionId, { kind: "tool_call", call: editCall() })
  return controller
}

/** The bundle the preview slot is holding. Fails loudly when the preview never opened. */
function openBundle(controller: FakeController): HandoffBundle {
  const overlay = controller.store.getState().overlays.handoffPreview
  if (!overlay) throw new Error("expected the hand-off preview to be open")
  return overlay.bundle
}

/** Every block's text, joined the way `sendPrompt` records the turn. */
function sentText(controller: FakeController): string {
  const call = controller.calls.sendPrompt[0]
  if (!call) throw new Error("expected a prompt to have been sent")
  return (call.input as PromptBlock[]).map((block) => block.text).join("\n")
}

describe("composeHandoffBlocks", () => {
  const bundle: HandoffBundle = {
    intent: "continue",
    summary: "claude-code: I looked at src/app.ts",
    files: [
      { path: "src/app.ts", reason: "edited" },
      { path: "cfg.json", reason: "read" },
    ],
    pendingDiffs: [{ toolCallId: "call-edit", path: "src/app.ts", unified: UNIFIED }],
    redactionCount: 0,
  }
  const edits = createHandoffEdits(bundle)

  it("leads with the instruction that tells the target whose work this is", () => {
    expect(composeHandoffBlocks(bundle, edits)[0]).toEqual({ type: "text", text: HANDOFF_INSTRUCTION })
  })

  it("carries the summary, the file list, and one block per pending diff", () => {
    const blocks = composeHandoffBlocks(bundle, edits)
    const texts = blocks.map((block) => block.text)

    expect(texts).toContain(bundle.summary)
    expect(texts).toContain([FILES_HEADING, "- src/app.ts (edited)", "- cfg.json (read)"].join("\n"))
    expect(texts).toContain(`${pendingDiffHeading("src/app.ts")}\n${UNIFIED}`)
    expect(blocks).toHaveLength(4)
  })

  it("drops an excluded file from the composed blocks without touching the bundle", () => {
    const trimmed: HandoffEdits = { ...edits, excludedFiles: new Set(["cfg.json"]) }
    const text = composeHandoffBlocks(bundle, trimmed)
      .map((block) => block.text)
      .join("\n")

    expect(text).not.toContain("cfg.json")
    expect(text).toContain("src/app.ts (edited)")
    // The bundle is the immutable record of what the session held.
    expect(bundle.files.map((file) => file.path)).toEqual(["src/app.ts", "cfg.json"])
  })

  it("drops an excluded pending diff, and the file block with every file dropped", () => {
    const trimmed: HandoffEdits = {
      summary: bundle.summary,
      excludedFiles: new Set(["src/app.ts", "cfg.json"]),
      excludedDiffs: new Set(["call-edit"]),
    }
    const texts = composeHandoffBlocks(bundle, trimmed).map((block) => block.text)

    expect(texts).toEqual([HANDOFF_INSTRUCTION, bundle.summary])
    expect(includedFiles(bundle, trimmed)).toEqual([])
    expect(includedDiffs(bundle, trimmed)).toEqual([])
  })

  it("carries the developer's rewritten summary rather than the assembled one", () => {
    const rewritten: HandoffEdits = { ...edits, summary: "  Only the last hunk matters.  " }
    expect(composeHandoffBlocks(bundle, rewritten).map((b) => b.text)).toContain("Only the last hunk matters.")
  })

  it("composes nothing at all once the developer has emptied the bundle", () => {
    const emptied: HandoffEdits = {
      summary: "   \n  ",
      excludedFiles: new Set(["src/app.ts", "cfg.json"]),
      excludedDiffs: new Set(["call-edit"]),
    }
    // Not "just the instruction": a target told to continue a task it has been told
    // nothing about is worse off than one that was never prompted.
    expect(composeHandoffBlocks(bundle, emptied)).toEqual([])
  })

  it("omits an empty section rather than heading it with nothing", () => {
    const bare: HandoffBundle = { ...bundle, files: [], pendingDiffs: [] }
    expect(composeHandoffBlocks(bare, createHandoffEdits(bare)).map((b) => b.text)).toEqual([
      HANDOFF_INSTRUCTION,
      bare.summary,
    ])
  })
})

describe("HandoffFlow.begin", () => {
  it("assembles a bundle from the focused session and opens the preview toward the other agent", () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toBe(true)

    const overlay = controller.store.getState().overlays.handoffPreview!
    expect(overlay.sourceSessionId).toBe("claude-code")
    expect(overlay.targetSessionId).toBe("codex")
    expect(overlay.bundle.intent).toBe("continue")
    expect(overlay.bundle.summary).toContain("bump b")
    expect(overlay.bundle.files.map((file) => file.path)).toEqual(["cfg.json", "src/app.ts"])
    expect(overlay.bundle.pendingDiffs.map((diff) => diff.toolCallId)).toEqual(["call-edit"])
  })

  it("never sends anything: the preview is the only path to an agent", () => {
    const controller = controllerWithWork()
    createHandoffFlow({ controller }).begin()

    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
  })

  it("redacts the bundle before it is shown, and reports how many secrets went", () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: `key is ${SECRET}` })
    createHandoffFlow({ controller }).begin()

    const bundle = openBundle(controller)
    expect(bundle.redactionCount).toBe(1)
    expect(bundle.summary).toContain(REDACTION_PLACEHOLDER)
    expect(bundle.summary).not.toContain(SECRET)
  })

  it("does nothing when the source agent has said nothing worth carrying", () => {
    const controller = createFakeController()
    expect(createHandoffFlow({ controller }).begin()).toBe(false)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("does nothing when the agent that would receive the bundle never came up", () => {
    const runtimes: AgentRuntimeState[] = [
      readyRuntimes()[0]!,
      {
        sessionId: "codex",
        providerKind: "codex",
        displayName: "Codex",
        title: "Codex",
        cwd: "/workspace/kitten",
        ready: false,
        error: "codex-acp: command not found",
      },
    ]
    const controller = controllerWithWork({ runtimes })

    expect(createHandoffFlow({ controller }).begin()).toBe(false)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("does not clobber a pending permission request, which has an agent blocked on it", () => {
    const controller = controllerWithWork()
    controller.store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: { sessionId: "s", toolCall: { toolCallId: "call-1" }, options: [] },
    })

    expect(createHandoffFlow({ controller }).begin()).toBe(false)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("does not re-assemble over a preview the developer is already curating", () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    expect(flow.begin()).toBe(true)

    const first = openBundle(controller)
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m3", text: "and again" })

    expect(flow.begin()).toBe(false)
    expect(openBundle(controller)).toBe(first)
  })

  it("assembles through the injected strategy, so Phase 2 swaps it without touching callers", () => {
    const controller = controllerWithWork()
    const seen: ProviderKind[] = []
    const assembler: BundleAssembler = {
      assemble(session, target) {
        seen.push(target)
        return {
          intent: "continue",
          summary: `curated ${session.providerKind}`,
          files: [],
          pendingDiffs: [],
          redactionCount: 7,
        }
      },
    }

    createHandoffFlow({ controller, assembler }).begin()

    expect(seen).toEqual(["codex"])
    expect(openBundle(controller)).toEqual({
      intent: "continue",
      summary: "curated claude-code",
      files: [],
      pendingDiffs: [],
      redactionCount: 7,
    })
  })
})

describe("HandoffFlow.confirm", () => {
  it("sends the composed bundle to the target and moves focus to it", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)

    await flow.confirm(createHandoffEdits(bundle))

    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("codex")
    expect(sentText(controller)).toContain(HANDOFF_INSTRUCTION)
    expect(controller.calls.switchFocus).toEqual(["codex"])
    expect(controller.store.getState().focusedSessionId).toBe("codex")
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("addresses the target explicitly, so the user turn lands in the target's transcript", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    await flow.confirm(createHandoffEdits(openBundle(controller)))

    // The fake records the call rather than dispatching it; what matters is that the
    // agent id travelled with the prompt instead of being left to whatever holds focus.
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("codex")
  })

  it("sends the curated bundle, not the assembled one", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)

    await flow.confirm({
      summary: "Just finish the edit.",
      excludedFiles: new Set(["cfg.json"]),
      excludedDiffs: new Set(),
    })

    const text = sentText(controller)
    expect(text).toContain("Just finish the edit.")
    expect(text).not.toContain(bundle.summary)
    expect(text).not.toContain("cfg.json")
    expect(text).toContain(pendingDiffHeading("src/app.ts"))
  })

  it("sends nothing and keeps the preview up when the developer emptied the bundle", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    const result = await flow.confirm({
      summary: "",
      excludedFiles: new Set(["cfg.json", "src/app.ts"]),
      excludedDiffs: new Set(["call-edit"]),
    })

    expect(result).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().overlays.handoffPreview).not.toBeNull()
  })

  it("sends nothing when no preview is open", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })

    expect(await flow.confirm({ summary: "hi", excludedFiles: new Set(), excludedDiffs: new Set() })).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
  })
})

describe("HandoffFlow.cancel", () => {
  it("closes the preview, sends nothing, and leaves focus where it was", () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    flow.cancel()

    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
  })

  it("is a no-op with no preview open", () => {
    const controller = controllerWithWork()
    createHandoffFlow({ controller }).cancel()
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })
})

describe("hand-back", () => {
  it("runs the same flow in the other direction once the target holds focus", async () => {
    // Codex has been handed the task and has since done work of its own.
    const controller = controllerWithWork({ sessionId: "codex" })
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toBe(true)
    const overlay = controller.store.getState().overlays.handoffPreview!
    expect(overlay.sourceSessionId).toBe("codex")
    expect(overlay.targetSessionId).toBe("claude-code")
    expect(overlay.bundle.summary).toContain("codex")

    await flow.confirm(createHandoffEdits(overlay.bundle))

    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("claude-code")
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
  })
})
