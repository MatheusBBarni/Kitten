import { describe, expect, test } from "bun:test";
import { TransformStream } from "node:stream/web";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type SessionConfigOption,
  type Stream,
} from "@agentclientprotocol/sdk";
import type { AttemptGeneration, AttemptId, ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "./contracts.ts";
import {
  createDesktopAcpConnectionFactory,
  type DesktopAcpRuntimeProfile,
  type DesktopAcpTransport,
} from "./desktopAcpAdapter.ts";

const PROFILE_ID = "desktop-codex" as ProfileId;
const RUNTIME: DesktopAcpRuntimeProfile = {
  command: "npx",
  args: ["-y", "codex-acp@1.0.0"],
  env: {},
  profile: {
    profileId: PROFILE_ID,
    provider: "codex",
    models: ["gpt-5.6-luna"],
    efforts: ["high"],
    readiness: { ready: true, profileId: PROFILE_ID, protocolVersion: PROTOCOL_VERSION },
    certification: { recipeId: "codex-acp", adapterVersion: "1.0.0", checkedAt: 10 },
  } satisfies CertifiedDirectAcpProfile,
};

function transportPair(): { readonly client: Stream; readonly agent: Stream } {
  const clientToAgent = new TransformStream<unknown, unknown>();
  const agentToClient = new TransformStream<unknown, unknown>();
  return {
    client: {
      writable: clientToAgent.writable,
      readable: agentToClient.readable,
    } as unknown as Stream,
    agent: {
      writable: agentToClient.writable,
      readable: clientToAgent.readable,
    } as unknown as Stream,
  };
}

function selectOption(id: string, category: string, currentValue: string, values: readonly string[]): SessionConfigOption {
  return {
    type: "select",
    id,
    name: id,
    category,
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

function sessionInput() {
  return {
    attemptId: "attempt-desktop-acp" as AttemptId,
    generation: 1 as AttemptGeneration,
    cwd: "/tmp/kitten-card",
    model: "gpt-5.6-luna",
    effort: "high",
    skillContent: "Always verify the result.",
  };
}

describe("desktop direct ACP adapter", () => {
  test("opens a fresh configured session, forwards normalized activity, and closes its transport", async () => {
    const pair = transportPair();
    const prompts: string[] = [];
    const configChanges: Array<{ readonly configId: string; readonly value: string }> = [];
    const sessionRequests: unknown[] = [];
    let closes = 0;
    let cancellations = 0;
    let agentConnection!: AgentSideConnection;
    const configOptions = [
      selectOption("model", "model", "default", ["default", "gpt-5.6-luna"]),
      selectOption("reasoning", "reasoning", "medium", ["medium", "high"]),
    ];
    const agent: Agent = {
      initialize: () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        agentInfo: { name: "desktop-test-agent", version: "1.0.0" },
      }),
      newSession: (request) => {
        sessionRequests.push(request);
        return { sessionId: "fresh-desktop-session", configOptions };
      },
      setSessionConfigOption: (request) => {
        configChanges.push({ configId: request.configId, value: String(request.value) });
        return { configOptions };
      },
      async prompt(request) {
        prompts.push(request.prompt[0]?.type === "text" ? request.prompt[0].text : "");
        await agentConnection.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "duplicate operator text" } },
        });
        await agentConnection.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } },
        });
        await agentConnection.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "read-1", title: "Read file", kind: "read", status: "in_progress" },
        });
        await agentConnection.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "plan", entries: [{ content: "Verify", status: "pending", priority: "high" }] },
        });
        await agentConnection.sessionUpdate({
          sessionId: request.sessionId,
          update: { sessionUpdate: "usage_update", used: 12, size: 100 },
        });
        return { stopReason: "end_turn" };
      },
      authenticate: () => ({}),
      cancel: () => { cancellations += 1; },
    };
    agentConnection = new AgentSideConnection(() => agent, pair.agent);
    const transport: DesktopAcpTransport = {
      stream: pair.client,
      async close() { closes += 1; },
    };
    const factory = createDesktopAcpConnectionFactory([RUNTIME], () => transport, {
      command: "/usr/local/bin/bun",
      args: ["/app/desktop.js", "--kitten-desktop-ask-user-mcp"],
    });

    const connection = await factory.connect({
      profileId: PROFILE_ID,
      recipeId: "codex-acp",
      adapterVersion: "1.0.0",
    });
    const activities: unknown[] = [];
    const unsubscribe = connection.subscribeActivity((activity) => { activities.push(activity); });
    const session = await connection.newSession({
      ...sessionInput(),
      askUserRoute: {
        capability: "c".repeat(43),
        endpoint: "/tmp/kitten-desktop-ask-user.sock",
      },
    });
    expect(session.sessionId).toBe("fresh-desktop-session");
    expect(sessionRequests).toMatchObject([{
      cwd: "/tmp/kitten-card",
      mcpServers: [{
        name: "kitten-ask-user",
        command: "/usr/local/bin/bun",
        args: ["/app/desktop.js", "--kitten-desktop-ask-user-mcp"],
        env: [
          { name: "KITTEN_DESKTOP_ASK_USER_ENDPOINT", value: "/tmp/kitten-desktop-ask-user.sock" },
          { name: "KITTEN_DESKTOP_ASK_USER_CAPABILITY", value: "c".repeat(43) },
        ],
      }],
    }]);
    expect(configChanges).toEqual([
      { configId: "model", value: "gpt-5.6-luna" },
      { configId: "reasoning", value: "high" },
    ]);

    expect(await connection.prompt({ sessionId: session.sessionId, prompt: "Review the UI" })).toEqual({ stopReason: "end_turn" });
    expect(prompts[0]).toContain("Always verify the result.");
    expect(prompts[0]).toContain("Review the UI");
    expect(activities.map((entry) => (entry as { activity: { kind: string } }).activity.kind)).toEqual([
      "agent_message", "tool_call", "plan", "usage",
    ]);
    await connection.cancel?.({ sessionId: session.sessionId });
    expect(cancellations).toBe(1);

    unsubscribe();
    await connection.close();
    expect(closes).toBe(1);
  });

  test("rejects an untrusted profile fence and closes a failed handshake", async () => {
    let transportCalls = 0;
    const factory = createDesktopAcpConnectionFactory([RUNTIME], () => {
      transportCalls += 1;
      throw new Error("must not spawn");
    });
    await expect(factory.connect({
      profileId: PROFILE_ID,
      recipeId: "other-recipe",
      adapterVersion: "1.0.0",
    })).rejects.toThrow("not available");
    expect(transportCalls).toBe(0);

    const pair = transportPair();
    let closes = 0;
    const incompatible: Agent = {
      initialize: () => ({
        protocolVersion: PROTOCOL_VERSION + 1,
        agentCapabilities: {},
        agentInfo: { name: "incompatible", version: "1.0.0" },
      }),
      newSession: () => ({ sessionId: "unused" }),
      prompt: () => ({ stopReason: "end_turn" }),
      authenticate: () => ({}),
      cancel: () => {},
    };
    new AgentSideConnection(() => incompatible, pair.agent);
    const incompatibleFactory = createDesktopAcpConnectionFactory([RUNTIME], () => ({
      stream: pair.client,
      async close() { closes += 1; },
    }));
    await expect(incompatibleFactory.connect({
      profileId: PROFILE_ID,
      recipeId: "codex-acp",
      adapterVersion: "1.0.0",
    })).rejects.toThrow("protocol mismatch");
    expect(closes).toBe(1);
  });

  test("rejects stale sessions and unsupported configured selections", async () => {
    const pair = transportPair();
    const configOptions = [selectOption("model", "model", "default", ["default", "gpt-5.6-luna"])];
    const agent: Agent = {
      initialize: () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        agentInfo: { name: "selection-test", version: "1.0.0" },
      }),
      newSession: () => ({ sessionId: "selection-session", configOptions }),
      setSessionConfigOption: () => ({ configOptions }),
      prompt: () => ({ stopReason: "end_turn" }),
      authenticate: () => ({}),
      cancel: () => {},
    };
    new AgentSideConnection(() => agent, pair.agent);
    const factory = createDesktopAcpConnectionFactory([RUNTIME], () => ({ stream: pair.client, close: async () => {} }));
    const connection = await factory.connect({ profileId: PROFILE_ID, recipeId: "codex-acp", adapterVersion: "1.0.0" });
    await expect(connection.newSession({ ...sessionInput(), effort: "ultra" })).rejects.toThrow("does not support effort ultra");
    await expect(connection.prompt({ sessionId: "stale-session", prompt: "No" })).rejects.toThrow("does not belong");
    await connection.close();
  });
});
