// Suite: assembled clarification lifecycle
// Invariant: one real ACP callback is projected through the controller and mounted cockpit, then settles exactly once.
// Boundary IN: SDK in-memory transport, mock AgentSideConnection, AgentConnection, SessionController, AppStore, and CockpitApp.
// Boundary OUT: external adapter processes, credentials, real terminals, persistence I/O, and production allowlist entries.

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createAgentConnection, type AgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController, type SessionController } from "../src/app/controller.ts"
import { HARNESS_CONTRACT_SDK_VERSION } from "../src/config/harnessCapability.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type {
  AppConfig,
  ProviderKind,
  ResolvedAgentConfig,
  SessionDescriptor,
} from "../src/core/types.ts"
import type { PersistedRunRecordV1 } from "../src/persistence/runRecord.ts"
import type { NotificationInput } from "../src/notify/channel.ts"
import { createNotifier } from "../src/notify/notifier.ts"
import { selectNextNeedy, selectSessionList } from "../src/store/selectors.ts"
import {
  createTelemetryRecorder,
  type TelemetryRecord,
  type TelemetryRecorder,
} from "../src/telemetry/recorder.ts"
import { approvalTitleFor } from "../src/ui/ApprovalPrompt.tsx"
import { clarificationTitleFor } from "../src/ui/ClarificationPrompt.tsx"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { PROMPT_PLACEHOLDER } from "../src/ui/PromptEditor.tsx"
import { SESSIONS_TITLE } from "../src/ui/SessionsOverlay.tsx"
import { SETTINGS_TITLE, THEME_OPTION_MARKER } from "../src/ui/SettingsView.tsx"
import { STATUS_LABELS } from "../src/ui/StatusStrip.tsx"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "./mockAgent.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

const CWD = process.cwd()
const WIDTH = 92
const HEIGHT = 28
const TEST_HARNESS_CAPABILITY = {
  status: "supported",
  profileId: "clarification-lifecycle-test",
  encoder: "codex-prompt-meta-v1",
} as const

const SUPPORTED_ADAPTER: Partial<Record<ProviderKind, { adapterPackage: string; adapterVersion: string }>> = {
  "claude-code": {
    adapterPackage: "@agentclientprotocol/claude-agent-acp",
    adapterVersion: "0.57.0",
  },
  codex: {
    adapterPackage: "@agentclientprotocol/codex-acp",
    adapterVersion: "1.1.2",
  },
}

interface WireAgent {
  readonly connection: AgentConnection
  readonly agent: MockAgentHandle
}

interface MountedLifecycle {
  readonly controller: SessionController
  readonly setup: TestRendererSetup
}

type PendingPrompt = ReturnType<SessionController["actions"]["sendPrompt"]>

function appConfig(sessions: SessionDescriptor[]): AppConfig {
  const config = defaultAppConfig()
  return {
    ...config,
    sessions,
    shell: { ...config.shell, enabled: false },
    persistenceEnabled: false,
    telemetryEnabled: false,
    welcomeBanner: "off",
  }
}

function wireAgent(providerKind: ProviderKind, options: MockAgentOptions = {}): WireAgent {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, options)
  const recipe = defaultAppConfig().providers[providerKind]
  const supportedAdapter = SUPPORTED_ADAPTER[providerKind]
  if (!supportedAdapter) throw new Error(`No clarification contract fixture for ${providerKind}`)
  const config: ResolvedAgentConfig = {
    id: providerKind,
    ...recipe,
    clarificationCapability: { status: "supported", ...supportedAdapter },
    runtimeProfile: { kind: "standard" },
  }
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
    harnessProfiles: [{
      profileId: TEST_HARNESS_CAPABILITY.profileId,
      encoder: TEST_HARNESS_CAPABILITY.encoder,
      sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
      recipe: {
        providerKind,
        command: config.command,
        args: [...config.args],
        env: { ...config.env },
        adapterPackage: supportedAdapter.adapterPackage,
        adapterVersion: supportedAdapter.adapterVersion,
      },
    }],
  })
  return { connection, agent }
}

async function mountLifecycle(
  controller: SessionController,
  recorder?: TelemetryRecorder,
): Promise<MountedLifecycle> {
  const setup = await testRender(
    <CockpitApp controller={controller} recorder={recorder} welcomeBannerVariant="none" />,
    { width: WIDTH, height: HEIGHT, kittyKeyboard: true },
  )
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return { controller, setup }
}

async function destroyLifecycle(lifecycle: MountedLifecycle | undefined): Promise<void> {
  if (!lifecycle) return
  await destroyMounted(lifecycle.setup.renderer)
  await lifecycle.controller.dispose()
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mixedForm(sessionId: string, message = "Choose a boundary and explain it") {
  return {
    mode: "form" as const,
    sessionId,
    message,
    requestedSchema: {
      type: "object" as const,
      required: ["boundary", "notes"],
      properties: {
        boundary: {
          type: "string" as const,
          title: "Implementation boundary",
          oneOf: [
            { const: "controller", title: "Controller" },
            { const: "store", title: "Store" },
          ],
        },
        notes: {
          type: "string" as const,
          title: "Reason",
        },
      },
    },
  }
}

function singleForm(sessionId: string, message: string) {
  return {
    mode: "form" as const,
    sessionId,
    message,
    requestedSchema: {
      type: "object" as const,
      required: ["choice"],
      properties: {
        choice: {
          type: "string" as const,
          title: "Choice",
          oneOf: [
            { const: "first", title: "First" },
            { const: "second", title: "Second" },
          ],
        },
      },
    },
  }
}

describe("clarification lifecycle integration", () => {
  it("submits selected and text values to the original ACP callback exactly once", async () => {
    const claude = wireAgent("claude-code", {
      sessionId: "claude-acp",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation(mixedForm(request.sessionId))
      },
    })
    const controller = await createSessionController({
      config: appConfig([{ provider: "claude-code", cwd: CWD, title: "Planner" }]),
      cwd: CWD,
      createConnection: () => claude.connection,
      readBranch: async () => null,
      sendInitialTasks: false,
      newInteractionId: () => "clarification-answer",
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      let prompt!: PendingPrompt
      await actAsync(() => {
        prompt = controller.actions.sendPrompt("ask for a boundary", "claude-code")
      })
      const dialog = await lifecycle.setup.waitForFrame((frame) =>
        frame.includes(clarificationTitleFor("Claude Code")) && frame.includes("Planner") && frame.includes(CWD),
      )
      expect(dialog).toContain("Choose a boundary and explain it")
      expect(controller.store.getState().overlays.clarification).toMatchObject({
        requestId: "clarification-answer",
        sessionId: "claude-code",
        title: "Planner",
      })

      await actAsync(() => lifecycle!.setup.mockInput.pressTab())
      await actAsync(async () => lifecycle!.setup.mockInput.typeText("Keep lifecycle ownership central"))
      await lifecycle.setup.waitForFrame((frame) => frame.includes("Keep lifecycle ownership central"))
      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())

      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(claude.agent.elicitationRequests).toHaveLength(1)
      expect(claude.agent.elicitationOutcomes).toEqual([{
        action: "accept",
        content: {
          boundary: "controller",
          notes: "Keep lifecycle ownership central",
        },
      }])
      expect(controller.store.getState().overlays.clarification).toBeNull()
      expect(controller.store.getState().sessions["claude-code"]?.status).toBe("finished")
      expect(await lifecycle.setup.waitForFrame((frame) => !frame.includes("Choose a boundary and explain it")))
        .toContain(PROMPT_PLACEHOLDER)
    } finally {
      await destroyLifecycle(lifecycle)
    }
  })

  it("cancels one callback on duplicate Escape without settling the next request", async () => {
    const claude = wireAgent("claude-code", {
      sessionId: "claude-acp",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation(singleForm(request.sessionId, "First clarification"))
        await ctx.createElicitation(singleForm(request.sessionId, "Second clarification"))
      },
    })
    let interaction = 0
    const controller = await createSessionController({
      config: appConfig([{ provider: "claude-code", cwd: CWD, title: "Planner" }]),
      cwd: CWD,
      createConnection: () => claude.connection,
      readBranch: async () => null,
      sendInitialTasks: false,
      newInteractionId: () => `clarification-${++interaction}`,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      let prompt!: PendingPrompt
      await actAsync(() => {
        prompt = controller.actions.sendPrompt("ask twice", "claude-code")
      })
      await lifecycle.setup.waitForFrame((frame) => frame.includes("First clarification"))

      await actAsync(() => {
        lifecycle!.setup.mockInput.pressEscape()
        lifecycle!.setup.mockInput.pressEscape()
      })

      await lifecycle.setup.waitFor(() => claude.agent.elicitationOutcomes.length === 1)
      const second = await lifecycle.setup.waitForFrame((frame) => frame.includes("Second clarification"))
      expect(second).toContain(clarificationTitleFor("Claude Code"))
      expect(claude.agent.elicitationOutcomes).toEqual([{ action: "cancel" }])
      expect(controller.store.getState().overlays.clarification?.requestId).toBe("clarification-2")

      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())
      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(claude.agent.elicitationRequests).toHaveLength(2)
      expect(claude.agent.elicitationOutcomes).toEqual([
        { action: "cancel" },
        { action: "accept", content: { choice: "first" } },
      ])
      expect(controller.store.getState().overlays.clarification).toBeNull()
    } finally {
      await destroyLifecycle(lifecycle)
    }
  })

  it("preempts and resumes the same permission and settings state", async () => {
    const releaseClarification = deferred()
    const claude = wireAgent("claude-code", {
      sessionId: "claude-acp",
      onPrompt: async (request, ctx) => {
        const permission = ctx.requestPermission(
          { toolCallId: "edit-controller", kind: "edit", title: "Edit controller.ts" },
          [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        )
        await releaseClarification.promise
        await ctx.createElicitation(singleForm(request.sessionId, "Choose the safe boundary"))
        await permission
      },
    })
    const controller = await createSessionController({
      config: appConfig([{ provider: "claude-code", cwd: CWD, title: "Planner" }]),
      cwd: CWD,
      createConnection: () => claude.connection,
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    controller.store.setThemePreference("dark")
    controller.store.openSettings()
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      const settingsOverlay = controller.store.getState().overlays.settings
      const initialSettings = await lifecycle.setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))
      expect(initialSettings).toContain(`${THEME_OPTION_MARKER} Dark`)

      let prompt!: PendingPrompt
      await actAsync(() => {
        prompt = controller.actions.sendPrompt("request permission then clarify", "claude-code")
      })
      await lifecycle.setup.waitForFrame((frame) => frame.includes(approvalTitleFor("Claude Code")))
      const permissionOverlay = controller.store.getState().overlays.approval
      expect(permissionOverlay?.request.toolCall.toolCallId).toBe("edit-controller")
      expect(controller.store.getState().overlays.settings).toBe(settingsOverlay)

      await actAsync(() => releaseClarification.resolve())
      const clarification = await lifecycle.setup.waitForFrame((frame) => frame.includes("Choose the safe boundary"))
      expect(clarification).not.toContain(approvalTitleFor("Claude Code"))
      expect(clarification).not.toContain(SETTINGS_TITLE)
      expect(controller.store.getState().overlays.approval).toBe(permissionOverlay)
      expect(controller.store.getState().overlays.settings).toBe(settingsOverlay)
      expect(controller.store.getState().preferences.theme).toBe("dark")

      await actAsync(() => lifecycle!.setup.mockInput.pressEscape())
      const resumedPermission = await lifecycle.setup.waitForFrame((frame) => frame.includes(approvalTitleFor("Claude Code")))
      expect(resumedPermission).toContain("Edit controller.ts")
      expect(controller.store.getState().overlays.approval).toBe(permissionOverlay)
      expect(claude.agent.elicitationOutcomes).toEqual([{ action: "cancel" }])

      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())
      const resumedSettings = await lifecycle.setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))
      expect(resumedSettings).toContain(`${THEME_OPTION_MARKER} Dark`)
      expect(controller.store.getState().overlays.settings).toBe(settingsOverlay)
      expect(controller.store.getState().preferences.theme).toBe("dark")
      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(claude.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])
    } finally {
      if (lifecycle) await actAsync(() => releaseClarification.resolve())
      else releaseClarification.resolve()
      await destroyLifecycle(lifecycle)
    }
  })

  it("times out one suspended session without settling the active sibling", async () => {
    const scheduled: Array<() => void> = []
    const claude = wireAgent("claude-code", {
      sessionId: "claude-acp",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation(singleForm(request.sessionId, "Claude decision"))
      },
    })
    const codex = wireAgent("codex", {
      sessionId: "codex-acp",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation(singleForm(request.sessionId, "Codex decision"))
      },
    })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>
    const controller = await createSessionController({
      config: appConfig([
        { provider: "claude-code", cwd: CWD, title: "Planner" },
        { provider: "codex", cwd: CWD, title: "Builder" },
      ]),
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      readBranch: async () => null,
      sendInitialTasks: false,
      scheduleClarificationTimeout(callback) {
        scheduled.push(callback)
        return () => {}
      },
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      let claudePrompt!: PendingPrompt
      await actAsync(() => {
        claudePrompt = controller.actions.sendPrompt("ask Claude", "claude-code")
      })
      await lifecycle.setup.waitForFrame((frame) => frame.includes("Claude decision"))

      let codexPrompt!: PendingPrompt
      await actAsync(() => {
        codexPrompt = controller.actions.sendPrompt("ask Codex", "codex")
      })
      await lifecycle.setup.waitForFrame((frame) => frame.includes("Codex decision"))
      expect(scheduled).toHaveLength(2)

      await actAsync(() => scheduled[0]!())
      expect(await claudePrompt).toEqual({ stopReason: "end_turn" })
      expect(claude.agent.elicitationOutcomes).toEqual([{ action: "cancel" }])
      expect(codex.agent.elicitationOutcomes).toEqual([])
      expect(controller.store.getState().overlays.clarification).toMatchObject({
        sessionId: "codex",
        title: "Builder",
      })

      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())
      expect(await codexPrompt).toEqual({ stopReason: "end_turn" })
      expect(codex.agent.elicitationOutcomes).toEqual([
        { action: "accept", content: { choice: "first" } },
      ])
    } finally {
      await destroyLifecycle(lifecycle)
    }
  })

  it("terminally cancels on restoration and rejects a stale answer without replay", async () => {
    const agents: WireAgent[] = []
    const config = appConfig([{ provider: "claude-code", cwd: CWD, title: "Planner" }])
    const controller = await createSessionController({
      config,
      cwd: CWD,
      createConnection: () => {
        const generation = agents.length
        const agent = wireAgent("claude-code", {
          sessionId: `claude-acp-${generation}`,
          onPrompt: generation === 0
            ? async (request, ctx) => {
                await ctx.createElicitation(singleForm(request.sessionId, "Will be cancelled by restore"))
              }
            : undefined,
        })
        agents.push(agent)
        return agent.connection
      },
      readBranch: async () => null,
      sendInitialTasks: false,
      newInteractionId: () => "clarification-before-restore",
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      let prompt!: PendingPrompt
      await actAsync(() => {
        prompt = controller.actions.sendPrompt("ask before restore", "claude-code")
      })
      await lifecycle.setup.waitForFrame((frame) => frame.includes("Will be cancelled by restore"))
      const stale = controller.store.getState().overlays.clarification!
      const record: PersistedRunRecordV1 = {
        version: 1,
        runId: "restored-run",
        cwd: CWD,
        gitBranch: null,
        focusedAgentId: "claude-code",
        createdAt: 1,
        updatedAt: 2,
        agents: {
          "claude-code": {
            sessionId: "saved-claude",
            lastPrompt: "",
            messageCount: 0,
            status: "idle",
          },
        },
        handoffBundle: null,
      }

      await actAsync(() => controller.restore(record))
      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(agents).toHaveLength(2)
      expect(agents[0]!.agent.elicitationOutcomes).toEqual([{ action: "cancel" }])
      expect(agents[1]!.agent.elicitationRequests).toEqual([])
      expect(agents[1]!.agent.elicitationOutcomes).toEqual([])
      expect(controller.store.getState().overlays.clarification).toBeNull()
      expect(await lifecycle.setup.waitForFrame((frame) => !frame.includes("Will be cancelled by restore")))
        .toContain(PROMPT_PLACEHOLDER)

      await actAsync(() => {
        controller.actions.respondClarification(stale.requestId, stale.generation, {
          kind: "submitted",
          answers: { choice: { selectedOptionIds: ["second"] } },
        })
      })
      expect(agents[0]!.agent.elicitationOutcomes).toEqual([{ action: "cancel" }])
      expect(agents[1]!.agent.elicitationOutcomes).toEqual([])
      expect(controller.store.getState().overlays.clarification).toBeNull()
    } finally {
      await destroyLifecycle(lifecycle)
    }
  })

  it("routes a background clarification through shared attention without moving focus first", async () => {
    const notifications: NotificationInput[] = []
    const telemetry: TelemetryRecord[] = []
    let bells = 0
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => telemetry.push(record) },
      now: () => 1_000,
      sessionRef: "clarification-lifecycle",
    })
    const claude = wireAgent("claude-code", { sessionId: "claude-acp" })
    const codex = wireAgent("codex", {
      sessionId: "codex-acp",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation(singleForm(request.sessionId, "Background decision"))
      },
    })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>
    const controller = await createSessionController({
      config: appConfig([
        { provider: "claude-code", cwd: CWD, title: "Foreground" },
        { provider: "codex", cwd: CWD, title: "Background" },
      ]),
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      readBranch: async () => null,
      sendInitialTasks: false,
      recorder,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    const stopNotifier = createNotifier({
      channel: { notify: (input) => notifications.push(input) },
      focus: { current: () => "unfocused" },
      ringBell: () => bells++,
    }).watch(controller.store)
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller, recorder)
      let prompt!: PendingPrompt
      await actAsync(() => {
        controller.actions.backgroundConversation("codex")
        prompt = controller.actions.sendPrompt("ask in background", "codex")
      })
      const frame = await lifecycle.setup.waitForFrame((value) =>
        value.includes(clarificationTitleFor("Codex")) && value.includes("Background decision"),
      )

      const state = controller.store.getState()
      expect(state.workspace.selectedVisibleId).toBe("claude-code")
      expect(state.workspace.conversations.codex?.lifecycle).toBe("background")
      expect(state.sessions.codex?.status).toBe("awaiting_clarification")
      expect(selectNextNeedy("claude-code")(state)).toBe("codex")
      expect(selectSessionList(state).find((item) => item.id === "codex")).toMatchObject({
        lifecycle: "background",
        status: "awaiting_clarification",
        needsAttention: true,
      })
      expect(bells).toBe(1)
      expect(notifications).toEqual([{
        title: "Background",
        provider: "codex",
        cwd: CWD,
        state: "awaiting_clarification",
      }])
      expect(telemetry.find((record) => record.type === "clarification_presented")).toMatchObject({
        type: "clarification_presented",
        agentRef: 1,
        capability: "unsupported",
        focused: false,
        at: 1_000,
        sessionRef: "clarification-lifecycle",
      })

      await actAsync(() => controller.store.openSessions())
      expect(controller.store.getState().overlays.sessions).toBe(true)
      expect(selectSessionList(controller.store.getState()).find((item) => item.id === "codex"))
        .toMatchObject({
          title: "Background",
          status: "awaiting_clarification",
          needsAttention: true,
          attentionSeen: false,
        })

      await actAsync(() => controller.actions.jumpToNextAttention())
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
      expect(controller.store.getState().workspace.conversations.codex?.lifecycle).toBe("visible")
      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())
      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(codex.agent.elicitationOutcomes).toEqual([
        { action: "accept", content: { choice: "first" } },
      ])
      expect(telemetry.find((record) => record.type === "clarification_settled")).toMatchObject({
        type: "clarification_settled",
        terminalKind: "submitted",
        durationBucket: "under_5s",
        at: 1_000,
        sessionRef: "clarification-lifecycle",
      })
      const overview = await lifecycle.setup.waitForFrame((value) =>
        value.includes(SESSIONS_TITLE) && value.includes("Background") && value.includes(STATUS_LABELS.finished),
      )
      expect(overview).toContain(STATUS_LABELS.finished)
      await actAsync(() => controller.store.closeSessions())
    } finally {
      stopNotifier()
      await destroyLifecycle(lifecycle)
    }
  })

  it("keeps ordinary settings and prompt behavior unchanged when no clarification arrives", async () => {
    const claude = wireAgent("claude-code", { sessionId: "claude-acp" })
    const controller = await createSessionController({
      config: appConfig([{ provider: "claude-code", cwd: CWD, title: "Planner" }]),
      cwd: CWD,
      createConnection: () => claude.connection,
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    let lifecycle: MountedLifecycle | undefined

    try {
      lifecycle = await mountLifecycle(controller)
      await actAsync(() => controller.store.openSettings())
      await lifecycle.setup.waitForFrame((frame) => frame.includes(SETTINGS_TITLE))
      await actAsync(() => lifecycle!.setup.mockInput.pressEscape())
      await lifecycle.setup.waitForFrame((frame) => !frame.includes(SETTINGS_TITLE) && frame.includes(PROMPT_PLACEHOLDER))

      await actAsync(async () => lifecycle!.setup.mockInput.typeText("plain turn"))
      await actAsync(() => lifecycle!.setup.mockInput.pressEnter())
      await lifecycle.setup.waitFor(() => claude.agent.prompts.length === 1)

      expect(claude.agent.prompts[0]?.prompt).toEqual([{ type: "text", text: "plain turn" }])
      expect(claude.agent.elicitationRequests).toEqual([])
      expect(claude.agent.elicitationOutcomes).toEqual([])
      expect(controller.store.getState().overlays.clarification).toBeNull()
      expect(controller.store.getState().sessions["claude-code"]?.status).toBe("finished")
    } finally {
      await destroyLifecycle(lifecycle)
    }
  })
})
