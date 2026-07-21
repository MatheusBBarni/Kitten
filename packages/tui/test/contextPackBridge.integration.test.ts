import { describe, expect, it } from "bun:test"
import { join } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

import { applyBuilderMutation, createDraft } from "../src/core/contextPack.ts"
import type { ContextPackMutationResult, DraftContextPack } from "../src/core/types.ts"
import {
  ASK_USER_MCP_TOOL_NAME,
} from "../src/agent/askUserMcp.ts"
import { AGENT_RUN_MCP_TOOL_NAME } from "../src/agent/agentRunMcp.ts"
import {
  CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
} from "../src/agent/contextPackMcp.ts"
import {
  createContextPackBridge,
  type ContextPackBridgeFacade,
  type ContextPackBridgeRoute,
} from "../src/app/contextPackBridge.ts"

describe("Context Pack same-binary bridge integration", () => {
  it("keeps real stdio isolated, fences revisions, and rejects forbidden or late calls", async () => {
    const created = createDraft("Inspect the dedicated route")
    if (created.kind !== "created") throw new Error("draft fixture failed")
    let draft: DraftContextPack = created.draft
    let live = true
    let mutations = 0
    const route: ContextPackBridgeRoute = {
      parentId: "parent",
      childId: "child",
      parentGeneration: 1,
      childGeneration: 1,
      draftRevision: draft.revision,
      workspaceRoot: process.cwd(),
    }
    const facade: ContextPackBridgeFacade = {
      authorize: ({ route: candidate, workspaceRoot }) => live
        && JSON.stringify(candidate) === JSON.stringify(route)
        && workspaceRoot === process.cwd(),
      readDraft: () => draft,
      readWorkspace: async (_route, _root, request) => ({
        kind: "ready",
        artifact: {
          source: { identity: "file:1:2", digest: "a".repeat(64), bytes: 5 },
          content: request.path === "src/index.ts" ? "hello" : "other",
        },
      }),
      mutateDraft: (_route, input): ContextPackMutationResult => {
        mutations += 1
        const result = applyBuilderMutation(draft, input)
        if (result.kind === "applied") draft = result.draft
        return result
      },
      askUser: async () => ({ kind: "skipped" }),
      dispose: () => { live = false },
    }

    const bridge = createContextPackBridge({
      executablePath: process.execPath,
      executableArgs: ["run", join(process.cwd(), "packages/tui/src/index.ts")],
    })
    const config = bridge.register({ route, facade })
    const transport = new StdioClientTransport({
      command: config.command,
      args: [...config.args],
      cwd: process.cwd(),
      env: { ...getDefaultEnvironment(), ...config.env },
      stderr: "pipe",
    })
    let stderr = ""
    transport.stderr?.on("data", (chunk) => { stderr += String(chunk) })
    const client = new Client({ name: "context-pack-integration", version: "1.0.0" })
    await client.connect(transport)
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        ASK_USER_MCP_TOOL_NAME,
        CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
        CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      ])
      expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(AGENT_RUN_MCP_TOOL_NAME)

      expect((await client.callTool({
        name: CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
        arguments: { kind: "full_file", path: "src/index.ts", max_bytes: 128 },
      })).structuredContent).toMatchObject({
        result: { kind: "ready", artifact: { content: "hello" } },
      })

      const initialRevision = draft.revision
      expect((await client.callTool({
        name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
        arguments: {
          expected_revision: initialRevision,
          mutation: { kind: "set_brief_section", section: "relationships", text: "Bound" },
        },
      })).structuredContent).toEqual({
        result: { kind: "applied", revision: initialRevision + 1 },
      })
      expect((await client.callTool({
        name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
        arguments: {
          expected_revision: initialRevision,
          mutation: { kind: "set_brief_section", section: "relationships", text: "Stale" },
        },
      })).structuredContent).toEqual({
        result: {
          kind: "stale",
          expected_revision: initialRevision,
          current_revision: initialRevision + 1,
        },
      })
      expect(mutations).toBe(1)

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
        expect((await client.callTool({ name: forbidden, arguments: {} })).isError).toBe(true)
      }
      expect((await client.callTool({
        name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        arguments: { parent_id: "cross-session" },
      })).isError).toBe(true)

      bridge.revoke(route, "parent_generation_changed")
      expect((await client.callTool({
        name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
        arguments: {},
      })).isError).toBe(true)
      expect((await client.callTool({
        name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
        arguments: {
          expected_revision: draft.revision,
          mutation: { kind: "set_brief_section", section: "architecture", text: "Late" },
        },
      })).isError).toBe(true)
      expect(mutations).toBe(1)
      expect(stderr).toBe("")
    } finally {
      await client.close()
      await bridge.dispose()
    }
  })
})
