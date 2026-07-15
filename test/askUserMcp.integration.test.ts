import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js"

import {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  ASK_USER_MCP_MODE_FLAG,
  ASK_USER_MCP_TOOL_NAME,
} from "../src/agent/askUserMcp.ts"
import { AGENT_RUN_MCP_TOOL_NAME } from "../src/agent/agentRunMcp.ts"
import { createAgentConnection, type AgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController } from "../src/app/controller.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile } from "../src/config/harnessCapability.ts"
import type { AppConfig, ResolvedAgentConfig } from "../src/core/types.ts"
import { createInMemoryShellRuntimeFactory } from "../src/shell/shellRuntime.ts"
import { cockpitElement } from "../src/ui/main.tsx"
import { testRender, actAsync, destroyMounted } from "./reactTui.ts"
import { startMockAgent, type MockAgentHandle } from "./mockAgent.ts"

const cleanup: Array<() => void> = []

afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

describe("ask_user same-binary child", () => {
  it("uses real MCP stdio and authenticated IPC while keeping stdout protocol-only", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-ask-user-child-"))
    chmodSync(directory, 0o700)
    const endpoint = join(directory, "bridge.sock")
    const capability = "integration-capability-00000000000000000000"
    const frames: unknown[] = []
    const buffers = new Map<object, string>()
    const listener = Bun.listen<undefined>({
      unix: endpoint,
      socket: {
        open(socket) {
          buffers.set(socket, "")
        },
        data(socket, data) {
          const next = `${buffers.get(socket) ?? ""}${Buffer.from(data).toString("utf8")}`
          const newline = next.indexOf("\n")
          if (newline < 0) {
            buffers.set(socket, next)
            return
          }
          const frame = JSON.parse(next.slice(0, newline)) as {
            kind: string
            callId: string
            capability: string
            form: Record<string, unknown>
          }
          frames.push(frame)
          expect(frame.kind).toBe("ask")
          expect(frame.capability).toBe(capability)
          expect(frame.form).not.toHaveProperty("timeout")
          expect(frame.form).not.toHaveProperty("session_id")
          socket.write(`${JSON.stringify({
            kind: "result",
            callId: frame.callId,
            outcome: {
              kind: "submitted",
              answers: { strategy: { selectedOptionIds: ["safe"], customText: "after backup" } },
            },
          })}\n`)
        },
        close(socket) {
          buffers.delete(socket)
        },
      },
    })
    cleanup.push(() => {
      listener.stop(true)
      rmSync(directory, { recursive: true, force: true })
    })

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", join(process.cwd(), "src/index.ts"), ASK_USER_MCP_MODE_FLAG],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        [ASK_USER_MCP_ENDPOINT_ENV]: endpoint,
        [ASK_USER_MCP_CAPABILITY_ENV]: capability,
      },
      stderr: "pipe",
    })
    let stderr = ""
    transport.stderr?.on("data", (chunk) => {
      stderr += String(chunk)
    })
    const client = new Client({ name: "kitten-integration-test", version: "1.0.0" })
    await client.connect(transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        ASK_USER_MCP_TOOL_NAME,
        AGENT_RUN_MCP_TOOL_NAME,
      ])
      const response = await client.callTool({
        name: ASK_USER_MCP_TOOL_NAME,
        arguments: {
          title: "Migration decision",
          fields: [{
            id: "strategy",
            question: "How should the migration proceed?",
            options: [{ id: "safe", label: "Back up first" }],
          }],
        },
      })
      expect(response.isError).not.toBe(true)
      expect(response.structuredContent).toEqual({
        outcome: "submitted",
        answers: {
          strategy: {
            selected_option_ids: ["safe"],
            custom_text: "after backup",
            values: ["safe", "after backup"],
          },
        },
      })
      expect(frames).toHaveLength(1)
      expect(stderr).toBe("")
    } finally {
      await client.close()
    }
  })

  it("continues the same fake-ACP prompt after the mounted cockpit answers the real child", async () => {
    const config: AppConfig = {
      providers: {
        "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
        codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
        cursor: { displayName: "Cursor", command: "agent", args: ["acp"], env: {} },
      },
      providerDefaults: {},
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Codex integration" }],
      mcpServers: [
        { name: "user-first", command: process.execPath, args: ["--version"], env: {} },
        { name: "user-second", command: process.execPath, args: ["--help"], env: {} },
      ],
      shell: { enabled: false, command: "/bin/sh", scrollback: 100 },
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: false,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "off",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const pair = createInMemoryTransportPair()
    let agent!: MockAgentHandle
    let continuedOutcome: unknown
    agent = startMockAgent(pair.agent, {
      sessionId: "fake-acp-session",
      onPrompt: async (_prompt, ctx) => {
        const declaration = agent.newSessionRequests[0]!.mcpServers.at(-1)!
        if (!("command" in declaration)) throw new Error("generated MCP declaration was not stdio")
        expect(agent.newSessionRequests[0]!.mcpServers.map((server) => server.name)).toEqual([
          "user-first",
          "user-second",
          "kitten-ask-user",
        ])
        const transport = new StdioClientTransport({
          command: declaration.command,
          args: declaration.args,
          cwd: process.cwd(),
          env: {
            ...getDefaultEnvironment(),
            ...Object.fromEntries(declaration.env.map(({ name, value }) => [name, value])),
          },
          stderr: "pipe",
        })
        const client = new Client({ name: "fake-acp-agent", version: "1.0.0" })
        await client.connect(transport)
        try {
          const response = await client.callTool({
            name: ASK_USER_MCP_TOOL_NAME,
            arguments: {
              title: "Deployment choice",
              fields: [{
                id: "strategy",
                question: "Which deployment strategy should this turn use?",
                options: [
                  { id: "safe", label: "Safe rollout" },
                  { id: "fast", label: "Fast rollout" },
                ],
              }],
            },
          })
          continuedOutcome = response.structuredContent
          const outcome = response.structuredContent as { outcome?: unknown } | undefined
          await ctx.update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `continued:${String(outcome?.outcome)}` },
          })
        } finally {
          await client.close()
        }
      },
    })

    let connection: AgentConnection | null = null
    const controller = await createSessionController({
      config,
      cwd: process.cwd(),
      createConnection(resolved) {
        connection = createAgentConnection({
          config: resolved,
          transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
          scheduler: { schedule: (flush) => flush(), dispose: () => {} },
          harnessProfiles: [certifiedProfile(resolved)],
        })
        return connection
      },
      createShellRuntime: createInMemoryShellRuntimeFactory().factory,
      readBranch: async () => null,
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "ask-user-integration",
        encoder: "codex-prompt-meta-v1",
      }),
      askUserMcpExecutable: {
        command: process.execPath,
        args: ["run", join(process.cwd(), "src/index.ts")],
      },
      sendInitialTasks: false,
    })
    const setup = await testRender(cockpitElement(controller, undefined, "none"), {
      width: 90,
      height: 28,
      kittyKeyboard: true,
    })

    try {
      const prompt = controller.actions.sendPrompt("ask before continuing", "codex")
      await actAsync(async () => {
        await waitUntil(
          () => controller.store.getState().overlays.clarification !== null,
          "real child clarification",
        )
      })
      await setup.waitForFrame((frame) => frame.includes("Which deployment strategy should this turn use?"))
      await actAsync(() => {
        setup.mockInput.pressEnter()
      })
      expect(await prompt).toEqual({ stopReason: "end_turn" })
      expect(continuedOutcome).toEqual({
        outcome: "submitted",
        answers: {
          strategy: {
            selected_option_ids: ["safe"],
            custom_text: null,
            values: ["safe"],
          },
        },
      })
      expect(controller.store.getState().sessions.codex?.turns.at(-1)).toMatchObject({
        kind: "agent",
        text: "continued:submitted",
      })
      expect(connection).not.toBeNull()
    } finally {
      await destroyMounted(setup.renderer)
      await controller.dispose()
    }
  })

  it("keeps two concurrent fake-ACP child calls isolated and preserves user MCP order", async () => {
    const config: AppConfig = {
      providers: {
        "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
        codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
        cursor: { displayName: "Cursor", command: "agent", args: ["acp"], env: {} },
      },
      providerDefaults: {},
      sessions: [
        { provider: "claude-code", cwd: process.cwd(), title: "Claude" },
        { provider: "codex", cwd: process.cwd(), title: "Codex" },
      ],
      mcpServers: [
        { name: "ordered-a", command: process.execPath, args: ["--version"], env: {} },
        { name: "ordered-b", command: process.execPath, args: ["--help"], env: {} },
      ],
      shell: { enabled: false, command: "/bin/sh", scrollback: 100 },
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: false,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "off",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const pairs = {
      "claude-code": createInMemoryTransportPair(),
      codex: createInMemoryTransportPair(),
    }
    const agents = {} as Record<"claude-code" | "codex", MockAgentHandle>
    const outcomes = {} as Record<"claude-code" | "codex", unknown>
    for (const provider of ["claude-code", "codex"] as const) {
      const fieldId = `${provider}-choice`
      const optionId = `${provider}-answer`
      agents[provider] = startMockAgent(pairs[provider].agent, {
        sessionId: `${provider}-fake-session`,
        onPrompt: async (_prompt, ctx) => {
          outcomes[provider] = await callGeneratedAskUser(agents[provider], {
            fields: [{
              id: fieldId,
              question: `Question for ${provider}`,
              options: [{ id: optionId, label: `Answer for ${provider}` }],
            }],
          })
          await ctx.update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `continued:${provider}` },
          })
        },
      })
    }

    const controller = await createSessionController({
      config,
      cwd: process.cwd(),
      createConnection(resolved) {
        const provider = resolved.id as "claude-code" | "codex"
        return createAgentConnection({
          config: resolved,
          transport: () => ({ stream: pairs[provider].client, onClose: () => {}, dispose: async () => {} }),
          scheduler: { schedule: (flush) => flush(), dispose: () => {} },
          harnessProfiles: [certifiedProfile(resolved)],
        })
      },
      createShellRuntime: createInMemoryShellRuntimeFactory().factory,
      readBranch: async () => null,
      resolveHarnessCapability: (resolved) => ({
        status: "supported",
        profileId: "ask-user-integration",
        encoder: resolved.id === "claude-code" ? "claude-code-prompt-meta-v1" : "codex-prompt-meta-v1",
      }),
      askUserMcpExecutable: {
        command: process.execPath,
        args: ["run", join(process.cwd(), "src/index.ts")],
      },
      sendInitialTasks: false,
    })

    try {
      const prompts = [
        controller.actions.sendPrompt("ask concurrently", "claude-code"),
        controller.actions.sendPrompt("ask concurrently", "codex"),
      ]
      const seen = new Set<string>()
      for (let index = 0; index < 2; index++) {
        await waitUntil(() => {
          const requestId = controller.store.getState().overlays.clarification?.requestId
          return requestId !== undefined && !seen.has(requestId)
        }, `concurrent clarification ${index + 1}`)
        const overlay = controller.store.getState().overlays.clarification!
        seen.add(overlay.requestId)
        const field = overlay.payload.fields[0]!
        controller.actions.respondClarification(overlay.requestId, overlay.generation, {
          kind: "submitted",
          answers: { [field.id]: { selectedOptionIds: [field.options![0]!.id] } },
        })
      }
      expect(await Promise.all(prompts)).toEqual([
        { stopReason: "end_turn" },
        { stopReason: "end_turn" },
      ])

      expect(outcomes["claude-code"]).toEqual({
        outcome: "submitted",
        answers: {
          "claude-code-choice": {
            selected_option_ids: ["claude-code-answer"],
            custom_text: null,
            values: ["claude-code-answer"],
          },
        },
      })
      expect(outcomes.codex).toEqual({
        outcome: "submitted",
        answers: {
          "codex-choice": {
            selected_option_ids: ["codex-answer"],
            custom_text: null,
            values: ["codex-answer"],
          },
        },
      })
      for (const provider of ["claude-code", "codex"] as const) {
        expect(agents[provider].newSessionRequests[0]!.mcpServers.map((server) => server.name)).toEqual([
          "ordered-a",
          "ordered-b",
          "kitten-ask-user",
        ])
        expect(controller.store.getState().sessions[provider]?.turns.at(-1)).toMatchObject({
          kind: "agent",
          text: `continued:${provider}`,
        })
      }
    } finally {
      await controller.dispose()
    }
  })
})

function certifiedProfile(config: ResolvedAgentConfig): CertifiedHarnessProfile {
  return {
    profileId: "ask-user-integration",
    encoder: config.id === "claude-code" ? "claude-code-prompt-meta-v1" : "codex-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: config.id,
      command: config.command,
      args: [...config.args],
      env: { ...config.env },
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "0.13.0",
    },
  }
}

async function callGeneratedAskUser(
  agent: MockAgentHandle,
  args: Record<string, unknown>,
): Promise<unknown> {
  const declaration = agent.newSessionRequests[0]!.mcpServers.at(-1)!
  if (!("command" in declaration)) throw new Error("generated MCP declaration was not stdio")
  const transport = new StdioClientTransport({
    command: declaration.command,
    args: declaration.args,
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(declaration.env.map(({ name, value }) => [name, value])),
    },
    stderr: "pipe",
  })
  const client = new Client({ name: "concurrent-fake-acp-agent", version: "1.0.0" })
  await client.connect(transport)
  try {
    return (await client.callTool({ name: ASK_USER_MCP_TOOL_NAME, arguments: args })).structuredContent
  } finally {
    await client.close()
  }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}
