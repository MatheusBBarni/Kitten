import { describe, expect, test } from "bun:test";
import type { QuestionId } from "@kitten/engine";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createCardNotificationService } from "./cardNotificationService.ts";

describe("card-safe Attention Blocker notifications", () => {
  test("delivers one exact card/action-only payload for concurrent duplicate calls", async () => {
    const payloads: unknown[] = [];
    const service = createCardNotificationService({
      now: () => 42,
      async deliver(payload) { payloads.push(payload); },
    });
    const input = {
      blockerId: "blocker-1" as QuestionId,
      cardId: workflowIds.card("card-1"),
      cardTitle: "Fix parser",
    };
    expect(await Promise.all([service.notify(input), service.notify(input)])).toEqual([
      { state: "delivered", attemptedAt: 42 },
      { state: "delivered", attemptedAt: 42 },
    ]);
    expect(payloads).toEqual([{
      title: "Action required",
      body: "Fix parser needs your answer.",
      cardId: input.cardId,
      action: "open_card",
    }]);
    expect(JSON.stringify(payloads)).not.toMatch(/prompt content|answer content|source code|provider name|\/secret\/path|credential value/i);
  });

  test("caches a content-free failure without retrying or resolving blocker state", async () => {
    let calls = 0;
    const service = createCardNotificationService({
      now: () => 55,
      deliver() { calls += 1; throw new Error("raw provider path and credentials"); },
    });
    const input = {
      blockerId: "blocker-failed" as QuestionId,
      cardId: workflowIds.card("card-failed"),
      cardTitle: "Safe card",
    };
    expect(await service.notify(input)).toEqual({ state: "failed", attemptedAt: 55, failureCode: "unavailable" });
    expect(await service.notify(input)).toEqual({ state: "failed", attemptedAt: 55, failureCode: "unavailable" });
    expect(calls).toBe(1);
  });
});
