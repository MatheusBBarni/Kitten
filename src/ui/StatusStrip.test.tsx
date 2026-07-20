// Suite: selected-provider footer
// Invariant: the footer is concise context, while live work belongs beside the transcript.

import { describe, expect, it } from "bun:test"
import { basename } from "node:path"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { StatuslineLayout } from "../core/statusline.ts"
import type { ConfigOption, SessionId } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import {
  BACKGROUND_STATUS_LABEL,
  CONTEXT_HEADROOM_LABEL,
  EMPTY_WORKSPACE_STATUS_LABEL,
  FOCUS_MARKER,
  MCP_STATUS_LABEL,
  StatusStrip,
  type StatusSlotSelectors,
} from "./StatusStrip.tsx"

const HEIGHT = 1
const PROJECT_FOLDER = basename(process.cwd())

function expectNoOverflow(frame: string, width: number): void {
  const rows = frame.replace(/\n$/, "").split("\n")
  expect(rows).toHaveLength(HEIGHT)
  expect([...rows[0]!]).toHaveLength(width)
  expect(frame).not.toContain("਀")
}

const HIDDEN_SELECTORS: StatusSlotSelectors = {
  model: () => () => null,
  effort: () => () => undefined,
}

function slotSelectors(values: {
  model?: Partial<Record<SessionId, string>>
  effort?: Partial<Record<SessionId, string>>
}): StatusSlotSelectors {
  return {
    ...HIDDEN_SELECTORS,
    model: (sessionId) => () => (sessionId ? values.model?.[sessionId] : undefined) ?? null,
    effort: (sessionId) => () => (sessionId ? values.effort?.[sessionId] : undefined),
  }
}

function confirmModelAndEffort(
  controller: ReturnType<typeof createFakeController>,
  model: { value: string; name: string },
  effort: { value: string; name: string; alternatives?: Array<{ value: string; name: string }> },
): void {
  controller.store.applyEvent("claude-code", {
    kind: "config_options",
    options: [
      {
        id: "model",
        category: "model",
        label: "Model",
        currentValue: model.value,
        options: [model],
      },
      {
        id: "effort",
        category: "thought_level",
        label: "Reasoning effort",
        currentValue: effort.value,
        options: [{ value: effort.value, name: effort.name }, ...(effort.alternatives ?? [])],
      },
    ],
  })
}

function saveCustomLayout(
  controller: ReturnType<typeof createFakeController>,
  layout: StatuslineLayout,
): void {
  controller.store.setStatuslinePreference({ llmDisclosureAcknowledged: true, layout })
}

async function renderStrip(
  controller = createFakeController(),
  width = 80,
  selectors: StatusSlotSelectors = HIDDEN_SELECTORS,
): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <StatusStrip selectors={selectors} />
    </CockpitProvider>,
    { width, height: HEIGHT },
  )
  await setup.waitForFrame((frame) => frame.includes("/help"))
  return setup
}

describe("StatusStrip", () => {
  it("shows only the selected provider and moves with conversation focus", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain("Claude:—")
    expect(setup.captureCharFrame()).toContain(`${CONTEXT_HEADROOM_LABEL} —`)
    expect(setup.captureCharFrame()).not.toContain("Codex:")

    await actAsync(() => controller.actions.selectConversation("codex"))
    const codex = await setup.waitForFrame((frame) => frame.includes("Codex:—"))
    expect(codex).not.toContain("Claude:")

    await destroyMounted(setup.renderer)
  })

  it("keeps the selected provider's model, effort, and headroom without a run-state label", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const setup = await renderStrip(controller, 80, slotSelectors({
      model: { "claude-code": "opus", codex: "terra" },
      effort: { "claude-code": "high", codex: "ultra" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:opus:high ctx 38% █░░")
    expect(frame).not.toContain("working")
    expect(frame).not.toContain("Codex:")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 80)

    await destroyMounted(setup.renderer)
  })

  it("shows confirmed provider, model, and effort with an applied-default label", async () => {
    const controller = createFakeController()
    confirmModelAndEffort(controller, { value: "opus", name: "Opus" }, { value: "medium", name: "Medium" })
    controller.store.applyEvent("claude-code", {
      kind: "default_apply_result",
      result: { kind: "applied", model: "opus", effort: "medium" },
    })
    const setup = await renderStrip(controller, 64, slotSelectors({
      model: { "claude-code": "opus" },
      effort: { "claude-code": "medium" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:Opus:Medium")
    expect(frame).toContain("default applied")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 64)

    await destroyMounted(setup.renderer)
  })

  it("shows post-model confirmed effort with explicit partial feedback at 64 columns", async () => {
    const controller = createFakeController()
    confirmModelAndEffort(
      controller,
      { value: "opus", name: "Opus" },
      { value: "medium", name: "Medium", alternatives: [{ value: "ultra", name: "Ultra" }] },
    )
    controller.store.applyEvent("claude-code", {
      kind: "default_apply_result",
      result: { kind: "partial", model: "opus", unavailable: "effort" },
    })
    const setup = await renderStrip(controller, 64, slotSelectors({
      model: { "claude-code": "opus" },
      effort: { "claude-code": "medium" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:Opus:Medium")
    expect(frame).not.toContain(":Ultra")
    expect(frame).toContain("effort unavailable")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 64)

    await destroyMounted(setup.renderer)
  })

  it("retains prior confirmed values with explicit unavailable-model feedback", async () => {
    const controller = createFakeController()
    confirmModelAndEffort(controller, { value: "sonnet", name: "Sonnet" }, { value: "low", name: "Low" })
    controller.store.applyEvent("claude-code", {
      kind: "default_apply_result",
      result: { kind: "unavailable", unavailable: "model" },
    })
    const setup = await renderStrip(controller, 64, slotSelectors({
      model: { "claude-code": "sonnet" },
      effort: { "claude-code": "low" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:Sonnet:Low")
    expect(frame).toContain("model unavailable")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 64)

    await destroyMounted(setup.renderer)
  })

  it("preserves legacy confirmed output without a label for a none result", async () => {
    const controller = createFakeController()
    confirmModelAndEffort(controller, { value: "opus", name: "Opus" }, { value: "high", name: "High" })
    controller.store.applyEvent("claude-code", {
      kind: "default_apply_result",
      result: { kind: "none" },
    })
    const setup = await renderStrip(controller, 64, slotSelectors({
      model: { "claude-code": "opus" },
      effort: { "claude-code": "high" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:Opus:High")
    expect(frame).not.toContain("default applied")
    expect(frame).not.toContain("unavailable")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 64)

    await destroyMounted(setup.renderer)
  })

  it("uses the advertised model label instead of the provider's opaque value", async () => {
    const controller = createFakeController()
    const model: ConfigOption = {
      id: "model",
      category: "model",
      label: "Model",
      currentValue: "opus[1m]",
      options: [{ value: "opus[1m]", name: "Opus" }],
    }
    controller.store.applyEvent("claude-code", { kind: "config_options", options: [model] })
    const setup = await renderStrip(controller, 80, slotSelectors({ model: { "claude-code": "opus[1m]" } }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Claude:Opus")
    expect(frame).not.toContain("opus[1m]")

    await destroyMounted(setup.renderer)
  })

  it("keeps workspace feedback when no visible conversation is selected", async () => {
    const store = createAppStore({
      seeds: [{ id: "background", providerKind: "codex", title: "Background", cwd: "/work" }],
      selectedVisibleId: "background",
    })
    store.backgroundConversation("background")
    const setup = await renderStrip(createFakeController({ store, runtimes: [] }), 100)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(EMPTY_WORKSPACE_STATUS_LABEL)
    expect(frame).toContain(`${BACKGROUND_STATUS_LABEL}: 1`)
    expect(frame).not.toContain("Codex:")

    await destroyMounted(setup.renderer)
  })

  it("keeps selected MCP declarations available without rendering another provider", async () => {
    const [claude, codex] = readyRuntimes()
    claude!.mcp = { loaded: ["github"], skipped: [] }
    const setup = await renderStrip(createFakeController({ runtimes: [claude!, codex!] }), 100)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`${MCP_STATUS_LABEL}: +github`)
    expect(frame).not.toContain("Codex:")

    await destroyMounted(setup.renderer)
  })

  it("shows the built-in Ask User bridge lifecycle beside user MCP declarations", async () => {
    const [claude, codex] = readyRuntimes()
    claude!.mcp = { loaded: ["github"], skipped: [], askUser: "loading" }
    const setup = await renderStrip(createFakeController({ runtimes: [claude!, codex!] }), 100)

    expect(setup.captureCharFrame()).toContain(`${MCP_STATUS_LABEL}: +github; Ask User connecting`)
    await destroyMounted(setup.renderer)

    claude!.mcp = { loaded: ["github"], skipped: [], askUser: "attached" }
    const attached = await renderStrip(createFakeController({ runtimes: [claude!, codex!] }), 100)
    expect(attached.captureCharFrame()).toContain(`${MCP_STATUS_LABEL}: +github; Ask User ready`)

    await destroyMounted(attached.renderer)

    claude!.mcp = { loaded: ["github"], skipped: [], askUser: "unavailable" }
    const unavailable = await renderStrip(createFakeController({ runtimes: [claude!, codex!] }), 100)
    expect(unavailable.captureCharFrame()).toContain(`${MCP_STATUS_LABEL}: +github; Ask User unavailable`)

    await destroyMounted(unavailable.renderer)
  })

  it("renders a saved layout in declared order and omits unavailable values without duplicate separators", async () => {
    const controller = createFakeController()
    saveCustomLayout(controller, {
      separator: " · ",
      line: ["MODEL", "BRANCH", "PROVIDER", "EFFORT"],
    })
    controller.store.applyEvent("claude-code", {
      kind: "config_options",
      options: [{
        id: "model",
        category: "model",
        label: "Model",
        currentValue: "opus",
        options: [{ value: "opus", name: "Opus" }],
      }],
    })
    const setup = await renderStrip(controller, 80, slotSelectors({ model: { "claude-code": "opus" } }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Opus · Claude")
    expect(frame).not.toContain("Opus ·  · Claude")
    expect(frame).not.toContain("Claude:Opus")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 80)

    await destroyMounted(setup.renderer)
  })

  it("renders saved CONTEXT from the focused session's validated headroom", async () => {
    const controller = createFakeController()
    saveCustomLayout(controller, { separator: " · ", line: ["CONTEXT"] })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain("ctx 38%")
    expect(frame).not.toContain("█")

    await destroyMounted(setup.renderer)
  })

  it("moves saved CONTEXT with real-store conversation focus without retaining the previous value", async () => {
    const controller = createFakeController()
    saveCustomLayout(controller, { separator: " · ", line: ["CONTEXT"] })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    controller.store.applyEvent("codex", { kind: "usage", used: 50_000, size: 200_000 })
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain("ctx 38%")
    expect(setup.captureCharFrame()).not.toContain("ctx 75%")

    await actAsync(() => controller.actions.selectConversation("codex"))
    const codex = await setup.waitForFrame((frame) => frame.includes("ctx 75%"))
    expect(codex).not.toContain("ctx 38%")

    await destroyMounted(setup.renderer)
  })

  it.each([
    ["unavailable", null],
    ["selector-invalid", { used: -10_000, size: 200_000 }],
  ] as const)("canonically omits %s saved CONTEXT without separator artifacts", async (_case, usage) => {
    const controller = createFakeController()
    saveCustomLayout(controller, {
      separator: " · ",
      line: ["PROVIDER", "CONTEXT", "FOLDER"],
    })
    if (usage !== null) {
      controller.store.applyEvent("claude-code", { kind: "usage", ...usage })
    }
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`Claude · ${PROJECT_FOLDER}`)
    expect(frame).not.toContain(CONTEXT_HEADROOM_LABEL)
    expect(frame).not.toContain("0%")
    expect(frame).not.toContain(" ·  · ")

    await destroyMounted(setup.renderer)
  })

  it("drops trailing saved CONTEXT at a narrow width while retaining FULL_PATH", async () => {
    const statuslineCwd = "/work/kitten"
    const controller = createFakeController({
      runtimes: readyRuntimes().map((runtime) => ({ ...runtime, cwd: statuslineCwd })),
    })
    saveCustomLayout(controller, { separator: " · ", line: ["FULL_PATH", "CONTEXT"] })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStrip(controller, 40)

    expect(setup.captureCharFrame()).toContain(`${statuslineCwd} · ctx 38%`)

    await actAsync(() => setup.resize(20, HEIGHT))
    const narrow = await setup.waitForFrame((frame) => frame.includes(statuslineCwd))
    expect(narrow).not.toContain(CONTEXT_HEADROOM_LABEL)
    expect(narrow).toContain(KEYMAP_HINT)
    expectNoOverflow(narrow, 20)

    await destroyMounted(setup.renderer)
  })

  it("keeps the layout-null legacy AgentStatusChip path with valid usage", async () => {
    const controller = createFakeController()
    controller.store.setStatuslinePreference({ llmDisclosureAcknowledged: true, layout: null })
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`${FOCUS_MARKER} Claude:— ctx 38% █░░`)

    await destroyMounted(setup.renderer)
  })

  it("uses the core renderer's grapheme-safe branch ellipsis", async () => {
    const controller = createFakeController()
    saveCustomLayout(controller, {
      separator: " · ",
      line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 12 }],
    })
    controller.store.applyEvent("claude-code", {
      kind: "branch",
      branch: "feature/👨‍👩‍👧‍👦-statusline",
    })
    const setup = await renderStrip(controller, 80)

    const frame = setup.captureCharFrame()
    expect(frame).toContain("feature/👨‍👩‍👧‍👦-s…")
    expect(frame).not.toContain("feature/👨‍👩‍👧‍👦-statusline")
    expect(frame.replace(/\n$/, "").split("\n")).toHaveLength(HEIGHT)
    expect(frame).not.toContain("਀")

    await destroyMounted(setup.renderer)
  })

  it("reacts to 80-to-64-column resizing by omitting trailing custom fields before containment", async () => {
    const statuslineCwd = "/workspace/kitten-statusline-preview"
    const controller = createFakeController({
      runtimes: readyRuntimes().map((runtime) => ({ ...runtime, cwd: statuslineCwd })),
    })
    saveCustomLayout(controller, {
      separator: " · ",
      line: ["FULL_PATH", "BRANCH", "PROVIDER", "MODEL"],
    })
    controller.store.applyEvent("claude-code", {
      kind: "branch",
      branch: "feat/statusline-ui",
    })
    const setup = await renderStrip(controller, 80, slotSelectors({ model: { "claude-code": "opus" } }))

    const wide = setup.captureCharFrame()
    expect(wide).toContain(statuslineCwd)
    expect(wide).toContain("feat/statusline-ui")
    expect(wide).toContain("Claude")
    expect(wide).not.toContain("opus")
    expectNoOverflow(wide, 80)

    await actAsync(() => setup.resize(64, HEIGHT))
    const narrow = await setup.waitForFrame((frame) => frame.includes(statuslineCwd))
    expect(narrow).not.toContain("feat/statusline-ui")
    expect(narrow).not.toContain("Claude")
    expect(narrow).not.toContain("opus")
    expect(narrow).toContain(KEYMAP_HINT)
    expectNoOverflow(narrow, 64)

    await destroyMounted(setup.renderer)
  })

  it("renders a ready Cursor runtime through shared metadata within 80 columns", async () => {
    const cursor = {
      sessionId: "cursor",
      providerKind: "cursor",
      displayName: "Cursor",
      title: "Cursor",
      cwd: process.cwd(),
      ready: true,
      acpSessionId: "session-cursor",
      mcp: { loaded: ["github"], skipped: [] },
    } satisfies AgentRuntimeState
    const store = createAppStore({ selectedVisibleId: "cursor" })
    store.applyEvent("cursor", {
      kind: "config_options",
      options: [
        {
          id: "cursor/model-profile",
          category: "model",
          label: "Model",
          currentValue: "cursor:composer",
          options: [{ value: "cursor:composer", name: "Composer" }],
        },
        {
          id: "cursor/effort-profile",
          category: "thought_level",
          label: "Reasoning effort",
          currentValue: "cursor:high",
          options: [{ value: "cursor:high", name: "High" }],
        },
      ],
    })
    store.applyEvent("cursor", { kind: "usage", used: 50_000, size: 200_000 })
    const controller = createFakeController({ store, runtimes: [...readyRuntimes(), cursor] })
    const setup = await renderStrip(controller, 80, slotSelectors({
      model: { cursor: "cursor:composer" },
      effort: { cursor: "cursor:high" },
    }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Cursor:Composer:High ctx 75% ██░")
    expect(frame).toContain(`${MCP_STATUS_LABEL}: +github`)
    expect(frame).not.toContain("Claude:")
    expect(frame).not.toContain("Codex:")
    expectNoOverflow(frame, 80)

    await destroyMounted(setup.renderer)
  })

  it("uses the help-only footer normally and the shell exit hint while the shell owns input", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain("/help")
    expect(setup.captureCharFrame()).not.toContain("hand-off")
    expect(setup.captureCharFrame()).not.toContain("resumed")

    await actAsync(() => controller.store.setFocusedPane({ kind: "shell" }))
    const shell = await setup.waitForFrame((frame) => frame.includes(SHELL_EXIT_HINT))
    expect(shell).not.toContain(KEYMAP_HINT)

    await destroyMounted(setup.renderer)
  })

  it("retains the shell-exit affordance while saved custom left-side content is active", async () => {
    const controller = createFakeController()
    saveCustomLayout(controller, { separator: " · ", line: ["FOLDER"] })
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(PROJECT_FOLDER)
    expect(setup.captureCharFrame()).toContain(KEYMAP_HINT)

    await actAsync(() => controller.store.setFocusedPane({ kind: "shell" }))
    const shell = await setup.waitForFrame((frame) => frame.includes(SHELL_EXIT_HINT))
    expect(shell).toContain(PROJECT_FOLDER)
    expect(shell).not.toContain(KEYMAP_HINT)
    expectNoOverflow(shell, 80)

    await destroyMounted(setup.renderer)
  })
})
