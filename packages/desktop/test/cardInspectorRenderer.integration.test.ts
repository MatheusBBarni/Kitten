import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttentionOutcome } from "../src/attention/contracts.ts";
import type { DesktopRpcClient } from "../src/renderer/client.ts";
import { answerAttentionThroughRpc } from "../src/renderer/features/inspector/inspectorCommands.ts";
import { attentionBlocker } from "../src/renderer/features/inspector/testSupport.ts";

describe("fake RPC card inspector outcomes", () => {
  test("routes every terminal Attention outcome with stable attempt and blocker identity", async () => {
    const calls: Array<{ readonly commandId: string; readonly input: Parameters<DesktopRpcClient["answerAttention"]>[1] }> = [];
    const client = {
      async answerAttention(commandId: string, input: Parameters<DesktopRpcClient["answerAttention"]>[1]) {
        calls.push({ commandId, input });
        return { kind: "inspector_command_result" as const, commandId, result: { status: "ok" as const } };
      },
    } as DesktopRpcClient;
    const blocker = attentionBlocker();
    const outcomes: readonly AttentionOutcome[] = [
      { kind: "submitted", answers: { scope: { selectedOptionIds: ["full"] } } },
      { kind: "skipped" },
      { kind: "timed_out" },
      { kind: "cancelled" },
    ];

    for (const [index, outcome] of outcomes.entries()) {
      await answerAttentionThroughRpc(client, `answer-${index}`, blocker, outcome);
    }

    expect(calls.map(({ input }) => input.outcome.kind)).toEqual(["submitted", "skipped", "timed_out", "cancelled"]);
    expect(calls.every(({ input }) => (
      input.attemptId === blocker.attemptId
      && input.generation === blocker.generation
      && input.blockerId === blocker.blockerId
      && input.expectedVersion === blocker.version
    ))).toBeTrue();
    expect(calls.map(({ commandId }) => commandId)).toEqual(["answer-0", "answer-1", "answer-2", "answer-3"]);
  });
});

describe("responsive renderer visual contract", () => {
  test("keeps semantic meaning in text and does not import the reference product vocabulary", async () => {
    const rendererSources = await Promise.all([
      "main.tsx",
      "features/board/WorkflowBoardContainer.tsx",
      "features/board/ProjectSidebar.tsx",
      "features/board/WorkflowBoard.tsx",
      "features/inspector/CardInspector.tsx",
    ].map((path) => readFile(join(import.meta.dir, "../src/renderer", path), "utf8")));
    const source = rendererSources.join("\n");

    for (const label of [
      "Attention required",
      "Ready for review",
      "Running",
      "Failed",
      "Completed",
    ]) {
      expect(source).toContain(label);
    }
    expect(source).not.toMatch(/T3 Code|thread identity|\bsnooze\b|\bwake\b/i);
  });

  test("ships neutral and semantic tokens with generated focus and reduced-motion utilities", async () => {
    const [source, generated] = await Promise.all([
      readFile(join(import.meta.dir, "../src/renderer/styles.css"), "utf8"),
      readFile(join(import.meta.dir, "../src/renderer/generated.css"), "utf8"),
    ]);

    for (const token of [
      "--kitten-surface-navigation",
      "--kitten-surface-board",
      "--kitten-surface-workbench",
      "--kitten-accent",
      "--kitten-status-attention",
      "--kitten-status-review",
      "--kitten-status-failure",
      "--kitten-status-running",
      "--kitten-status-success",
      "--kitten-radius-surface",
      "--kitten-shadow-panel",
    ]) {
      expect(source).toContain(token);
      expect(generated).toContain(token);
    }
    expect(source).toContain(":focus-visible");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(generated).toContain("focus-visible\\:ring-2");
    expect(generated).toContain("motion-reduce\\:animate-none");
    expect(generated).toContain("@media (prefers-reduced-motion:reduce)");
    expect(generated).toContain("text-\\[var\\(--kitten-status-attention\\)\\]");
    expect(generated).toContain("bg-\\[var\\(--kitten-surface-workbench\\)\\]");
  });
});
