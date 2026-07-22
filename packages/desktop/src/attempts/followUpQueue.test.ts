import { describe, expect, test } from "bun:test";
import { toAttemptGeneration, type AttemptId } from "@kitten/engine";
import { workflowIds } from "../workflow/workflowTypes.ts";
import {
  awaitingConfirmationHead,
  confirmFollowUpHead,
  createFollowUpQueue,
  enqueueFollowUp,
  markFollowUpDispatched,
  removeFollowUp,
  settleFollowUpTurn,
  validateFollowUpQueueProjection,
  type FollowUpQueueId,
} from "./followUpQueue.ts";

const BOARD_ID = workflowIds.board("board-follow-ups");
const CARD_ID = workflowIds.card("card-follow-ups");
const ATTEMPT_ID = "attempt-follow-ups" as AttemptId;
const GENERATION = toAttemptGeneration(1)!;
const id = (value: string) => value as FollowUpQueueId;

describe("durable follow-up queue state machine", () => {
  test("preserves FIFO, exposes only the settled head, removes, confirms, and dispatches", () => {
    let queue = createFollowUpQueue({
      boardId: BOARD_ID,
      cardId: CARD_ID,
      attemptId: ATTEMPT_ID,
      generation: GENERATION,
      turnState: "active",
      queueId: id("queue-1"),
      text: "first",
      occurredAt: 1,
    });
    queue = enqueueFollowUp(queue, { queueId: id("queue-2"), text: "second", occurredAt: 2 });
    queue = enqueueFollowUp(queue, { queueId: id("queue-3"), text: "third", occurredAt: 3 });

    expect(queue.drafts.map(({ queueId, state }) => [String(queueId), state])).toEqual([
      ["queue-1", "queued"], ["queue-2", "queued"], ["queue-3", "queued"],
    ]);
    queue = settleFollowUpTurn(queue, 4);
    expect(awaitingConfirmationHead(queue)?.queueId).toBe(id("queue-1"));
    expect(queue.drafts.filter(({ state }) => state === "awaiting_confirmation")).toHaveLength(1);

    queue = removeFollowUp(queue, id("queue-1"), 5);
    expect(awaitingConfirmationHead(queue)?.queueId).toBe(id("queue-2"));
    queue = confirmFollowUpHead(queue, id("queue-2"), 6);
    expect(queue.turnState).toBe("dispatching");
    queue = markFollowUpDispatched(queue, id("queue-2"), 7);
    expect(queue.drafts.find(({ queueId }) => queueId === "queue-2")).toMatchObject({
      state: "dispatched",
      confirmedAt: 6,
      dispatchedAt: 7,
    });
    expect(awaitingConfirmationHead(queue)?.queueId).toBe(id("queue-3"));
  });

  test("rejects duplicate identity, out-of-order confirmation, and malformed persisted heads", () => {
    const queue = createFollowUpQueue({
      boardId: BOARD_ID,
      cardId: CARD_ID,
      attemptId: ATTEMPT_ID,
      generation: GENERATION,
      turnState: "active",
      queueId: id("queue-1"),
      text: "first",
      occurredAt: 1,
    });
    expect(() => enqueueFollowUp(queue, { queueId: id("queue-1"), text: "duplicate", occurredAt: 2 }))
      .toThrow("already exists");
    expect(() => confirmFollowUpHead(queue, id("queue-1"), 2)).toThrow("no longer awaiting confirmation");

    expect(() => validateFollowUpQueueProjection({
      ...settleFollowUpTurn(enqueueFollowUp(queue, { queueId: id("queue-2"), text: "second", occurredAt: 2 }), 3),
      drafts: [
        { ...settleFollowUpTurn(queue, 3).drafts[0], state: "queued" },
        {
          ...enqueueFollowUp(queue, { queueId: id("queue-2"), text: "second", occurredAt: 2 }).drafts[1],
          state: "awaiting_confirmation",
        },
      ],
    })).toThrow("only the FIFO head");
  });
});
