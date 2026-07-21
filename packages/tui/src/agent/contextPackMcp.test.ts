import { describe, expect, it } from "bun:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import { createDraft } from "../core/contextPack.ts"
import type { ContextPackMcpIpcOptions, ContextPackMcpRequest } from "./contextPackMcp.ts"
import {
  CONTEXT_PACK_MCP_INSTRUCTIONS,
  CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
  createContextPackMcpServer,
  forwardContextPackMcpRequest,
  MAX_CONTEXT_PACK_MCP_RESULT_FRAME_BYTES,
  normalizeContextPackMutation,
  normalizeContextPackWorkspaceRead,
  runContextPackMcp,
  serializeContextPackMutationResult,
} from "./contextPackMcp.ts"
import { ASK_USER_MCP_TOOL_NAME } from "./askUserMcp.ts"
import { AGENT_RUN_MCP_TOOL_NAME } from "./agentRunMcp.ts"

const draftResult = createDraft("Investigate the bridge")
if (draftResult.kind !== "created") throw new Error("draft fixture failed")
const draft = draftResult.draft

function responseFor(request: Exclude<ContextPackMcpRequest, { operation: "ask_user" }>): unknown {
  switch (request.operation) {
    case "read_draft":
      return { draft }
    case "read_workspace":
      return {
        result: {
          kind: "ready",
          artifact: {
            source: { identity: "file:1:2", digest: "a".repeat(64), bytes: 5 },
            content: "hello",
          },
        },
      }
    case "mutate_draft":
      return { result: { kind: "applied", revision: request.input.expected_revision + 1 } }
  }
}

describe("Context Pack MCP registrar", () => {
  it("advertises exactly scoped ask_user and the three strict Context Pack tools", async () => {
    const server = createContextPackMcpServer({}, {
      askUser: async () => ({ kind: "skipped" }),
      forward: async (request) => responseFor(request),
    })
    const client = new Client({ name: "context-pack-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      expect(client.getInstructions()).toBe(CONTEXT_PACK_MCP_INSTRUCTIONS)
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        ASK_USER_MCP_TOOL_NAME,
        CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
        CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      ])
      expect(listed.tools.map((tool) => tool.name)).not.toContain(AGENT_RUN_MCP_TOOL_NAME)

      for (const tool of listed.tools) {
        expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false })
      }
      expect(listed.tools.find((tool) => tool.name === CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME)?.inputSchema)
        .toMatchObject({ required: ["kind", "path", "max_bytes"] })
      expect(listed.tools.find((tool) => tool.name === CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME)?.inputSchema)
        .toMatchObject({ required: ["expected_revision", "mutation"] })
      for (const name of [
        CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
        CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      ]) {
        expect(listed.tools.find((tool) => tool.name === name)?.outputSchema)
          .toMatchObject({ type: "object", additionalProperties: false })
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("executes bounded reads, one revision-fenced mutation, and scoped ask_user", async () => {
    const requests: Array<Exclude<ContextPackMcpRequest, { operation: "ask_user" }>> = []
    const server = createContextPackMcpServer({}, {
      askUser: async () => ({ kind: "cancelled" }),
      forward: async (request) => {
        requests.push(request)
        return responseFor(request)
      },
    })
    const client = new Client({ name: "context-pack-call-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      expect((await client.callTool({
        name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        arguments: {},
      })).structuredContent).toEqual({ draft })

      expect((await client.callTool({
        name: CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
        arguments: { kind: "full_file", path: "src/index.ts", max_bytes: 4096 },
      })).structuredContent).toEqual(responseFor({
        operation: "read_workspace",
        input: { kind: "full_file", path: "src/index.ts", max_bytes: 4096 },
      }))

      expect((await client.callTool({
        name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
        arguments: {
          expected_revision: draft.revision,
          mutation: { kind: "set_brief_section", section: "architecture", text: "Layered" },
        },
      })).structuredContent).toEqual({
        result: { kind: "applied", revision: draft.revision + 1 },
      })

      expect((await client.callTool({
        name: ASK_USER_MCP_TOOL_NAME,
        arguments: {
          fields: [{ id: "choice", question: "Continue?", allows_custom: true }],
        },
      })).structuredContent).toEqual({ outcome: "cancelled" })
      expect(requests.map((request) => request.operation)).toEqual([
        "read_draft",
        "read_workspace",
        "mutate_draft",
      ])
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("rejects caller-owned route fields and every unregistered operation", async () => {
    let forwards = 0
    const server = createContextPackMcpServer({}, {
      askUser: async () => ({ kind: "skipped" }),
      forward: async (request) => {
        forwards += 1
        return responseFor(request)
      },
    })
    const client = new Client({ name: "context-pack-denial-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      const denied = await client.callTool({
        name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        arguments: { parent_id: "other-session" },
      })
      expect(denied.isError).toBe(true)
      expect(forwards).toBe(0)

      for (const forbidden of [
        "agent_run",
        "shell",
        "git",
        "external_mcp",
        "context_pack.seal",
        "context_pack.send",
        "context_pack.export",
        "approval",
      ]) {
        const result = await client.callTool({ name: forbidden, arguments: {} })
        expect(result.isError).toBe(true)
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("normalizes every bounded read arm and closed mutation result", () => {
    expect(normalizeContextPackWorkspaceRead({
      kind: "file_slice",
      path: "src/index.ts",
      max_bytes: 64,
      range: { start_line: 2, end_line: 4 },
    })).toEqual({
      request: { kind: "file_slice", path: "src/index.ts", range: { startLine: 2, endLine: 4 } },
      maxBytes: 64,
    })
    expect(normalizeContextPackWorkspaceRead({
      kind: "diff",
      path: "src/index.ts",
      max_bytes: 128,
      scope: "staged",
    })).toEqual({ request: { kind: "diff", path: "src/index.ts", scope: "staged" }, maxBytes: 128 })
    expect(normalizeContextPackMutation({
      expected_revision: 2,
      mutation: { kind: "remove_selection", selectionKey: "full_file:src/index.ts:file:1" },
    })).toEqual({
      readRevision: 2,
      mutation: { kind: "remove_selection", selectionKey: "full_file:src/index.ts:file:1" },
    })
    expect(serializeContextPackMutationResult({
      kind: "stale",
      readRevision: 1,
      currentRevision: 2,
    })).toEqual({ result: { kind: "stale", expected_revision: 1, current_revision: 2 } })
    expect(serializeContextPackMutationResult({
      kind: "invalid",
      issues: [{ code: "invalid_path", selectionIndex: 3 }],
    })).toEqual({ result: { kind: "invalid", issues: [{ code: "invalid_path", selection_index: 3 }] } })
  })

  it("forwards authenticated IPC frames and rejects malformed or oversized replies", async () => {
    const env = {
      KITTEN_CONTEXT_PACK_ENDPOINT: "/tmp/context.sock",
      KITTEN_CONTEXT_PACK_CAPABILITY: "c".repeat(32),
    }
    const connect = async ({ socket }: Parameters<NonNullable<ContextPackMcpIpcOptions["connect"]>>[0]) => {
      const peer = {
        write(data: string) {
          const frame = JSON.parse(data) as { callId: string; request: { operation: string } }
          socket.data(peer, new TextEncoder().encode(`${JSON.stringify({
            kind: "context_pack_result",
            callId: frame.callId,
            operation: frame.request.operation,
            result: { draft },
          })}\n`))
          return data.length
        },
        end() {},
      }
      socket.open(peer)
      return peer
    }
    expect(await forwardContextPackMcpRequest(
      { operation: "read_draft", input: {} },
      env,
      { connect, newCallId: () => "call-1" },
    )).toEqual({ draft })

    const failingConnect = (payload: string) => async ({ socket }: Parameters<NonNullable<ContextPackMcpIpcOptions["connect"]>>[0]) => {
      const peer = {
        write(data: string) {
          socket.data(peer, new TextEncoder().encode(payload.replace("CALL", (JSON.parse(data) as { callId: string }).callId)))
          return data.length
        },
        end() {},
      }
      socket.open(peer)
      return peer
    }
    expect(forwardContextPackMcpRequest(
      { operation: "read_draft", input: {} },
      env,
      { connect: failingConnect('{"kind":"error","callId":"CALL","error":"busy"}\n') },
    )).rejects.toThrow("busy")
    expect(forwardContextPackMcpRequest(
      { operation: "read_draft", input: {} },
      env,
      { connect: failingConnect("not-json\n") },
    )).rejects.toThrow("unavailable")
    expect(forwardContextPackMcpRequest(
      { operation: "read_draft", input: {} },
      env,
      { connect: failingConnect(`${"x".repeat(MAX_CONTEXT_PACK_MCP_RESULT_FRAME_BYTES + 1)}\n`) },
    )).rejects.toThrow("unavailable")
    expect(forwardContextPackMcpRequest(
      { operation: "read_draft", input: {} },
      {},
    )).rejects.toThrow("unavailable")
  })

  it("runs the isolated server until its transport closes", async () => {
    const client = new Client({ name: "context-pack-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const running = runContextPackMcp({}, {
      askUser: async () => ({ kind: "skipped" }),
      forward: async (request) => responseFor(request),
      createTransport: () => serverTransport,
    })
    await client.connect(clientTransport)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      ASK_USER_MCP_TOOL_NAME,
      CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
      CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
      CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
    ])
    await client.close()
    await running
  })
})
