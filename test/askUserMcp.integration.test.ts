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
import type { ManagedWorktreeProvisioner } from "../src/app/managedWorktree.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile } from "../src/config/harnessCapability.ts"
import { evaluateExplorePolicy, EXPLORE_RESTRICTIONS } from "../src/core/explorePolicy.ts"
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
          buffers.set(socket, next.slice(newline + 1))
          const frame = JSON.parse(next.slice(0, newline)) as {
            kind: string
            callId: string
            capability: string
            form?: Record<string, unknown>
            request?: Record<string, unknown>
          }
          frames.push(frame)
          expect(frame.capability).toBe(capability)
          if (frame.kind === "ask") {
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
            return
          }
          expect(frame.kind).toBe("agent_run")
          expect(frame.request).toEqual({
            operation: "start",
            tasks: [{ task: "Inspect the bridge", desired_outcome: "Return protocol evidence" }],
          })
          socket.write(`${JSON.stringify({
            kind: "agent_run_result",
            callId: frame.callId,
            result: {
              operation: "start",
              children: [{ child_id: "integration-child", status: "running" }],
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
      const agentRun = await client.callTool({
        name: AGENT_RUN_MCP_TOOL_NAME,
        arguments: {
          operation: "start",
          tasks: [{ task: "Inspect the bridge", desired_outcome: "Return protocol evidence" }],
        },
      })
      expect(agentRun.isError).not.toBe(true)
      expect(agentRun.structuredContent).toEqual({
        operation: "start",
        children: [{ child_id: "integration-child", status: "running" }],
      })
      expect(frames.map((frame) => (frame as { kind: string }).kind)).toEqual(["ask", "agent_run"])
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
      transcriptWindowingEnabled: false,
      theme: "auto",
      editor: { kind: "system-default" },
      welcomeBanner: "off",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const pair = createInMemoryTransportPair()
    let agent!: MockAgentHandle
    let continuedOutcome: unknown
    let delegatedOutcome: unknown
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
          const [response, agentRunResponse] = await Promise.all([
            client.callTool({
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
            }),
            client.callTool({
              name: AGENT_RUN_MCP_TOOL_NAME,
              arguments: {
                operation: "start",
                tasks: [{ task: "Inspect concurrency", desired_outcome: "Return mixed-call evidence" }],
              },
            }),
          ])
          continuedOutcome = response.structuredContent
          delegatedOutcome = agentRunResponse.structuredContent
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
    let parentConnectionCreated = false
    const controller = await createSessionController({
      config,
      cwd: process.cwd(),
      createConnection(resolved) {
        if (parentConnectionCreated) return passiveAgentConnection(resolved.id)
        parentConnectionCreated = true
        connection = createAgentConnection({
          config: resolved,
          transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
          scheduler: { schedule: (flush) => flush(), dispose: () => {} },
          harnessProfiles: [certifiedProfile(resolved)],
        })
        return connection
      },
      createShellRuntime: createInMemoryShellRuntimeFactory().factory,
      managedWorktreeProvisioner: inMemoryManagedWorktrees(),
      newSessionId: () => "mixed-call-child",
      readBranch: async () => null,
      resolveExploreCapability: integrationExploreCapability,
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "ask-user-integration",
        encoder: "codex-prompt-meta-v1",
      }),
      kittenMcpExecutable: {
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
    let disposed = false

    try {
      const prompt = controller.actions.sendPrompt("ask before continuing", "codex")
      await actAsync(async () => {
        await waitUntil(
          () => controller.store.getState().overlays.clarification !== null,
          "real child clarification",
        )
      })
      const clarificationFrame = await setup.waitForFrame((frame) => frame.includes("Which deployment strategy should this turn use?"))
      expect(clarificationFrame).toContain("Custom answer:")
      expect(clarificationFrame).toContain("Type a custom answer")
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
      expect(delegatedOutcome).toEqual({
        operation: "start",
        children: [{ child_id: "mixed-call-child", status: "running" }],
      })
      expect(controller.store.getState().sessions.codex?.turns.at(-1)).toMatchObject({
        kind: "agent",
        text: "continued:submitted",
      })
      expect(connection).not.toBeNull()

      await controller.dispose()
      disposed = true
      const lateAfterDispose = await callGeneratedAgentRun(agent, {
        operation: "poll",
        child_ids: ["mixed-call-child"],
      })
      expect(lateAfterDispose.isError).toBe(true)
      expect(lateAfterDispose.structuredContent).toBeUndefined()
    } finally {
      await destroyMounted(setup.renderer)
      if (!disposed) await controller.dispose()
    }
  }, 15_000)

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
      transcriptWindowingEnabled: false,
      theme: "auto",
      editor: { kind: "system-default" },
      welcomeBanner: "off",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const pairs = {
      "claude-code": createInMemoryTransportPair(),
      codex: createInMemoryTransportPair(),
    }
    const agents = {} as Record<"claude-code" | "codex", MockAgentHandle>
    const outcomes = {} as Record<"claude-code" | "codex", unknown>
    const delegatedStarts = {} as Record<"claude-code" | "codex", Awaited<ReturnType<typeof callGeneratedAgentRun>>>
    const parentConnections = new Set<"claude-code" | "codex">()
    let childOrdinal = 0
    for (const provider of ["claude-code", "codex"] as const) {
      const fieldId = `${provider}-choice`
      const optionId = `${provider}-answer`
      agents[provider] = startMockAgent(pairs[provider].agent, {
        sessionId: `${provider}-fake-session`,
        onPrompt: async (_prompt, ctx) => {
          const [askOutcome, delegatedStart] = await Promise.all([
            callGeneratedAskUser(agents[provider], {
              fields: [{
                id: fieldId,
                question: `Question for ${provider}`,
                options: [{ id: optionId, label: `Answer for ${provider}` }],
              }],
            }),
            callGeneratedAgentRun(agents[provider], {
              operation: "start",
              tasks: [{ task: `Inspect ${provider}`, desired_outcome: `Report ${provider}` }],
            }),
          ])
          outcomes[provider] = askOutcome
          delegatedStarts[provider] = delegatedStart
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
        if (parentConnections.has(provider)) return passiveAgentConnection(provider)
        parentConnections.add(provider)
        return createAgentConnection({
          config: resolved,
          transport: () => ({ stream: pairs[provider].client, onClose: () => {}, dispose: async () => {} }),
          scheduler: { schedule: (flush) => flush(), dispose: () => {} },
          harnessProfiles: [certifiedProfile(resolved)],
        })
      },
      createShellRuntime: createInMemoryShellRuntimeFactory().factory,
      managedWorktreeProvisioner: inMemoryManagedWorktrees(),
      newSessionId: () => `provider-child-${++childOrdinal}`,
      readBranch: async () => null,
      resolveExploreCapability: integrationExploreCapability,
      resolveHarnessCapability: (resolved) => ({
        status: "supported",
        profileId: "ask-user-integration",
        encoder: resolved.id === "claude-code" ? "claude-code-prompt-meta-v1" : "codex-prompt-meta-v1",
      }),
      kittenMcpExecutable: {
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

      const childIds = (["claude-code", "codex"] as const).map((provider) => {
        const result = delegatedStarts[provider]
        expect(result.isError).not.toBe(true)
        const content = result.structuredContent as { children: Array<{ child_id: string }> }
        return content.children[0]!.child_id
      })
      expect(new Set(childIds).size).toBe(2)

      const declarations = (["claude-code", "codex"] as const).map((provider) =>
        agents[provider].newSessionRequests[0]!.mcpServers.at(-1)!
      )
      const capabilities = declarations.map((declaration) => {
        if (!("env" in declaration)) throw new Error("generated MCP declaration was not stdio")
        return declaration.env.find(({ name }) => name === ASK_USER_MCP_CAPABILITY_ENV)?.value
      })
      expect(capabilities[0]).not.toBe(capabilities[1])

      const [claudeOwn, codexOwn] = await Promise.all([
        callGeneratedAgentRun(agents["claude-code"], { operation: "poll", child_ids: [childIds[0]] }),
        callGeneratedAgentRun(agents.codex, { operation: "poll", child_ids: [childIds[1]] }),
      ])
      const [claudeCross, codexCross] = await Promise.all([
        callGeneratedAgentRun(agents["claude-code"], { operation: "poll", child_ids: [childIds[1]] }),
        callGeneratedAgentRun(agents.codex, { operation: "poll", child_ids: [childIds[0]] }),
      ])
      expect(claudeOwn.structuredContent).toEqual({
        operation: "poll",
        children: [{ child_id: childIds[0], status: "running" }],
      })
      expect(codexOwn.structuredContent).toEqual({
        operation: "poll",
        children: [{ child_id: childIds[1], status: "running" }],
      })
      expect(claudeCross.isError).toBe(true)
      expect(codexCross.isError).toBe(true)
      expect(claudeCross.structuredContent).toBeUndefined()
      expect(codexCross.structuredContent).toBeUndefined()

      await controller.actions.startNewRun()
      const staleAfterReplacement = await callGeneratedAgentRun(agents["claude-code"], {
        operation: "poll",
        child_ids: [childIds[0]],
      })
      expect(staleAfterReplacement.isError).toBe(true)
      expect(staleAfterReplacement.structuredContent).toBeUndefined()
    } finally {
      await controller.dispose()
    }
  }, 15_000)
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

async function callGeneratedAgentRun(
  agent: MockAgentHandle,
  args: Record<string, unknown>,
) {
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
  const client = new Client({ name: "agent-run-fake-acp-agent", version: "1.0.0" })
  await client.connect(transport)
  try {
    return await client.callTool({ name: AGENT_RUN_MCP_TOOL_NAME, arguments: args })
  } finally {
    await client.close()
  }
}

function passiveAgentConnection(id: AgentConnection["id"]): AgentConnection {
  return {
    id,
    async connect() {
      return { ready: true, protocolVersion: 1, canLoadSession: false }
    },
    async newSession() {
      return `${id}-child-acp`
    },
    async loadSession() {},
    async prompt() {
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async setSessionConfigOption() {
      return []
    },
    onUpdate() {
      return () => {}
    },
    onPermission() {},
    onClarification() {
      return () => {}
    },
    async dispose() {},
  }
}

function inMemoryManagedWorktrees(): ManagedWorktreeProvisioner {
  return {
    async provision({ ownerSessionId }) {
      return {
        kind: "provisioned",
        binding: {
          kind: "managed",
          id: `kw-${ownerSessionId}`,
          repoRoot: process.cwd(),
          worktreePath: join(tmpdir(), `kitten-${ownerSessionId}`),
          branch: `kitten/${ownerSessionId}`,
          baseBranch: "main",
          baseSha: "a".repeat(40),
          ownerSessionId,
          availability: "available",
        },
      }
    },
    async reconcile(binding) {
      return { kind: "available", binding }
    },
    async cleanup() {
      return { kind: "removed" }
    },
  }
}

function integrationExploreCapability(config: ResolvedAgentConfig) {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: EXPLORE_RESTRICTIONS,
    limits: { perParent: 1, global: 2 },
    attestationVersion: "two-provider-agent-run-v1",
    confirmed: { provider: config.id, model: "test-model", effort: "low" },
  })
  if (decision.kind !== "eligible") return { status: "unsupported" as const, reason: decision.reason }
  return {
    status: "supported" as const,
    policy: decision.policy,
    recipe: { ...config, args: [...config.args], env: { ...config.env } },
  }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}
