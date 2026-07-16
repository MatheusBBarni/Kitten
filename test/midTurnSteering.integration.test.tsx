// Suite: assembled mid-turn steering lifecycle
// Invariant: mounted composer direction stays ordered and lossless across real ACP cancellation boundaries.
// Boundary IN: OpenTUI, AgentConnection, in-memory ACP transport, controller, reducer, and selectors.
// Boundary OUT: external adapters, credentials, real terminals, persistence, and native steering certification.

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createAgentConnection, type AgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController, type SessionController } from "../src/app/controller.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { AppConfig, ResolvedAgentConfig } from "../src/core/types.ts"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { PROMPT_PLACEHOLDER, PROMPT_STEERING_PLACEHOLDER } from "../src/ui/PromptEditor.tsx"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "./mockAgent.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

const CWD = process.cwd()

interface SteeringHarness {
  readonly controller: SessionController
  readonly agent: MockAgentHandle
  readonly setup: TestRendererSetup
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function config(): AppConfig {
  const defaults = defaultAppConfig()
  return {
    ...defaults,
    sessions: [{ provider: "claude-code", cwd: CWD, title: "Steering agent" }],
    shell: { ...defaults.shell, enabled: false },
    persistenceEnabled: false,
    telemetryEnabled: false,
    welcomeBanner: "off",
  }
}

async function createHarness(options: {
  readonly onPrompt: NonNullable<MockAgentOptions["onPrompt"]>
  readonly onCancel?: MockAgentOptions["onCancel"]
  readonly scheduleSteeringSettlementTimeout?: (
    callback: () => void,
    timeoutMs: number,
  ) => () => void
}): Promise<SteeringHarness> {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, {
    sessionId: "steering-acp",
    onPrompt: options.onPrompt,
    onCancel: options.onCancel,
  })
  const recipe = defaultAppConfig().providers["claude-code"]
  const connectionConfig: ResolvedAgentConfig = {
    id: "claude-code",
    ...recipe,
    clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
    steeringCapability: { status: "unavailable" },
    runtimeProfile: { kind: "standard" },
  }
  const connection: AgentConnection = createAgentConnection({
    config: connectionConfig,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
  let steeringId = 0
  const controller = await createSessionController({
    config: config(),
    cwd: CWD,
    createConnection: () => connection,
    readBranch: async () => null,
    sendInitialTasks: false,
    newSteeringId: () => `steering-${++steeringId}`,
    newInteractionId: () => "original-permission",
    scheduleSteeringSettlementTimeout: options.scheduleSteeringSettlementTimeout,
  })
  const setup = await testRender(
    <CockpitApp controller={controller} welcomeBannerVariant="none" />,
    { width: 92, height: 28, kittyKeyboard: true },
  )
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return { controller, agent, setup }
}

async function destroyHarness(harness: SteeringHarness | undefined): Promise<void> {
  if (!harness) return
  await destroyMounted(harness.setup.renderer)
  await harness.controller.dispose()
}

async function typeAndSubmit(setup: TestRendererSetup, text: string): Promise<void> {
  await actAsync(async () => setup.mockInput.typeText(text))
  await actAsync(() => setup.mockInput.pressEnter())
}

function promptTexts(agent: MockAgentHandle, index: number): string[] {
  return agent.prompts[index]?.prompt.flatMap((block) => block.type === "text" ? [block.text] : []) ?? []
}

describe("mid-turn steering integration", () => {
  it("preserves interaction attribution and sends one ordered follow-up after safe settlement", async () => {
    const cancelled = deferred()
    let promptNumber = 0
    let harness: SteeringHarness | undefined

    try {
      harness = await createHarness({
        onPrompt: async (request, ctx) => {
          promptNumber += 1
          if (promptNumber !== 1) return
          await ctx.requestPermission(
            { toolCallId: "original-edit", kind: "edit", title: "Edit original turn" },
            [
              { optionId: "allow", name: "Allow once", kind: "allow_once" },
              { optionId: "reject", name: "Reject", kind: "reject_once" },
            ],
          )
          await cancelled.promise
        },
        onCancel: () => cancelled.resolve(),
      })

      let originalPrompt!: ReturnType<SessionController["actions"]["sendPrompt"]>
      await actAsync(() => {
        originalPrompt = harness!.controller.actions.sendPrompt("original long-running task", "claude-code")
      })
      await harness.setup.waitForFrame((frame) => frame.includes("Edit original turn"))
      const originalOverlay = harness.controller.store.getState().overlays.approval
      expect(originalOverlay).toMatchObject({
        sessionId: "claude-code",
        request: { sessionId: "steering-acp", toolCall: { toolCallId: "original-edit" } },
      })

      await actAsync(() => {
        expect(harness!.controller.actions.steer("first ordered direction", "claude-code").kind).toBe("queued")
        expect(harness!.controller.actions.steer("second ordered direction", "claude-code").kind).toBe("queued")
      })
      expect(harness.controller.store.getState().sessions["claude-code"]?.steering).toMatchObject({
        queue: [{ phase: "waiting" }, { phase: "queued" }],
      })
      expect(harness.controller.store.getState().overlays.approval).toBe(originalOverlay)
      expect(harness.agent.cancelNotifications).toEqual([])

      await actAsync(async () => {
        harness!.setup.mockInput.pressEnter()
        await originalPrompt
      })
      await actAsync(async () => {
        await harness!.setup.waitFor(() =>
          harness!.agent.prompts.length === 2
          && harness!.controller.store.getState().sessions["claude-code"]?.steering.queue.length === 0,
        )
      })

      expect(harness.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])
      expect(harness.agent.cancelNotifications).toEqual([{ sessionId: "steering-acp" }])
      expect(promptTexts(harness.agent, 1).slice(-3)).toEqual([
        "The previous turn was interrupted. Continue with this direction:",
        "first ordered direction",
        "second ordered direction",
      ])
      expect(harness.controller.store.getState().sessions["claude-code"]?.steering.queue).toEqual([])
      expect(harness.controller.store.getState().overlays.approval).toBeNull()
    } finally {
      if (harness) await actAsync(() => cancelled.resolve())
      else cancelled.resolve()
      await destroyHarness(harness)
    }
  })

  it("renders failed exact recovery after settlement timeout without resend or concurrent prompt", async () => {
    const releasePrompt = deferred()
    let fireTimeout: (() => void) | undefined
    let harness: SteeringHarness | undefined

    try {
      harness = await createHarness({
        onPrompt: async () => releasePrompt.promise,
        scheduleSteeringSettlementTimeout: (callback) => {
          fireTimeout = callback
          return () => { fireTimeout = undefined }
        },
      })

      await typeAndSubmit(harness.setup, "original pending task")
      await harness.setup.waitForFrame((frame) => frame.includes(PROMPT_STEERING_PLACEHOLDER))
      await typeAndSubmit(harness.setup, "exact direction to recover")
      await harness.setup.waitFor(() => harness!.agent.cancelNotifications.length === 1 && fireTimeout !== undefined)

      await actAsync(() => fireTimeout?.())
      const recovered = await harness.setup.waitForFrame((frame) =>
        frame.includes("Steering failed · draft restored") && frame.includes("exact direction to recover"),
      )

      expect(recovered).toContain("exact direction to recover")
      expect(harness.setup.renderer.currentFocusedEditor?.plainText).toBe("exact direction to recover")
      expect(harness.agent.prompts).toHaveLength(1)
      expect(harness.agent.cancelNotifications).toEqual([{ sessionId: "steering-acp" }])
      expect(harness.controller.store.getState().sessions["claude-code"]?.steering.recovery).toBeNull()
    } finally {
      if (harness) await actAsync(() => releasePrompt.resolve())
      else releasePrompt.resolve()
      await destroyHarness(harness)
    }
  })
})
