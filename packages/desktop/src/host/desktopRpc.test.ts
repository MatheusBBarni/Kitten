import { describe, expect, test } from "bun:test";
import type { DesktopAttemptCoordinator } from "../attempts/attemptCoordinator.ts";
import type { EventJournal } from "../persistence/eventJournal.ts";
import { workflowIds, type CardProjection } from "../workflow/workflowTypes.ts";
import { createDesktopInspectorRpc } from "./desktopRpc.ts";

const CARD: CardProjection = {
  cardId: workflowIds.card("card-inspector-rpc"),
  boardId: workflowIds.board("board-inspector-rpc"),
  stageId: workflowIds.stage("stage-inspector-rpc"),
  title: "Review the latest UI",
  description: "Check the task inspector",
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

function journal(cards: readonly CardProjection[] = [CARD]): EventJournal {
  return { snapshot: () => ({ cards }) } as unknown as EventJournal;
}

function request(initialPrompt = "  Review the UI  ") {
  return {
    commandId: "start-command",
    input: { cardId: CARD.cardId, expectedCardVersion: CARD.version, initialPrompt },
  };
}

function coordinator(start: DesktopAttemptCoordinator["start"]): DesktopAttemptCoordinator {
  return { start } as unknown as DesktopAttemptCoordinator;
}

describe("desktop inspector RPC", () => {
  test("version-fences the card and forwards a trimmed initial prompt to the coordinator", async () => {
    const starts: string[] = [];
    const rpc = createDesktopInspectorRpc(journal(), coordinator(async (_cardId, prompt) => {
      starts.push(prompt ?? "");
      return { status: "started" } as Awaited<ReturnType<DesktopAttemptCoordinator["start"]>>;
    }));

    expect(await rpc.startAttempt(request())).toEqual({
      kind: "inspector_command_result",
      commandId: "start-command",
      result: { status: "ok" },
    });
    expect(starts).toEqual(["Review the UI"]);
  });

  test("rejects missing, stale, and empty task starts before any external work", async () => {
    let starts = 0;
    const rpc = createDesktopInspectorRpc(journal(), coordinator(async () => {
      starts += 1;
      return { status: "started" } as Awaited<ReturnType<DesktopAttemptCoordinator["start"]>>;
    }));
    const missing = createDesktopInspectorRpc(journal([]), coordinator(async () => {
      starts += 1;
      return { status: "started" } as Awaited<ReturnType<DesktopAttemptCoordinator["start"]>>;
    }));

    expect((await missing.startAttempt(request())).result).toMatchObject({
      status: "rejected",
      reason: { code: "card_not_found" },
    });
    expect((await rpc.startAttempt({ ...request(), input: { ...request().input, expectedCardVersion: 3 } })).result).toMatchObject({
      status: "conflict",
      conflict: { code: "stale_card" },
    });
    expect((await rpc.startAttempt(request("   "))).result).toMatchObject({
      status: "rejected",
      reason: { code: "empty_prompt" },
    });
    expect(starts).toBe(0);
    await expect(rpc.startAttempt({ ...request(), commandId: " " })).rejects.toThrow("commandId must be non-empty");
  });

  test("maps admission rejection and durable startup failure without leaking host exceptions", async () => {
    const rejected = createDesktopInspectorRpc(journal(), coordinator(async () => ({
      status: "rejected",
      reason: { code: "capacity_exhausted", message: "Another task is active." },
    })));
    const failed = createDesktopInspectorRpc(journal(), coordinator(async () => ({
      status: "failed",
      failure: { code: "connection_failed", message: "The configured ACP could not connect.", occurredAt: 5 },
      attempt: null,
    })));

    expect((await rejected.startAttempt(request())).result).toEqual({
      status: "rejected",
      reason: { code: "capacity_exhausted", message: "Another task is active." },
    });
    expect((await failed.startAttempt(request())).result).toEqual({
      status: "rejected",
      reason: { code: "connection_failed", message: "The configured ACP could not connect." },
    });
    expect((await rejected.answerAttention({ commandId: "answer", input: {} as never })).result).toMatchObject({
      status: "rejected",
      reason: { code: "not_ready" },
    });
  });
});
