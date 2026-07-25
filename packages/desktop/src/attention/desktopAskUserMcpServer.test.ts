import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { createCardNotificationService } from "../notifications/cardNotificationService.ts";
import { createAttentionCoordinator } from "./attentionCoordinator.ts";
import { createAttemptAskUserBridge } from "./attemptAskUserBridge.ts";
import {
  DESKTOP_ASK_USER_CAPABILITY_ENV,
  DESKTOP_ASK_USER_ENDPOINT_ENV,
  DESKTOP_ASK_USER_MCP_MODE_FLAG,
  DESKTOP_ASK_USER_MCP_TOOL_NAME,
  runDesktopAskUserMcp,
} from "./desktopAskUserMcpServer.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_GENERATION,
  createAttentionFixture,
} from "./testSupport.ts";

describe("desktop ask_user MCP child", () => {
  test("serves ask_user through the in-process MCP transport used by coverage", async () => {
    const fixture = createAttentionFixture();
    const attention = createAttentionCoordinator({
      journal: fixture.journal,
      notifications: createCardNotificationService({ deliver() {} }),
      createBlockerId: () => "desktop-mcp-in-memory-blocker",
      createEventId: (operation) => `desktop-mcp-in-memory-${operation}`,
    });
    const bridge = createAttemptAskUserBridge({
      journal: fixture.journal,
      attention,
      createCapability: () => "m".repeat(43),
    });
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const serverPromise = runDesktopAskUserMcp({
      [DESKTOP_ASK_USER_ENDPOINT_ENV]: route.endpoint,
      [DESKTOP_ASK_USER_CAPABILITY_ENV]: route.capability,
    }, { createTransport: () => serverTransport });
    const client = new Client({ name: "desktop-ask-user-in-memory-test", version: "1.0.0" });
    try {
      await client.connect(clientTransport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toContain(DESKTOP_ASK_USER_MCP_TOOL_NAME);
      const resultPromise = client.callTool({
        name: DESKTOP_ASK_USER_MCP_TOOL_NAME,
        arguments: {
          context: "Choose how the run should proceed.",
          fields: [
            { id: "notes", question: "Add context" },
            {
              id: "targets",
              header: "Targets",
              question: "Which targets should be included?",
              context: "Select every applicable target.",
              allows_multiple: true,
              allows_custom: true,
              options: [
                { id: "ui", label: "UI", description: "Renderer changes" },
                { id: "host", label: "Host" },
              ],
            },
          ],
        },
      });
      const blocker = await waitForBlocker(fixture.journal);
      expect(blocker.form).toMatchObject({
        prompt: "Choose how the run should proceed.",
        fields: [
          { id: "notes", label: "Add context", mode: "text" },
          { id: "targets", label: "Targets", description: "Select every applicable target.", mode: "multi" },
        ],
      });
      attention.resolve({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        blockerId: blocker.blockerId,
        expectedVersion: blocker.version,
        outcome: {
          kind: "submitted",
          answers: {
            notes: { selectedOptionIds: [], customText: "Keep the diff narrow" },
            targets: { selectedOptionIds: ["ui", "host"] },
          },
        },
      });
      expect((await resultPromise).content).toEqual([{
        type: "text",
        text: JSON.stringify({
          outcome: "submitted",
          answers: {
            notes: {
              selected_option_ids: [],
              custom_text: "Keep the diff narrow",
              values: ["Keep the diff narrow"],
            },
            targets: {
              selected_option_ids: ["ui", "host"],
              custom_text: null,
              values: ["ui", "host"],
            },
          },
        }),
      }]);
    } finally {
      await client.close();
      await serverPromise;
      bridge.dispose();
      closeSqliteDatabase(fixture.database);
    }
  });

  test("forwards a capability-scoped stdio tool call into the durable attention route", async () => {
    const fixture = createAttentionFixture();
    const attention = createAttentionCoordinator({
      journal: fixture.journal,
      notifications: createCardNotificationService({ deliver() {} }),
      createBlockerId: () => "desktop-mcp-blocker",
      createEventId: (operation) => `desktop-mcp-${operation}`,
    });
    const bridge = createAttemptAskUserBridge({
      journal: fixture.journal,
      attention,
      createCapability: () => "c".repeat(43),
    });
    const route = bridge.register({ attemptId: ATTENTION_ATTEMPT_ID, generation: ATTENTION_GENERATION });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["run", new URL("../main.ts", import.meta.url).pathname, DESKTOP_ASK_USER_MCP_MODE_FLAG],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        [DESKTOP_ASK_USER_ENDPOINT_ENV]: route.endpoint,
        [DESKTOP_ASK_USER_CAPABILITY_ENV]: route.capability,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const client = new Client({ name: "desktop-ask-user-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toContain(DESKTOP_ASK_USER_MCP_TOOL_NAME);
      const resultPromise = client.callTool({
        name: DESKTOP_ASK_USER_MCP_TOOL_NAME,
        arguments: {
          title: "Choose a baseline",
          context: "The review needs a fixed point.",
          fields: [{
            id: "base",
            header: "Baseline",
            question: "What should the review compare against?",
            options: [{ id: "main", label: "main" }],
            allows_custom: true,
          }],
        },
      });
      const blocker = await waitForBlocker(fixture.journal);
      expect(blocker.form).toMatchObject({
        title: "Choose a baseline",
        prompt: "Choose a baseline",
        fields: [{ id: "base", label: "Baseline", mode: "single" }],
      });
      attention.resolve({
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        blockerId: blocker.blockerId,
        expectedVersion: blocker.version,
        outcome: {
          kind: "submitted",
          answers: { base: { selectedOptionIds: ["main"], customText: "Keep scope narrow" } },
        },
      });
      expect((await resultPromise).content).toEqual([{
        type: "text",
        text: JSON.stringify({
          outcome: "submitted",
          answers: {
            base: {
              selected_option_ids: ["main"],
              custom_text: "Keep scope narrow",
              values: ["main", "Keep scope narrow"],
            },
          },
        }),
      }]);
      expect(stderr).toBe("");
    } finally {
      await client.close();
      bridge.dispose();
      closeSqliteDatabase(fixture.database);
    }
  });
});

async function waitForBlocker(journal: ReturnType<typeof createAttentionFixture>["journal"]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const blocker = journal.snapshot().attentionBlockers[0];
    if (blocker !== undefined && blocker.notification.state !== "pending") return blocker;
    await Bun.sleep(1);
  }
  throw new Error("Attention blocker was not committed");
}
