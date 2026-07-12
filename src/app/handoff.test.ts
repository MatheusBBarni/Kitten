import { describe, expect, it } from "bun:test"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import type { PromptBlock } from "../agent/agentConnection.ts"
import type { BundleAssembler } from "../core/bundleAssembler.ts"
import { REDACTION_PLACEHOLDER } from "../core/secretRedactor.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, PROVIDER_DISPLAY_NAMES } from "../core/types.ts"
import type { ConfigOption, HandoffBundle, ProviderKind, SessionId, SessionSeed, ToolCallUpdate } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { createTelemetryRecorder, type TelemetryRecord } from "../telemetry/recorder.ts"
import type { AgentRuntimeState } from "./controller.ts"
import {
  composeHandoffBlocks,
  createHandoffEdits,
  createHandoffFlow,
  FILES_HEADING,
  HANDOFF_INSTRUCTION,
  includedCommands,
  includedDiffs,
  includedFiles,
  pendingDiffHeading,
  SHELL_HEADING,
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

/** Add two completed commands to the shell slice captured by the next hand-off. */
function seedShellWork(controller: FakeController): void {
  controller.store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-test", command: "bun test" })
  controller.store.applyShellEvent({ kind: "command_finished", id: "command-test", exitCode: 0, output: "12 pass" })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-status", command: "git status" })
  controller.store.applyShellEvent({ kind: "command_finished", id: "command-status", exitCode: 0, output: "clean" })
}

/** Give `sessionId` a transcript worth handing over: a turn, a file it read, a diff. */
function seedWork(controller: FakeController, sessionId: SessionId, text = "bump b"): void {
  const { store } = controller
  store.applyEvent(sessionId, { kind: "user_message", messageId: "m1", text })
  store.applyEvent(sessionId, { kind: "agent_message", messageId: "m2", textDelta: "On it." })
  store.applyEvent(sessionId, {
    kind: "tool_call",
    call: { toolCallId: "call-read", kind: "read", title: "Read config", status: "completed", locations: ["cfg.json"] },
  })
  store.applyEvent(sessionId, { kind: "tool_call", call: editCall() })
}

/** The target's advertised model/effort options, including their confirmed values. */
function targetConfigOptions(currentModel = "sonnet", currentEffort = "low"): ConfigOption[] {
  return [
    {
      id: "model",
      category: MODEL_CATEGORY,
      label: "Model",
      currentValue: currentModel,
      options: [
        { value: "sonnet", name: "Sonnet" },
        { value: "opus", name: "Opus" },
      ],
    },
    {
      id: "effort",
      category: EFFORT_CATEGORY,
      label: "Reasoning effort",
      currentValue: currentEffort,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    },
  ]
}

/** A three-session fleet (two sharing a provider), each in its own directory. */
const FLEET_SEEDS: SessionSeed[] = [
  { id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" },
  { id: "b", providerKind: "codex", title: "Beta", cwd: "/work/beta" },
  { id: "c", providerKind: "claude-code", title: "Gamma", cwd: "/work/gamma" },
]

/** A ready runtime per seed, save for any id mapped to `false` in `notReady`. */
function fleetRuntimes(notReady: Partial<Record<SessionId, boolean>> = {}): AgentRuntimeState[] {
  return FLEET_SEEDS.map((seed) => {
    const base = {
      sessionId: seed.id,
      providerKind: seed.providerKind,
      displayName: PROVIDER_DISPLAY_NAMES[seed.providerKind],
      title: seed.title,
      cwd: seed.cwd,
    }
    return notReady[seed.id]
      ? { ...base, ready: false as const, error: "not up" }
      : { ...base, ready: true as const, acpSessionId: `session-${seed.id}` }
  })
}

/** A fake controller over the three-session fleet, focused on `source` with work to hand over. */
function fleetControllerWithWork(
  options: { source?: SessionId; notReady?: Partial<Record<SessionId, boolean>> } = {},
): FakeController {
  const controller = createFakeController({
    store: createAppStore({ seeds: FLEET_SEEDS }),
    runtimes: fleetRuntimes(options.notReady),
  })
  const source = options.source ?? "a"
  controller.store.setFocus(source)
  seedWork(controller, source)
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
      excludedCommands: new Set(),
      targetConfig: [],
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
      excludedCommands: new Set(),
      targetConfig: [],
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

  it("emits a Shell context block from the surviving commands and cwd", () => {
    const shellBundle: HandoffBundle = {
      ...bundle,
      shell: {
        cwd: "/workspace/kitten",
        commands: [
          { id: "command-1", command: "bun test", output: "12 pass", exitCode: 0 },
          { id: "command-2", command: "false", output: "", exitCode: 1 },
        ],
      },
    }
    const shellEdits = {
      ...createHandoffEdits(shellBundle),
      excludedCommands: new Set(["command-2"]),
    }

    const blocks = composeHandoffBlocks(shellBundle, shellEdits)
    const shellBlock = blocks.find((block) => block.text.startsWith(SHELL_HEADING))

    expect(includedCommands(shellBundle, shellEdits).map((command) => command.id)).toEqual(["command-1"])
    expect(shellBlock?.text).toBe(
      [SHELL_HEADING, "Working directory: /workspace/kitten", "Command: bun test\nExit code: 0\nOutput:\n12 pass"].join(
        "\n\n",
      ),
    )
    expect(shellBlock?.text).not.toContain("Command: false")
  })

  it("omits the shell block when the developer drops every command", () => {
    const shellOnly: HandoffBundle = {
      intent: "continue",
      summary: "",
      files: [],
      pendingDiffs: [],
      shell: {
        cwd: "/workspace/kitten",
        commands: [{ id: "command-1", command: "bun test", output: "12 pass", exitCode: 0 }],
      },
      redactionCount: 0,
    }
    const dropped = {
      ...createHandoffEdits(shellOnly),
      excludedCommands: new Set(["command-1"]),
    }

    expect(composeHandoffBlocks(shellOnly, dropped)).toEqual([])
  })
})

describe("HandoffFlow.begin", () => {
  it("assembles a bundle from the focused session and opens the preview toward the other agent", () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toEqual({ ok: true })

    const overlay = controller.store.getState().overlays.handoffPreview!
    expect(overlay.sourceSessionId).toBe("claude-code")
    expect(overlay.targetSessionId).toBe("codex")
    expect(overlay.bundle.intent).toBe("continue")
    expect(overlay.bundle.summary).toContain("bump b")
    expect(overlay.bundle.files.map((file) => file.path)).toEqual(["cfg.json", "src/app.ts"])
    expect(overlay.bundle.pendingDiffs.map((diff) => diff.toolCallId)).toEqual(["call-edit"])
  })

  it("seeds the target's visible model/effort options and confirmed values into the preview", () => {
    const controller = controllerWithWork()
    const options: ConfigOption[] = [
      ...targetConfigOptions("sonnet", "low"),
      {
        id: "mode",
        category: "mode",
        label: "Permission mode",
        currentValue: "default",
        options: [{ value: "default", name: "Default" }],
      },
    ]
    controller.store.applyEvent("codex", { kind: "config_options", options })

    expect(createHandoffFlow({ controller }).begin()).toEqual({ ok: true })

    const preview = controller.store.getState().overlays.handoffPreview!
    expect(preview.targetConfigOptions).toEqual(targetConfigOptions("sonnet", "low"))
    expect(preview.targetConfigOptions.map((option) => option.currentValue)).toEqual(["sonnet", "low"])
  })

  it("never sends anything: the preview is the only path to an agent", () => {
    const controller = controllerWithWork()
    createHandoffFlow({ controller }).begin()

    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
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

  it("returns empty-source when the source agent has said nothing worth carrying", () => {
    const controller = createFakeController()
    expect(createHandoffFlow({ controller }).begin()).toEqual({ ok: false, reason: "empty-source" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("returns empty-source without assembling or opening an overlay when selection is null", () => {
    const controller = controllerWithWork()
    controller.store.backgroundConversation("claude-code")
    controller.store.backgroundConversation("codex")
    let assemblies = 0
    const assembler = {
      assemble(): never {
        assemblies += 1
        throw new Error("assembler must not run without a selected source")
      },
    }

    expect(createHandoffFlow({ controller, assembler }).begin()).toEqual({ ok: false, reason: "empty-source" })
    expect(assemblies).toBe(0)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()
  })

  it("returns no-target when the agent that would receive the bundle never came up", () => {
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

    expect(createHandoffFlow({ controller }).begin()).toEqual({ ok: false, reason: "no-target" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("returns overlay-open without clobbering a pending permission request", () => {
    const controller = controllerWithWork()
    controller.store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: { sessionId: "s", toolCall: { toolCallId: "call-1" }, options: [] },
    })

    expect(createHandoffFlow({ controller }).begin()).toEqual({ ok: false, reason: "overlay-open" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("does not re-assemble over a preview the developer is already curating", () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    expect(flow.begin()).toEqual({ ok: true })

    const first = openBundle(controller)
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m3", text: "and again" })

    expect(flow.begin()).toEqual({ ok: false, reason: "overlay-open" })
    expect(openBundle(controller)).toBe(first)
  })

  it("assembles through the injected strategy, so Phase 2 swaps it without touching callers", () => {
    const controller = controllerWithWork()
    const seen: ProviderKind[] = []
    controller.store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })
    controller.store.applyShellEvent({ kind: "command_started", id: "command-1", command: "bun test" })
    controller.store.applyShellEvent({ kind: "command_finished", id: "command-1", output: "12 pass", exitCode: 0 })
    let seenShell: HandoffBundle["shell"]
    const assembler: BundleAssembler = {
      assemble(session, target, shell) {
        seen.push(target)
        seenShell = shell
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
    expect(seenShell).toMatchObject({
      cwd: "/workspace/kitten",
      commands: [{ id: "command-1", command: "bun test", output: "12 pass", exitCode: 0 }],
    })
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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
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

  it("applies requested target model and effort before sending the hand-off prompt", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)
    const order: string[] = []
    const setSessionConfigOption = controller.actions.setSessionConfigOption
    const sendPrompt = controller.actions.sendPrompt
    controller.actions.setSessionConfigOption = async (configId, value, sessionId) => {
      order.push(`config:${configId}:${value}`)
      return setSessionConfigOption(configId, value, sessionId)
    }
    controller.actions.sendPrompt = async (input, sessionId) => {
      order.push("send")
      return sendPrompt(input, sessionId)
    }

    await flow.confirm({
      ...createHandoffEdits(bundle),
      targetConfig: [
        { configId: "model", value: "opus" },
        { configId: "effort", value: "high" },
      ],
    })

    expect(controller.calls.setSessionConfigOption).toEqual([
      { configId: "model", value: "opus", sessionId: "codex" },
      { configId: "effort", value: "high", sessionId: "codex" },
    ])
    expect(order).toEqual(["config:model:opus", "config:effort:high", "send"])
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("codex")
  })

  it("keeps the preview open and does not send when a target setting is unconfirmed", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)
    controller.actions.setSessionConfigOption = async (configId, value, sessionId) => {
      controller.calls.setSessionConfigOption.push({ configId, value, sessionId })
      return false
    }

    const result = await flow.confirm({
      ...createHandoffEdits(bundle),
      targetConfig: [{ configId: "effort", value: "high" }],
    })

    expect(result).toBeNull()
    expect(controller.store.getState().overlays.handoffPreview?.bundle).toBe(bundle)
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.switchFocus).toEqual([])
  })

  it("records an effort-linked hand-off only when it carries target configuration", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({ enabled: true, sink: { write: (record) => records.push(record) } })
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller, recorder })
    flow.begin()

    await flow.confirm({
      ...createHandoffEdits(openBundle(controller)),
      targetConfig: [{ configId: "effort", value: "high" }],
    })

    expect(records.filter((record) => record.type === "effort_linked_handoff")).toEqual([
      expect.objectContaining({ agent: "codex" }),
    ])
  })

  it("does not record an effort-linked hand-off when no target configuration is selected", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({ enabled: true, sink: { write: (record) => records.push(record) } })
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller, recorder })
    flow.begin()

    await flow.confirm(createHandoffEdits(openBundle(controller)))

    expect(records.some((record) => record.type === "effort_linked_handoff")).toBe(false)
  })

  it("records shell_snapshot_attached when a confirmed hand-off carries a surviving command", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({ enabled: true, sink: { write: (record) => records.push(record) } })
    const controller = controllerWithWork()
    seedShellWork(controller)
    const flow = createHandoffFlow({ controller, recorder })
    flow.begin()
    const bundle = openBundle(controller)

    await flow.confirm({
      ...createHandoffEdits(bundle),
      excludedCommands: new Set(["command-test"]),
    })

    expect(records.filter((record) => record.type === "shell_snapshot_attached")).toHaveLength(1)
  })

  it("records no shell snapshot event when every command is dropped", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({ enabled: true, sink: { write: (record) => records.push(record) } })
    const controller = controllerWithWork()
    seedShellWork(controller)
    const flow = createHandoffFlow({ controller, recorder })
    flow.begin()
    const bundle = openBundle(controller)

    await flow.confirm({
      ...createHandoffEdits(bundle),
      excludedCommands: new Set(["command-test", "command-status"]),
    })

    expect(records.some((record) => record.type === "shell_snapshot_attached")).toBe(false)
  })

  it("sends unchanged hand-offs without a target config call", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    await flow.confirm(createHandoffEdits(openBundle(controller)))

    expect(controller.calls.setSessionConfigOption).toEqual([])
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
      excludedCommands: new Set(),
      targetConfig: [],
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
      excludedCommands: new Set(),
      targetConfig: [],
    })

    expect(result).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().overlays.handoffPreview).not.toBeNull()
  })

  it("sends nothing when no preview is open", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })

    expect(
      await flow.confirm({
        summary: "hi",
        excludedFiles: new Set(),
        excludedDiffs: new Set(),
        excludedCommands: new Set(),
        targetConfig: [],
      }),
    ).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
  })

  it("keeps preview-first safety when the source is removed before confirmation", async () => {
    const controller = controllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)
    controller.store.removeSession("claude-code")

    expect(await flow.confirm(createHandoffEdits(bundle))).toBeNull()
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.switchFocus).toEqual([])
  })

  it("declines an unavailable target without sending or moving focus", async () => {
    const runtimes = readyRuntimes()
    const controller = controllerWithWork({ runtimes })
    const flow = createHandoffFlow({ controller })
    flow.begin()
    const bundle = openBundle(controller)
    runtimes[1] = {
      sessionId: "codex",
      providerKind: "codex",
      displayName: "Codex",
      title: "Codex",
      cwd: "/workspace/kitten",
      ready: false,
      error: "connection lost",
    }

    expect(await flow.confirm(createHandoffEdits(bundle))).toBeNull()
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.store.getState().overlays.handoffPreview).not.toBeNull()
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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })

  it("is a no-op with no preview open", () => {
    const controller = controllerWithWork()
    createHandoffFlow({ controller }).cancel()
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })
})

describe("HandoffFlow.begin - fleet targeting", () => {
  it("opens the target picker, not the preview, when more than one session can receive", () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toEqual({ ok: true })

    const { overlays } = controller.store.getState()
    expect(overlays.handoffTarget).toEqual({ sourceSessionId: "a" })
    // Nothing is assembled or aimed yet: the developer has not chosen a recipient.
    expect(overlays.handoffPreview).toBeNull()
  })

  it("skips the picker and opens the preview when exactly one recipient is ready", () => {
    // Only Beta is ready besides the source, so there is no choice to offer.
    const controller = fleetControllerWithWork({ notReady: { c: true } })
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toEqual({ ok: true })

    const { overlays } = controller.store.getState()
    expect(overlays.handoffTarget).toBeNull()
    expect(overlays.handoffPreview!.sourceSessionId).toBe("a")
    expect(overlays.handoffPreview!.targetSessionId).toBe("b")
  })

  it("returns no-target when only the source is ready, so there is no recipient", () => {
    const controller = fleetControllerWithWork({ notReady: { b: true, c: true } })

    expect(createHandoffFlow({ controller }).begin()).toEqual({ ok: false, reason: "no-target" })
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("does not open a second picker over one already open", () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })
    expect(flow.begin()).toEqual({ ok: true })

    // A picker is an open overlay, so a second chord finds the screen already owned.
    expect(flow.begin()).toEqual({ ok: false, reason: "overlay-open" })
    expect(controller.store.getState().overlays.handoffTarget).toEqual({ sourceSessionId: "a" })
  })

  it("sends nothing when it opens the picker: only confirm reaches an agent", () => {
    const controller = fleetControllerWithWork()
    createHandoffFlow({ controller }).begin()

    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
  })
})

describe("HandoffFlow.chooseTarget", () => {
  it("opens the preview toward the chosen target and closes the picker", () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    expect(flow.chooseTarget("c")).toBe(true)

    const { overlays } = controller.store.getState()
    expect(overlays.handoffTarget).toBeNull()
    const preview = overlays.handoffPreview!
    expect(preview.sourceSessionId).toBe("a")
    expect(preview.targetSessionId).toBe("c")
    // The bundle is assembled from the source and headed for the chosen provider kind.
    expect(preview.bundle.summary).toContain("bump b")
  })

  it("routes confirm to the chosen target's sendPrompt and moves focus to it", async () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()
    flow.chooseTarget("c")

    await flow.confirm(createHandoffEdits(openBundle(controller)))

    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("c")
    expect(sentText(controller)).toContain(HANDOFF_INSTRUCTION)
    expect(controller.calls.switchFocus).toEqual(["c"])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("c")
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("is a no-op when no picker is open", () => {
    const controller = fleetControllerWithWork()

    expect(createHandoffFlow({ controller }).chooseTarget("c")).toBe(false)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("rejects the source itself as a target", () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    expect(flow.chooseTarget("a")).toBe(false)
    // The picker stays up so the developer can still pick a real recipient.
    expect(controller.store.getState().overlays.handoffTarget).toEqual({ sourceSessionId: "a" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
  })

  it("rejects a target that is not ready, leaving the picker open", () => {
    const seeds: SessionSeed[] = [...FLEET_SEEDS, { id: "d", providerKind: "codex", title: "Delta", cwd: "/work/delta" }]
    const controller = createFakeController({
      store: createAppStore({ seeds }),
      runtimes: [
        ...fleetRuntimes(),
        { sessionId: "d", providerKind: "codex", displayName: "Codex", title: "Delta", cwd: "/work/delta", ready: false, error: "down" },
      ],
    })
    controller.store.setFocus("a")
    seedWork(controller, "a")
    const flow = createHandoffFlow({ controller })
    expect(flow.begin()).toEqual({ ok: true })

    expect(flow.chooseTarget("d")).toBe(false)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).not.toBeNull()
  })

  it("closes the picker on cancel, sending nothing and leaving focus put", () => {
    const controller = fleetControllerWithWork()
    const flow = createHandoffFlow({ controller })
    flow.begin()

    flow.cancel()

    expect(controller.store.getState().overlays.handoffTarget).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
  })
})

describe("hand-off moat - characterization (ADR-002)", () => {
  // A frozen bundle and the exact blocks it must compose to. This locks the composed
  // wire format byte-for-byte: re-addressing the hand-off to a chosen session must not
  // move a character of what the target actually receives.
  const FIXED_BUNDLE: HandoffBundle = {
    intent: "continue",
    summary: "claude-code: I bumped b in src/app.ts",
    files: [
      { path: "cfg.json", reason: "read" },
      { path: "src/app.ts", reason: "edited" },
    ],
    pendingDiffs: [{ toolCallId: "call-edit", path: "src/app.ts", unified: UNIFIED }],
    redactionCount: 2,
  }

  it("composes a fixed bundle to exactly the expected blocks", () => {
    expect(composeHandoffBlocks(FIXED_BUNDLE, createHandoffEdits(FIXED_BUNDLE))).toEqual([
      { type: "text", text: HANDOFF_INSTRUCTION },
      { type: "text", text: "claude-code: I bumped b in src/app.ts" },
      { type: "text", text: "Files referenced so far:\n- cfg.json (read)\n- src/app.ts (edited)" },
      { type: "text", text: `Pending diff (proposed, not yet applied) - src/app.ts\n${UNIFIED}` },
    ])
  })

  it("composes the curated bundle to exactly the expected blocks under edits", () => {
    const edits: HandoffEdits = {
      summary: "  Only the edit matters.  ",
      excludedFiles: new Set(["cfg.json"]),
      excludedDiffs: new Set(),
      excludedCommands: new Set(),
      targetConfig: [],
    }
    expect(composeHandoffBlocks(FIXED_BUNDLE, edits)).toEqual([
      { type: "text", text: HANDOFF_INSTRUCTION },
      { type: "text", text: "Only the edit matters." },
      { type: "text", text: "Files referenced so far:\n- src/app.ts (edited)" },
      { type: "text", text: `Pending diff (proposed, not yet applied) - src/app.ts\n${UNIFIED}` },
    ])
  })

  it("preserves the redaction count through the re-addressed picker flow", () => {
    const controller = fleetControllerWithWork()
    // Plant a credential on the source, exactly as the source-only begin test does.
    controller.store.applyEvent("a", { kind: "user_message", messageId: "m3", text: `key is ${SECRET}` })
    const flow = createHandoffFlow({ controller })
    flow.begin()
    expect(flow.chooseTarget("c")).toBe(true)

    const bundle = openBundle(controller)
    // The assembler still redacts as it builds; the count survives the target choice.
    expect(bundle.redactionCount).toBe(1)
    expect(bundle.summary).toContain(REDACTION_PLACEHOLDER)
    expect(bundle.summary).not.toContain(SECRET)
  })
})

describe("hand-back", () => {
  it("runs the same flow in the other direction once the target holds focus", async () => {
    // Codex has been handed the task and has since done work of its own.
    const controller = controllerWithWork({ sessionId: "codex" })
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toEqual({ ok: true })
    const overlay = controller.store.getState().overlays.handoffPreview!
    expect(overlay.sourceSessionId).toBe("codex")
    expect(overlay.targetSessionId).toBe("claude-code")
    expect(overlay.bundle.summary).toContain("codex")

    await flow.confirm(createHandoffEdits(overlay.bundle))

    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("claude-code")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })
})
