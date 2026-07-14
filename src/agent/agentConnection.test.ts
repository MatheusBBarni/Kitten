import { describe, expect, it } from "bun:test"

import type { CreateElicitationRequest, PermissionOption, SessionUpdate } from "@agentclientprotocol/sdk"

import type { AgentConfig, ClarificationPayload, DomainSessionEvent, McpServerConfig, ResolvedAgentConfig } from "../core/types.ts"
import { startMockAgent, type MockAgentOptions } from "../../test/mockAgent.ts"
import {
  createAgentConnection,
  CODEX_COMPACTION_IDLE_RECOVERY_GRACE_MS,
  createFrameScheduler,
  type AgentConnection,
  type FrameScheduler,
  type PermissionRequest,
} from "./agentConnection.ts"
import { createInMemoryTransportPair } from "./transport.ts"
import { KITTEN_VERSION } from "../version.ts"

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
const SUPPORTED_CONFIG: ResolvedAgentConfig = {
  ...CONFIG,
  clarificationCapability: {
    status: "supported",
    adapterPackage: "@agentclientprotocol/claude-agent-acp",
    adapterVersion: "0.14.1",
  },
}
const UNSUPPORTED_CONFIG: ResolvedAgentConfig = {
  ...CONFIG,
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
}

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
) {
  const pair = createInMemoryTransportPair()
  const mock = startMockAgent(pair.agent, mockOptions)
  const events: DomainSessionEvent[] = []
  const conn = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler,
  })
  conn.onUpdate((event) => events.push(event))
  return { conn, mock, events }
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
        kind: "answered",
        values: { strategy: "safe", targets: ["tests", "docs"], notes: "Keep it focused" },
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
      kind: "answered",
      values: { strategy: "unknown", targets: ["tests"] },
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

  it("setSessionConfigOption returns the agent-confirmed refreshed option set", async () => {
    const { conn } = await connected({ configOptions: [MODEL, EFFORT] })
    const sessionId = await conn.newSession("/tmp/project")

    const refreshed = await conn.setSessionConfigOption(sessionId, "model", "opus")

    expect(refreshed).toEqual([
      { id: "model", category: "model", label: "model", currentValue: "opus", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }] },
      { id: "thought_level", category: "thought_level", label: "thought_level", currentValue: "medium", options: [{ value: "medium", name: "Medium" }, { value: "high", name: "High" }] },
    ])
    await conn.dispose()
  })

  it("propagates a transport error to the controller's error path without corrupting confirmed state", async () => {
    const { conn, events } = await connected({
      configOptions: [MODEL],
      onSetConfigOption: () => {
        throw new Error("set_config_option transport boom")
      },
    })
    const sessionId = await conn.newSession("/tmp/project")
    const before = configEvents(events).length

    // The adapter rejects so the controller action (the existing error path) reports it
    // through onError; it must never emit a status:error or a config_options event that
    // would misreport the live model, so the overlay keeps its last confirmed value.
    await expect(conn.setSessionConfigOption(sessionId, "model", "opus")).rejects.toThrow()
    expect(configEvents(events).length).toBe(before)
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
