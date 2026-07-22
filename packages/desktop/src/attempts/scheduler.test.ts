import { describe, expect, test } from "bun:test";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createGlobalAttemptScheduler } from "./scheduler.ts";

describe("global attempt scheduler", () => {
  test("defaults to one active attempt across boards and releases without leaks", () => {
    let id = 0;
    const scheduler = createGlobalAttemptScheduler({ createReservationId: () => `reservation-${++id}` });
    const firstCard = workflowIds.card("board-a-card");
    const secondCard = workflowIds.card("board-b-card");

    expect(scheduler.limit).toBe(1);
    const first = scheduler.reserve(firstCard);
    expect(first.status).toBe("reserved");
    if (first.status !== "reserved") throw new Error("expected reservation");
    expect(scheduler.activeCount).toBe(1);
    expect(scheduler.reserve(firstCard)).toEqual({ status: "card_already_active" });
    expect(scheduler.reserve(secondCard)).toEqual({ status: "capacity_exhausted" });

    expect(scheduler.release({ ...first.reservation })).toBeFalse();
    expect(scheduler.activeCount).toBe(1);
    expect(scheduler.release(first.reservation)).toBeTrue();
    expect(scheduler.release(first.reservation)).toBeFalse();
    expect(scheduler.activeCount).toBe(0);

    expect(scheduler.reserve(secondCard).status).toBe("reserved");
    expect(scheduler.activeCount).toBe(1);
  });

  test("supports an explicit positive global limit and rejects invalid limits", () => {
    const scheduler = createGlobalAttemptScheduler({ limit: 2 });
    expect(scheduler.reserve(workflowIds.card("one")).status).toBe("reserved");
    expect(scheduler.reserve(workflowIds.card("two")).status).toBe("reserved");
    expect(scheduler.inspect(workflowIds.card("three"))).toEqual({ status: "capacity_exhausted" });
    expect(() => createGlobalAttemptScheduler({ limit: 0 })).toThrow("positive integer");
  });
});
