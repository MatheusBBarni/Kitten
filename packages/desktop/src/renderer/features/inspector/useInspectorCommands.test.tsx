import { afterEach, describe, expect, test } from "bun:test";
import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import "../../settings/testDom.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import {
  attentionBlocker,
  inspectorCard,
  inspectorProjection,
  TEST_ATTEMPT_ID,
  TEST_GENERATION,
  TEST_QUEUE_ID,
} from "./testSupport.ts";
import { useInspectorCommands, type InspectorFeedback } from "./useInspectorCommands.ts";

afterEach(cleanup);

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={createDesktopQueryClient()}>{children}</QueryClientProvider>;
}

function ok(commandId: string, kind: "inspector_command_result" | "follow_up_command_result") {
  return { kind, commandId, result: { status: "ok" as const } };
}

describe("inspector command mutations", () => {
  test("routes start, queue, remove, confirm, and attention commands through React Query", async () => {
    const calls: string[] = [];
    const feedback: InspectorFeedback[] = [];
    let refreshes = 0;
    let consumed = 0;
    const client = {
      async startAttempt(commandId: string) { calls.push("start"); return ok(commandId, "inspector_command_result"); },
      async queueFollowUp(commandId: string) { calls.push("queue"); return ok(commandId, "follow_up_command_result"); },
      async removeQueuedFollowUp(commandId: string) { calls.push("remove"); return ok(commandId, "follow_up_command_result"); },
      async confirmQueuedFollowUp(commandId: string) { calls.push("confirm"); return ok(commandId, "follow_up_command_result"); },
      async answerAttention(commandId: string) { calls.push("attention"); return ok(commandId, "inspector_command_result"); },
    } as unknown as DesktopRpcClient;
    const projection = inspectorProjection({ queue: "settled" });
    const queue = projection.followUpQueues[0]!;
    const base = {
      client,
      card: inspectorCard("running"),
      attempt: { attemptId: TEST_ATTEMPT_ID, generation: TEST_GENERATION },
      queue,
      blocker: null,
      refresh: async () => { refreshes += 1; },
      onFeedback: (entry: InspectorFeedback) => { feedback.push(entry); },
      onDraftConsumed: () => { consumed += 1; },
    };
    const view = renderHook(() => useInspectorCommands(base), { wrapper });

    act(() => {
      view.result.current.startAttempt("Start message");
      view.result.current.queueFollowUp("Next message");
      view.result.current.removeQueuedFollowUp(TEST_QUEUE_ID);
      view.result.current.confirmQueuedFollowUp(TEST_QUEUE_ID);
    });
    await waitFor(() => expect(calls).toEqual(["start", "queue", "remove", "confirm"]));
    await waitFor(() => expect(refreshes).toBe(4));
    expect(consumed).toBe(2);
    expect(feedback.every(({ tone }) => tone === "status")).toBeTrue();

    const attention = renderHook(() => useInspectorCommands({ ...base, queue: null, blocker: attentionBlocker() }), { wrapper });
    act(() => attention.result.current.answerAttention({ kind: "skipped" }));
    await waitFor(() => expect(calls.at(-1)).toBe("attention"));
  });

  test("reports local guards, transport failures, and typed conflicts without consuming the draft", async () => {
    const feedback: InspectorFeedback[] = [];
    let consumed = 0;
    const client = {
      async startAttempt(commandId: string) {
        return {
          kind: "inspector_command_result" as const,
          commandId,
          result: {
            status: "conflict" as const,
            conflict: { kind: "inspector_command" as const, code: "stale_card" as const, message: "Task changed." },
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const view = renderHook(() => useInspectorCommands({
      client,
      card: inspectorCard("idle"),
      attempt: null,
      queue: null,
      blocker: null,
      refresh: async () => {},
      onFeedback: (entry) => { feedback.push(entry); },
      onDraftConsumed: () => { consumed += 1; },
    }), { wrapper });

    act(() => {
      view.result.current.startAttempt("Start");
      view.result.current.queueFollowUp("No attempt");
      view.result.current.removeQueuedFollowUp(TEST_QUEUE_ID);
      view.result.current.confirmQueuedFollowUp(TEST_QUEUE_ID);
      view.result.current.answerAttention({ kind: "cancelled" });
    });
    await waitFor(() => expect(feedback).toHaveLength(5));
    expect(feedback.some(({ message }) => message === "Task changed.")).toBeTrue();
    expect(feedback.filter(({ message }) => message.includes("desktop host did not finish"))).toHaveLength(4);
    expect(consumed).toBe(0);
  });
});
