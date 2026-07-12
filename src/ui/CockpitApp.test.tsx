// Suite: Cockpit shell integration
// Invariant: shell chords route to the owning surface while modal overlays retain precedence and focus.
// Boundary IN: real AppStore, OpenTUI renderer/input/focus, telemetry recorder, and the cockpit frame tree.
// Boundary OUT: config persistence/watching and agent subprocess transport, owned by their integration suites.

import { describe, expect, it, spyOn } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted, ESCAPE_DISAMBIGUATION_MS, sleep } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption } from "../core/types.ts"
import type { PersistedRunRecord, PersistedRunSummary } from "../persistence/runRecord.ts"
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
import { HELP_ENTRIES } from "./keymap.ts"
import { renderCockpit } from "./main.tsx"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { SETTINGS_TITLE } from "./SettingsView.tsx"
import { SESSION_PICKER_TITLE, type SessionPickerSource } from "./SessionPicker.tsx"
import { STATUS_LABELS } from "./StatusStrip.tsx"
import { WELCOME_GREETING, WELCOME_ON_RAMP } from "./WelcomeBanner.tsx"

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
  await setup.waitForFrame((f) => f.includes("Claude Code"))
  return setup
}

/** A project run fixture plus its in-memory persistence boundary for Ctrl+R flows. */
function pickerRun(runId: string, lastPrompt: string, updatedAt: number): PersistedRunRecord {
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

function pickerSource(records: PersistedRunRecord[]): SessionPickerSource {
  const toSummary = (record: PersistedRunRecord): PersistedRunSummary => {
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

    // The focused agent titles the conversation region.
    expect(rows[0]).toContain("Claude Code")
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).toContain(WELCOME_ON_RAMP)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    // The strip keeps shared hand-off context above the last-row agent lozenges.
    const shared = rows.at(-2) ?? ""
    const strip = rows.at(-1) ?? ""
    expect(strip).toContain(`Claude Code: ${STATUS_LABELS.idle}`)
    expect(strip).toContain(`Codex: ${STATUS_LABELS.idle}`)
    expect(shared).toContain("kitten")
    expect(shared).toContain("^` shell")
    expect(shared).toContain("^T hand off -> Codex")

    await destroyMounted(renderer)
  })

  it("matches the expected frame at a fixed size", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpitApp(controller)

    expect(captureCharFrame()).toMatchSnapshot()

    await destroyMounted(renderer)
  })

  it("shows each pane's confirmed model and effort and refreshes them from config updates", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("claude-fable-5[1m]", "high") })
    controller.store.applyEvent("codex", { kind: "config_options", options: configOptions("gpt-5.1-codex-max", "medium") })
    const { renderer, waitForFrame } = await renderCockpitApp(controller)

    const initial = await waitForFrame(
      (f) =>
        f.includes("Claude Code: idle claude-fable-5[1m]/high") &&
        f.includes("Codex: idle gpt-5.1-codex-max/medium"),
    )
    expectNoOverflow(initial, 80, 24)
    expect(initial).toContain("Claude Code: idle claude-fable-5[1m]/high")
    expect(initial).toContain("Codex: idle gpt-5.1-codex-max/medium")

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("sonnet", "low") })
    })

    const updated = await waitForFrame((f) => f.includes("Claude Code: idle sonnet/low"))
    expectNoOverflow(updated, 80, 24)
    expect(updated).toContain("Claude Code: idle sonnet/low")
    expect(updated).toContain("Codex: idle gpt-5.1-codex-max/medium")

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
    const shrunk = await waitForFrame((f) => lines(f).length === 12 && f.includes(`Codex: ${STATUS_LABELS.idle}`))

    expectNoOverflow(shrunk, 64, 12)
    // The strip survives the shrink and stays pinned to the bottom row.
    expect(lines(shrunk).at(-1)).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await actAsync(() => {
      resize(120, 40)
    })
    const grown = await waitForFrame((f) => lines(f).length === 40 && f.includes(WELCOME_GREETING))

    expectNoOverflow(grown, 120, 40)
    expect(lines(grown).at(-1)).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })
})

describe("CockpitApp alternate-screen layout", () => {
  it("expands the shell pane on alternate-screen enter and restores cockpit chrome on exit", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
      const primary = await setup.waitForFrame(
        (frame) => frame.includes("Shell · focused") && frame.includes(PROMPT_PLACEHOLDER),
      )
      expect(primary).toContain("hand off")
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
      expect(alternate).not.toContain("hand off")
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
        (frame) => frame.includes(PROMPT_PLACEHOLDER) && frame.includes("hand off"),
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
  it("forwards navigation and function keys while an alternate-screen app is active", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
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

  it("toggles into the shell, forwards input, and restores the intact agent draft", async () => {
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
      expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", agentId: "claude-code" })
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

  it("stands cockpit chords down while shell focus forwards their terminal bytes", async () => {
    const { controller, runtime, shell } = shellReadyController()
    const setup = await renderCockpitApp(controller)

    try {
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
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
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
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
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
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

  it("copies the latest shell command and records external_run exactly once per use", async () => {
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
        setup.mockInput.pressKey("F2")
      })
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))

      await actAsync(() => {
        setup.mockInput.pressKey("F3")
      })

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

  it("does not copy or record external_run when the shell has no command", async () => {
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
      await actAsync(() => {
        setup.mockInput.pressKey("F2")
      })
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))

      await actAsync(() => {
        setup.mockInput.pressKey("F3")
      })

      expect(await setup.waitForFrame((frame) => frame.includes(EXTERNAL_RUN_EMPTY))).toContain(EXTERNAL_RUN_EMPTY)
      expect(copy).not.toHaveBeenCalled()
      expect(records.filter((record) => record.type === "external_run")).toEqual([])
    } finally {
      copy.mockRestore()
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("switches the focused agent through the controller action", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("o", { ctrl: true })
    })

    expect(controller.calls.switchFocus).toEqual([undefined])
    // The action really moved focus, so the region retitles to the other agent.
    const frame = await waitForFrame((f) => lines(f)[0]?.includes("Codex") === true)
    expect(lines(frame)[0]).not.toContain("Claude Code")

    await destroyMounted(renderer)
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

  it("dispatches Ctrl+R to the project saved-run picker", async () => {
    const controller = createFakeController()
    const source = pickerSource([pickerRun("auth", "refactor the auth guard", 9_000)])
    const setup = await renderCockpitApp(controller, 80, 24, undefined, source)

    await actAsync(() => {
      setup.mockInput.pressKey("r", { ctrl: true })
    })

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

    await actAsync(() => {
      setup.mockInput.pressKey("r", { ctrl: true })
    })
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

  it("shows and hides the help panel on the help key", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, captureCharFrame, waitForFrame } = await renderCockpitApp(controller)

    expect(captureCharFrame()).not.toContain(HELP_TITLE)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    const opened = await waitForFrame((f) => f.includes(HELP_TITLE))
    // The panel documents the shell's chords and the editor's alike.
    for (const entry of HELP_ENTRIES) {
      expect(opened).toContain(entry.keys)
      expect(opened).toContain(entry.description)
    }

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    const closed = await waitForFrame((f) => !f.includes(HELP_TITLE))
    expect(closed).toContain(WELCOME_GREETING)

    await destroyMounted(renderer)
  })

  it("closes the open help panel on Escape", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    await waitForFrame((f) => f.includes(HELP_TITLE))

    await actAsync(async () => {
      mockInput.pressEscape()
      // A lone ESC is held briefly in case it prefixes a longer escape sequence.
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(await waitForFrame((f) => !f.includes(HELP_TITLE))).toContain(WELCOME_GREETING)

    await destroyMounted(renderer)
  })

  it("shows shell attach guidance and restores editor focus without interrupting the working agent", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)
    const editorBeforeHelp = renderer.currentFocusedEditor

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    const opened = await waitForFrame((f) => f.includes(HELP_TITLE))
    expect(opened).toContain("Ctrl+` / F2")
    expect(opened).toContain("Ctrl+C interrupts")
    expect(opened).toContain("shell cwd/commands")

    await actAsync(async () => {
      mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    await waitForFrame((f) => !f.includes(HELP_TITLE))
    // The shell consumed the key, so the editor never saw it and the turn survives.
    expect(controller.calls.cancel).toEqual([])
    expect(renderer.currentFocusedEditor).toBe(editorBeforeHelp)

    // With help gone, the same key now reaches the editor.
    await actAsync(async () => {
      mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(renderer)
  })

  it("opens settings through Ctrl+, and records the content-free reach event", async () => {
    const controller = createFakeController()
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "shell-test",
    })
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller, 80, 24, recorder)

    await actAsync(() => {
      mockInput.pressKey(",", { ctrl: true })
    })

    expect(controller.store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(await waitForFrame((frame) => frame.includes(SETTINGS_TITLE))).toContain("^T hand off -> Codex")
    expect(records).toEqual([{ type: "settings_opened", at: 42, sessionRef: "shell-test" }])

    await destroyMounted(renderer)
  })

  it("closes the help panel before settings takes keyboard ownership", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    await waitForFrame((frame) => frame.includes(HELP_TITLE))

    await actAsync(() => {
      mockInput.pressKey(",", { ctrl: true })
    })

    const settings = await waitForFrame((frame) => frame.includes(SETTINGS_TITLE) && !frame.includes(HELP_TITLE))
    expect(settings).not.toContain(HELP_TITLE)

    await destroyMounted(renderer)
  })

  it("keeps approval above the immediately preceding settings overlay", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey(",", { ctrl: true })
    })
    await waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    await actAsync(() => {
      openApproval(controller)
    })

    const approval = await waitForFrame((frame) => frame.includes(APPROVAL_TITLE) && !frame.includes(SETTINGS_TITLE))
    expect(approval).toContain("Approve action")
    expect(controller.store.getState().overlays.settings).toEqual({ tab: "theme" })

    await destroyMounted(renderer)
  })

  it("stands shell chords down while settings owns the keyboard", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey(",", { ctrl: true })
    })
    await waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    await actAsync(() => {
      mockInput.pressKey("o", { ctrl: true })
      mockInput.pressKey("t", { ctrl: true })
    })

    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

    await destroyMounted(renderer)
  })

  it("stands shell chords down while the session picker slot is open", async () => {
    const controller = createFakeController()
    controller.store.openSessionPicker()
    const { renderer, mockInput } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("o", { ctrl: true })
      mockInput.pressKey("t", { ctrl: true })
    })

    expect(selectHasOpenOverlay(controller.store.getState())).toBe(true)
    expect(controller.calls.switchFocus).toEqual([])
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

    await destroyMounted(renderer)
  })

  it("releases composer focus for settings and restores it after Escape", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)
    expect(setup.renderer.currentFocusedEditor).not.toBeNull()

    await actAsync(() => {
      setup.mockInput.pressKey(",", { ctrl: true })
    })
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

  it("matches the cockpit frame with settings open", async () => {
    const controller = createFakeController()
    const setup = await renderCockpitApp(controller)

    await actAsync(() => {
      setup.mockInput.pressKey(",", { ctrl: true })
    })
    await setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))

    expect(setup.captureCharFrame()).toMatchSnapshot("settings-open")

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
    expect(await waitForFrame((f) => f.includes(WELCOME_GREETING))).toContain("Claude Code")

    await destroyMounted(renderer)
  })
})
