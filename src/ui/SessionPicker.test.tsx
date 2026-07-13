// Suite: saved-run picker component
// Invariant: while open, project runs alone own filtering, preview, confirmed deletion, cancel, and explicit restore.
// Boundary IN: real AppStore, OpenTUI renderer/input/focus, picker UI, and injected RunStore boundary.
// Boundary OUT: `/resume` dispatch (CockpitApp.test.tsx) and live ACP replay (test/sessionRestore.integration.test.ts).

import { describe, expect, it } from "bun:test"
import { type ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted, ESCAPE_DISAMBIGUATION_MS, sleep } from "../../test/reactTui.ts"
import {
  persistedResumeAgent,
  persistedSelectedConversationId,
  type PersistedRunRecord,
  type PersistedRunRecordV1,
  type PersistedRunRecordV2,
  type PersistedRunSummary,
} from "../persistence/runRecord.ts"
import type { RunStore } from "../persistence/runStore.ts"
import { createTelemetryRecorder, type TelemetryRecord, type TelemetryRecorder } from "../telemetry/recorder.ts"
import { ClarificationPrompt } from "./ClarificationPrompt.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  DELETE_ALL_CONFIRMATION,
  DELETE_RUN_CONFIRMATION,
  NO_MATCHING_RUNS,
  NO_SAVED_RUNS,
  PREVIEW_HEADING,
  SESSION_PICKER_SCROLLBOX_ID,
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
): PersistedRunRecordV1 {
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
  const focusedAgentId = persistedSelectedConversationId(record)
  const summaryId = focusedAgentId ?? (record.version === 2 ? record.workspace.order[0] : null)
  const focused = summaryId === null || summaryId === undefined ? undefined : persistedResumeAgent(record, summaryId)
  return {
    runId: record.runId,
    updatedAt: record.updatedAt,
    gitBranch: record.gitBranch,
    focusedAgentId,
    lastPrompt: focused?.lastPrompt ?? "",
    messageCount: focused?.messageCount ?? 0,
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

function backgroundOnlyV2Run(): PersistedRunRecordV2 {
  return {
    version: 2,
    runId: "background-v2",
    cwd: CWD,
    gitBranch: null,
    createdAt: NOW - DAY,
    updatedAt: NOW,
    conversations: {
      review: {
        sessionId: "review",
        providerKind: "codex",
        cwd: CWD,
        initialTitle: "Codex",
        acpSessionId: "review-acp",
        lastPrompt: "review the V2 record",
        messageCount: 6,
        status: "finished",
      },
    },
    workspace: {
      conversations: {
        review: {
          sessionId: "review",
          displayName: "Background review",
          lifecycle: "background",
          createdOrdinal: 3,
          attention: { seen: false, sequence: 4 },
        },
      },
      order: ["review"],
      selectedVisibleId: null,
    },
    handoffBundle: null,
  }
}

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
        <ClarificationPrompt />
      </box>
    </CockpitProvider>,
    { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
  )
  return { controller, ...setup }
}

/** Open the real top-priority clarification overlay over the mounted saved-run picker. */
async function openClarification(controller: FakeController, requestId: string): Promise<void> {
  await actAsync(() => {
    controller.store.openClarification({
      requestId,
      generation: 1,
      sessionId: "claude-code",
      title: "Claude",
      cwd: CWD,
      payload: {
        prompt: "Choose a boundary",
        fields: [{
          id: "boundary",
          label: "Boundary",
          mode: "single",
          required: true,
          options: [
            { id: "controller", label: "Controller" },
            { id: "store", label: "Store" },
          ],
        }],
      },
    })
  })
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

  it("lists and previews a V2 run with null visible selection", async () => {
    const setup = await renderPicker(pickerSource([backgroundOnlyV2Run()]))
    await setup.waitForFrame((value) => value.includes("review the V2 record"))

    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    const frame = await setup.waitForFrame((value) => value.includes("Focused: none"))

    expect(frame).toContain("1 agent")
    expect(frame).toContain("No run summary.")
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

  it("scrolls the highlighted saved run into view during arrow navigation", async () => {
    const runs = Array.from({ length: 12 }, (_, index) =>
      savedRun(
        `scroll-${index}`,
        `scroll target ${index}`,
        NOW - index * DAY,
        "feat/scroll",
        index,
        `Scroll summary ${index}`,
      ),
    )
    const setup = await renderPicker(pickerSource(runs))
    const scrollbox = setup.renderer.root.findDescendantById(SESSION_PICKER_SCROLLBOX_ID) as ScrollBoxRenderable | undefined

    expect(scrollbox).toBeDefined()
    await setup.waitFor(() => scrollbox!.scrollHeight > scrollbox!.viewport.height)

    await actAsync(() => {
      for (let index = 1; index < runs.length; index += 1) setup.mockInput.pressArrow("down")
    })
    const frame = await setup.waitForFrame((value) => value.includes("scroll target 11"))

    expect(frame).toContain("scroll target 11")
    expect(scrollbox!.scrollTop).toBeGreaterThan(0)

    await destroyMounted(setup.renderer)
  })
})

describe("SessionPicker outcomes", () => {
  it("blocks filter text, navigation, and restore while clarification is active, then resumes them", async () => {
    const setup = await renderPicker(pickerSource(RUNS))

    await actAsync(async () => {
      await setup.mockInput.typeText("rpr")
    })
    await setup.waitForFrame((frame) =>
      frame.includes("repair parser recovery") && !frame.includes("refactor the auth guard"),
    )

    await openClarification(setup.controller, "clarification-picker-enter")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(async () => {
      await setup.mockInput.typeText("x")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => setup.controller.store.getState().overlays.clarification === null)

    expect(setup.controller.calls.respondClarification).toHaveLength(1)
    expect(setup.controller.calls.restore).toEqual([])
    expect(setup.controller.store.getState().overlays.sessionPicker).toBe(true)
    const resumed = await setup.waitForFrame((frame) => frame.includes("repair parser recovery"))
    expect(resumed).not.toContain("refactor the auth guard")
    expect(resumed).not.toContain(NO_MATCHING_RUNS)

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => setup.controller.calls.restore.length === 1)
    expect(setup.controller.calls.restore[0]?.runId).toBe("parser")

    await destroyMounted(setup.renderer)
  })

  it("preserves armed deletion and blocks Ctrl+D and Escape until clarification settles", async () => {
    const deleteCalls: string[] = []
    const store = memoryRunStore(RUNS)
    const originalDelete = store.delete.bind(store)
    store.delete = (cwd, runId) => {
      deleteCalls.push(`${cwd}:${runId}`)
      originalDelete(cwd, runId)
    }
    const setup = await renderPicker({ runStore: store, cwd: CWD, now: () => NOW })

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    await setup.waitForFrame((frame) => frame.includes(DELETE_RUN_CONFIRMATION))

    await openClarification(setup.controller, "clarification-picker-escape")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
      setup.mockInput.pressEscape()
    })
    await setup.waitFor(() => setup.controller.store.getState().overlays.clarification === null)

    expect(setup.controller.calls.respondClarification.at(-1)?.outcome).toEqual({ kind: "cancelled" })
    expect(deleteCalls).toEqual([])
    expect(setup.controller.store.getState().overlays.sessionPicker).toBe(true)
    const resumed = await setup.waitForFrame((frame) =>
      frame.includes(DELETE_RUN_CONFIRMATION) && !frame.includes("Choose a boundary"),
    )
    expect(resumed).toContain("refactor the auth guard")

    await actAsync(() => {
      setup.mockInput.pressKey("d", { ctrl: true })
    })
    await setup.waitForFrame((frame) => !frame.includes("refactor the auth guard"))
    expect(deleteCalls).toEqual([`${CWD}:auth`])

    await destroyMounted(setup.renderer)
  })

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
