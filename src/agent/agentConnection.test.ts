import { describe, expect, it } from "bun:test"

import { RequestError, type CreateElicitationRequest, type PermissionOption, type SessionUpdate } from "@agentclientprotocol/sdk"

import type { AgentConfig, ClarificationPayload, DomainSessionEvent, McpServerConfig, ResolvedAgentConfig } from "../core/types.ts"
import { startMockAgent, type MockAgentOptions } from "../../test/mockAgent.ts"
import {
  createAgentConnection,
  CODEX_COMPACTION_IDLE_RECOVERY_GRACE_MS,
  ConcurrentPromptError,
  createFrameScheduler,
  type AgentConnection,
  type FrameScheduler,
  type PermissionRequest,
} from "./agentConnection.ts"
import { createInMemoryTransportPair } from "./transport.ts"
import { ASK_USER_MCP_HOST_GUIDANCE, ASK_USER_MCP_SERVER_NAME } from "./askUserMcp.ts"
import { KITTEN_VERSION } from "../version.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile } from "../config/harnessCapability.ts"

/**
 * Integration tests that drive the `AgentConnection` adapter against the in-process
 * mock ACP agent (`test/mockAgent.ts`) over the real ndjson wire framing. They
 * cover the `initialize` handshake, the permission round-trip, per-frame coalescing
 * of streamed deltas, and the ordered domain-event stream of a full prompt turn.
 */

const CONFIG: AgentConfig = { id: "claude-code", displayName: "Claude", command: "unused", args: [], env: {} }
const CODEX_CONFIG: AgentConfig = { id: "codex", displayName: "Codex", command: "unused", args: [], env: {} }
const MCP_SERVERS: McpServerConfig[] = [
  { name: "github", command: "/opt/bin/github-mcp", args: ["--stdio"], env: { TOKEN: "secret" } },
]
const ASK_USER_MCP_SERVER: McpServerConfig = {
  name: ASK_USER_MCP_SERVER_NAME,
  command: "/opt/bin/kitten",
  args: ["--ask-user-mcp"],
  env: {},
}
const SUPPORTED_CONFIG: ResolvedAgentConfig = {
  ...CONFIG,
  steeringCapability: { status: "unavailable" },
  clarificationCapability: {
    status: "supported",
    adapterPackage: "@agentclientprotocol/claude-agent-acp",
    adapterVersion: "0.14.1",
  },
  hardStopContinuationCapability: { status: "unavailable", reason: "unreviewed_recipe" },
  runtimeProfile: { kind: "standard" },
}
const UNSUPPORTED_CONFIG: ResolvedAgentConfig = {
  ...CONFIG,
  steeringCapability: { status: "unavailable" },
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
  hardStopContinuationCapability: { status: "unavailable", reason: "unreviewed_recipe" },
  runtimeProfile: { kind: "standard" },
}
const CERTIFIED_CURSOR_CONFIG: ResolvedAgentConfig = {
  id: "cursor",
  displayName: "Cursor",
  command: "agent",
  args: ["acp"],
  env: {},
  steeringCapability: { status: "unavailable" },
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
  hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
  runtimeProfile: {
    kind: "cursor-certified",
    command: "agent",
    args: ["acp"],
    env: {},
    certifiedVersion: "1.2.3",
    authenticationMethod: "cursor_login",
  },
}
const STANDARD_CODEX_CONFIG: ResolvedAgentConfig = {
  ...CODEX_CONFIG,
  steeringCapability: { status: "unavailable" },
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
  hardStopContinuationCapability: { status: "unavailable", reason: "unreviewed_recipe" },
  runtimeProfile: { kind: "standard" },
}
const OVERRIDDEN_CURSOR_CONFIG: ResolvedAgentConfig = {
  ...CERTIFIED_CURSOR_CONFIG,
  command: "/opt/cursor/agent",
  runtimeProfile: { kind: "standard" },
}

const CURSOR_LOGIN_METHOD = { id: "cursor_login", name: "Cursor Login" }

/** A hand-driven frame scheduler: `tick()` runs the single coalesced flush. */
function manualScheduler() {
  let pending: (() => void) | null = null
  const scheduler: FrameScheduler = {
    schedule(flush) {
      pending = flush
    },
    dispose() {
      pending = null
    },
  }
  return {
    scheduler,
    tick() {
      const flush = pending
      pending = null
      flush?.()
    },
    get pending() {
      return pending
    },
  }
}

/** Wire the adapter to a fresh mock agent over an in-memory transport pair. */
function setup(
  mockOptions: MockAgentOptions = {},
  scheduler?: FrameScheduler,
  config: AgentConfig | ResolvedAgentConfig = CONFIG,
  harnessProfiles?: readonly CertifiedHarnessProfile[],
  fileSystemAccess?: "read-write" | "none",
) {
  const pair = createInMemoryTransportPair()
  const mock = startMockAgent(pair.agent, mockOptions)
  const events: DomainSessionEvent[] = []
  const conn = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler,
    harnessProfiles,
    fileSystemAccess,
  })
  conn.onUpdate((event) => events.push(event))
  return { conn, mock, events }
}

const HARNESS_PROFILES: readonly CertifiedHarnessProfile[] = [
  harnessProfile("claude-profile", "claude-code", "npx", ["-y", "claude@1.0.0"], {}, "claude-code-prompt-meta-v1"),
  harnessProfile("codex-profile", "codex", "npx", ["-y", "codex@1.0.0"], {}, "codex-prompt-meta-v1"),
  harnessProfile("cursor-profile", "cursor", "agent", ["acp"], {}, "cursor-prompt-meta-v1"),
]

function harnessProfile(
  profileId: string,
  providerKind: string,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  encoder: CertifiedHarnessProfile["encoder"],
): CertifiedHarnessProfile {
  return {
    profileId,
    encoder,
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: { providerKind, command, args, env, adapterPackage: `${providerKind}-adapter`, adapterVersion: "1.0.0" },
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await delay(2)
  }
}

const messageEvents = (events: DomainSessionEvent[]) => events.filter((e) => e.kind === "agent_message")

/** The most recent status the adapter emitted, or `undefined` if it emitted none. */
function lastStatus(events: DomainSessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.kind === "status") return event.status
  }
  return undefined
}

async function connected(
  mockOptions?: MockAgentOptions,
  scheduler?: FrameScheduler,
  config?: AgentConfig | ResolvedAgentConfig,
): Promise<ReturnType<typeof setup>> {
  const ctx = setup(mockOptions, scheduler, config)
  await ctx.conn.connect()
  return ctx
}

describe("connect / session lifecycle", () => {
  it("authenticates a certified Cursor profile after initialize and before session creation", async () => {
    const { conn, mock } = setup({ authMethods: [CURSOR_LOGIN_METHOD] }, undefined, CERTIFIED_CURSOR_CONFIG)

    expect(await conn.connect()).toEqual({ ready: true, protocolVersion: 1, canLoadSession: false })
    expect(mock.authenticationRequests).toEqual([{ methodId: "cursor_login" }])
    expect(mock.lifecycle).toEqual(["initialize", "authenticate"])

    expect(await conn.newSession("/repo")).toBe("mock-session-1")
    expect(mock.lifecycle).toEqual(["initialize", "authenticate", "newSession"])
    await conn.dispose()
  })

  it("keeps certified Cursor not-ready when cursor_login is not advertised", async () => {
    const { conn, mock } = setup({ authMethods: [] }, undefined, CERTIFIED_CURSOR_CONFIG)

    expect(await conn.connect()).toEqual({
      ready: false,
      reason: "authentication_required",
      error: 'authentication method "cursor_login" is unavailable',
    })
    await expect(conn.newSession("/repo")).rejects.toThrow("not connected")
    expect(mock.authenticationRequests).toEqual([])
    expect(mock.newSessionRequests).toEqual([])
    expect(mock.lifecycle).toEqual(["initialize"])
    await conn.dispose()
  })

  it.each([
    ["auth_required", () => { throw RequestError.authRequired({ details: "not logged in" }) }],
    ["unavailable method", () => { throw RequestError.methodNotFound("authenticate") }],
    ["rejected", () => { throw new Error("Cursor login rejected") }],
  ])("normalizes certified Cursor %s authentication failure without creating a session", async (_case, reject) => {
    const { conn, mock } = setup(
      { authMethods: [CURSOR_LOGIN_METHOD], onAuthenticate: reject },
      undefined,
      CERTIFIED_CURSOR_CONFIG,
    )

    const result = await conn.connect()
    expect(result).toMatchObject({ ready: false, reason: "authentication_required" })
    expect(result.ready === false && result.error.length).toBeGreaterThan(0)
    await expect(conn.newSession("/repo")).rejects.toThrow("not connected")
    expect(mock.authenticationRequests).toEqual([{ methodId: "cursor_login" }])
    expect(mock.newSessionRequests).toEqual([])
    expect(mock.lifecycle).toEqual(["initialize", "authenticate"])
    await conn.dispose()
  })

  it.each([
    ["Claude Code", UNSUPPORTED_CONFIG],
    ["Codex", STANDARD_CODEX_CONFIG],
    ["overridden Cursor", OVERRIDDEN_CURSOR_CONFIG],
  ])("never authenticates a standard %s profile", async (_case, config) => {
    const { conn, mock } = setup({ authMethods: [CURSOR_LOGIN_METHOD] }, undefined, config)

    expect((await conn.connect()).ready).toBe(true)
    await conn.newSession("/repo")
    expect(mock.authenticationRequests).toEqual([])
    expect(mock.lifecycle).toEqual(["initialize", "newSession"])
    await conn.dispose()
  })

  it("keeps certified Cursor initialization failure generic", async () => {
    const { conn, mock } = setup(
      { onInitialize: () => { throw new Error("initialize rejected") } },
      undefined,
      CERTIFIED_CURSOR_CONFIG,
    )

    const result = await conn.connect()
    expect(result).toEqual({ ready: false, error: expect.stringContaining("initialize rejected") })
    expect(result).not.toHaveProperty("reason")
    expect(mock.authenticationRequests).toEqual([])
    expect(mock.newSessionRequests).toEqual([])
    await conn.dispose()
  })

  it("reports canLoadSession false when the initialize capability is absent", async () => {
    const { conn } = setup()
    expect(await conn.connect()).toEqual({ ready: true, protocolVersion: 1, canLoadSession: false })
    await conn.dispose()
  })

  it("reports canLoadSession true when the agent advertises the initialize capability", async () => {
    const { conn } = setup({ canLoadSession: true })
    expect(await conn.connect()).toEqual({ ready: true, protocolVersion: 1, canLoadSession: true })
    await conn.dispose()
  })

  it("advertises select config-option support during initialize", async () => {
    const { conn } = setup({
      onInitialize(request) {
        expect(request.clientCapabilities?.session?.configOptions).toEqual({})
        return {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-agent", version: "0.0.0" },
        }
      },
    })

    expect(await conn.connect()).toEqual({ ready: true, protocolVersion: 1, canLoadSession: false })
    await conn.dispose()
  })

  it("identifies the ACP client with the package version", async () => {
    const { conn } = setup({
      onInitialize(request) {
        expect(request.clientInfo).toEqual({ name: "kitten", version: KITTEN_VERSION })
        return {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "mock-agent", version: "0.0.0" },
        }
      },
    })

    expect((await conn.connect()).ready).toBe(true)
    await conn.dispose()
  })

  it("advertises form elicitation only for a verified supported capability", async () => {
    const supported = setup(
      {
        onInitialize(request) {
          expect(request.clientCapabilities?.elicitation).toEqual({ form: {} })
          return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "mock-agent", version: "0.0.0" } }
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    expect((await supported.conn.connect()).ready).toBe(true)
    await supported.conn.dispose()

    const unsupported = setup(
      {
        onInitialize(request) {
          expect(request.clientCapabilities?.elicitation).toBeUndefined()
          return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "mock-agent", version: "0.0.0" } }
        },
      },
      undefined,
      UNSUPPORTED_CONFIG,
    )
    expect((await unsupported.conn.connect()).ready).toBe(true)
    await unsupported.conn.dispose()
  })

  it("reports not-ready with a legible error when the transport fails to start", async () => {
    const conn = createAgentConnection({
      config: CONFIG,
      transport: () => {
        throw new Error("spawn kitten-agent ENOENT")
      },
    })
    expect(await conn.connect()).toEqual({ ready: false, error: "spawn kitten-agent ENOENT" })
  })

  it("returns the agent's session id from newSession", async () => {
    const { conn } = await connected({ sessionId: "sess-7" })
    expect(await conn.newSession("/tmp/project")).toBe("sess-7")
    await conn.dispose()
  })

  it("provisions resolved MCP servers for fresh and restored ACP sessions", async () => {
    const { conn, mock } = await connected({ canLoadSession: true })

    await conn.newSession("/repo", MCP_SERVERS)
    await conn.loadSession("sess-7", "/repo", MCP_SERVERS)

    const expectedServers = [
      {
        name: "github",
        command: "/opt/bin/github-mcp",
        args: ["--stdio"],
        env: [{ name: "TOKEN", value: "secret" }],
      },
    ]
    expect(mock.newSessionRequests).toEqual([{ cwd: "/repo", mcpServers: expectedServers }])
    expect(mock.loadSessionRequests).toEqual([{ sessionId: "sess-7", cwd: "/repo", mcpServers: expectedServers }])
    await conn.dispose()
  })

  it("adds hidden ask_user guidance only to prompts from a session with Kitten's bridge", async () => {
    let receivedPrompt: unknown = []
    const { conn, mock } = await connected({
      onPrompt: (request) => {
        receivedPrompt = request.prompt
        return "end_turn"
      },
    })

    const sessionId = await conn.newSession("/repo", [ASK_USER_MCP_SERVER])
    await conn.prompt(sessionId, [{ type: "text", text: "Refine the feature idea." }])

    expect(mock.newSessionRequests[0]?.mcpServers[0]?.name).toBe(ASK_USER_MCP_SERVER_NAME)
    expect(receivedPrompt).toEqual([
      { type: "text", text: ASK_USER_MCP_HOST_GUIDANCE },
      { type: "text", text: "Refine the feature idea." },
    ])
    await conn.dispose()
  })

  it("adds hidden ask_user guidance after restoring a session with Kitten's bridge", async () => {
    let receivedPrompt: unknown = []
    const { conn, mock } = await connected({
      canLoadSession: true,
      onPrompt: (request) => {
        receivedPrompt = request.prompt
        return "end_turn"
      },
    })

    await conn.loadSession("sess-7", "/repo", [ASK_USER_MCP_SERVER])
    await conn.prompt("sess-7", [{ type: "text", text: "Continue the feature idea." }])

    expect(mock.loadSessionRequests[0]?.mcpServers[0]?.name).toBe(ASK_USER_MCP_SERVER_NAME)
    expect(receivedPrompt).toEqual([
      { type: "text", text: ASK_USER_MCP_HOST_GUIDANCE },
      { type: "text", text: "Continue the feature idea." },
    ])
    await conn.dispose()
  })

  it("does not add ask_user guidance when the bridge is absent", async () => {
    let receivedPrompt: unknown = []
    const { conn } = await connected({
      onPrompt: (request) => {
        receivedPrompt = request.prompt
        return "end_turn"
      },
    })

    const sessionId = await conn.newSession("/repo", MCP_SERVERS)
    await conn.prompt(sessionId, [{ type: "text", text: "Refine the feature idea." }])

    expect(receivedPrompt).toEqual([{ type: "text", text: "Refine the feature idea." }])
    await conn.dispose()
  })

  it("forwards loadSession to the ACP agent with the stored session and working directory", async () => {
    const { conn, mock } = await connected({ canLoadSession: true })

    await conn.loadSession("sess-7", "/repo")

    expect(mock.loadSessionRequests).toEqual([{ sessionId: "sess-7", cwd: "/repo", mcpServers: [] }])
    await conn.dispose()
  })

  it("routes history replayed during loadSession through the existing domain update stream", async () => {
    const { conn, events } = await connected({
      canLoadSession: true,
      onLoadSession: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "user_message_chunk",
          messageId: "history-1",
          content: { type: "text", text: "Continue the saved work" },
        })
      },
    })

    await conn.loadSession("sess-7", "/repo")
    await waitFor(() => events.length === 1)

    expect(events).toEqual([
      { kind: "user_message", messageId: "history-1", text: "Continue the saved work" },
    ])
    await conn.dispose()
  })

  it("throws when loading a session before connect", async () => {
    const { conn } = setup()
    await expect(conn.loadSession("sess-7", "/repo")).rejects.toThrow(/not connected/)
  })

  it("throws when prompting before connect", async () => {
    const { conn } = setup()
    await expect(conn.prompt("s", [{ type: "text", text: "hi" }])).rejects.toThrow(/not connected/)
  })
})

describe("harness prompt envelope", () => {
  it("preserves ordinary ACP prompt mapping for an envelope without a harness", async () => {
    const { conn, mock } = setup()
    await conn.connect()
    const userBlocks = [
      { type: "text" as const, text: "first\nline" },
      { type: "text" as const, text: "second" },
    ]

    await conn.prompt("mock-session-1", { userBlocks })

    expect(mock.prompts).toEqual([{ sessionId: "mock-session-1", prompt: userBlocks }])
    await conn.dispose()
  })

  it.each([
    ["claude-code", "claude-profile", "claudeCode"],
    ["codex", "codex-profile", "codex"],
    ["cursor", "cursor-profile", "cursor"],
  ] as const)("selects only the certified %s encoder", async (providerKind, profileId, metaKey) => {
    const profile = HARNESS_PROFILES.find((candidate) => candidate.profileId === profileId)!
    const config: AgentConfig = {
      id: providerKind,
      displayName: providerKind,
      command: profile.recipe.command,
      args: [...profile.recipe.args],
      env: { ...profile.recipe.env },
    }
    const { conn, mock } = setup({}, undefined, config, HARNESS_PROFILES)
    await conn.connect()
    const sessionId = await conn.newSession("/repo", [ASK_USER_MCP_SERVER])

    await conn.prompt(sessionId, {
      userBlocks: [{ type: "text", text: "SYNTHETIC_USER_BLOCK" }],
      harness: { version: "v1", text: "SYNTHETIC_HARNESS_BLOCK" },
      profileId,
    })

    expect(mock.prompts).toEqual([
      {
        sessionId,
        prompt: [
          { type: "text", text: ASK_USER_MCP_HOST_GUIDANCE },
          { type: "text", text: "SYNTHETIC_USER_BLOCK" },
        ],
        _meta: { [metaKey]: { kittenHarness: { version: "v1", text: "SYNTHETIC_HARNESS_BLOCK" } } },
      },
    ])
    expect(JSON.stringify(mock.prompts[0]!.prompt)).not.toContain("SYNTHETIC_HARNESS_BLOCK")
    expect(mock.prompts[0]).not.toHaveProperty("_meta.kitten")
    await conn.dispose()
  })

  it.each([
    ["missing profile", undefined, CONFIG],
    ["unknown profile", "not-certified", CONFIG],
    [
      "mismatched recipe",
      "claude-profile",
      { ...CONFIG, command: "/opt/bin/npx", args: ["-y", "claude@1.0.0"] },
    ],
  ] as const)("rejects %s before ACP prompt", async (_case, profileId, config) => {
    const { conn, mock, events } = setup({}, undefined, config as AgentConfig, HARNESS_PROFILES)
    await conn.connect()

    await expect(
      conn.prompt("mock-session-1", {
        userBlocks: [{ type: "text", text: "SYNTHETIC_USER_BLOCK" }],
        harness: { version: "v1", text: "SYNTHETIC_HARNESS_BLOCK" },
        ...(profileId === undefined ? {} : { profileId }),
      }),
    ).rejects.toThrow("unsupported for this runtime profile")

    expect(mock.prompts).toEqual([])
    expect(events).toEqual([])
    await conn.dispose()
  })
})

describe("Codex compaction recovery", () => {
  const compacted = (): SessionUpdate => ({
    sessionUpdate: "agent_message_chunk",
    messageId: "compaction",
    content: { type: "text", text: "*Context compacted to fit the model's context window.*\n\n" },
  })

  const idle = (): SessionUpdate =>
    ({
      sessionUpdate: "session_info_update",
      _meta: { codex: { threadStatus: { type: "idle" } } },
    }) as SessionUpdate

  it("releases a quiet post-compaction Codex abort that the adapter leaves unresolved", async () => {
    const never = new Promise<never>(() => {})
    const { conn, events } = await connected(
      {
        onPrompt: async (_request, ctx) => {
          await ctx.update(compacted())
          await ctx.update(idle())
          return await never
        },
      },
      undefined,
      CODEX_CONFIG,
    )

    await expect(conn.prompt("codex-session", [{ type: "text", text: "Continue" }])).resolves.toEqual({
      stopReason: "cancelled",
    })
    expect(lastStatus(events)).toBe("idle")
    await conn.dispose()
  }, CODEX_COMPACTION_IDLE_RECOVERY_GRACE_MS + 1_000)

  it("does not recover when Codex resumes emitting updates after a compaction idle transition", async () => {
    let finish!: () => void
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { conn, events } = await connected(
      {
        onPrompt: async (_request, ctx) => {
          await ctx.update(compacted())
          await ctx.update(idle())
          await ctx.update({
            sessionUpdate: "agent_message_chunk",
            messageId: "resumed",
            content: { type: "text", text: "Still working" },
          })
          await done
          return "end_turn" as const
        },
      },
      undefined,
      CODEX_CONFIG,
    )

    const prompt = conn.prompt("codex-session", [{ type: "text", text: "Continue" }])
    await delay(CODEX_COMPACTION_IDLE_RECOVERY_GRACE_MS + 20)
    expect(lastStatus(events)).toBe("working")

    finish()
    await expect(prompt).resolves.toEqual({ stopReason: "end_turn" })
    expect(lastStatus(events)).toBe("finished")
    await conn.dispose()
  }, CODEX_COMPACTION_IDLE_RECOVERY_GRACE_MS + 1_000)
})

describe("streaming coalescing (ADR-004)", () => {
  it("coalesces two agent_message deltas in one frame into a single update", async () => {
    const scheduler = manualScheduler()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { conn, events } = await connected(
      {
        onPrompt: async (_request, ctx) => {
          await ctx.update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hel" } })
          await ctx.update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "lo" } })
          await gate
          return "end_turn" as const
        },
      },
      scheduler.scheduler,
    )
    const sessionId = await conn.newSession("/tmp")
    const promptDone = conn.prompt(sessionId, [{ type: "text", text: "hi" }])

    // Both chunks buffer within the frame; nothing is emitted until the frame ticks.
    await waitFor(() => scheduler.pending !== null)
    await delay(10)
    expect(messageEvents(events)).toEqual([])

    scheduler.tick()
    expect(messageEvents(events)).toEqual([{ kind: "agent_message", messageId: "m1", textDelta: "Hello" }])

    release()
    await promptDone
    await conn.dispose()
  })
})

describe("usage updates", () => {
  it("delivers translated usage counters to onUpdate subscribers", async () => {
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "usage_update",
          used: 36000,
          size: 200000,
          cost: { amount: 0.25, currency: "USD" },
          _meta: { trace: "private" },
        })
        return "end_turn" as const
      },
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "inspect usage" }])
    await waitFor(() => events.some((event) => event.kind === "usage"))

    expect(events.find((event) => event.kind === "usage")).toEqual({
      kind: "usage",
      used: 36000,
      size: 200000,
    })
    await conn.dispose()
  })
})

describe("permission round-trip", () => {
  it("routes requestPermission to onPermission and returns the selected outcome to the agent", async () => {
    const options: PermissionOption[] = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ]
    let seen: PermissionRequest | null = null
    const { conn, mock, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.requestPermission({ toolCallId: "t1", title: "Write file", kind: "edit", status: "pending" }, options)
        return "end_turn" as const
      },
    })
    conn.onPermission(async (request) => {
      seen = request
      return { outcome: "selected", optionId: "allow" }
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "edit" }])

    expect(seen).not.toBeNull()
    expect(seen!.toolCall).toEqual({ toolCallId: "t1", title: "Write file", kind: "edit", status: "pending" })
    expect(seen!.options).toEqual([
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "deny", name: "Deny", kind: "reject_once" },
    ])
    expect(mock.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(events.some((e) => e.kind === "status" && e.status === "awaiting_approval")).toBe(true)
    await conn.dispose()
  })

  it("cancels the permission request when no handler is registered", async () => {
    const { conn, mock } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.requestPermission({ toolCallId: "t1", title: "Write", kind: "edit", status: "pending" }, [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
        ])
        return "end_turn" as const
      },
    })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "edit" }])
    expect(mock.permissionOutcomes).toEqual([{ outcome: "cancelled" }])
    await conn.dispose()
  })

  it("keeps the terminal error after a transport close cancels a pending permission", async () => {
    let fireClose: ((info: { code: number | null }) => void) | undefined
    let releasePermission!: () => void
    let releasePrompt!: () => void
    const permissionGate = new Promise<void>((resolve) => {
      releasePermission = resolve
    })
    const promptGate = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    const pair = createInMemoryTransportPair()
    startMockAgent(pair.agent, {
      onPrompt: async (_request, ctx) => {
        await ctx.requestPermission({ toolCallId: "t1", title: "Write", kind: "edit", status: "pending" }, [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
        ])
        await promptGate
        return "end_turn" as const
      },
    })
    const events: DomainSessionEvent[] = []
    const conn = createAgentConnection({
      config: CONFIG,
      transport: () => ({
        stream: pair.client,
        onClose: (cb) => {
          fireClose = cb
        },
        dispose: async () => {},
      }),
    })
    conn.onUpdate((event) => events.push(event))
    conn.onPermission(async () => {
      await permissionGate
      return { outcome: "cancelled" }
    })
    await conn.connect()
    const sessionId = await conn.newSession("/repo")
    const prompt = conn.prompt(sessionId, [{ type: "text", text: "edit" }])
    await waitFor(() => lastStatus(events) === "awaiting_approval")

    fireClose!({ code: 1 })
    releasePermission()
    await waitFor(() => lastStatus(events) === "error")
    expect(lastStatus(events)).toBe("error")

    releasePrompt()
    await prompt
    await conn.dispose()
  })
})

describe("verified clarification elicitation", () => {
  const validForm = (sessionId: string): CreateElicitationRequest => ({
    mode: "form",
    sessionId,
    message: "How should Kitten proceed?",
    requestedSchema: {
      type: "object",
      required: ["strategy", "targets"],
      properties: {
        strategy: {
          type: "string",
          title: "Strategy",
          oneOf: [
            { const: "safe", title: "Safe" },
            { const: "fast", title: "Fast" },
          ],
        },
        targets: {
          type: "array",
          title: "Targets",
          items: { type: "string", enum: ["tests", "docs"] },
        },
        notes: { type: "string", title: "Notes" },
      },
    },
  })

  it("delivers a normalized payload once and maps one valid answer back to ACP", async () => {
    let calls = 0
    let seen: ClarificationPayload | null = null
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          await ctx.createElicitation(validForm(request.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    conn.onClarification(async (payload) => {
      calls += 1
      seen = payload
      return {
        kind: "submitted",
        answers: {
          strategy: { selectedOptionIds: ["safe"] },
          targets: { selectedOptionIds: ["tests", "docs"] },
          notes: { selectedOptionIds: [], customText: "Keep it focused" },
        },
      }
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])

    expect(calls).toBe(1)
    expect(seen as ClarificationPayload | null).toEqual({
      prompt: "How should Kitten proceed?",
      fields: [
        {
          id: "strategy",
          label: "Strategy",
          required: true,
          mode: "single",
          allowsCustom: false,
          options: [
            { id: "safe", label: "Safe" },
            { id: "fast", label: "Fast" },
          ],
        },
        {
          id: "targets",
          label: "Targets",
          required: true,
          mode: "multi",
          allowsCustom: false,
          options: [
            { id: "tests", label: "tests" },
            { id: "docs", label: "docs" },
          ],
        },
        { id: "notes", label: "Notes", required: false, mode: "text" },
      ],
    })
    expect(mock.elicitationOutcomes).toEqual([
      {
        action: "accept",
        content: { strategy: "safe", targets: ["tests", "docs"], notes: "Keep it focused" },
      },
    ])
    await conn.dispose()
  })

  it("maps a protocol-free cancellation back to ACP cancellation", async () => {
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          await ctx.createElicitation(validForm(request.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    conn.onClarification(async () => ({ kind: "cancelled" }))
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])
    expect(mock.elicitationOutcomes).toEqual([{ action: "cancel" }])
    await conn.dispose()
  })

  it("cancels when no clarification handler is registered", async () => {
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          await ctx.createElicitation(validForm(request.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])
    expect(mock.elicitationOutcomes).toEqual([{ action: "cancel" }])
    await conn.dispose()
  })

  it.each([
    [
      "URL mode",
      (sessionId: string): CreateElicitationRequest => ({
        mode: "url",
        sessionId,
        message: "Open this",
        elicitationId: "elicit-1",
        url: "https://example.test",
      }),
    ],
    [
      "custom mode",
      (sessionId: string): CreateElicitationRequest =>
        ({ mode: "_future", sessionId, message: "Future" }) as CreateElicitationRequest,
    ],
    [
      "request scope",
      (): CreateElicitationRequest => ({
        mode: "form",
        requestId: "request-1",
        message: "Configure",
        requestedSchema: { properties: { note: { type: "string" } } },
      }),
    ],
    [
      "mismatched session",
      (): CreateElicitationRequest => validForm("another-session"),
    ],
    [
      "malformed field",
      (sessionId: string): CreateElicitationRequest => ({
        mode: "form",
        sessionId,
        message: "Choose",
        requestedSchema: { properties: { enabled: { type: "boolean" } } },
      }),
    ],
  ])("terminally cancels unsupported %s without invoking the handler", async (_label, request) => {
    let handlerCalls = 0
    const { conn, mock } = await connected(
      {
        onPrompt: async (prompt, ctx) => {
          await ctx.createElicitation(request(prompt.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    conn.onClarification(async () => {
      handlerCalls += 1
      return { kind: "cancelled" }
    })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])
    expect(handlerCalls).toBe(0)
    expect(mock.elicitationOutcomes).toEqual([{ action: "cancel" }])
    await conn.dispose()
  })

  it("cancels a matching-looking request when no ACP session is active", async () => {
    let handlerCalls = 0
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          await ctx.createElicitation(validForm(request.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    conn.onClarification(async () => {
      handlerCalls += 1
      return { kind: "cancelled" }
    })
    await conn.prompt("not-opened", [{ type: "text", text: "ask" }])
    expect(handlerCalls).toBe(0)
    expect(mock.elicitationOutcomes).toEqual([{ action: "cancel" }])
    await conn.dispose()
  })

  it("cancels an invalid submitted value instead of accepting malformed content", async () => {
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          await ctx.createElicitation(validForm(request.sessionId))
          return "end_turn" as const
        },
      },
      undefined,
      SUPPORTED_CONFIG,
    )
    conn.onClarification(async () => ({
      kind: "submitted",
      answers: {
        strategy: { selectedOptionIds: ["unknown"] },
        targets: { selectedOptionIds: ["tests"] },
      },
    }))
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])
    expect(mock.elicitationOutcomes).toEqual([{ action: "cancel" }])
    await conn.dispose()
  })

  it("does not register the ACP callback for an unsupported capability", async () => {
    let handlerCalls = 0
    let rejected = false
    const { conn, mock } = await connected(
      {
        onPrompt: async (request, ctx) => {
          try {
            await ctx.createElicitation(validForm(request.sessionId))
          } catch {
            rejected = true
          }
          return "end_turn" as const
        },
      },
      undefined,
      UNSUPPORTED_CONFIG,
    )
    conn.onClarification(async () => {
      handlerCalls += 1
      return { kind: "cancelled" }
    })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "ask" }])
    expect(rejected).toBe(true)
    expect(handlerCalls).toBe(0)
    expect(mock.elicitationOutcomes).toEqual([])
    await conn.dispose()
  })
})

describe("full prompt turn", () => {
  it("yields the expected ordered domain events (message -> tool_call -> completion)", async () => {
    const scheduler = manualScheduler()
    const { conn, events } = await connected(
      {
        onPrompt: async (_request, ctx) => {
          await ctx.update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "Hel" } })
          await ctx.update({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "lo" } })
          await ctx.update({
            sessionUpdate: "tool_call",
            toolCallId: "t1",
            title: "Read",
            kind: "read",
            status: "completed",
            locations: [{ path: "/a.ts" }],
          })
          return "end_turn" as const
        },
      },
      scheduler.scheduler,
    )
    const sessionId = await conn.newSession("/tmp")
    const result = await conn.prompt(sessionId, [{ type: "text", text: "go" }])
    await waitFor(() => events.some((e) => e.kind === "status" && e.status === "finished"))
    await delay(10)

    expect(result).toEqual({ stopReason: "end_turn" })
    // `end_turn` leaves the session `finished` (your move), not `idle` (ADR-006).
    expect(events).toEqual([
      { kind: "status", status: "working" },
      { kind: "agent_message", messageId: "m1", textDelta: "Hello" },
      {
        kind: "tool_call",
        call: { toolCallId: "t1", title: "Read", kind: "read", status: "completed", locations: ["/a.ts"] },
      },
      { kind: "status", status: "finished" },
    ])
    await conn.dispose()
  })

  it("never emits an object carrying an ACP-only field through onUpdate", async () => {
    const forbidden = ["_meta", "sessionUpdate", "rawInput", "rawOutput", "content", "annotations", "line"]
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Edit",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/x.ts", line: 12 }],
          content: [{ type: "diff", path: "/x.ts", oldText: "a", newText: "b" }],
          rawInput: { secret: "nope" },
          _meta: { trace: "abc" },
        })
        return "end_turn" as const
      },
    })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "edit" }])
    await delay(10)

    const keys = new Set<string>()
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key)
          walk(nested)
        }
      }
    }
    walk(events)
    for (const key of forbidden) expect(keys.has(key)).toBe(false)
    await conn.dispose()
  })
})

describe("bundled MCP failure classification", () => {
  const bundledTitle = `mcp.${ASK_USER_MCP_SERVER_NAME}.ask_user`
  const textResult = (text: string) => [{ type: "content" as const, content: { type: "text" as const, text } }]

  it("classifies an exact failed full bundled call without retaining its source envelope", async () => {
    const rawEnvelope = '{ "error": "busy" }'
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "tool_call",
          toolCallId: "bundled-full",
          title: bundledTitle,
          kind: "other",
          status: "failed",
          content: textResult(rawEnvelope),
        })
        return "end_turn" as const
      },
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "classify" }])
    const event = events.find((candidate) => candidate.kind === "tool_call")

    expect(event).toEqual({
      kind: "tool_call",
      call: {
        toolCallId: "bundled-full",
        title: bundledTitle,
        kind: "other",
        status: "failed",
        diff: null,
        failureKind: "temporary_capacity",
      },
    })
    expect(JSON.stringify(event)).not.toContain(rawEnvelope)
    expect(JSON.stringify(event)).not.toContain('"error"')
    await conn.dispose()
  })

  it("associates a title-less later update and emits only protocol-free bounded state", async () => {
    const sentinels = {
      capability: "private-capability-sentinel",
      route: "private-route-sentinel",
      endpoint: "private-endpoint-sentinel",
      server: "private-server-sentinel",
    }
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "tool_call",
          toolCallId: "bundled-later",
          title: bundledTitle,
          kind: "other",
          status: "in_progress",
        })
        await ctx.update({
          sessionUpdate: "tool_call_update",
          toolCallId: "bundled-later",
          status: "failed",
          content: textResult('{"error":"unavailable"}'),
          rawOutput: sentinels,
          _meta: sentinels,
        })
        return "end_turn" as const
      },
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "classify later" }])
    const classified = events.filter(
      (candidate) => candidate.kind === "tool_call" && candidate.call.failureKind !== undefined,
    )

    expect(classified).toEqual([{
      kind: "tool_call",
      call: {
        toolCallId: "bundled-later",
        status: "failed",
        diff: null,
        failureKind: "unavailable",
      },
    }])
    const serialized = JSON.stringify(classified)
    expect(serialized).not.toContain('{"error"')
    expect(serialized).not.toContain(ASK_USER_MCP_SERVER_NAME)
    for (const sentinel of Object.values(sentinels)) expect(serialized).not.toContain(sentinel)
    await conn.dispose()
  })

  it("keeps unrelated titles and non-exact content generic", async () => {
    const cases = [
      { id: "other-server", title: "mcp.other.ask_user", content: textResult('{"error":"busy"}') },
      { id: "missing-function", title: `mcp.${ASK_USER_MCP_SERVER_NAME}`, content: textResult('{"error":"busy"}') },
      { id: "empty-function", title: `mcp.${ASK_USER_MCP_SERVER_NAME}.`, content: textResult('{"error":"busy"}') },
      { id: "empty-function-segment", title: `mcp.${ASK_USER_MCP_SERVER_NAME}..ask_user`, content: textResult('{"error":"busy"}') },
      { id: "non-mcp", title: "shell", content: textResult('{"error":"busy"}') },
      { id: "still-running", title: bundledTitle, status: "in_progress" as const, content: textResult('{"error":"busy"}') },
      { id: "completed", title: bundledTitle, status: "completed" as const, content: textResult('{"error":"busy"}') },
      { id: "malformed", title: bundledTitle, content: textResult("not-json") },
      { id: "additional-key", title: bundledTitle, content: textResult('{"error":"busy","route":"private"}') },
      { id: "invalid-request", title: bundledTitle, content: textResult('{"error":"invalid_request"}') },
      { id: "arbitrary-text", title: bundledTitle, content: textResult("busy") },
      {
        id: "multiple-blocks",
        title: bundledTitle,
        content: [...textResult('{"error":"busy"}'), ...textResult("ignored")],
      },
    ]
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        for (const testCase of cases) {
          await ctx.update({
            sessionUpdate: "tool_call",
            toolCallId: testCase.id,
            title: testCase.title,
            kind: "other",
            status: testCase.status ?? "failed",
            content: testCase.content,
          })
        }
        return "end_turn" as const
      },
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "keep generic" }])
    const toolEvents = events.filter((candidate) => candidate.kind === "tool_call")

    expect(toolEvents).toHaveLength(cases.length)
    for (const event of toolEvents) {
      if (event.kind === "tool_call") expect(event.call.failureKind).toBeUndefined()
    }
    expect(JSON.stringify(toolEvents)).not.toContain('"error"')
    expect(JSON.stringify(toolEvents)).not.toContain("private")
    await conn.dispose()
  })

  it("retires eligibility after both completion and failure before an ID is reused", async () => {
    const { conn, events } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.update({
          sessionUpdate: "tool_call",
          toolCallId: "completed-id",
          title: bundledTitle,
          kind: "other",
          status: "completed",
        })
        await ctx.update({
          sessionUpdate: "tool_call_update",
          toolCallId: "completed-id",
          status: "failed",
          content: textResult('{"error":"busy"}'),
        })
        await ctx.update({
          sessionUpdate: "tool_call",
          toolCallId: "failed-id",
          title: bundledTitle,
          kind: "other",
          status: "failed",
          content: textResult('{"error":"busy"}'),
        })
        await ctx.update({
          sessionUpdate: "tool_call_update",
          toolCallId: "failed-id",
          status: "failed",
          content: textResult('{"error":"unavailable"}'),
        })
        return "end_turn" as const
      },
    })

    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "reuse IDs" }])
    const calls = events.filter((candidate) => candidate.kind === "tool_call").map((event) => event.call)

    expect(calls[1]?.failureKind).toBeUndefined()
    expect(calls[2]?.failureKind).toBe("temporary_capacity")
    expect(calls[3]?.failureKind).toBeUndefined()
    await conn.dispose()
  })
})

describe("status mapping (ADR-006)", () => {
  const finishedReasons = ["end_turn", "max_tokens", "max_turn_requests", "refusal"] as const

  for (const reason of finishedReasons) {
    it(`maps the ${reason} stop reason to a finished status`, async () => {
      const { conn, events } = await connected({ onPrompt: async () => reason })
      const sessionId = await conn.newSession("/tmp")
      await conn.prompt(sessionId, [{ type: "text", text: "go" }])
      expect(lastStatus(events)).toBe("finished")
      await conn.dispose()
    })
  }

  it("maps the cancelled stop reason to idle, not finished", async () => {
    const { conn, events } = await connected({ onPrompt: async () => "cancelled" as const })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "stop" }])
    expect(lastStatus(events)).toBe("idle")
    await conn.dispose()
  })

  it("maps a thrown prompt to error and rethrows the failure", async () => {
    const { conn, events } = await connected({
      onPrompt: async () => {
        throw new Error("model exploded")
      },
    })
    const sessionId = await conn.newSession("/tmp")
    await expect(conn.prompt(sessionId, [{ type: "text", text: "go" }])).rejects.toThrow()
    expect(lastStatus(events)).toBe("error")
    await conn.dispose()
  })

  it("maps an unexpected transport close to error", async () => {
    let fireClose: ((info: { code: number | null }) => void) | undefined
    const pair = createInMemoryTransportPair()
    startMockAgent(pair.agent)
    const events: DomainSessionEvent[] = []
    const conn = createAgentConnection({
      config: CONFIG,
      transport: () => ({
        stream: pair.client,
        onClose: (cb) => {
          fireClose = cb
        },
        dispose: async () => {},
      }),
    })
    conn.onUpdate((event) => events.push(event))
    await conn.connect()

    fireClose!({ code: 1 })
    expect(lastStatus(events)).toBe("error")
    await conn.dispose()
  })

  it("does not report error when dispose closes the transport intentionally", async () => {
    let fireClose: ((info: { code: number | null }) => void) | undefined
    const pair = createInMemoryTransportPair()
    startMockAgent(pair.agent)
    const events: DomainSessionEvent[] = []
    const conn = createAgentConnection({
      config: CONFIG,
      transport: () => ({
        stream: pair.client,
        onClose: (cb) => {
          fireClose = cb
        },
        // A real transport's close fires as `dispose` reaps the subprocess.
        dispose: async () => fireClose?.({ code: 0 }),
      }),
    })
    conn.onUpdate((event) => events.push(event))
    await conn.connect()
    await conn.dispose()

    expect(events.some((event) => event.kind === "status" && event.status === "error")).toBe(false)
  })
})

describe("concurrent prompt guard", () => {
  it("rejects before a second ACP dispatch and preserves the original terminal result", async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const { conn, mock, events } = await connected({
      onPrompt: async () => {
        await firstGate
        return "end_turn" as const
      },
    })
    const sessionId = await conn.newSession("/tmp")

    const first = conn.prompt(sessionId, [{ type: "text", text: "first" }])
    await waitFor(() => mock.prompts.length === 1)

    await expect(conn.prompt(sessionId, [{ type: "text", text: "second" }])).rejects.toBeInstanceOf(
      ConcurrentPromptError,
    )
    expect(mock.prompts).toHaveLength(1)
    expect(lastStatus(events)).toBe("working")

    releaseFirst()
    await expect(first).resolves.toEqual({ stopReason: "end_turn" })
    expect(lastStatus(events)).toBe("finished")
    await conn.dispose()
  })
})

describe("config options (task_03)", () => {
  /** A single ACP select config option, in the SDK wire shape the mock serves. */
  const selectOption = (id: string, category: string, currentValue: string, values: [string, string][]) => ({
    type: "select" as const,
    id,
    name: id,
    category,
    currentValue,
    options: values.map(([value, name]) => ({ value, name })),
  })

  const MODEL = selectOption("model", "model", "sonnet", [
    ["sonnet", "Sonnet"],
    ["opus", "Opus"],
  ])
  const EFFORT = selectOption("thought_level", "thought_level", "medium", [
    ["medium", "Medium"],
    ["high", "High"],
  ])
  const CLAUDE_BYPASS_MODE = selectOption("mode", "mode", "bypassPermissions", [
    ["default", "Default"],
    ["bypassPermissions", "Bypass Permissions"],
  ])

  const configEvents = (events: DomainSessionEvent[]) => events.filter((e) => e.kind === "config_options")

  it("captures newSession's config options and emits them as an initial config_options event", async () => {
    const { conn, events } = await connected({ configOptions: [MODEL, EFFORT] })
    await conn.newSession("/tmp/project")

    expect(configEvents(events)).toEqual([
      {
        kind: "config_options",
        options: [
          { id: "model", category: "model", label: "model", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
          { id: "thought_level", category: "thought_level", label: "thought_level", currentValue: "medium", options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
        ],
      },
    ])
    await conn.dispose()
  })

  it("captures loadSession's config options and emits them as an initial config_options event", async () => {
    const { conn, events } = await connected({ canLoadSession: true, configOptions: [MODEL, EFFORT] })
    await conn.loadSession("sess-7", "/tmp/project")

    expect(configEvents(events)).toEqual([
      {
        kind: "config_options",
        options: [
          { id: "model", category: "model", label: "model", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
          { id: "thought_level", category: "thought_level", label: "thought_level", currentValue: "medium", options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
        ],
      },
    ])
    await conn.dispose()
  })

  it("restores Claude's approval boundary before exposing a bypassed new session", async () => {
    const { conn, mock, events } = await connected({ configOptions: [CLAUDE_BYPASS_MODE, MODEL] })

    const sessionId = await conn.newSession("/tmp/project")

    expect(mock.configOptionRequests).toEqual([{ sessionId, configId: "mode", value: "default" }])
    expect(configEvents(events)).toEqual([
      {
        kind: "config_options",
        options: [
          { id: "mode", category: "mode", label: "mode", currentValue: "default", options: [{ value: "default", name: "Default" }, { value: "bypassPermissions", name: "Bypass Permissions" }] },
          { id: "model", category: "model", label: "model", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
        ],
      },
    ])
    await conn.dispose()
  })

  it("restores Claude's approval boundary when loading a bypassed session", async () => {
    const { conn, mock, events } = await connected({ canLoadSession: true, configOptions: [CLAUDE_BYPASS_MODE, MODEL] })

    await conn.loadSession("stored-session", "/tmp/project")

    expect(mock.configOptionRequests).toEqual([{ sessionId: "stored-session", configId: "mode", value: "default" }])
    expect(configEvents(events).at(-1)).toMatchObject({
      kind: "config_options",
      options: expect.arrayContaining([expect.objectContaining({ id: "mode", currentValue: "default" })]),
    })
    await conn.dispose()
  })

  it("fails Claude closed when a bypassed session cannot restore Kitten's approval boundary", async () => {
    const { conn, mock } = await connected({
      configOptions: [CLAUDE_BYPASS_MODE],
      onSetConfigOption: () => { throw new Error("mode change rejected") },
    })

    await expect(conn.newSession("/tmp/project")).rejects.toThrow(
      "Claude Code started in bypass permissions mode, and Kitten could not restore its approval boundary.",
    )
    expect(mock.configOptionRequests).toEqual([{ sessionId: "mock-session-1", configId: "mode", value: "default" }])
    await conn.dispose()
  })

  it("does not impose Claude's permission mode on another provider", async () => {
    const { conn, mock } = await connected({ configOptions: [CLAUDE_BYPASS_MODE] }, undefined, CODEX_CONFIG)

    await conn.newSession("/tmp/project")

    expect(mock.configOptionRequests).toEqual([])
    await conn.dispose()
  })

  it("emits an empty config_options event when the session advertises no options (no fabrication)", async () => {
    const { conn, events } = await connected({ configOptions: [] })
    await conn.newSession("/tmp/project")
    expect(configEvents(events)).toEqual([{ kind: "config_options", options: [] }])
    await conn.dispose()
  })

  it("emits no config_options event when the agent does not advertise the capability", async () => {
    const { conn, events } = await connected()
    await conn.newSession("/tmp/project")
    expect(configEvents(events)).toEqual([])
    await conn.dispose()
  })

  it("setSessionConfigOption returns only the complete agent-confirmed snapshot without an optimistic event", async () => {
    const { conn, mock, events } = await connected({ configOptions: [MODEL, EFFORT] })
    const sessionId = await conn.newSession("/tmp/project")
    const before = configEvents(events).map((event) => structuredClone(event))

    const refreshed = await conn.setSessionConfigOption(sessionId, "model", "opus")

    expect(mock.configOptionRequests).toEqual([{ sessionId, configId: "model", value: "opus" }])
    expect(refreshed).toEqual([
      { id: "model", category: "model", label: "model", currentValue: "opus", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
      { id: "thought_level", category: "thought_level", label: "thought_level", currentValue: "medium", options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
    ])
    expect(configEvents(events)).toEqual(before)
    expect(before[0]).toEqual({
      kind: "config_options",
      options: [
        { id: "model", category: "model", label: "model", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
        { id: "thought_level", category: "thought_level", label: "thought_level", currentValue: "medium", options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
      ],
    })
    await conn.dispose()
  })

  it("propagates a transport error to the controller's error path without corrupting confirmed state", async () => {
    const { conn, mock, events } = await connected({
      configOptions: [MODEL],
      onSetConfigOption: () => {
        throw new Error("set_config_option transport boom")
      },
    })
    const sessionId = await conn.newSession("/tmp/project")
    const before = configEvents(events).map((event) => structuredClone(event))

    // The adapter rejects so the controller action (the existing error path) reports it
    // through onError; it must never emit a status:error or a config_options event that
    // would misreport the live model, so the overlay keeps its last confirmed value.
    await expect(conn.setSessionConfigOption(sessionId, "model", "opus")).rejects.toThrow()
    expect(mock.configOptionRequests).toEqual([{ sessionId, configId: "model", value: "opus" }])
    expect(mock.configOptions[0]?.currentValue).toBe("sonnet")
    expect(configEvents(events)).toEqual(before)
    expect(events.some((e) => e.kind === "status" && e.status === "error")).toBe(false)
    await conn.dispose()
  })

  it("changes the live session's value in place and keeps the session usable (no re-spawn)", async () => {
    const { conn, mock, events } = await connected({ configOptions: [MODEL] })
    const sessionId = await conn.newSession("/tmp/project")

    const refreshed = await conn.setSessionConfigOption(sessionId, "model", "opus")

    // The mock's own state moved, and the returned set reflects the confirmed value.
    expect(mock.configOptions[0]?.currentValue).toBe("opus")
    expect(refreshed[0]?.currentValue).toBe("opus")
    expect(mock.configOptionRequests).toEqual([{ sessionId, configId: "model", value: "opus" }])
    // The same live session is still driveable afterward - no teardown happened.
    expect(await conn.prompt(sessionId, [{ type: "text", text: "still there?" }])).toEqual({ stopReason: "end_turn" })
    expect(events.some((e) => e.kind === "status" && e.status === "error")).toBe(false)
    await conn.dispose()
  })

  it("translates an agent-initiated config_option_update after the switch into a config_options event", async () => {
    const { conn, mock, events } = await connected({ configOptions: [MODEL] })
    await conn.newSession("/tmp/project")

    await mock.emitConfigOptionUpdate([{ ...MODEL, currentValue: "opus" }])
    await waitFor(() => configEvents(events).length >= 2)

    expect(configEvents(events).at(-1)).toEqual({
      kind: "config_options",
      options: [{ id: "model", category: "model", label: "model", currentValue: "opus", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] }],
    })
    await conn.dispose()
  })
})

describe("createFrameScheduler", () => {
  it("runs a single coalesced flush per frame", async () => {
    const scheduler = createFrameScheduler(5)
    let count = 0
    const flush = () => {
      count += 1
    }
    scheduler.schedule(flush)
    scheduler.schedule(flush) // collapses into the pending frame
    expect(count).toBe(0)
    await delay(20)
    expect(count).toBe(1)

    scheduler.schedule(flush) // a fresh frame flushes again
    await delay(20)
    expect(count).toBe(2)
    scheduler.dispose()
  })

  it("dispose cancels a pending flush", async () => {
    const scheduler = createFrameScheduler(5)
    let count = 0
    scheduler.schedule(() => {
      count += 1
    })
    scheduler.dispose()
    await delay(20)
    expect(count).toBe(0)
  })
})

describe("filesystem callbacks", () => {
  it("omits ACP filesystem capability and handlers for a bridge-only child", async () => {
    let callbackRejected = false
    const { conn } = setup({
      onInitialize(request) {
        expect(request.clientCapabilities?.fs).toEqual({
          readTextFile: false,
          writeTextFile: false,
        })
        return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: "mock-agent", version: "0.0.0" } }
      },
      onPrompt: async (request, ctx) => {
        try {
          await ctx.readTextFile(`${request.sessionId}.txt`)
        } catch {
          callbackRejected = true
        }
        return "end_turn" as const
      },
    }, undefined, UNSUPPORTED_CONFIG, undefined, "none")

    const readiness = await conn.connect()
    expect(readiness).toEqual({ ready: true, protocolVersion: 1, canLoadSession: false })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "bounded bridge only" }])
    expect(callbackRejected).toBe(true)
    await conn.dispose()
  })

  it("serves the agent's writeTextFile and windowed readTextFile requests", async () => {
    const path = `${import.meta.dir}/.tmp-fs-callback-${process.pid}.txt`
    let readBack = ""
    const { conn } = await connected({
      onPrompt: async (_request, ctx) => {
        await ctx.writeTextFile(path, "line1\nline2\nline3")
        readBack = await ctx.readTextFile(path, { line: 2, limit: 1 })
        return "end_turn" as const
      },
    })
    const sessionId = await conn.newSession("/tmp")
    await conn.prompt(sessionId, [{ type: "text", text: "edit" }])
    expect(readBack).toBe("line2")
    expect(await Bun.file(path).text()).toBe("line1\nline2\nline3")
    await Bun.file(path).delete()
    await conn.dispose()
  })
})

// Ensure adapters expose the interface type without unused-import noise.
export type _AgentConnection = AgentConnection
