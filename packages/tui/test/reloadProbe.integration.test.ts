// Suite: reload probe ACP integration
// Invariant: both configured adapters confirm only after history crosses a fresh ACP client connection.
// Boundary IN: self-check probe, real AgentConnection adapter, ACP SDK framing, and fake agent process boundary.
// Boundary OUT: published adapter subprocesses and user authentication, exercised by `bun run selfcheck:reload`.

import { describe, expect, it } from "bun:test"

import { createAgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { formatReloadProbeLine, runReloadConfirmationProbe } from "../src/app/selfCheck.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { ProviderKind } from "../src/core/types.ts"
import { startMockAgent, type MockAgentHandle } from "./mockAgent.ts"

const describeOptIn = process.env.KITTEN_RELOAD_PROBE_INTEGRATION === "1" ? describe : describe.skip

describeOptIn("reload confirmation probe over ACP", () => {
  it("reports confirmed for both configured agents through fresh connections", async () => {
    const connectionCounts = new Map<ProviderKind, number>()
    const handles = new Map<ProviderKind, MockAgentHandle[]>()

    const reports = await runReloadConfirmationProbe(defaultAppConfig(), {
      createConnection: (config) => {
        connectionCounts.set(config.id, (connectionCounts.get(config.id) ?? 0) + 1)
        const pair = createInMemoryTransportPair()
        const handle = startMockAgent(pair.agent, {
          canLoadSession: true,
          sessionId: `${config.id}-saved-session`,
          onLoadSession: async (_request, context) => {
            await context.update({
              sessionUpdate: "user_message_chunk",
              messageId: `${config.id}-history`,
              content: { type: "text", text: `persisted ${config.id} context` },
            })
          },
        })
        handles.set(config.id, [...(handles.get(config.id) ?? []), handle])
        return createAgentConnection({
          config,
          transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
        })
      },
    })

    expect(reports.map((report) => report.outcome)).toEqual(["reload confirmed", "reload confirmed"])
    expect(reports.map(formatReloadProbeLine)).toEqual([
      "[PASS] Claude Code (claude-code): loadSession=true — reload confirmed",
      "[PASS] Codex (codex): loadSession=true — reload confirmed",
    ])
    expect(connectionCounts).toEqual(new Map<ProviderKind, number>([["claude-code", 2], ["codex", 2]]))
    expect(handles.get("claude-code")?.[0]?.prompts).toHaveLength(1)
    expect(handles.get("codex")?.[0]?.prompts).toHaveLength(1)
    expect(handles.get("claude-code")?.[1]?.loadSessionRequests).toHaveLength(1)
    expect(handles.get("codex")?.[1]?.loadSessionRequests).toHaveLength(1)
  })
})
