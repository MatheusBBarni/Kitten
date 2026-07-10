import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { startMockAgent } from "../../test/mockAgent.ts"
import { createAgentConnection, type AgentConnection } from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import { createSessionController } from "../app/controller.ts"
import {
  EFFORT_CATEGORY,
  MODEL_CATEGORY,
  type AgentConfig,
  type AppConfig,
  type ConfigOption,
  type ProviderKind,
  type SessionId,
} from "../core/types.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import {
  CURRENT_MARK,
  EFFORT_HEADING,
  MODEL_HEADING,
  modelSelectTitleFor,
  NO_OPTIONS_NOTICE,
  OTHER_MARK,
  ROW_MARKER,
  UNVERIFIED_LABEL,
} from "./ModelSelect.tsx"
import { APPROVAL_HINT, MODEL_SELECT_CONFIRM_HINT, MODEL_SELECT_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"

/**
 * The selector is exercised inside the real shell, because most of what it promises is
 * about the shell: the chord must reach it, it must paint over the cockpit, it must take
 * every key from the composer, and it must render only the agent-confirmed model/effort.
 *
 * The terminal speaks the Kitty keyboard protocol so a bare Escape arrives as a complete
 * sequence rather than a lone byte the parser holds.
 */

const WIDTH = 80
const HEIGHT = 30

/** Typed at the modal overlay; must never appear anywhere, least of all in the composer. */
const DRAFT_MARKER = "zzq"

/** The domain config options a Claude pane advertises: a model picker and an effort picker. */
function configOptions(currentModel = "opus", currentEffort = "high"): ConfigOption[] {
  return [
    {
      id: "model",
      category: MODEL_CATEGORY,
      label: "Model",
      currentValue: currentModel,
      options: [
        { value: "opus", name: "Opus" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    {
      id: "effort",
      category: EFFORT_CATEGORY,
      label: "Reasoning effort",
      currentValue: currentEffort,
      options: [
        { value: "high", name: "High" },
        { value: "low", name: "Low" },
      ],
    },
  ]
}

/** A model-only advertisement: no effort category at all. */
function modelOnlyOptions(): ConfigOption[] {
  return [configOptions()[0]!]
}

/** Seed a session's advertised config options through the reducer. */
function seedOptions(controller: FakeController, sessionId: SessionId, options: ConfigOption[]): void {
  controller.store.applyEvent(sessionId, { kind: "config_options", options })
}

/** Give a session a turn, so it reads as an established conversation. */
function seedTurn(controller: FakeController, sessionId: SessionId): void {
  controller.store.applyEvent(sessionId, { kind: "user_message", messageId: "m1", text: "hello" })
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes("Claude Code"))
  return setup
}

/** Press the selector chord and wait for it to paint. */
async function openSelector(setup: TestRendererSetup): Promise<string> {
  await actAsync(() => {
    setup.mockInput.pressKey("e", { ctrl: true })
  })
  return setup.waitForFrame((frame) => frame.includes(MODEL_SELECT_HINT))
}

/** Mount the cockpit over a session with config options, then open the selector. */
async function renderWithSelector(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await renderCockpit(controller)
  await openSelector(setup)
  return setup
}

describe("ModelSelect visibility and content", () => {
  it("renders nothing until the selector chord is pressed", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions())
    const setup = await renderCockpit(controller)

    const frame = setup.captureCharFrame()
    expect(frame).not.toContain(MODEL_SELECT_HINT)
    expect(frame).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("opens for the focused pane, marking the current model and effort", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    const setup = await renderWithSelector(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(modelSelectTitleFor("Claude Code"))
    expect(frame).toContain(MODEL_HEADING)
    expect(frame).toContain(EFFORT_HEADING)
    // Both values of each section are listed, and the live one carries the current mark.
    expect(frame).toContain(`${CURRENT_MARK} Opus`)
    expect(frame).toContain(`${OTHER_MARK} Sonnet`)
    expect(frame).toContain(`${CURRENT_MARK} High`)
    expect(frame).toContain(`${OTHER_MARK} Low`)
    // The highlight starts on the first row and clamps at the top on an up-arrow.
    expect(frame).toContain(`${ROW_MARKER} ${CURRENT_MARK} Opus`)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("up")
    })
    expect(await setup.waitForFrame((f) => f.includes(MODEL_SELECT_HINT))).toContain(`${ROW_MARKER} ${CURRENT_MARK} Opus`)

    await destroyMounted(setup.renderer)
  })

  it("hides the effort section when the model exposes no effort options", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", modelOnlyOptions())
    const setup = await renderWithSelector(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(MODEL_HEADING)
    expect(frame).not.toContain(EFFORT_HEADING)

    await destroyMounted(setup.renderer)
  })

  it("shows a plain notice when the agent advertises no visible options", async () => {
    const controller = createFakeController()
    // No config options advertised at all for this pane.
    const setup = await renderWithSelector(controller)

    expect(setup.captureCharFrame()).toContain(NO_OPTIONS_NOTICE)

    await destroyMounted(setup.renderer)
  })

  it("refreshes the effort section from the option set the agent returns after a model change", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    const setup = await renderWithSelector(controller)
    expect(setup.captureCharFrame()).toContain("High")

    // The agent confirms a model change and returns a fresh set whose effort options
    // differ - exactly what a different model exposes.
    await actAsync(() => {
      controller.store.applyEvent("claude-code", {
        kind: "config_options",
        options: [
          { id: "model", category: MODEL_CATEGORY, label: "Model", currentValue: "sonnet", options: configOptions()[0]!.options },
          {
            id: "effort",
            category: EFFORT_CATEGORY,
            label: "Reasoning effort",
            currentValue: "minimal",
            options: [
              { value: "max", name: "Max" },
              { value: "minimal", name: "Minimal" },
            ],
          },
        ],
      })
    })

    const frame = await setup.waitForFrame((f) => f.includes("Minimal"))
    expect(frame).toContain("Max")
    expect(frame).not.toContain("High")
    expect(frame).not.toContain("Low")

    await destroyMounted(setup.renderer)
  })
})

describe("ModelSelect confirmed state", () => {
  it("shows unverified and keeps the confirmed value when a switch is not confirmed", async () => {
    const controller = createFakeController()
    // A fresh session (no turns): applies immediately, with no confirm step in the way.
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    const setup = await renderWithSelector(controller)

    // Highlight starts on the current model (Opus); move to Sonnet and apply it.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(`${ROW_MARKER} ${OTHER_MARK} Sonnet`))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    // The fake never echoes a confirmed set back, so the switch stays unverified and the
    // overlay keeps showing the last confirmed model - never the requested one.
    const frame = await setup.waitForFrame((f) => f.includes(`(${UNVERIFIED_LABEL})`))
    expect(frame).toContain(`${CURRENT_MARK} Opus`)
    expect(frame).not.toContain(`${CURRENT_MARK} Sonnet`)

    // The change was requested through the controller action, on the focused pane.
    expect(controller.calls.setSessionConfigOption).toEqual([
      { configId: "model", value: "sonnet", sessionId: "claude-code" },
    ])

    await destroyMounted(setup.renderer)
  })
})

describe("ModelSelect mid-conversation confirm", () => {
  it("warns before switching inside an established conversation, then applies on Enter", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    seedTurn(controller, "claude-code")
    const setup = await renderWithSelector(controller)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(`${ROW_MARKER} ${OTHER_MARK} Sonnet`))

    // Enter opens the warning rather than applying: nothing has reached the controller.
    // (The full warning wraps across lines in the box, so match on the confirm hint and
    // a single-line fragment of the warning text.)
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    const warning = await setup.waitForFrame((f) => f.includes(MODEL_SELECT_CONFIRM_HINT))
    expect(warning).toContain("may reduce quality")
    expect(controller.calls.setSessionConfigOption).toHaveLength(0)

    // Enter again proceeds with the switch.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => !f.includes(MODEL_SELECT_CONFIRM_HINT) && f.includes(MODEL_SELECT_HINT))
    expect(controller.calls.setSessionConfigOption).toEqual([
      { configId: "model", value: "sonnet", sessionId: "claude-code" },
    ])

    await destroyMounted(setup.renderer)
  })

  it("returns to the list without applying when the warning is dismissed", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    seedTurn(controller, "claude-code")
    const setup = await renderWithSelector(controller)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(`${ROW_MARKER} ${OTHER_MARK} Sonnet`))
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => f.includes(MODEL_SELECT_CONFIRM_HINT))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const back = await setup.waitForFrame((f) => f.includes(MODEL_SELECT_HINT) && !f.includes(MODEL_SELECT_CONFIRM_HINT))
    expect(back).toContain(MODEL_HEADING)
    expect(controller.calls.setSessionConfigOption).toHaveLength(0)
    // Escaping the warning must not also close the selector.
    expect(controller.store.getState().overlays.modelSelect).not.toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("applies without a confirm step on a fresh session with no turns", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions("opus", "high"))
    const setup = await renderWithSelector(controller)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(`${ROW_MARKER} ${OTHER_MARK} Sonnet`))
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    // No warning was ever shown, and the switch went straight through.
    await setup.waitForFrame((f) => f.includes(`(${UNVERIFIED_LABEL})`))
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain(MODEL_SELECT_CONFIRM_HINT)
    expect(frame).not.toContain("may reduce quality")
    expect(controller.calls.setSessionConfigOption).toEqual([
      { configId: "model", value: "sonnet", sessionId: "claude-code" },
    ])

    await destroyMounted(setup.renderer)
  })
})

describe("ModelSelect dismissal and modality", () => {
  it("closes on Escape and changes nothing", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions())
    const setup = await renderWithSelector(controller)

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((f) => !f.includes(MODEL_SELECT_HINT))

    expect(controller.calls.setSessionConfigOption).toHaveLength(0)
    expect(controller.store.getState().overlays.modelSelect).toBeNull()
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions())
    const setup = await renderWithSelector(controller)

    await actAsync(async () => {
      setup.mockInput.pressKey("o", { ctrl: true })
      setup.mockInput.pressKey("F1")
      await setup.mockInput.typeText(DRAFT_MARKER)
    })

    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
    expect(await setup.waitForFrame((f) => f.includes(MODEL_SELECT_HINT))).not.toContain(HELP_TITLE)

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((f) => !f.includes(MODEL_SELECT_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("stands down for a permission request, which has an agent blocked on it", async () => {
    const controller = createFakeController()
    seedOptions(controller, "claude-code", configOptions())
    const setup = await renderWithSelector(controller)

    await actAsync(() => {
      controller.store.openApproval({
        sessionId: "claude-code",
        title: "Claude Code",
        cwd: "/workspace/kitten",
        request: {
          sessionId: "s",
          toolCall: { toolCallId: "call-1", kind: "edit", title: "Bump b" },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        },
      })
    })
    await setup.waitForFrame((f) => f.includes(APPROVAL_HINT))

    // Enter now answers the agent. It must not also touch the selector behind the dialog.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(controller.calls.setSessionConfigOption).toHaveLength(0)
    expect(controller.store.getState().overlays.modelSelect).not.toBeNull()

    await destroyMounted(setup.renderer)
  })
})

const CLAUDE: AgentConfig = { id: "claude-code", displayName: "Claude Code", command: "claude-acp", args: [], env: {} }
const CODEX: AgentConfig = { id: "codex", displayName: "Codex", command: "codex-acp", args: [], env: {} }
const APP_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
    codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
  },
  sessions: [],
  telemetryEnabled: false,
}

/** A single ACP select config option in the SDK wire shape the mock serves. */
const selectOption = (id: string, category: string, currentValue: string, values: [string, string][]) => ({
  type: "select" as const,
  id,
  name: id,
  category,
  currentValue,
  options: values.map(([value, name]) => ({ value, name })),
})

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent advertising config. */
function connectionToMockAgent(config: AgentConfig) {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, {
    sessionId: `${config.id}-session`,
    configOptions: [
      selectOption("model", "model", "sonnet", [
        ["sonnet", "Sonnet"],
        ["opus", "Opus"],
      ]),
      selectOption("thought_level", "thought_level", "high", [
        ["high", "High"],
        ["low", "Low"],
      ]),
    ],
  })
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
  return { connection, agent }
}

describe("integration - a confirmed switch across a mock agent", () => {
  it("renders the agent-confirmed model after the switch, with no unverified tag", async () => {
    const claude = connectionToMockAgent(CLAUDE)
    const codex = connectionToMockAgent(CODEX)
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": claude.connection,
      codex: codex.connection,
    }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })

    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: WIDTH,
      height: HEIGHT,
      kittyKeyboard: true,
    })
    await setup.waitForFrame((frame) => frame.includes("Claude Code"))

    // The controller seeded the advertised options at session start, so the selector
    // opens straight onto the confirmed model.
    await openSelector(setup)
    const opened = setup.captureCharFrame()
    expect(opened).toContain(`${CURRENT_MARK} Sonnet`)

    // Move to Opus and apply it; a fresh session applies without a confirm step.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(`${ROW_MARKER} ${OTHER_MARK} Opus`))
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    // The agent confirmed the switch, so the overlay now shows Opus as current with no
    // unverified tag - and never asserted Opus before the confirmation arrived.
    const confirmed = await setup.waitForFrame((f) => f.includes(`${CURRENT_MARK} Opus`))
    expect(confirmed).not.toContain(`(${UNVERIFIED_LABEL})`)
    expect(claude.agent.configOptionRequests.map((r) => ({ id: r.configId, value: r.value }))).toEqual([
      { id: "model", value: "opus" },
    ])

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})
