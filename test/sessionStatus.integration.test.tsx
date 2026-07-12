import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createAgentConnection, type AgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController } from "../src/app/controller.ts"
import type { AgentConfig, AppConfig, ProviderKind } from "../src/core/types.ts"
import { CockpitProvider } from "../src/ui/cockpitContext.tsx"
import { STATUS_LABELS, StatusStrip } from "../src/ui/StatusStrip.tsx"
import { startMockAgent } from "./mockAgent.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

/**
 * Integration: a real `AgentConnection` wired over the ndjson wire framing to an
 * in-process mock ACP agent, driven through the controller, so a genuine `end_turn`
 * prompt turn decides the session status the store and the strip show. This exercises
 * the adapter's stop-reason mapping (ADR-006) end to end - the store must read
 * `finished`, and the status strip must paint the `finished` label for that session.
 */

const PROVIDERS: AppConfig["providers"] = {
  "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
  codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
}
const APP_CONFIG: AppConfig = {
  providers: PROVIDERS,
  sessions: [],
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

describe("session status integration (end_turn -> finished)", () => {
  it("drives a mock session to end_turn and renders the finished label in the strip", async () => {
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": endTurnConnection({ id: "claude-code", ...PROVIDERS["claude-code"] }),
      codex: endTurnConnection({ id: "codex", ...PROVIDERS.codex }),
    }
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })

    const { renderer, waitForFrame } = await testRender(
      <CockpitProvider controller={controller}>
        <StatusStrip />
      </CockpitProvider>,
      { width: 80, height: 3 },
    )
    await waitForFrame((frame) => frame.includes("Claude Code"))

    await actAsync(async () => {
      await controller.actions.sendPrompt("do the thing")
    })

    // The store reflects the terminal stop reason: the turn ended, your move.
    expect(controller.store.getState().sessions["claude-code"]!.status).toBe("finished")

    // And the strip paints the finished label for the session that ran the turn.
    const frame = await waitForFrame((f) => f.includes(STATUS_LABELS.finished))
    expect(frame).toContain(`Claude Code: ${STATUS_LABELS.finished}`)
    // The session that never ran a turn stays idle.
    expect(frame).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
    await controller.dispose()
  })
})
