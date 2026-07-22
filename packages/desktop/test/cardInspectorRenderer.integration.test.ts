import { describe, expect, test } from "bun:test";
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
