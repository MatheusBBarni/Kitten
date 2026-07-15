import { describe, expect, it } from "bun:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import type { ClarificationOutcome, ClarificationPayload } from "../core/types.ts"
import {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  ASK_USER_MCP_TOOL_NAME,
  askUserInputSchema,
  createAskUserMcpServer,
  forwardAskUserToBridge,
  MAX_ASK_USER_FIELDS,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_TEXT_BYTES,
  normalizeAskUserInput,
  runAskUserMcp,
  serializeAskUserOutcome,
  type AskUserIpcOptions,
  type AskUserMcpInput,
} from "./askUserMcp.ts"

type TestSocketHandlers = Parameters<NonNullable<AskUserIpcOptions["connect"]>>[0]["socket"]
type TestSocket = Parameters<TestSocketHandlers["data"]>[0]

const INPUT: AskUserMcpInput = {
  title: "Migration decision",
  context: "The current database is serving production traffic.",
  fields: [{
    id: "strategy",
    header: "Strategy",
    question: "How should the migration proceed?",
    context: "Choose the safest viable path.",
    options: [
      { id: "safe", label: "Back up first", description: "Create a verified snapshot." },
      { id: "fast", label: "Proceed now" },
    ],
    allows_custom: true,
  }],
}

const SUBMITTED: ClarificationOutcome = {
  kind: "submitted",
  answers: { strategy: { selectedOptionIds: ["safe"], customText: "with verification" } },
}

describe("ask_user MCP schema", () => {
  it("accepts the published field, option, and UTF-8 text boundaries", () => {
    const fields = Array.from({ length: MAX_ASK_USER_FIELDS }, (_, fieldIndex) => ({
      id: `field-${fieldIndex}`,
      question: "x".repeat(MAX_ASK_USER_TEXT_BYTES),
      options: Array.from({ length: MAX_ASK_USER_OPTIONS }, (_, optionIndex) => ({
        id: `option-${optionIndex}`,
        label: `Option ${optionIndex}`,
      })),
      allows_multiple: fieldIndex % 2 === 0,
    }))
    expect(askUserInputSchema.safeParse({ title: "x".repeat(MAX_ASK_USER_TEXT_BYTES), fields }).success).toBe(true)
  })

  it.each([
    ["empty form", { fields: [] }],
    ["oversized text", { fields: [{ id: "field", question: "🔥".repeat(1_025), allows_custom: true }] }],
    ["too many fields", { fields: Array.from({ length: MAX_ASK_USER_FIELDS + 1 }, (_, index) => ({ id: `f-${index}`, question: "Question", allows_custom: true })) }],
    ["too many options", { fields: [{ id: "field", question: "Question", options: Array.from({ length: MAX_ASK_USER_OPTIONS + 1 }, (_, index) => ({ id: `o-${index}`, label: "Option" })) }] }],
    ["duplicate field id", { fields: [{ id: "same", question: "One", allows_custom: true }, { id: "same", question: "Two", allows_custom: true }] }],
    ["duplicate option id", { fields: [{ id: "field", question: "Question", options: [{ id: "same", label: "One" }, { id: "same", label: "Two" }] }] }],
    ["impossible field", { fields: [{ id: "field", question: "Question" }] }],
    ["caller timeout", { ...INPUT, timeout: 1 }],
    ["caller session identity", { ...INPUT, session_id: "private-session" }],
  ])("rejects %s", (_label, value) => {
    const result = askUserInputSchema.safeParse(value)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain("private-session")
      expect(JSON.stringify(result.error.issues)).not.toContain("🔥")
    }
  })

  it("normalizes the form without adding caller-controlled lifecycle identity", () => {
    expect(normalizeAskUserInput(INPUT)).toEqual({
      title: INPUT.title!,
      context: INPUT.context!,
      prompt: INPUT.title!,
      fields: [{
        id: "strategy",
        label: "Strategy",
        description: "How should the migration proceed?\nChoose the safest viable path.",
        required: true,
        mode: "single",
        options: INPUT.fields[0]!.options!,
        allowsCustom: true,
      }],
    })
  })
})

describe("ask_user MCP server and serialization", () => {
  it("advertises exactly one tool and forwards a valid submitted form exactly once", async () => {
    const forwarded: ClarificationPayload[] = []
    const server = createAskUserMcpServer({}, {
      forward: async (form) => {
        forwarded.push(form)
        return SUBMITTED
      },
    })
    const client = new Client({ name: "ask-user-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([ASK_USER_MCP_TOOL_NAME])
      expect(tools.tools[0]!.inputSchema).toMatchObject({
        type: "object",
        required: ["fields"],
        additionalProperties: false,
        properties: {
          fields: { type: "array", minItems: 1, maxItems: MAX_ASK_USER_FIELDS },
        },
      })
      const result = await client.callTool({ name: ASK_USER_MCP_TOOL_NAME, arguments: INPUT })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({
        outcome: "submitted",
        answers: {
          strategy: {
            selected_option_ids: ["safe"],
            custom_text: "with verification",
            values: ["safe", "with verification"],
          },
        },
      })
      expect(forwarded).toHaveLength(1)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("returns a content-free schema error without forwarding rejected content", async () => {
    let forwards = 0
    const secret = "question-secret-that-must-not-return"
    const server = createAskUserMcpServer({}, {
      forward: async () => {
        forwards += 1
        return { kind: "cancelled" }
      },
    })
    const client = new Client({ name: "ask-user-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const result = await client.callTool({
        name: ASK_USER_MCP_TOOL_NAME,
        arguments: { fields: [{ id: "field", question: secret }] },
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).not.toContain(secret)
      expect(forwards).toBe(0)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it.each([
    [{ kind: "skipped" } as const, { outcome: "skipped" } as const],
    [{ kind: "timed_out" } as const, { outcome: "timed_out" } as const],
    [{ kind: "cancelled" } as const, { outcome: "cancelled" } as const],
  ])("preserves the %s terminal category", (outcome, expected) => {
    expect(serializeAskUserOutcome(outcome)).toEqual(expected)
  })

  it("collapses private IPC connection failures to one generic category", async () => {
    const form = normalizeAskUserInput(INPUT)
    await expect(forwardAskUserToBridge(form, {
      [ASK_USER_MCP_ENDPOINT_ENV]: "/private/secret.sock",
      [ASK_USER_MCP_CAPABILITY_ENV]: "c".repeat(32),
    }, {
      connect: async () => {
        throw new Error("private connection details")
      },
    })).rejects.toThrow("unavailable")
  })

  it("correlates a chunked IPC result and closes the local stream", async () => {
    const form = normalizeAskUserInput(INPUT)
    let ended = 0
    const outcome = await forwardAskUserToBridge(form, {
      [ASK_USER_MCP_ENDPOINT_ENV]: "/private/bridge.sock",
      [ASK_USER_MCP_CAPABILITY_ENV]: "c".repeat(32),
    }, {
      newCallId: () => "call-1",
      connect: async ({ socket: handlers }) => {
        const socket = {
          write(data: string) {
            const request = JSON.parse(data) as { callId: string }
            const response = new TextEncoder().encode(`${JSON.stringify({
              kind: "result",
              callId: request.callId,
              outcome: SUBMITTED,
            })}\n`)
            queueMicrotask(() => {
              handlers.data(socket, response.subarray(0, 7))
              handlers.data(socket, response.subarray(7))
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
    expect(outcome).toEqual(SUBMITTED)
    expect(ended).toBe(1)
  })

  it.each([
    ["error frame", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new TextEncoder().encode('{"kind":"error","callId":"call-1","error":"busy"}\n')), "busy"],
    ["malformed frame", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.data(socket, new TextEncoder().encode("not-json\n")), "unavailable"],
    ["closed stream", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.close(socket), "unavailable"],
    ["socket error", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.error(socket), "unavailable"],
    ["connect error", (handlers: TestSocketHandlers, socket: TestSocket) => handlers.connectError(socket), "unavailable"],
  ])("returns a generic category for an IPC %s", async (_label, respond, expected) => {
    const form = normalizeAskUserInput(INPUT)
    await expect(forwardAskUserToBridge(form, {
      [ASK_USER_MCP_ENDPOINT_ENV]: "/private/bridge.sock",
      [ASK_USER_MCP_CAPABILITY_ENV]: "c".repeat(32),
    }, {
      newCallId: () => "call-1",
      connect: async ({ socket: handlers }) => {
        const socket = { write: () => 1, end() {} }
        handlers.open(socket)
        queueMicrotask(() => respond(handlers, socket))
        return socket
      },
    })).rejects.toThrow(expected)
  })

  it("rejects missing credentials, invalid correlation IDs, and oversized frames generically", async () => {
    const form = normalizeAskUserInput(INPUT)
    await expect(forwardAskUserToBridge(form, {})).rejects.toThrow("unavailable")
    await expect(forwardAskUserToBridge(form, {
      [ASK_USER_MCP_ENDPOINT_ENV]: "/private/bridge.sock",
      [ASK_USER_MCP_CAPABILITY_ENV]: "c".repeat(32),
    }, { newCallId: () => "" })).rejects.toThrow("unavailable")
    await expect(forwardAskUserToBridge({ ...form, prompt: "x".repeat(70_000) }, {
      [ASK_USER_MCP_ENDPOINT_ENV]: "/private/bridge.sock",
      [ASK_USER_MCP_CAPABILITY_ENV]: "c".repeat(32),
    })).rejects.toThrow("invalid_request")
  })

  it("waits for the injected transport to close before child mode returns", async () => {
    const client = new Client({ name: "ask-user-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const run = runAskUserMcp({}, {
      createTransport: () => serverTransport,
      forward: async () => ({ kind: "skipped" }),
    })
    await client.connect(clientTransport)
    expect((await client.listTools()).tools).toHaveLength(1)
    await client.close()
    await run
  })
})
