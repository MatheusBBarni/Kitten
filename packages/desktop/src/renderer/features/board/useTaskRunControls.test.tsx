import { afterEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import "../../settings/testDom.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import { workflowIds, type CardProjection } from "../../../workflow/workflowTypes.ts";
import { useTaskRunControls } from "./useTaskRunControls.ts";

afterEach(cleanup);

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={createDesktopQueryClient()}>{children}</QueryClientProvider>;
}

const card: CardProjection = {
  cardId: workflowIds.card("card-run-controls"),
  boardId: workflowIds.board("board-run-controls"),
  stageId: workflowIds.stage("stage-run-controls"),
  title: "Review the UI",
  description: "Review the latest UI changes.",
  provider: "codex",
  model: "gpt-5.6-luna",
  effort: "high",
  skillOverrideId: null,
  runnable: true,
  executionStatus: "idle",
  version: 4,
  createdAt: 1,
  updatedAt: 2,
};

describe("task card run controls", () => {
  test("starts from the task description and stops with the same version fence", async () => {
    const calls: unknown[] = [];
    const client = {
      async submitCardPrompt(input: Parameters<DesktopRpcClient["submitCardPrompt"]>[0]) {
        calls.push({ action: "start", commandId: input.commandId, input });
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "ok" as const,
            outcome: "admitted" as const,
            cardVersion: input.expectedCardVersion + 1,
            attemptId: "attempt-run-controls" as never,
            generation: 1 as never,
          },
        };
      },
      async stopAttempt(commandId: string, input: unknown) {
        calls.push({ action: "stop", commandId, input });
        return { kind: "inspector_command_result" as const, commandId, result: { status: "ok" as const } };
      },
    } as unknown as DesktopRpcClient;
    const view = renderHook(() => useTaskRunControls(client), { wrapper });

    act(() => view.result.current.start(card));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      action: "start",
      input: {
        cardId: card.cardId,
        expectedCardVersion: card.version,
        content: card.description,
        source: "initial",
      },
    });

    act(() => view.result.current.stop({ ...card, executionStatus: "running" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({
      action: "stop",
      input: { cardId: card.cardId, expectedCardVersion: card.version },
    });
  });

  test("falls back to the title and handles rejected, unavailable, and failed commands", async () => {
    const starts: unknown[] = [];
    const rejectedClient = {
      async submitCardPrompt(input: Parameters<DesktopRpcClient["submitCardPrompt"]>[0]) {
        starts.push(input);
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "rejected" as const,
            error: { code: "stale_projection" as const, recoveryHint: "refresh_projection" as const },
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const rejected = renderHook(() => useTaskRunControls(rejectedClient), { wrapper });

    act(() => rejected.result.current.start({ ...card, description: "   " }));
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toMatchObject({ content: card.title });

    act(() => rejected.result.current.stop({ ...card, executionStatus: "running" }));
    await waitFor(() => expect(rejected.result.current.busy).toBe(false));

    const failedClient = {
      submitCardPrompt: () => Promise.reject(new Error("offline")),
      stopAttempt: () => Promise.reject(new Error("offline")),
    } as unknown as DesktopRpcClient;
    const failed = renderHook(() => useTaskRunControls(failedClient), { wrapper });
    act(() => failed.result.current.start(card));
    await waitFor(() => expect(failed.result.current.busy).toBe(false));
    act(() => failed.result.current.stop({ ...card, executionStatus: "running" }));
    await waitFor(() => expect(failed.result.current.busy).toBe(false));
  });
});
