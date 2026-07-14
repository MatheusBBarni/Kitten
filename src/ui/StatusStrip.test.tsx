// Suite: selected-provider footer
// Invariant: the footer is concise context, while live work belongs beside the transcript.

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { ConfigOption, SessionId } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import {
  BACKGROUND_STATUS_LABEL,
  EMPTY_WORKSPACE_STATUS_LABEL,
  MCP_STATUS_LABEL,
  StatusStrip,
  type StatusSlotSelectors,
} from "./StatusStrip.tsx"

const HEIGHT = 1

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
    expect(frame).toContain("Claude:opus:high 38% █░░")
    expect(frame).not.toContain("working")
    expect(frame).not.toContain("Codex:")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 80)

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
    expect(frame).toContain(`${MCP_STATUS_LABEL} +github`)
    expect(frame).not.toContain("Codex:")

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
    expect(frame).toContain("Cursor:Composer:High 75% ██░")
    expect(frame).toContain(`${MCP_STATUS_LABEL} +github`)
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
})
