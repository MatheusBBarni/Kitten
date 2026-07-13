// Suite: Cockpit command and shell integration
// Invariant: slash commands drive cockpit actions while the shell chord and modal overlays retain clear input precedence.
// Boundary IN: real AppStore, OpenTUI renderer/input/focus, telemetry recorder, and the cockpit frame tree.
// Boundary OUT: config persistence/watching and agent subprocess transport, owned by their integration suites.

import { describe, expect, it, spyOn } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"
import { KeyEvent } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted, ESCAPE_DISAMBIGUATION_MS, sleep } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption } from "../core/types.ts"
import { wireKeyboardCapability } from "../index.ts"
import type {
  PersistedRunRecord,
  PersistedRunRecordV1,
  PersistedRunSummary,
} from "../persistence/runRecord.ts"
import type { RunStore } from "../persistence/runStore.ts"
import { createInMemoryShellRuntimeFactory } from "../shell/shellRuntime.ts"
import { selectHasOpenOverlay } from "../store/selectors.ts"
import {
  createTelemetryRecorder,
  type TelemetryRecord,
  type TelemetryRecorder,
} from "../telemetry/recorder.ts"
import { APPROVAL_TITLE } from "./ApprovalPrompt.tsx"
import {
  CockpitApp,
  EXTERNAL_RUN_COPIED_PREFIX,
  EXTERNAL_RUN_EMPTY,
  HELP_TITLE,
} from "./CockpitApp.tsx"
import { EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import { HELP_ENTRIES, SHELL_EXIT_HINT, tabNavigationHint } from "./keymap.ts"
import { renderCockpit } from "./main.tsx"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { SETTINGS_TITLE } from "./SettingsView.tsx"
import { SESSION_PICKER_TITLE, type SessionPickerSource } from "./SessionPicker.tsx"
import { STATUS_LABELS } from "./StatusStrip.tsx"
import { WELCOME_GREETING, WELCOME_KITTEN, WELCOME_ON_RAMP } from "./WelcomeBanner.tsx"

/** The frame's rows. `captureCharFrame` terminates the last row with a newline. */
function lines(frame: string): string[] {
  return frame.replace(/\n$/, "").split("\n")
}

/**
 * Every rendered line fits the viewport, the frame fits the row budget, and no cell
 * was left holding the buffer's uninitialized filler (`U+0A00`) from a larger frame.
 */
function expectNoOverflow(frame: string, width: number, height: number): void {
  const rows = lines(frame)
  expect(rows.length).toBe(height)
  for (const row of rows) {
    expect([...row].length).toBe(width)
  }
  expect(frame).not.toContain("਀")
}

function keyEvent(name: string, options: { ctrl?: boolean; shift?: boolean; meta?: boolean; source?: "raw" | "kitty" } = {}): KeyEvent {
  return new KeyEvent({
    name,
    ctrl: options.ctrl ?? false,
    shift: options.shift ?? false,
    meta: options.meta ?? false,
    option: false,
    sequence: "",
    number: false,
    raw: options.source === "kitty" ? `kitty:${name}` : name,
    eventType: "press",
    source: options.source ?? "raw",
  })
}

async function renderCockpitApp(
  controller: FakeController,
  width = 80,
  height = 24,
  recorder?: TelemetryRecorder,
  sessionPicker?: SessionPickerSource,
) {
  const setup = await testRender(<CockpitApp controller={controller} recorder={recorder} sessionPicker={sessionPicker} />, {
    width,
    height,
    kittyKeyboard: true,
    exitOnCtrlC: false,
  })
  await setup.waitForFrame((f) => f.includes("Kitten"))
  return setup
}

/** Drive a command exactly as a user does: type it in the focused prompt, then choose it. */
async function runSlashCommand(
  setup: Awaited<ReturnType<typeof renderCockpitApp>>,
  command: string,
): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.typeText(`/${command}`)
  })
  await actAsync(() => {
    setup.mockInput.pressEnter()
  })
}

/** A project run fixture plus its in-memory persistence boundary for `/resume` flows. */
function pickerRun(runId: string, lastPrompt: string, updatedAt: number): PersistedRunRecordV1 {
  return {
    version: 1,
    runId,
    cwd: process.cwd(),
    gitBranch: `feat/${runId}`,
    focusedAgentId: "codex",
    createdAt: updatedAt - 1_000,
    updatedAt,
    agents: {
      "claude-code": { sessionId: `${runId}-claude`, lastPrompt: "review", messageCount: 2, status: "idle" },
      codex: { sessionId: `${runId}-codex`, lastPrompt, messageCount: 5, status: "finished" },
    },
    handoffBundle: null,
  }
}

function pickerSource(records: PersistedRunRecordV1[]): SessionPickerSource {
  const toSummary = (record: PersistedRunRecordV1): PersistedRunSummary => {
    const focused = record.agents[record.focusedAgentId]!
    return {
      runId: record.runId,
      updatedAt: record.updatedAt,
      gitBranch: record.gitBranch,
      focusedAgentId: record.focusedAgentId,
      lastPrompt: focused.lastPrompt,
      messageCount: focused.messageCount,
    }
  }
  const runStore: RunStore = {
    save() {},
    list: (cwd) => records.filter((record) => record.cwd === cwd).map(toSummary).sort((a, b) => b.updatedAt - a.updatedAt),
    load: (cwd, runId) => records.find((record) => record.cwd === cwd && record.runId === runId) ?? null,
    delete() {},
    deleteAll() {},
    flush() {},
  }
  return { runStore, cwd: process.cwd(), now: () => 10_000 }
}

/** Open the one approval needed to prove it still outranks settings. */
function openApproval(controller: FakeController): void {
  controller.store.openApproval({
    sessionId: "claude-code",
    title: "Claude Code",
    cwd: "/workspace/kitten",
    request: {
      sessionId: "claude-code",
      toolCall: { toolCallId: "approval-1", kind: "other", title: "Approve action" },
      options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
    },
  })
}

/** The current model/effort values a session reports through a config_options event. */
function configOptions(model: string, effort: string): ConfigOption[] {
  return [
    {
      id: "model",
      category: MODEL_CATEGORY,
      label: "Model",
      currentValue: model,
      options: [{ value: model, name: model }],
    },
    {
      id: "effort",
      category: EFFORT_CATEGORY,
      label: "Reasoning effort",
      currentValue: effort,
      options: [{ value: effort, name: effort }],
    },
  ]
}

/** Build the real xterm-backed in-memory shell boundary used by cockpit input tests. */
function shellReadyController() {
  const shell = createInMemoryShellRuntimeFactory()
  const runtime = shell.factory({ cwd: process.cwd() })
  const controller = createFakeController({ shell: { ready: true, runtime } })
  return { controller, runtime, shell }
}

describe("CockpitApp layout", () => {
  it("renders the focused conversation region above a persistent status strip", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpitApp(controller)

    const frame = captureCharFrame()
    const rows = lines(frame)

    // The focused pane is product-branded; the banner shows Kitten in ASCII.
    expect(rows[0]).toContain("Kitten")
    for (const line of WELCOME_KITTEN) expect(frame).toContain(line)
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).toContain(WELCOME_ON_RAMP)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)
    expect(frame).not.toContain("Claude Code")

    // The strip keeps the focused provider, model, and status in one bottom row.
    const strip = rows.at(-1) ?? ""
    expect(strip).toContain(`claude:— - ${STATUS_LABELS.idle}`)
    expect(strip).not.toContain("codex:—")
    expect(strip).toContain(tabNavigationHint("unknown"))

    await destroyMounted(renderer)
  })

  it("keeps the ASCII welcome and command affordance in a fixed-size frame", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpitApp(controller)

    const frame = captureCharFrame()
    expectNoOverflow(frame, 80, 24)
    expect(frame).toContain(WELCOME_KITTEN[0])
    expect(frame).toContain(tabNavigationHint("unknown"))

    await destroyMounted(renderer)
  })

  it("shows only the focused pane's chosen model and refreshes it from config updates", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("claude-fable-5[1m]", "high") })
    controller.store.applyEvent("codex", { kind: "config_options", options: configOptions("gpt-5.1-codex-max", "medium") })
    const { renderer, waitForFrame } = await renderCockpitApp(controller)

    const initial = await waitForFrame((f) => f.includes("claude:claude-fable-5[1m]"))
    expectNoOverflow(initial, 80, 24)
    expect(initial).toContain("claude:claude-fable-5[1m]")
    expect(initial).not.toContain("/high")
    expect(initial).not.toContain("codex:gpt-5.1-codex-max")

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("sonnet", "low") })
    })

    const updated = await waitForFrame((f) => f.includes("claude:sonnet"))
    expectNoOverflow(updated, 80, 24)
    expect(updated).toContain("claude:sonnet")
    expect(updated).not.toContain("/low")
    expect(updated).not.toContain("codex:gpt-5.1-codex-max")

    await actAsync(() => controller.actions.switchFocus("codex"))
    const codex = await waitForFrame((f) => f.includes("codex:gpt-5.1-codex-max"))
    expect(codex).not.toContain("claude:sonnet")

    await destroyMounted(renderer)
  })

  it("explains a not-ready focused agent instead of an empty transcript", async () => {
    const runtimes: AgentRuntimeState[] = [
      { sessionId: "claude-code", providerKind: "claude-code", displayName: "Claude Code", title: "Claude Code", cwd: "/workspace/kitten", ready: false, error: "claude-agent-acp: command not found" },
      readyRuntimes()[1]!,
    ]
    const controller = createFakeController({ runtimes })
    const { renderer, waitForFrame } = await renderCockpitApp(controller)

    const frame = await waitForFrame((f) => f.includes("not ready"))
    expect(frame).toContain("This agent is not ready.")
    expect(frame).toContain("claude-agent-acp: command not found")
    expect(frame).not.toContain(WELCOME_GREETING)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })
})

describe("CockpitApp resize", () => {
  it("re-lays out the frame on a resize without overflow artifacts", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame, resize, waitForFrame } = await renderCockpitApp(controller, 100, 30)

    expectNoOverflow(captureCharFrame(), 100, 30)
    expect(lines(captureCharFrame()).length).toBe(30)

    await actAsync(() => {
      resize(64, 12)
    })
    const shrunk = await waitForFrame((f) => lines(f).length === 12 && f.includes(tabNavigationHint("unknown")))

    expectNoOverflow(shrunk, 64, 12)
    // The strip survives the shrink and stays pinned to the bottom row.
    expect(lines(shrunk).at(-1)).toContain(STATUS_LABELS.idle)

    await actAsync(() => {
      resize(120, 40)
    })
    const grown = await waitForFrame((f) => lines(f).length === 40 && f.includes(WELCOME_GREETING))

    expectNoOverflow(grown, 120, 40)
    expect(lines(grown).at(-1)).toContain(STATUS_LABELS.idle)

    await destroyMounted(renderer)
  })
})

describe("CockpitApp alternate-screen layout", () => {
  it("expands the shell pane on alternate-screen enter and restores cockpit chrome on exit", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await runSlashCommand(setup, "shell")
      const primary = await setup.waitForFrame(
        (frame) => frame.includes("Shell · focused") && frame.includes(PROMPT_PLACEHOLDER),
      )
      expect(primary).toContain(SHELL_EXIT_HINT)
      await setup.waitFor(() => shell.resizes.length > 0)
      const primarySize = shell.resizes.at(-1)!

      await actAsync(async () => {
        await shell.scriptOutput("\u001b[?1049h\u001b[Hinteractive-app")
      })
      const alternate = await setup.waitForFrame((frame) => frame.includes("interactive-app"))
      await setup.waitFor(() => (shell.resizes.at(-1)?.rows ?? 0) > primarySize.rows)
      const alternateSize = shell.resizes.at(-1)!
      expect(runtime.bufferType()).toBe("alternate")
      expect(alternate).not.toContain(PROMPT_PLACEHOLDER)
      expect(alternate).not.toContain(tabNavigationHint("unknown"))
      expect(alternate).not.toContain(SHELL_EXIT_HINT)
      expect(alternateSize.rows).toBeGreaterThan(primarySize.rows)

      await actAsync(() => {
        setup.resize(100, 30)
      })
      await setup.waitFor(
        () =>
          (shell.resizes.at(-1)?.cols ?? 0) > alternateSize.cols &&
          (shell.resizes.at(-1)?.rows ?? 0) > alternateSize.rows,
      )
      const resizedAlternate = shell.resizes.at(-1)!
      expect(runtime.view()).toHaveLength(resizedAlternate.rows)

      await actAsync(async () => {
        await shell.scriptOutput("\u001b[?1049l")
      })
      const restored = await setup.waitForFrame(
        (frame) => frame.includes(PROMPT_PLACEHOLDER) && frame.includes(SHELL_EXIT_HINT),
      )
      expect(runtime.bufferType()).toBe("normal")
      expect(restored).not.toContain("interactive-app")
      await setup.waitFor(() => (shell.resizes.at(-1)?.rows ?? Infinity) < resizedAlternate.rows)
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })
})

describe("CockpitApp keymap", () => {
  it("ignores the first Kitty tab chord, then dispatches one cyclic action per confirmed Kitty event", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)
    const selectAdjacent = spyOn(controller.store, "selectAdjacentConversation")
    const stopObservation = wireKeyboardCapability(setup.renderer, () => controller.store.confirmKittyKeyboard())

    try {
      const first = keyEvent("l", { ctrl: true, source: "kitty" })
      await actAsync(() => {
        setup.renderer.keyInput.emit("keypress", first)
      })
      expect(controller.store.getState().keyboardCapability).toBe("kittyConfirmed")
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      expect(selectAdjacent).toHaveBeenCalledTimes(0)
      expect(first.defaultPrevented).toBe(false)

      const next = keyEvent("l", { ctrl: true, source: "kitty" })
      await actAsync(() => {
        setup.renderer.keyInput.emit("keypress", next)
      })
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
      expect(selectAdjacent).toHaveBeenCalledTimes(1)
      expect(selectAdjacent).toHaveBeenLastCalledWith("next")
      expect(next.defaultPrevented).toBe(true)

      const previous = keyEvent("h", { ctrl: true, source: "kitty" })
      await actAsync(() => {
        setup.renderer.keyInput.emit("keypress", previous)
      })
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      expect(selectAdjacent).toHaveBeenCalledTimes(2)
      expect(selectAdjacent).toHaveBeenLastCalledWith("previous")
      expect(previous.defaultPrevented).toBe(true)
    } finally {
      stopObservation()
      selectAdjacent.mockRestore()
      await destroyMounted(setup.renderer)
    }
  })

  it("rejects confirmed raw and modified tab lookalikes and stands down behind a modal", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)
    const selectAdjacent = spyOn(controller.store, "selectAdjacentConversation")
    await actAsync(() => controller.store.confirmKittyKeyboard())

    try {
      for (const event of [
        keyEvent("l", { ctrl: true, source: "raw" }),
        keyEvent("h", { ctrl: true, shift: true, source: "kitty" }),
        keyEvent("l", { ctrl: true, meta: true, source: "kitty" }),
        keyEvent("j", { ctrl: true, source: "kitty" }),
      ]) {
        await actAsync(() => {
          setup.renderer.keyInput.emit("keypress", event)
        })
      }

      await actAsync(() => controller.store.openSettings())
      await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))
      await actAsync(() => {
        setup.renderer.keyInput.emit(
          "keypress",
          keyEvent("l", { ctrl: true, source: "kitty" }),
        )
      })

      expect(selectAdjacent).toHaveBeenCalledTimes(0)
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    } finally {
      selectAdjacent.mockRestore()
      await destroyMounted(setup.renderer)
    }
  })

  it("forwards navigation and function keys while an alternate-screen app is active", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await runSlashCommand(setup, "shell")
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))
      await actAsync(async () => {
        await shell.scriptOutput("\u001b[?1049h\u001b[Hinteractive-app")
      })
      await setup.waitForFrame((frame) => frame.includes("interactive-app"))

      await actAsync(() => {
        setup.mockInput.pressArrow("up")
        setup.mockInput.pressArrow("left")
        setup.mockInput.pressKey("F5")
      })

      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([
        0x1b, 0x5b, 0x41,
        0x1b, 0x5b, 0x44,
        0x1b, 0x5b, 0x31, 0x35, 0x7e,
      ])
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("keeps the shell chord for terminal-level focus while preserving an agent draft", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await actAsync(async () => {
        await setup.mockInput.typeText("agent draft")
      })
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("agent draft")

      await actAsync(() => {
        setup.mockInput.pressKey("`", { ctrl: true })
      })
      const shellFrame = await setup.waitForFrame((frame) => frame.includes("Shell · focused"))
      expect(controller.store.getState().focusedPane).toEqual({ kind: "shell" })
      expect(shellFrame).toContain(SHELL_EXIT_HINT)
      expect(shellFrame).not.toContain(WELCOME_GREETING)
      expect(setup.renderer.currentFocusedEditor).toBeNull()

      await actAsync(async () => {
        await setup.mockInput.typeText("ls")
      })
      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x6c, 0x73])

      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
      await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING) && !frame.includes("Shell · focused"))
      expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("agent draft")

      await actAsync(async () => {
        await setup.mockInput.typeText("!")
      })
      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x6c, 0x73])
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("agent draft!")
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("stands slash commands down while shell focus forwards terminal bytes", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await runSlashCommand(setup, "shell")
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))

      await actAsync(() => {
        setup.mockInput.pressKey("o", { ctrl: true })
        setup.mockInput.pressKey("t", { ctrl: true })
        setup.mockInput.pressKey("F1")
      })

      expect(controller.calls.switchFocus).toEqual([])
      expect(controller.store.getState().overlays.handoffPreview).toBeNull()
      expect(controller.store.getState().overlays.handoffTarget).toBeNull()
      expect(setup.captureCharFrame()).not.toContain(HELP_TITLE)
      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x0f, 0x14, 0x1b, 0x4f, 0x50])
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("forwards shell-focused Ctrl+C as 0x03 without destroying the cockpit", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await runSlashCommand(setup, "shell")
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))

      await actAsync(() => {
        setup.mockInput.pressCtrlC()
      })

      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x03])
      expect(setup.renderer.isDestroyed).toBe(false)
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("forwards shell-focused Ctrl+H and Ctrl+L as PTY bytes without tab navigation", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)
    const selectAdjacent = spyOn(controller.store, "selectAdjacentConversation")
    await actAsync(() => controller.store.confirmKittyKeyboard())

    try {
      await runSlashCommand(setup, "shell")
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))

      await actAsync(() => {
        setup.mockInput.pressKey("h", { ctrl: true })
        setup.mockInput.pressKey("l", { ctrl: true })
      })

      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x08, 0x0c])
      expect(selectAdjacent).toHaveBeenCalledTimes(0)
      expect(controller.store.getState().focusedPane).toEqual({ kind: "shell" })
    } finally {
      selectAdjacent.mockRestore()
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("records shell_activated once on the first shell command event", async () => {
    const { controller, runtime } = shellReadyController()
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "shell-input-test",
    })
    const setup = await renderCockpitApp(controller, 80, 24, recorder)

    try {
      await runSlashCommand(setup, "shell")
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))
      await actAsync(async () => {
        await setup.mockInput.typeText("ls")
      })
      expect(records).toEqual([])

      await actAsync(() => {
        controller.store.applyShellEvent({ kind: "command_started", id: "command-1", command: "ls" })
      })
      await setup.waitFor(() => records.length === 1)
      await actAsync(() => {
        controller.store.applyShellEvent({ kind: "command_started", id: "command-2", command: "pwd" })
      })

      expect(records).toEqual([{ type: "shell_activated", at: 42, sessionRef: "shell-input-test" }])
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("runs /copy from the agent pane and records external_run exactly once per use", async () => {
    const { controller, runtime } = shellReadyController()
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "external-run-test",
    })
    const setup = await renderCockpitApp(controller, 80, 24, recorder)
    const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(true)

    try {
      await actAsync(() => {
        controller.store.applyShellEvent({ kind: "command_started", id: "command-1", command: "bun test" })
      })
      await runSlashCommand(setup, "copy")

      const frame = await setup.waitForFrame((value) => value.includes(EXTERNAL_RUN_COPIED_PREFIX))
      expect(frame).toContain(`${EXTERNAL_RUN_COPIED_PREFIX} bun test`)
      expect(copy).toHaveBeenCalledTimes(1)
      expect(copy).toHaveBeenCalledWith("bun test")
      expect(records.filter((record) => record.type === "external_run")).toEqual([
        { type: "external_run", at: 42, sessionRef: "external-run-test" },
      ])
    } finally {
      copy.mockRestore()
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("shows /copy's empty state without copying or recording telemetry", async () => {
    const { controller, runtime } = shellReadyController()
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "external-run-empty-test",
    })
    const setup = await renderCockpitApp(controller, 80, 24, recorder)
    const copy = spyOn(setup.renderer, "copyToClipboardOSC52").mockReturnValue(true)

    try {
      await runSlashCommand(setup, "copy")

      expect(await setup.waitForFrame((frame) => frame.includes(EXTERNAL_RUN_EMPTY))).toContain(EXTERNAL_RUN_EMPTY)
      expect(copy).not.toHaveBeenCalled()
      expect(records.filter((record) => record.type === "external_run")).toEqual([])
    } finally {
      copy.mockRestore()
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("switches the focused agent through /switch", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "switch")

    expect(controller.calls.switchFocus).toEqual([undefined])
    // The action really moved focus, reflected by the compact inline summary.
    const frame = await setup.waitForFrame((f) => f.includes(`codex:— - ${STATUS_LABELS.idle}`))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(frame).toContain("Kitten")

    await destroyMounted(setup.renderer)
  })

  it("leaves an unrecognized slash token for the focused agent instead of switching focus", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await actAsync(async () => {
      await setup.mockInput.typeText("/switcheroo")
    })
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => controller.calls.sendPrompt.length === 1)

    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.calls.sendPrompt[0]).toEqual({ input: "/switcheroo", sessionId: undefined })

    await destroyMounted(setup.renderer)
  })

  it("starts fresh agent sessions through /new", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "new")
    await setup.waitFor(() => controller.calls.startNewRun === 1)

    expect(controller.calls.startNewRun).toBe(1)

    await destroyMounted(setup.renderer)
  })

  it("clears the current run through /clear", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "clear")
    await setup.waitFor(() => controller.calls.startNewRun === 1)

    expect(controller.calls.startNewRun).toBe(1)

    await destroyMounted(setup.renderer)
  })

  it("leaves printable keys to the prompt editor", async () => {
    const controller = createFakeController()
    const { renderer, mockInput } = await renderCockpitApp(controller)

    await actAsync(async () => {
      await mockInput.typeText("o")
    })

    expect(controller.calls.switchFocus).toEqual([])

    await destroyMounted(renderer)
  })

  it("opens the project saved-run picker through /resume", async () => {
    const controller = createFakeController()
    const source = pickerSource([pickerRun("auth", "refactor the auth guard", 9_000)])
    const setup = await renderCockpitApp(controller, 80, 24, undefined, source)

    await runSlashCommand(setup, "resume")

    const frame = await setup.waitForFrame((value) => value.includes(SESSION_PICKER_TITLE))
    expect(frame).toContain("refactor the auth guard")
    expect(controller.store.getState().overlays.sessionPicker).toBe(true)
    expect(selectHasOpenOverlay(controller.store.getState())).toBe(true)

    await destroyMounted(setup.renderer)
  })

  it("opens, selects, and restores a saved run through the mounted cockpit", async () => {
    const controller = createFakeController()
    const source = pickerSource([
      pickerRun("newest", "current resume work", 9_000),
      pickerRun("auth", "refactor the auth guard", 8_000),
    ])
    const setup = await renderCockpitApp(controller, 80, 24, undefined, source)

    await runSlashCommand(setup, "resume")
    await setup.waitForFrame((value) => value.includes(SESSION_PICKER_TITLE))
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => controller.calls.restore.length === 1)

    expect(controller.calls.restore[0]?.runId).toBe("auth")
    expect(controller.store.getState().overlays.sessionPicker).toBe(false)
    expect(controller.calls.switchFocus).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("shows the full command list through /help", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    expect(setup.captureCharFrame()).not.toContain(HELP_TITLE)

    await runSlashCommand(setup, "help")
    const opened = await setup.waitForFrame((f) => f.includes(HELP_TITLE))
    // The panel documents the slash commands, its one global chord, and editor keys.
    for (const entry of HELP_ENTRIES) {
      expect(opened).toContain(entry.keys)
      expect(opened).toContain(entry.description)
    }
    expect(opened).toContain("/model")
    expect(opened).toContain("/settings")
    expect(opened).not.toContain("Ctrl+O")

    await destroyMounted(setup.renderer)
  })

  it("closes the open help panel on Escape", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "help")
    await setup.waitForFrame((f) => f.includes(HELP_TITLE))

    await actAsync(async () => {
      setup.mockInput.pressEscape()
      // A lone ESC is held briefly in case it prefixes a longer escape sequence.
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(await setup.waitForFrame((f) => !f.includes(HELP_TITLE))).toContain(WELCOME_GREETING)

    await destroyMounted(setup.renderer)
  })

  it("closes /help before the editor can interrupt a working agent", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const setup = await renderCockpitApp(controller)
    const editorBeforeHelp = setup.renderer.currentFocusedEditor

    await runSlashCommand(setup, "help")
    const opened = await setup.waitForFrame((f) => f.includes(HELP_TITLE))
    expect(opened).toContain("/shell")
    expect(opened).toContain("Focus or leave the integrated shell")
    expect(opened).toContain("/resume")

    await actAsync(async () => {
      setup.mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    await setup.waitForFrame((f) => !f.includes(HELP_TITLE))
    // The help overlay consumed the key, so the editor never saw it and the turn survives.
    expect(controller.calls.cancel).toEqual([])
    expect(setup.renderer.currentFocusedEditor).toBe(editorBeforeHelp)

    // With help gone, the same key now reaches the editor.
    await actAsync(async () => {
      setup.mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(setup.renderer)
  })

  it("opens settings through /settings and records the content-free reach event", async () => {
    const controller = createFakeController()
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "shell-test",
    })
    const setup = await renderCockpitApp(controller, 80, 24, recorder)

    await runSlashCommand(setup, "settings")

    expect(controller.store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))).toContain("Applies immediately")
    expect(records).toEqual([{ type: "settings_opened", at: 42, sessionRef: "shell-test" }])

    await destroyMounted(setup.renderer)
  })

  it("closes the help panel before settings takes keyboard ownership", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "help")
    await setup.waitForFrame((frame) => frame.includes(HELP_TITLE))

    await runSlashCommand(setup, "settings")

    const settings = await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE) && !frame.includes(HELP_TITLE))
    expect(settings).not.toContain(HELP_TITLE)

    await destroyMounted(setup.renderer)
  })

  it("keeps approval above the immediately preceding settings overlay", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "settings")
    await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    await actAsync(() => {
      openApproval(controller)
    })

    const approval = await setup.waitForFrame((frame) => frame.includes(APPROVAL_TITLE) && !frame.includes(SETTINGS_TITLE))
    expect(approval).toContain("Approve action")
    expect(controller.store.getState().overlays.settings).toEqual({ tab: "theme" })

    await destroyMounted(setup.renderer)
  })

  it("stands the terminal shell chord down while settings owns the keyboard", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "settings")
    await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    await actAsync(() => {
      setup.mockInput.pressKey("`", { ctrl: true })
    })

    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("stands shell chords down while the session picker slot is open", async () => {
    const controller = createFakeController()
    controller.store.openSessionPicker()
    const setup = await renderCockpitApp(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("`", { ctrl: true })
    })

    expect(selectHasOpenOverlay(controller.store.getState())).toBe(true)
    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("releases composer focus for settings and restores it after Escape", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)
    expect(setup.renderer.currentFocusedEditor).not.toBeNull()

    await runSlashCommand(setup, "settings")
    await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))
    await setup.waitFor(() => setup.renderer.currentFocusedEditor === null)

    expect(selectHasOpenOverlay(controller.store.getState())).toBe(true)
    expect(setup.renderer.currentFocusedEditor).toBeNull()

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    await setup.waitForFrame((frame) => !frame.includes(SETTINGS_TITLE))
    await setup.waitFor(() => setup.renderer.currentFocusedEditor !== null)

    expect(selectHasOpenOverlay(controller.store.getState())).toBe(false)
    expect(setup.renderer.currentFocusedEditor).not.toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("keeps settings above the branded cockpit frame", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await runSlashCommand(setup, "settings")
    await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    const frame = setup.captureCharFrame()
    expect(frame).toContain(SETTINGS_TITLE)
    expect(frame).toContain("[Theme]")
    expect(frame).not.toContain(HELP_TITLE)

    await destroyMounted(setup.renderer)
  })
})

describe("renderCockpit", () => {
  it("mounts the cockpit into a bare renderer", async () => {
    const { renderer, waitForFrame } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()

    let root: ReturnType<typeof renderCockpit> | undefined
    await actAsync(() => {
      root = renderCockpit(renderer, controller)
    })

    expect(root).toBeDefined()
    const frame = await waitForFrame((f) => f.includes(WELCOME_GREETING))
    expect(frame).toContain("Kitten")
    expect(frame).toContain(WELCOME_KITTEN[0])

    await destroyMounted(renderer)
  })
})
