import { describe, expect, it, spyOn } from "bun:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import {
  ASK_USER_MCP_INSTRUCTIONS,
  ASK_USER_MCP_TOOL_NAME,
  createAskUserMcpRegistrar,
} from "./askUserMcp.ts"
import {
  AGENT_RUN_MCP_TOOL_NAME,
  createAgentRunMcpRegistrar,
} from "./agentRunMcp.ts"
import { createKittenMcpServer, runKittenMcp } from "./kittenMcp.ts"

describe("bundled Kitten MCP server", () => {
  it("composes agent_run beside the unchanged ask_user registrar in memory", async () => {
    const server = createKittenMcpServer({
      instructions: ASK_USER_MCP_INSTRUCTIONS,
      registrars: [
        createAskUserMcpRegistrar({}, { forward: async () => ({ kind: "skipped" }) }),
        createAgentRunMcpRegistrar({}, {
          forward: async (request) => ({
            operation: request.operation,
            children: request.operation === "start"
              ? request.tasks.map((_, index) => ({ child_id: `child-${index}`, status: "starting" }))
              : request.child_ids.map((childId) => ({ child_id: childId, status: "running" })),
          }),
        }),
      ],
    })
    const client = new Client({ name: "kitten-mcp-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    try {
      expect(client.getInstructions()).toBe(ASK_USER_MCP_INSTRUCTIONS)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        ASK_USER_MCP_TOOL_NAME,
        AGENT_RUN_MCP_TOOL_NAME,
      ])
      const askUser = tools.tools.find((tool) => tool.name === ASK_USER_MCP_TOOL_NAME)
      expect(askUser!.inputSchema).toMatchObject({
        type: "object",
        required: ["fields"],
        additionalProperties: false,
      })

      const rejected = await client.callTool({
        name: ASK_USER_MCP_TOOL_NAME,
        arguments: {
          fields: [{ id: "answer", question: "Continue?", allows_custom: true }],
          session_id: "caller-controlled",
        },
      })
      expect(rejected.isError).toBe(true)
      expect(JSON.stringify(rejected)).not.toContain("caller-controlled")
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("settles when the child transport closes without writing to stdout", async () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation((() => true) as never)
    const client = new Client({ name: "kitten-mcp-run-test", version: "1.0.0" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      const run = runKittenMcp({
        instructions: ASK_USER_MCP_INSTRUCTIONS,
        registrars: [createAskUserMcpRegistrar({}, { forward: async () => ({ kind: "cancelled" }) })],
        createTransport: () => serverTransport,
      })
      await client.connect(clientTransport)
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([ASK_USER_MCP_TOOL_NAME])
      await client.close()
      await run
      expect(stdout).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
    }
  })
})
