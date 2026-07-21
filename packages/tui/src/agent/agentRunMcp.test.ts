import { describe, expect, it } from "bun:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import {
  AGENT_RUN_MCP_CAPABILITY_ENV,
  AGENT_RUN_MCP_ENDPOINT_ENV,
  AGENT_RUN_MCP_TOOL_NAME,
  agentRunInputSchema,
  createAgentRunMcpRegistrar,
  forwardAgentRunToBridge,
  MAX_AGENT_RUN_CHILDREN,
  MAX_AGENT_RUN_CHILD_ID_BYTES,
  MAX_AGENT_RUN_FRAME_BYTES,
  MAX_AGENT_RUN_TEXT_BYTES,
  serializeAgentRunResult,
  type AgentRunIpcOptions,
  type AgentRunRequest,
  type AgentRunResult,
} from "./agentRunMcp.ts"
import { createKittenMcpServer } from "./kittenMcp.ts"

type TestSocketHandlers = Parameters<NonNullable<AgentRunIpcOptions["connect"]>>[0]["socket"]
type TestSocket = Parameters<TestSocketHandlers["data"]>[0]

const ENV = {
  [AGENT_RUN_MCP_ENDPOINT_ENV]: "/private/kitten.sock",
  [AGENT_RUN_MCP_CAPABILITY_ENV]: "c".repeat(32),
}

const START: AgentRunRequest = {
  operation: "start",
  tasks: [{ task: "Inspect the parser", desired_outcome: "List the unsafe branches" }],
}

const POLL: AgentRunRequest = {
  operation: "poll",
  child_ids: ["child-b", "child-a"],
}

function snapshots(request: AgentRunRequest): AgentRunResult {
  const childIds = request.operation === "start"
    ? request.tasks.map((_, index) => `child-${index + 1}`)
    : request.child_ids
  return {
    operation: request.operation,
    children: childIds.map((childId, index) => ({
      child_id: childId,
      status: index === 0 ? "running" : "finished",
      ...(index === 0 ? {} : { terminal_at: 1_750_000_000_000 }),
    })),
  }
}

function responseConnect(
  respond: (handlers: TestSocketHandlers, socket: TestSocket, request: Record<string, unknown>) => void,
): NonNullable<AgentRunIpcOptions["connect"]> {
  return async ({ socket: handlers }) => {
    const socket = {
      write(data: string) {
        const request = JSON.parse(data) as Record<string, unknown>
        queueMicrotask(() => respond(handlers, socket, request))
        return data.length
      },
      end() {},
    }
    handlers.open(socket)
    return socket
  }
}

describe("agent_run MCP schema", () => {
  it("accepts one and four distinct bounded start entries", () => {
    expect(agentRunInputSchema.safeParse(START).success).toBe(true)
    expect(agentRunInputSchema.safeParse({
      operation: "start",
      tasks: Array.from({ length: MAX_AGENT_RUN_CHILDREN }, (_, index) => ({
        task: `${index}:${"🔥".repeat(1_023)}`,
        desired_outcome: `${index}:done`,
      })),
    }).success).toBe(true)
  })

  it.each([
    ["empty tasks", { operation: "start", tasks: [] }],
    ["too many tasks", { operation: "start", tasks: Array.from({ length: MAX_AGENT_RUN_CHILDREN + 1 }, (_, index) => ({ task: `task-${index}`, desired_outcome: "done" })) }],
    ["duplicate task/outcome pair", { operation: "start", tasks: [{ task: "same", desired_outcome: "same" }, { task: "same", desired_outcome: "same" }] }],
    ["empty task", { operation: "start", tasks: [{ task: "", desired_outcome: "done" }] }],
    ["whitespace outcome", { operation: "start", tasks: [{ task: "work", desired_outcome: "   " }] }],
    ["oversized task", { operation: "start", tasks: [{ task: "🔥".repeat((MAX_AGENT_RUN_TEXT_BYTES / 4) + 1), desired_outcome: "done" }] }],
    ["unknown start key", { ...START, transcript: "private-transcript" }],
    ["unknown task key", { operation: "start", tasks: [{ task: "work", desired_outcome: "done", provider: "private-provider" }] }],
    ["caller parent", { ...START, parent_id: "private-parent" }],
    ["caller session", { ...START, session_id: "private-session" }],
    ["caller generation", { ...START, generation: 42 }],
    ["unsupported operation", { operation: "wait", child_ids: ["child-a"] }],
  ])("rejects %s", (_label, input) => {
    const parsed = agentRunInputSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      const error = JSON.stringify(parsed.error.issues)
      expect(error).not.toContain("private-")
      expect(error).not.toContain("🔥")
    }
  })

  it("accepts ordered poll IDs and rejects empty, duplicate, malformed, or caller-owned identity", () => {
    expect(agentRunInputSchema.safeParse(POLL).success).toBe(true)
    for (const input of [
      { operation: "poll", child_ids: [] },
      { operation: "poll", child_ids: ["child-a", "child-a"] },
      { operation: "poll", child_ids: [""] },
      { operation: "poll", child_ids: [" "] },
      { operation: "poll", child_ids: ["x".repeat(MAX_AGENT_RUN_CHILD_ID_BYTES + 1)] },
      { operation: "poll", child_ids: ["child-a"], parent: "private-parent" },
    ]) {
      expect(agentRunInputSchema.safeParse(input).success).toBe(false)
    }
  })
})

describe("agent_run MCP registrar and serialization", () => {
  it("forwards one and four valid start entries and returns only ordered snapshots", async () => {
    const forwarded: AgentRunRequest[] = []
    const server = createKittenMcpServer({
      registrars: [createAgentRunMcpRegistrar({}, {
        forward: async (request) => {
          forwarded.push(request)
          return snapshots(request)
        },
      })],
    })
    const client = new Client({ name: "agent-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([AGENT_RUN_MCP_TOOL_NAME])
      expect(tools.tools[0]!.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: { not: {} },
        properties: {
          operation: { enum: ["start", "poll"] },
          tasks: { type: "array", minItems: 1, maxItems: MAX_AGENT_RUN_CHILDREN },
          child_ids: { type: "array", minItems: 1 },
        },
      })

      const one = await client.callTool({ name: AGENT_RUN_MCP_TOOL_NAME, arguments: START })
      expect(one.isError).not.toBe(true)
      expect(one.structuredContent).toEqual({
        operation: "start",
        children: [{ child_id: "child-1", status: "running" }],
      })

      const four: AgentRunRequest = {
        operation: "start",
        tasks: Array.from({ length: 4 }, (_, index) => ({
          task: `task-${index}`,
          desired_outcome: `outcome-${index}`,
        })),
      }
      const fourResult = await client.callTool({ name: AGENT_RUN_MCP_TOOL_NAME, arguments: four })
      expect(fourResult.isError).not.toBe(true)
      expect((fourResult.structuredContent as { children: unknown[] }).children).toHaveLength(4)
      expect(forwarded).toEqual([START, four])
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("rejects invalid input without forwarding or echoing caller content", async () => {
    let forwards = 0
    const secret = "task-sentinel-must-not-return"
    const server = createKittenMcpServer({
      registrars: [createAgentRunMcpRegistrar({}, {
        forward: async () => {
          forwards += 1
          return snapshots(START)
        },
      })],
    })
    const client = new Client({ name: "agent-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const invalidInputs = [
        {
          operation: "start",
          tasks: [{ task: secret, desired_outcome: "done" }],
          session_id: "caller-session",
        },
        {
          operation: "start",
          tasks: [{ task: secret, desired_outcome: "done" }, { task: secret, desired_outcome: "done" }],
        },
        { operation: "start", tasks: [null] },
        { operation: "poll", child_ids: ["child-a", "child-a"] },
      ]
      for (const arguments_ of invalidInputs) {
        const result = await client.callTool({
          name: AGENT_RUN_MCP_TOOL_NAME,
          arguments: arguments_ as Record<string, unknown>,
        })
        expect(result.isError).toBe(true)
        expect(result.content).toEqual([{ type: "text", text: '{"error":"invalid_request"}' }])
        expect(JSON.stringify(result)).not.toContain(secret)
      }
      expect(forwards).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("collapses malformed or sensitive forwarded results to unavailable", async () => {
    const secret = "provider-route-transcript-sentinel"
    const server = createKittenMcpServer({
      registrars: [createAgentRunMcpRegistrar({}, {
        forward: async () => ({
          operation: "start",
          children: [{ child_id: "child-1", status: "running", transcript: secret }],
        }),
      })],
    })
    const client = new Client({ name: "agent-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const result = await client.callTool({ name: AGENT_RUN_MCP_TOOL_NAME, arguments: START })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: "text", text: '{"error":"unavailable"}' }])
      expect(JSON.stringify(result)).not.toContain(secret)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("preserves poll request order and rejects reordered or extra snapshot fields", () => {
    expect(serializeAgentRunResult(POLL, {
      operation: "poll",
      children: [
        { child_id: "child-b", status: "needs_input" },
        { child_id: "child-a", status: "finished", terminal_at: 123 },
      ],
    })).toEqual({
      operation: "poll",
      children: [
        { child_id: "child-b", status: "needs_input" },
        { child_id: "child-a", status: "finished", terminal_at: 123 },
      ],
    })
    expect(() => serializeAgentRunResult(POLL, {
      operation: "poll",
      children: [
        { child_id: "child-a", status: "finished" },
        { child_id: "child-b", status: "running" },
      ],
    })).toThrow("unavailable")
    expect(() => serializeAgentRunResult(START, {
      operation: "start",
      children: [{ child_id: "child-1", status: "running", route: "private" }],
    })).toThrow("unavailable")
  })
})

describe("agent_run local forwarding", () => {
  it("writes a correlated bounded frame without caller-owned identity and accepts a chunked result", async () => {
    let outbound: Record<string, unknown> | undefined
    let ended = 0
    const result = await forwardAgentRunToBridge(POLL, ENV, {
      newCallId: () => "call-1",
      connect: async ({ socket: handlers }) => {
        const socket = {
          write(data: string) {
            outbound = JSON.parse(data) as Record<string, unknown>
            const response = new TextEncoder().encode(`${JSON.stringify({
              kind: "agent_run_result",
              callId: "call-1",
              result: snapshots(POLL),
            })}\n`)
            queueMicrotask(() => {
              handlers.data(socket, response.subarray(0, 9))
              handlers.data(socket, response.subarray(9))
            })
            return data.length
          },
          end() {
            ended += 1
          },
        }
        handlers.open(socket)
        return socket
      },
    })

    expect(outbound).toEqual({
      kind: "agent_run",
      callId: "call-1",
      capability: "c".repeat(32),
      request: POLL,
    })
    expect(JSON.stringify(outbound)).not.toMatch(/parent|session|generation/)
    expect(result.children.map((child) => child.child_id)).toEqual(POLL.child_ids)
    expect(ended).toBe(1)
  })

  it.each([
    ["invalid_request", "invalid_request"],
    ["unavailable", "unavailable"],
    ["busy", "busy"],
  ] as const)("preserves the approved %s bridge error", async (category, expected) => {
    await expect(forwardAgentRunToBridge(START, ENV, {
      newCallId: () => "call-1",
      connect: responseConnect((handlers, socket) => {
        handlers.data(socket, new TextEncoder().encode(`${JSON.stringify({
          kind: "error",
          callId: "call-1",
          error: category,
        })}\n`))
      }),
    })).rejects.toThrow(expected)
  })

  it.each([
    ["malformed", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new TextEncoder().encode("not-json\n"))],
    ["uncorrelated", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new TextEncoder().encode(`${JSON.stringify({ kind: "agent_run_result", callId: "other", result: snapshots(START) })}\n`))],
    ["unknown result field", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new TextEncoder().encode(`${JSON.stringify({ kind: "agent_run_result", callId: "call-1", result: { ...snapshots(START), transcript: "secret" } })}\n`))],
    ["oversized", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new Uint8Array(MAX_AGENT_RUN_FRAME_BYTES + 1))],
    ["closed", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.close(socket)],
    ["socket error", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.error(socket)],
    ["connect error", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.connectError(socket)],
  ])("maps a %s local frame to unavailable without echoing sentinels", async (_label, respond) => {
    const secretRequest: AgentRunRequest = {
      operation: "start",
      tasks: [{ task: "task-sentinel", desired_outcome: "outcome-sentinel" }],
    }
    let message = ""
    try {
      await forwardAgentRunToBridge(secretRequest, ENV, {
        newCallId: () => "call-1",
        connect: responseConnect((handlers, socket) => respond(handlers, socket)),
      })
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain("unavailable")
    expect(message).not.toContain("task-sentinel")
    expect(message).not.toContain("outcome-sentinel")
  })

  it("maps unavailable credentials, invalid call IDs, invalid requests, and connection details generically", async () => {
    await expect(forwardAgentRunToBridge(START, {})).rejects.toThrow("unavailable")
    await expect(forwardAgentRunToBridge(START, ENV, { newCallId: () => "" })).rejects.toThrow("unavailable")
    await expect(forwardAgentRunToBridge({
      operation: "start",
      tasks: [{ task: "x".repeat(MAX_AGENT_RUN_TEXT_BYTES + 1), desired_outcome: "done" }],
    }, ENV)).rejects.toThrow("invalid_request")
    await expect(forwardAgentRunToBridge(START, ENV, {
      connect: async () => {
        throw new Error("/private/path and capability details")
      },
    })).rejects.toThrow("unavailable")
  })
})
