import { describe, expect, it } from "bun:test"

import {
  createAgentConnection,
  SUPPORTED_PROTOCOL_VERSION,
  type AgentConnection,
  type ReadyState,
} from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import type { AgentConfig, AppConfig } from "../core/types.ts"
import { startMockAgent, type MockAgentOptions } from "../../test/mockAgent.ts"
import { checkAgentReadiness, checkAllAgentsReadiness, DEFAULT_HANDSHAKE_TIMEOUT_MS } from "./readiness.ts"

/**
 * Readiness is verified two ways.
 *
 * Unit tests drive `checkAgentReadiness` against a stub `AgentConnection` to pin the
 * failure taxonomy and the lifecycle guarantees (binary probed before spawn, probe
 * connection always disposed, handshake bounded by a timeout).
 *
 * Integration tests drive it against the real `AgentConnection` wired over the ndjson
 * wire framing to the in-process mock ACP agent, so a genuine `initialize` handshake -
 * accepted, rejected, or answered at the wrong protocol version - decides the verdict.
 */

const UNSUPPORTED_CLARIFICATION = { status: "unsupported", reason: "unknown_recipe" } as const

const CLAUDE: AgentConfig = {
  id: "claude-code",
  displayName: "Claude Code",
  command: "claude-code-acp",
  args: ["--stdio"],
  env: {},
}
const CODEX: AgentConfig = {
  id: "codex",
  displayName: "Codex",
  command: "codex-acp",
  args: [],
  env: {},
}

const APP_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
    codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
  },
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 1_000 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}

/** A stub connection: only `connect` and `dispose` are exercised by readiness. */
function stubConnection(connect: () => Promise<ReadyState>): {
  connection: AgentConnection
  disposed: () => boolean
} {
  let disposed = false
  const connection = {
    id: "codex",
    connect,
    dispose: async () => {
      disposed = true
    },
  } as unknown as AgentConnection
  return { connection, disposed: () => disposed }
}

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent. */
function connectionToMockAgent(config: AgentConfig, mockOptions: MockAgentOptions = {}): AgentConnection {
  const pair = createInMemoryTransportPair()
  startMockAgent(pair.agent, mockOptions)
  return createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
  })
}

const alwaysInstalled = () => true

describe("checkAgentReadiness - failure taxonomy", () => {
  it("Should report binary_not_found without ever spawning the agent", async () => {
    let created = false

    const result = await checkAgentReadiness(CODEX, {
      binaryExists: () => false,
      createConnection: () => {
        created = true
        throw new Error("must not spawn")
      },
    })

    expect(result.ready).toBe(false)
    expect(result).toMatchObject({ agentId: "codex", reason: "binary_not_found" })
    expect(created).toBe(false)
    expect(result.ready === false && result.message).toContain('command "codex-acp" was not found on your PATH')
  })

  it("Should report binary_not_found via the real PATH probe when the command does not exist", async () => {
    const missing: AgentConfig = { ...CODEX, command: "kitten-nonexistent-agent-binary" }

    const result = await checkAgentReadiness(missing)

    expect(result).toMatchObject({ agentId: "codex", ready: false, reason: "binary_not_found" })
  })

  it("Should report handshake_failed when connect returns a not-ready state", async () => {
    const result = await checkAgentReadiness(CODEX, {
      binaryExists: alwaysInstalled,
      createConnection: () => stubConnection(async () => ({ ready: false, error: "not authenticated" })).connection,
    })

    expect(result).toMatchObject({ ready: false, reason: "handshake_failed" })
    expect(result.ready === false && result.message).toContain("not authenticated")
  })

  it("Should report handshake_failed when the transport cannot be created", async () => {
    const result = await checkAgentReadiness(CODEX, {
      binaryExists: alwaysInstalled,
      createConnection: () => {
        throw new Error("ENOENT: no such file or directory")
      },
    })

    expect(result).toMatchObject({ ready: false, reason: "handshake_failed" })
    expect(result.ready === false && result.message).toContain("ENOENT")
    // The message names the exact command line so the user can reproduce it.
    expect(result.ready === false && result.message).toContain("codex-acp")
  })

  it("Should report handshake_timeout and dispose the probe when the agent never answers", async () => {
    const stub = stubConnection(() => new Promise<ReadyState>(() => {}))

    const result = await checkAgentReadiness(CODEX, {
      binaryExists: alwaysInstalled,
      createConnection: () => stub.connection,
      timeoutMs: 5,
    })

    expect(result).toMatchObject({ ready: false, reason: "handshake_timeout" })
    expect(result.ready === false && result.message).toContain("waiting on authentication")
    expect(stub.disposed()).toBe(true)
  })

  it("Should dispose the probe connection on the ready path too", async () => {
    const stub = stubConnection(async () => ({
      ready: true,
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      canLoadSession: false,
    }))

    const result = await checkAgentReadiness(CODEX, {
      binaryExists: alwaysInstalled,
      createConnection: () => stub.connection,
    })

    expect(result.ready).toBe(true)
    expect(result.clarificationCapability).toEqual(UNSUPPORTED_CLARIFICATION)
    expect(stub.disposed()).toBe(true)
  })

  it("Should keep the verdict when teardown of the probe connection fails", async () => {
    const connection = {
      connect: async () => ({
        ready: true,
        protocolVersion: SUPPORTED_PROTOCOL_VERSION,
        canLoadSession: false,
      }),
      dispose: async () => {
        throw new Error("kill failed")
      },
    } as unknown as AgentConnection

    const result = await checkAgentReadiness(CODEX, { binaryExists: alwaysInstalled, createConnection: () => connection })

    expect(result).toMatchObject({ ready: true, protocolVersion: SUPPORTED_PROTOCOL_VERSION })
  })

  it("Should bound the handshake by a default timeout", () => {
    expect(DEFAULT_HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe("checkAgentReadiness - against the mock ACP agent", () => {
  it("Should report ready when the agent completes the initialize handshake", async () => {
    const result = await checkAgentReadiness(CLAUDE, {
      binaryExists: alwaysInstalled,
      createConnection: (config) => connectionToMockAgent(config),
    })

    expect(result).toEqual({
      agentId: "claude-code",
      displayName: "Claude Code",
      clarificationCapability: UNSUPPORTED_CLARIFICATION,
      ready: true,
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
    })
  })

  it("Should report handshake_failed when the agent rejects initialize", async () => {
    const result = await checkAgentReadiness(CLAUDE, {
      binaryExists: alwaysInstalled,
      createConnection: (config) =>
        connectionToMockAgent(config, {
          onInitialize: () => {
            throw new Error("authentication required")
          },
        }),
    })

    expect(result).toMatchObject({ agentId: "claude-code", ready: false, reason: "handshake_failed" })
    expect(result.ready === false && result.message).toContain("authentication required")
  })

  it("Should report capability_mismatch when the agent negotiates an unsupported version", async () => {
    const result = await checkAgentReadiness(CODEX, {
      binaryExists: alwaysInstalled,
      createConnection: (config) => connectionToMockAgent(config, { protocolVersion: SUPPORTED_PROTOCOL_VERSION + 1 }),
    })

    expect(result).toMatchObject({ agentId: "codex", ready: false, reason: "capability_mismatch" })
    expect(result.ready === false && result.message).toContain(`Kitten speaks ${SUPPORTED_PROTOCOL_VERSION}`)
  })
})

describe("checkAllAgentsReadiness", () => {
  it("Should report each agent independently when one rejects the handshake", async () => {
    const results = await checkAllAgentsReadiness(APP_CONFIG, {
      binaryExists: alwaysInstalled,
      createConnection: (config) =>
        connectionToMockAgent(
          config,
          config.id === "codex"
            ? {
                onInitialize: () => {
                  throw new Error("codex adapter crashed")
                },
              }
            : {},
        ),
    })

    expect(results.map((result) => [result.agentId, result.ready])).toEqual([
      ["claude-code", true],
      ["codex", false],
    ])
    const codex = results[1]!
    expect(codex.ready === false && codex.reason).toBe("handshake_failed")
    expect(codex.ready === false && codex.message).toContain("codex adapter crashed")
  })

  it("Should not let a missing binary for one agent block the other", async () => {
    const results = await checkAllAgentsReadiness(APP_CONFIG, {
      binaryExists: (command) => command !== "claude-code-acp",
      createConnection: (config) => connectionToMockAgent(config),
    })

    expect(results[0]).toMatchObject({ agentId: "claude-code", ready: false, reason: "binary_not_found" })
    expect(results[1]).toMatchObject({ agentId: "codex", ready: true })
  })

  it("Should preserve config order and return one verdict per configured agent", async () => {
    const results = await checkAllAgentsReadiness(APP_CONFIG, {
      binaryExists: alwaysInstalled,
      createConnection: (config) => connectionToMockAgent(config),
    })

    expect(results).toHaveLength(2)
    expect(results.every((result) => result.ready)).toBe(true)
  })

  it("Should dispose every created probe when a sibling fails before connection creation", async () => {
    const created: Array<ReturnType<typeof stubConnection>> = []
    const results = await checkAllAgentsReadiness(APP_CONFIG, {
      binaryExists: alwaysInstalled,
      createConnection: (config) => {
        if (config.id === "codex") throw new Error("provider construction failed")
        const probe = stubConnection(async () => ({
          ready: true,
          protocolVersion: SUPPORTED_PROTOCOL_VERSION,
          canLoadSession: false,
        }))
        created.push(probe)
        return probe.connection
      },
    })

    expect(results.map((result) => result.ready)).toEqual([true, false])
    expect(created).toHaveLength(1)
    expect(created.every((probe) => probe.disposed())).toBe(true)
  })
})
