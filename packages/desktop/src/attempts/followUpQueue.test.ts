import { describe, expect, test } from "bun:test";
import { toAttemptGeneration, type AttemptId } from "@kitten/engine";
import { workflowIds } from "../workflow/workflowTypes.ts";
import {
  createFollowUpQueue,
  enqueueFollowUp,
  followUpQueueFence,
  interruptFollowUpDispatch,
  markFollowUpDispatched,
  markFollowUpDispatching,
  parseFollowUpQueueProjection,
  queuedFollowUpHead,
  removeFollowUp,
  retryInterruptedFollowUp,
  serializeFollowUpQueueProjection,
  unresolvedFollowUpHead,
  validateFollowUpQueueProjection,
  type FollowUpQueueId,
  type FollowUpQueueProjection,
} from "./followUpQueue.ts";

const BOARD_ID = workflowIds.board("board-follow-ups");
const CARD_ID = workflowIds.card("card-follow-ups");
const ATTEMPT_ID = "attempt-follow-ups" as AttemptId;
const GENERATION = toAttemptGeneration(1)!;
const id = (value: string) => value as FollowUpQueueId;

function queueWithThree(): FollowUpQueueProjection {
  let queue = createFollowUpQueue({
    boardId: BOARD_ID,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    queueId: id("queue-1"),
    text: "first",
    occurredAt: 1,
  });
  queue = enqueueFollowUp(
    queue,
    { queueId: id("queue-2"), text: "second", occurredAt: 2 },
    followUpQueueFence(queue),
  );
  return enqueueFollowUp(
    queue,
    { queueId: id("queue-3"), text: "third", occurredAt: 3 },
    followUpQueueFence(queue),
  );
}

function legacyProjection(
  state: "queued" | "awaiting_confirmation" | "confirmed" | "dispatched" | "removed",
  turnState: "active" | "settled" | "dispatching",
) {
  const confirmedAt = state === "confirmed" || state === "dispatched" ? 4 : null;
  return {
    schemaVersion: 1,
    boardId: BOARD_ID,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    version: 7,
    turnState,
    drafts: [{
      queueId: id("legacy-1"),
      text: "legacy explicit submission",
      state,
      createdAt: 1,
      updatedAt: state === "removed" ? 3 : state === "queued" ? 1 : 4,
      confirmedAt,
      dispatchedAt: state === "dispatched" ? 4 : null,
      removedAt: state === "removed" ? 3 : null,
    }],
    updatedAt: state === "removed" ? 3 : state === "queued" ? 1 : 4,
  };
}

describe("durable follow-up queue-v2 state machine", () => {
  test("keeps explicitly submitted items queued and dispatches only the FIFO head", () => {
    let queue = queueWithThree();

    expect(queue.schemaVersion).toBe(2);
    expect(queue.drafts.map(({ queueId, state }) => [String(queueId), state])).toEqual([
      ["queue-1", "queued"],
      ["queue-2", "queued"],
      ["queue-3", "queued"],
    ]);
    expect(queuedFollowUpHead(queue)?.queueId).toBe(id("queue-1"));
    expect(() => markFollowUpDispatching(
      queue,
      id("queue-2"),
      4,
      followUpQueueFence(queue),
    )).toThrow("Only the queued FIFO head");

    queue = markFollowUpDispatching(queue, id("queue-1"), 4, followUpQueueFence(queue));
    expect(queue.drafts[0]).toMatchObject({
      state: "dispatching",
      dispatchingAt: 4,
    });
    expect(queuedFollowUpHead(queue)).toBeNull();

    queue = markFollowUpDispatched(queue, id("queue-1"), 5, followUpQueueFence(queue));
    expect(queue.drafts[0]).toMatchObject({
      state: "dispatched",
      dispatchingAt: 4,
      dispatchedAt: 5,
    });
    expect(queuedFollowUpHead(queue)?.queueId).toBe(id("queue-2"));
    expect(queue.version).toBe(5);
  });

  test("maps legacy authorized and ambiguous states deterministically without changing identity, order, or version", () => {
    const legacyQueued = validateFollowUpQueueProjection(legacyProjection("queued", "active"));
    const legacyAwaiting = validateFollowUpQueueProjection(
      legacyProjection("awaiting_confirmation", "settled"),
    );
    const legacyConfirmed = validateFollowUpQueueProjection(
      legacyProjection("confirmed", "dispatching"),
    );
    const legacyDispatched = validateFollowUpQueueProjection(
      legacyProjection("dispatched", "settled"),
    );
    const legacyRemoved = validateFollowUpQueueProjection(
      legacyProjection("removed", "settled"),
    );

    expect([legacyQueued, legacyAwaiting].map((queue) => queue.drafts[0]?.state))
      .toEqual(["queued", "queued"]);
    expect(legacyConfirmed.drafts[0]).toMatchObject({
      queueId: id("legacy-1"),
      state: "interrupted",
      dispatchingAt: 4,
      interruptedAt: 4,
    });
    expect(legacyDispatched.drafts[0]).toMatchObject({
      state: "dispatched",
      dispatchingAt: 4,
      dispatchedAt: 4,
    });
    expect(legacyRemoved.drafts[0]).toMatchObject({ state: "removed", removedAt: 3 });
    for (const migrated of [
      legacyQueued,
      legacyAwaiting,
      legacyConfirmed,
      legacyDispatched,
      legacyRemoved,
    ]) {
      expect(migrated).toMatchObject({
        schemaVersion: 2,
        attemptId: ATTEMPT_ID,
        generation: GENERATION,
        version: 7,
      });
      expect(migrated).not.toHaveProperty("turnState");
      expect(migrated.drafts[0]).not.toHaveProperty("confirmedAt");
    }
  });

  test("rejects stale versions, attempts, generations, duplicate identities, and removal races", () => {
    const queue = queueWithThree();
    expect(() => enqueueFollowUp(
      queue,
      { queueId: id("queue-1"), text: "duplicate", occurredAt: 4 },
      followUpQueueFence(queue),
    )).toThrow("already exists");
    expect(() => removeFollowUp(queue, id("queue-1"), 4, {
      ...followUpQueueFence(queue),
      expectedVersion: queue.version - 1,
    })).toThrow("queue version is stale");
    expect(() => removeFollowUp(queue, id("queue-1"), 4, {
      ...followUpQueueFence(queue),
      attemptId: "attempt-other" as AttemptId,
    })).toThrow("attempt identity is stale");
    expect(() => removeFollowUp(queue, id("queue-1"), 4, {
      ...followUpQueueFence(queue),
      generation: toAttemptGeneration(2)!,
    })).toThrow("generation is stale");

    const dispatching = markFollowUpDispatching(
      queue,
      id("queue-1"),
      4,
      followUpQueueFence(queue),
    );
    expect(() => removeFollowUp(
      dispatching,
      id("queue-1"),
      5,
      followUpQueueFence(dispatching),
    )).toThrow("cannot be removed from dispatching");
    expect(() => markFollowUpDispatched(
      dispatching,
      id("queue-1"),
      5,
      followUpQueueFence(queue),
    )).toThrow("queue version is stale");
  });

  test("interrupts uncertain delivery, blocks automatic promotion, and changes only the explicit recovery target", () => {
    const initial = queueWithThree();
    const dispatching = markFollowUpDispatching(
      initial,
      id("queue-1"),
      4,
      followUpQueueFence(initial),
    );
    const interrupted = interruptFollowUpDispatch(
      dispatching,
      id("queue-1"),
      5,
      followUpQueueFence(dispatching),
    );

    expect(unresolvedFollowUpHead(interrupted)).toMatchObject({
      queueId: id("queue-1"),
      state: "interrupted",
      interruptedAt: 5,
    });
    expect(queuedFollowUpHead(interrupted)).toBeNull();
    expect(interrupted.drafts.slice(1)).toEqual(initial.drafts.slice(1));

    const retried = retryInterruptedFollowUp(
      interrupted,
      id("queue-1"),
      6,
      followUpQueueFence(interrupted),
    );
    expect(queuedFollowUpHead(retried)).toMatchObject({
      queueId: id("queue-1"),
      state: "queued",
      dispatchingAt: null,
      interruptedAt: null,
    });
    expect(retried.drafts.slice(1)).toEqual(initial.drafts.slice(1));

    const removed = removeFollowUp(
      interrupted,
      id("queue-1"),
      6,
      followUpQueueFence(interrupted),
    );
    expect(removed.drafts[0]).toMatchObject({
      state: "removed",
      dispatchingAt: 4,
      interruptedAt: 5,
      removedAt: 6,
    });
    expect(queuedFollowUpHead(removed)?.queueId).toBe(id("queue-2"));
    expect(removed.drafts.slice(1)).toEqual(initial.drafts.slice(1));
  });

  test("serializes and parses the same queue-v2 states, durable order, and version", () => {
    let queue = queueWithThree();
    queue = markFollowUpDispatching(queue, id("queue-1"), 4, followUpQueueFence(queue));
    queue = interruptFollowUpDispatch(queue, id("queue-1"), 5, followUpQueueFence(queue));
    const serialized = serializeFollowUpQueueProjection(queue);

    expect(parseFollowUpQueueProjection(serialized)).toEqual(queue);
    expect(serializeFollowUpQueueProjection(parseFollowUpQueueProjection(serialized)))
      .toBe(serialized);
    expect(() => parseFollowUpQueueProjection("{")).toThrow("invalid JSON");
  });

  test("rejects malformed non-head uncertainty and unsupported queue-v2 states", () => {
    const queue = queueWithThree();
    expect(() => validateFollowUpQueueProjection({
      ...queue,
      drafts: queue.drafts.map((draft, index) => index === 1
        ? {
            ...draft,
            state: "dispatching",
            dispatchingAt: 4,
            updatedAt: 4,
          }
        : draft),
      updatedAt: 4,
    })).toThrow("only the FIFO head");
    expect(() => validateFollowUpQueueProjection({
      ...queue,
      drafts: [{ ...queue.drafts[0], state: "awaiting_confirmation" }],
    })).toThrow("unsupported");
  });
});
