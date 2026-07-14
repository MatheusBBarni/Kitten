import { describe, expect, it } from "bun:test"

import {
  createAgentConnection,
  SUPPORTED_PROTOCOL_VERSION,
  type AgentConnection,
  type ReadyState,
} from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import type { AppConfig, ResolvedAgentConfig } from "../core/types.ts"
import { startMockAgent, type MockAgentOptions } from "../../test/mockAgent.ts"
import {
  checkAgentReadiness,
  checkAllAgentsReadiness,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  preflightAgentReadiness,
} from "./readiness.ts"

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

const CLAUDE: ResolvedAgentConfig = {
  id: "claude-code",
  displayName: "Claude Code",
  command: "claude-code-acp",
  args: ["--stdio"],
  env: {},
  clarificationCapability: UNSUPPORTED_CLARIFICATION,
  runtimeProfile: { kind: "standard" },
}
const CODEX: ResolvedAgentConfig = {
  id: "codex",
  displayName: "Codex",
  command: "codex-acp",
  args: [],
  env: {},
  clarificationCapability: UNSUPPORTED_CLARIFICATION,
  runtimeProfile: { kind: "standard" },
}

const CURSOR_VERSION = "1.2.3"
const CURSOR: ResolvedAgentConfig = {
  id: "cursor",
  displayName: "Cursor",
  command: "agent",
  args: ["acp"],
  env: {},
  clarificationCapability: UNSUPPORTED_CLARIFICATION,
  runtimeProfile: {
    kind: "cursor-certified",
    command: "agent",
    args: ["acp"],
    env: {},
    certifiedVersion: CURSOR_VERSION,
    authenticationMethod: "cursor_login",
  },
}

const UNCERTIFIED_CURSOR: ResolvedAgentConfig = {
  ...CURSOR,
  command: "/opt/cursor/agent",
  runtimeProfile: { kind: "standard" },
}

const APP_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
    codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
  } as AppConfig["providers"],
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 1_000 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}

const THREE_PROVIDER_CONFIG: AppConfig = {
  ...APP_CONFIG,
  providers: {
    ...APP_CONFIG.providers,
    cursor: {
      displayName: CURSOR.displayName,
      command: CURSOR.command,
      args: CURSOR.args,
      env: CURSOR.env,
    },
  },
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
function connectionToMockAgent(config: ResolvedAgentConfig, mockOptions: MockAgentOptions = {}): AgentConnection {
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
    const missing: ResolvedAgentConfig = { ...CODEX, command: "kitten-nonexistent-agent-binary" }

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

describe("checkAgentReadiness - Cursor preflight", () => {
  it("Should expose a lightweight successful preflight with no connection dependency", async () => {
    const result = await preflightAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async (profile) => ({ exitCode: 0, stdout: profile.certifiedVersion }),
    })

    expect(result).toEqual({ ready: true })
  })

  it("Should skip both the version probe and connection when the Cursor binary is missing", async () => {
    let probed = false
    let created = false

    const result = await checkAgentReadiness(CURSOR, {
      binaryExists: () => false,
      probeCursorVersion: async () => {
        probed = true
        return { exitCode: 0, stdout: CURSOR_VERSION }
      },
      createConnection: () => {
        created = true
        throw new Error("must not connect")
      },
    })

    expect(result).toMatchObject({ agentId: "cursor", ready: false, reason: "binary_not_found" })
    expect(probed).toBe(false)
    expect(created).toBe(false)
  })

  it("Should reject an uncertified Cursor recipe before probing or connecting", async () => {
    let probed = false
    let created = false

    const result = await checkAgentReadiness(UNCERTIFIED_CURSOR, {
      binaryExists: () => {
        throw new Error("must not check an uncertified command")
      },
      probeCursorVersion: async () => {
        probed = true
        return { exitCode: 0, stdout: CURSOR_VERSION }
      },
      createConnection: () => {
        created = true
        throw new Error("must not connect")
      },
    })

    expect(result).toMatchObject({ agentId: "cursor", ready: false, reason: "uncertified_recipe" })
    expect(result.ready === false && result.message).toContain("built-in `agent acp` recipe")
    expect(probed).toBe(false)
    expect(created).toBe(false)
  })

  it.each([
    ["empty", { exitCode: 0, stdout: "" }],
    ["malformed", { exitCode: 0, stdout: "Cursor agent version one" }],
    ["nonzero", { exitCode: 1, stdout: CURSOR_VERSION }],
    ["mismatched", { exitCode: 0, stdout: "1.2.4" }],
  ])("Should return version_mismatch for %s version output before connection creation", async (_case, probeResult) => {
    let created = false
    const result = await checkAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => probeResult,
      createConnection: () => {
        created = true
        throw new Error("must not connect")
      },
    })

    expect(result).toMatchObject({ agentId: "cursor", ready: false, reason: "version_mismatch" })
    expect(result.ready === false && result.message).toContain("certified Cursor CLI version")
    expect(created).toBe(false)
  })

  it("Should return version_mismatch when the version probe throws", async () => {
    let created = false
    const result = await checkAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => {
        throw new Error("version process failed")
      },
      createConnection: () => {
        created = true
        throw new Error("must not connect")
      },
    })

    expect(result).toMatchObject({ agentId: "cursor", ready: false, reason: "version_mismatch" })
    expect(created).toBe(false)
  })

  it("Should continue through one handshake and dispose it after an exact semantic version", async () => {
    const stub = stubConnection(async () => ({
      ready: true,
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      canLoadSession: false,
    }))
    let created = 0

    const result = await checkAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => ({ exitCode: 0, stdout: ` ${CURSOR_VERSION}\n` }),
      createConnection: () => {
        created += 1
        return stub.connection
      },
    })

    expect(result).toMatchObject({ agentId: "cursor", ready: true })
    expect(created).toBe(1)
    expect(stub.disposed()).toBe(true)
  })

  it("Should map the adapter authentication discriminator without changing legacy generic failures", async () => {
    const authenticationRequired = await checkAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => ({ exitCode: 0, stdout: CURSOR_VERSION }),
      createConnection: () =>
        stubConnection(async () => ({
          ready: false,
          reason: "authentication_required",
          error: "sign in to Cursor",
        }) as ReadyState).connection,
    })
    const genericFailure = await checkAgentReadiness(CURSOR, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => ({ exitCode: 0, stdout: CURSOR_VERSION }),
      createConnection: () => stubConnection(async () => ({ ready: false, error: "initialize failed" })).connection,
    })

    expect(authenticationRequired).toMatchObject({ ready: false, reason: "authentication_required" })
    expect(authenticationRequired.ready === false && authenticationRequired.message).toContain("sign in to Cursor")
    expect(genericFailure).toMatchObject({ ready: false, reason: "handshake_failed" })
  })

  it.each([CLAUDE, CODEX])("Should bypass Cursor version probing for $id", async (config) => {
    const stub = stubConnection(async () => ({
      ready: true,
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      canLoadSession: false,
    }))
    const result = await checkAgentReadiness(config, {
      binaryExists: alwaysInstalled,
      probeCursorVersion: async () => {
        throw new Error("non-Cursor providers must not be version probed")
      },
      createConnection: () => stub.connection,
    })

    expect(result.ready).toBe(true)
    expect(stub.disposed()).toBe(true)
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

const CURSOR_PREFLIGHT_FAILURES: Array<
  [
    string,
    {
      binaryExists: (command: string) => boolean
      uncertified?: boolean
      probeCursorVersion?: () => Promise<{ exitCode: number; stdout: string }>
    },
  ]
> = [
  ["binary missing", { binaryExists: (command) => command !== "agent" }],
  ["uncertified recipe", { binaryExists: alwaysInstalled, uncertified: true }],
  [
    "version mismatch",
    { binaryExists: alwaysInstalled, probeCursorVersion: async () => ({ exitCode: 0, stdout: "9.9.9" }) },
  ],
]

describe("checkAllAgentsReadiness", () => {
  it.each(CURSOR_PREFLIGHT_FAILURES)(
    "Should keep ready siblings usable when the Cursor preflight reports %s",
    async (_case, preflight) => {
      const config = preflight.uncertified
        ? {
            ...THREE_PROVIDER_CONFIG,
            providers: {
              ...THREE_PROVIDER_CONFIG.providers,
              cursor: { ...THREE_PROVIDER_CONFIG.providers.cursor, command: "/opt/cursor/agent" },
            },
          }
        : THREE_PROVIDER_CONFIG
      const results = await checkAllAgentsReadiness(config, {
        binaryExists: preflight.binaryExists,
        probeCursorVersion:
          preflight.probeCursorVersion ?? (async () => ({ exitCode: 0, stdout: CURSOR_VERSION })),
        resolveAgentConfig: (_config, kind) => {
          if (kind !== "cursor") return kind === "claude-code" ? CLAUDE : CODEX
          return preflight.uncertified ? UNCERTIFIED_CURSOR : CURSOR
        },
        createConnection: (config) => connectionToMockAgent(config),
      })

      expect(results.map((result) => [result.agentId, result.ready])).toEqual([
        ["claude-code", true],
        ["codex", true],
        ["cursor", false],
      ])
    },
  )

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
