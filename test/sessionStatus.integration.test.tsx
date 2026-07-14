import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createAgentConnection, type AgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController, type AgentRuntimeState } from "../src/app/controller.ts"
import type { AgentConfig, AppConfig, ProviderKind, SessionSeed } from "../src/core/types.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { SESSION_MARKER } from "../src/ui/SessionsOverlay.tsx"
import { createFakeController } from "./fakeController.ts"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "./mockAgent.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

/**
 * Integration: a real `AgentConnection` wired over the ndjson wire framing to an
 * in-process mock ACP agent, driven through the controller, so a genuine `end_turn`
 * prompt turn decides the session status the store and visible tab show. This exercises
 * the adapter's stop-reason mapping (ADR-006) end to end - the store must read
 * `finished`, and the visible workspace must paint that state for the session.
 */

const PROVIDERS = {
  "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
  codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
} as unknown as AppConfig["providers"]
const APP_CONFIG: AppConfig = {
  providers: PROVIDERS,
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 1_000 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}

/** A real adapter over a mock agent whose prompt turns always stop with `end_turn`. */
function endTurnConnection(config: AgentConfig): AgentConnection {
  const pair = createInMemoryTransportPair()
  startMockAgent(pair.agent, { sessionId: `${config.id}-session`, onPrompt: async () => "end_turn" as const })
  return createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    // Flush streamed deltas immediately; coalescing timing is not this test's subject.
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
}

function connectionToMockAgent(
  config: AgentConfig,
  options: MockAgentOptions,
): { connection: AgentConnection; agent: MockAgentHandle } {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, options)
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
  return { connection, agent }
}

describe("session status integration (end_turn -> finished)", () => {
  it("drives a mock session to end_turn and renders the finished state in its visible tab", async () => {
    const connections = {
      "claude-code": endTurnConnection({ id: "claude-code", ...PROVIDERS["claude-code"] }),
      codex: endTurnConnection({ id: "codex", ...PROVIDERS.codex }),
    } as Record<ProviderKind, AgentConnection>
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })

    const { renderer, waitForFrame } = await testRender(<CockpitApp controller={controller} />, {
      width: 80,
      height: 20,
      kittyKeyboard: true,
    })
    await waitForFrame((frame) => frame.includes("Codex:—"))

    await actAsync(async () => {
      await controller.actions.sendPrompt("do the thing")
    })

    // The store reflects the terminal stop reason: the turn ended, your move.
    expect(controller.store.getState().sessions.codex!.status).toBe("finished")

    // The selected tab owns execution state; the footer remains provider-only.
    const frame = await waitForFrame((f) => f.includes("Codex · finished"))
    expect(frame).toContain("Codex:—")
    expect(frame).not.toContain("Claude:—")
    expect(frame).not.toContain("Claude Code:")
    expect(frame).not.toContain("Codex: finished")

    await destroyMounted(renderer)
    await controller.dispose()
  })

  it("keeps every Visible and Background conversation reachable in a narrow Sessions overlay", async () => {
    const seeds = Array.from({ length: 8 }, (_, index): SessionSeed => ({
      id: `fleet-${index}`,
      providerKind: index % 2 === 0 ? "claude-code" : "codex",
      title: `Fleet ${index}`,
      cwd: `/workspace/fleet-${index}`,
    }))
    const runtimes: AgentRuntimeState[] = seeds.map((seed) => ({
      sessionId: seed.id,
      providerKind: seed.providerKind,
      displayName: seed.title,
      title: seed.title,
      cwd: seed.cwd,
      ready: true,
      acpSessionId: `acp-${seed.id}`,
    }))
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.backgroundConversation("fleet-2")
    controller.store.backgroundConversation("fleet-5")
    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: 46,
      height: 16,
      kittyKeyboard: true,
    })

    for (let targetIndex = 0; targetIndex < seeds.length; targetIndex += 1) {
      await actAsync(() => controller.store.openSessions())
      await setup.waitForFrame((frame) => frame.includes("n next attention") && frame.includes("Esc close"))
      await actAsync(() => {
        for (let index = 0; index < targetIndex; index += 1) setup.mockInput.pressArrow("down")
      })
      await setup.waitForFrame((frame) =>
        frame.split("\n").some((line) => line.includes(`Fleet ${targetIndex}`) && line.includes(SESSION_MARKER)),
      )
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitFor(() => controller.store.getState().overlays.sessions === false)
      await setup.waitForFrame((frame) => !frame.includes("┌─Sessions"))
      expect(controller.store.getState().workspace.selectedVisibleId).toBe(`fleet-${targetIndex}`)
    }

    expect(controller.calls.reopenConversation).toEqual(["fleet-2", "fleet-5"])
    await destroyMounted(setup.renderer)
  })

  it("retains a background approval's conversation identity through direct attention routing", async () => {
    const claude = connectionToMockAgent(
      { id: "claude-code", ...PROVIDERS["claude-code"] },
      { sessionId: "claude-session" },
    )
    const codex = connectionToMockAgent(
      { id: "codex", ...PROVIDERS.codex },
      {
        sessionId: "codex-session",
        onPrompt: async (_request, ctx) => {
          await ctx.requestPermission({ toolCallId: "background-call", kind: "edit", title: "Edit background.ts" }, [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
          ])
        },
      },
    )
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })
    controller.actions.backgroundConversation("codex")

    const prompt = controller.actions.sendPrompt("edit in the background", "codex")
    while (controller.store.getState().overlays.approval === null) await Bun.sleep(1)
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("codex")
    expect(controller.store.getState().workspace.conversations.codex?.lifecycle).toBe("background")

    controller.actions.jumpToNextAttention()

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(controller.store.getState().workspace.conversations.codex?.lifecycle).toBe("visible")
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("codex")
    expect(controller.store.getState().overlays.approval?.request.toolCall.toolCallId).toBe("background-call")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    await prompt
    expect(codex.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])

    await controller.dispose()
  })
})
