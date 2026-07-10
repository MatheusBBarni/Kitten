import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption } from "../core/types.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { FOCUS_MARKER, StatusStrip, STATUS_LABELS } from "./StatusStrip.tsx"

/** Mount the strip alone so its rendered terminal frame can be asserted directly. */
async function renderStrip(controller: ReturnType<typeof createFakeController>, width = 80, height = 3) {
  return testRender(
    <CockpitProvider controller={controller}>
      <StatusStrip />
    </CockpitProvider>,
    { width, height },
  )
}

/** The confirmed model/effort pair an agent advertises through the store. */
function configOptions(model = "opus", effort?: string): ConfigOption[] {
  const options: ConfigOption[] = [
    {
      id: "model",
      category: MODEL_CATEGORY,
      label: "Model",
      currentValue: model,
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
  ]

  if (effort !== undefined) {
    options.push({
      id: "effort",
      category: EFFORT_CATEGORY,
      label: "Reasoning effort",
      currentValue: effort,
      options: [
        { value: "high", name: "High" },
        { value: "low", name: "Low" },
      ],
    })
  }

  return options
}

describe("StatusStrip", () => {
  it("shows working for the busy agent and idle for the other", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)
    await waitForFrame((f) => f.includes("Claude Code"))

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    })

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.working))
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.working}`)
    expect(frame).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })

  it("shows awaiting approval while an agent is blocked on the user", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)
    await waitForFrame((f) => f.includes("Codex"))

    await actAsync(() => {
      controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    })

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.awaiting_approval))
    expect(frame).toContain(`Codex: ${STATUS_LABELS.awaiting_approval}`)

    await destroyMounted(renderer)
  })

  it("marks an agent that never came up as not ready, whatever its session status says", async () => {
    const runtimes: AgentRuntimeState[] = [
      readyRuntimes()[0]!,
      { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd: "/workspace/kitten", ready: false, error: "codex-acp: command not found" },
    ]
    const controller = createFakeController({ runtimes })
    const { renderer, waitForFrame } = await renderStrip(controller)

    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.not_ready))
    expect(frame).toContain(`Codex: ${STATUS_LABELS.not_ready}`)
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.idle}`)
    expect(frame).not.toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })

  it("marks only the focused agent, and moves the marker when focus moves", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)

    const initial = await waitForFrame((f) => f.includes(FOCUS_MARKER))
    expect(initial).toContain(`${FOCUS_MARKER} Claude Code`)
    expect(initial).not.toContain(`${FOCUS_MARKER} Codex`)

    await actAsync(() => {
      controller.actions.switchFocus()
    })

    const switched = await waitForFrame((f) => f.includes(`${FOCUS_MARKER} Codex`))
    expect(switched).not.toContain(`${FOCUS_MARKER} Claude Code`)

    await destroyMounted(renderer)
  })

  it("keeps the keymap hint visible next to both agents", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)

    const frame = await waitForFrame((f) => f.includes("F1 help"))
    expect(frame).toContain("^O switch")

    await destroyMounted(renderer)
  })

  it("fits both agents' longest state, plus the hint, into 80 columns", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderStrip(controller)

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "awaiting_approval" })
      controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    })

    const frame = await waitForFrame((f) => f.includes(`Codex: ${STATUS_LABELS.awaiting_approval}`))
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.awaiting_approval}`)
    expect(frame).toContain("F1 help")

    const strip = captureCharFrame().split("\n")[0] ?? ""
    expect([...strip].length).toBe(80)

    await destroyMounted(renderer)
  })

  it("shows the agent-confirmed model and effort beside its status", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("opus", "high") })
    const { renderer, waitForFrame } = await renderStrip(controller, 120)

    const frame = await waitForFrame((f) => f.includes("Claude Code: idle · opus / high"))
    expect(frame).toContain("Claude Code: idle · opus / high")

    await destroyMounted(renderer)
  })

  it("shows a model without an effort segment when no effort is advertised", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("opus") })
    const { renderer, waitForFrame } = await renderStrip(controller, 120)

    const frame = await waitForFrame((f) => f.includes("Claude Code: idle · opus"))
    expect(frame).toContain("Claude Code: idle · opus")
    expect(frame).not.toContain("Claude Code: idle · opus /")

    await destroyMounted(renderer)
  })

  it("omits the configuration segment when the agent advertises no options", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderStrip(controller)

    const frame = await waitForFrame((f) => f.includes("Claude Code: idle"))
    expect(frame).toContain("Claude Code: idle")
    expect(frame).not.toContain("Claude Code: idle ·")

    await destroyMounted(renderer)
  })

  it("keeps the confirmed model and effort when only the status changes", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("opus", "high") })
    const { renderer, waitForFrame } = await renderStrip(controller, 120)
    await waitForFrame((f) => f.includes("Claude Code: idle · opus / high"))

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    })

    const frame = await waitForFrame((f) => f.includes("Claude Code: working · opus / high"))
    expect(frame).toContain("Claude Code: working · opus / high")

    await destroyMounted(renderer)
  })

  it("keeps both agents' long confirmed settings visible in an 80-column terminal", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "config_options", options: configOptions("claude-fable-5[1m]", "high") })
    controller.store.applyEvent("codex", { kind: "config_options", options: configOptions("gpt-5.1-codex-max", "medium") })
    controller.store.applyEvent("claude-code", { kind: "status", status: "awaiting_approval" })
    controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    const { renderer, waitForFrame } = await renderStrip(controller, 80, 5)

    const frame = await waitForFrame(
      (f) => f.includes("claude-fable-5[1m]") && f.includes("gpt-5.1-codex-max") && f.includes("medium"),
    )
    expect(frame).toContain("Claude Code: awaiting approval")
    expect(frame).toContain("claude-fable-5[1m]")
    expect(frame).toContain("Codex: awaiting approval")
    expect(frame).toContain("gpt-5.1-codex-max")
    expect(frame).toContain("medium")

    await destroyMounted(renderer)
  })
})
