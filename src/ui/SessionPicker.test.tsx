// Suite: saved-run picker component
// Invariant: while open, project runs alone own filtering, preview, confirmed deletion, cancel, and explicit restore.
// Boundary IN: real AppStore, OpenTUI renderer/input/focus, picker UI, and injected RunStore boundary.
// Boundary OUT: shell Ctrl+R dispatch (CockpitApp.test.tsx) and live ACP replay (test/sessionRestore.integration.test.ts).

import { describe, expect, it } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted, ESCAPE_DISAMBIGUATION_MS, sleep } from "../../test/reactTui.ts"
import type { PersistedRunRecord, PersistedRunSummary } from "../persistence/runRecord.ts"
import type { RunStore } from "../persistence/runStore.ts"
import { createTelemetryRecorder, type TelemetryRecord, type TelemetryRecorder } from "../telemetry/recorder.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  DELETE_ALL_CONFIRMATION,
  DELETE_RUN_CONFIRMATION,
  NO_MATCHING_RUNS,
  NO_SAVED_RUNS,
  PREVIEW_HEADING,
  SESSION_PICKER_TITLE,
  SessionPicker,
  formatRelativeTime,
  fuzzyMatches,
  type SessionPickerSource,
} from "./SessionPicker.tsx"

const CWD = "/workspace/kitten"
const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1_000

function savedRun(
  runId: string,
  lastPrompt: string,
  updatedAt: number,
  gitBranch: string | null,
  messageCount: number,
  summary: string,
): PersistedRunRecord {
  return {
    version: 1,
    runId,
    cwd: CWD,
    gitBranch,
    focusedAgentId: "codex",
    createdAt: updatedAt - DAY,
    updatedAt,
    agents: {
      "claude-code": {
        sessionId: `${runId}-claude`,
        lastPrompt: "review the result",
        messageCount: 3,
        status: "idle",
      },
      codex: {
        sessionId: `${runId}-codex`,
        lastPrompt,
        messageCount,
        status: "finished",
      },
    },
    handoffBundle: {
      intent: "continue",
      summary,
      files: [],
      pendingDiffs: [],
      redactionCount: 0,
    },
  }
}

function summary(record: PersistedRunRecord): PersistedRunSummary {
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

function memoryRunStore(records: PersistedRunRecord[]): RunStore {
  let stored = [...records]
  return {
    save() {},
    list(cwd) {
      return stored
        .filter((record) => record.cwd === cwd)
        .map(summary)
        .sort((left, right) => right.updatedAt - left.updatedAt)
    },
    load(cwd, runId) {
      return stored.find((record) => record.cwd === cwd && record.runId === runId) ?? null
    },
    delete(cwd, runId) {
      stored = stored.filter((record) => record.cwd !== cwd || record.runId !== runId)
    },
    deleteAll() {
      stored = []
    },
    flush() {},
  }
}

function pickerSource(records: PersistedRunRecord[]): SessionPickerSource {
  return { runStore: memoryRunStore(records), cwd: CWD, now: () => NOW }
}

const RUNS = [
  savedRun("auth", "refactor the auth guard", NOW - 2 * DAY, "feat/auth", 47, "Finish the authorization refactor."),
  savedRun("parser", "repair parser recovery", NOW - 3 * DAY, "fix/parser", 12, "Repair malformed-input recovery."),
  savedRun("dashboard", "polish usage dashboard", NOW - 8 * DAY, null, 1, "Polish the usage dashboard."),
]

async function renderPicker(
  source: SessionPickerSource,
  open = true,
  controller: FakeController = createFakeController(),
  recorder?: TelemetryRecorder,
) {
  if (open) controller.store.openSessionPicker()
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <box style={{ width: 80, height: 24, position: "relative" }}>
        <SessionPicker source={source} recorder={recorder} />
      </box>
    </CockpitProvider>,
    { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
  )
  return { controller, ...setup }
}

describe("SessionPicker pure formatting", () => {
  it("formats activity relative to the injected clock", () => {
    expect(formatRelativeTime(NOW - 45_000, NOW)).toBe("now")
    expect(formatRelativeTime(NOW - 2 * DAY, NOW)).toBe("2d ago")
  })

  it("matches non-contiguous characters without matching unrelated text", () => {
    expect(fuzzyMatches("auth", "refactor the auth guard")).toBe(true)
    expect(fuzzyMatches("rpr", "repair parser recovery")).toBe(true)
    expect(fuzzyMatches("auth", "polish usage dashboard")).toBe(false)
  })
})

describe("SessionPicker visibility and listing", () => {
  it("renders nothing when the sessionPicker slot is closed", async () => {
    const setup = await renderPicker(pickerSource(RUNS), false)

    expect(setup.captureCharFrame()).not.toContain(SESSION_PICKER_TITLE)

    await destroyMounted(setup.renderer)
  })

  it("shows project runs with prompt, relative time, messages, and branch", async () => {
    const setup = await renderPicker(pickerSource(RUNS))
    const frame = await setup.waitForFrame((value) => value.includes("refactor the auth guard"))

    expect(frame).toContain("2d ago")
    expect(frame).toContain("47 msgs")
    expect(frame).toContain("feat/auth")
    expect(frame).toContain("repair parser recovery")
    expect(frame).toContain("no branch")

    await destroyMounted(setup.renderer)
  })

  it("records picker-open-to-interactive after the dialog commits", async () => {
    const records: TelemetryRecord[] = []
    let now = 1000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => now,
    })
    recorder.resumePickerOpened()
    now = 1125

    const setup = await renderPicker(pickerSource(RUNS), true, createFakeController(), recorder)
    await setup.waitFor(() => records.some((record) => record.type === "resume_picker_interactive_ms"))

    expect(records.find((record) => record.type === "resume_picker_interactive_ms")).toMatchObject({
      durationMs: 125,
    })
    await destroyMounted(setup.renderer)
  })

  it("filters live with fuzzy input", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(async () => {
      await setup.mockInput.typeText("auth")
    })
    const filtered = await setup.waitForFrame(
      (value) => value.includes("refactor the auth guard") && !value.includes("repair parser recovery"),
    )

    expect(filtered).toContain("refactor the auth guard")
    expect(filtered).not.toContain("polish usage dashboard")
    expect(filtered).not.toContain(NO_MATCHING_RUNS)

    await destroyMounted(setup.renderer)
  })
})

describe("SessionPicker outcomes", () => {
  it("previews the highlighted run on Space without restoring", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    const frame = await setup.waitForFrame((value) => value.includes("Repair malformed-input recovery."))

    expect(frame).toContain(PREVIEW_HEADING)
    expect(frame).toContain("Focused: codex")
    expect(setup.controller.calls.restore).toEqual([])
    expect(setup.controller.store.getState().overlays.sessionPicker).toBe(true)

    await destroyMounted(setup.renderer)
  })

  it("restores the arrow-selected record on Enter and closes", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => setup.controller.calls.restore.length === 1)

    expect(setup.controller.calls.restore[0]?.runId).toBe("parser")
    expect(setup.controller.calls.restoreModes).toEqual(["picker"])
    expect(setup.controller.store.getState().overlays.sessionPicker).toBe(false)

    await destroyMounted(setup.renderer)
  })

  it("closes on Escape without restoring", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(async () => {
      setup.mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    await setup.waitFor(() => setup.controller.store.getState().overlays.sessionPicker === false)

    expect(setup.controller.calls.restore).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("requires a second Ctrl+D before deleting the highlighted run", async () => {
    const calls: string[] = []
    const agentDeleteCalls: string[] = []
    const controller = Object.assign(createFakeController(), {
      deleteSession(sessionId: string) {
        agentDeleteCalls.push(sessionId)
      },
    })
    const store = memoryRunStore(RUNS)
    const originalDelete = store.delete.bind(store)
    store.delete = (cwd, runId) => {
      calls.push(`${cwd}:${runId}`)
      originalDelete(cwd, runId)
    }
    const setup = await renderPicker({ runStore: store, cwd: CWD, now: () => NOW }, true, controller)

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    const confirmation = await setup.waitForFrame((value) => value.includes(DELETE_RUN_CONFIRMATION))

    expect(confirmation).toContain("refactor the auth guard")
    expect(calls).toEqual([])

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    const deleted = await setup.waitForFrame((value) => !value.includes("refactor the auth guard"))

    expect(deleted).toContain("repair parser recovery")
    expect(calls).toEqual([`${CWD}:auth`])
    expect(agentDeleteCalls).toEqual([])
    expect(setup.controller.calls.restore).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("cancels an armed deletion on Escape without closing the picker", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    await setup.waitForFrame((value) => value.includes(DELETE_RUN_CONFIRMATION))
    await actAsync(async () => {
      setup.mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    const cancelled = await setup.waitForFrame((value) => !value.includes(DELETE_RUN_CONFIRMATION))

    expect(cancelled).toContain("refactor the auth guard")
    expect(setup.controller.store.getState().overlays.sessionPicker).toBe(true)

    await destroyMounted(setup.renderer)
  })

  it("requires confirmation before delete-all and then shows the empty state", async () => {
    let deleteAllCalls = 0
    const store = memoryRunStore(RUNS)
    const originalDeleteAll = store.deleteAll.bind(store)
    store.deleteAll = () => {
      deleteAllCalls++
      originalDeleteAll()
    }
    const setup = await renderPicker({ runStore: store, cwd: CWD, now: () => NOW })

    await actAsync(() => {
      setup.mockInput.pressKey("a", { ctrl: true })
    })
    const confirmation = await setup.waitForFrame((value) => value.includes(DELETE_ALL_CONFIRMATION))

    expect(confirmation).toContain("refactor the auth guard")
    expect(deleteAllCalls).toBe(0)

    await actAsync(() => {
      setup.mockInput.pressKey("a", { ctrl: true })
    })
    const empty = await setup.waitForFrame((value) => value.includes(NO_SAVED_RUNS))

    expect(empty).not.toContain("refactor the auth guard")
    expect(deleteAllCalls).toBe(1)

    await destroyMounted(setup.renderer)
  })

  it("shows the empty state after deleting the last run", async () => {
    const setup = await renderPicker(pickerSource([RUNS[0]!]))

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    await setup.waitForFrame((value) => value.includes(DELETE_RUN_CONFIRMATION))
    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    const empty = await setup.waitForFrame((value) => value.includes(NO_SAVED_RUNS))

    expect(empty).not.toContain("refactor the auth guard")
    expect(setup.controller.calls.restore).toEqual([])

    await destroyMounted(setup.renderer)
  })
})
