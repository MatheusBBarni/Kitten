import { describe, expect, test } from "bun:test";
import type { ActivitySequence } from "@kitten/engine";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import { getCardInspectorProjection } from "../../../attempts/activityIngestor.ts";
import type { EventJournal, PersistenceSnapshot } from "../../../persistence/eventJournal.ts";
import type { HostMessageEnvelope } from "../../../shared/rpc.ts";
import { createCardInspectorEnvelope } from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import { inspectorProjection, TEST_CARD_ID } from "./testSupport.ts";

function fakeClient() {
  let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
  let requests = 0;
  const accepted = inspectorProjection();
  const client: DesktopRpcClient = {
    async getDesktopSnapshot() { throw new Error("not used"); },
    async getCardInspector() {
      requests += 1;
      if (requests === 3) {
        return createCardInspectorEnvelope({
          status: "ok",
          projection: {
            ...accepted,
            cardId: "card-stale" as typeof accepted.cardId,
            card: { ...accepted.card, cardId: "card-stale" as typeof accepted.cardId },
          },
        });
      }
      return createCardInspectorEnvelope({ status: "ok", projection: { ...accepted, revision: 10 + requests } });
    },
    async getBoard() { throw new Error("not used"); },
    async getCatalog() { throw new Error("not used"); },
    async executeWorkflowCommand() { throw new Error("not used"); },
    async startAttempt() { throw new Error("not used"); },
    async queueFollowUp() { throw new Error("not used"); },
    async removeQueuedFollowUp() { throw new Error("not used"); },
    async confirmQueuedFollowUp() { throw new Error("not used"); },
    async answerAttention() { throw new Error("not used"); },
    async getSettings() { throw new Error("not used"); },
    async updatePreferences() { throw new Error("not used"); },
    async updateProfileDefaults() { throw new Error("not used"); },
    async updateCatalogRoots() { throw new Error("not used"); },
    async setExecutionLimit() { throw new Error("not used"); },
    subscribe(listener) { subscriber = listener; return () => { subscriber = undefined; }; },
    dispose() {},
  };
  return { client, emit: (message: HostMessageEnvelope) => subscriber?.(message), requests: () => requests };
}

describe("selected-card inspector binding", () => {
  test("composes sorted attempt, queue, and blocker projections for one card", () => {
    const latest = inspectorProjection({ queue: "active", blocker: "active" });
    const olderAttemptId = "attempt-older-renderer" as AttemptId;
    const olderGeneration = 1 as AttemptGeneration;
    const olderAttempt = {
      ...latest.attempts[0]!,
      attemptId: olderAttemptId,
      generation: olderGeneration,
      context: { ...latest.attempts[0]!.context, attemptId: olderAttemptId, generation: olderGeneration },
    };
    const olderState = { ...latest.attemptStates[0]!, attemptId: olderAttemptId, generation: olderGeneration };
    const olderQueue = { ...latest.followUpQueues[0]!, attemptId: olderAttemptId, generation: olderGeneration };
    const olderBlocker = {
      ...latest.attentionBlockers[0]!,
      blockerId: "blocker-older-renderer" as typeof latest.attentionBlockers[number]["blockerId"],
      attemptId: olderAttemptId,
      generation: olderGeneration,
      createdAt: 90,
    };
    const snapshot = {
      revision: 20,
      cards: [latest.card],
      runContexts: [
        { attemptId: latest.attempts[0]!.attemptId, generation: latest.attempts[0]!.generation, card: { cardId: TEST_CARD_ID } },
        { attemptId: olderAttemptId, generation: olderGeneration, card: { cardId: TEST_CARD_ID } },
      ],
      attemptInspectors: [latest.attempts[0]!, olderAttempt],
      attempts: [latest.attemptStates[0]!, olderState],
      followUpQueues: [latest.followUpQueues[0]!, olderQueue],
      attentionBlockers: [latest.attentionBlockers[0]!, olderBlocker],
    } as unknown as PersistenceSnapshot;
    const journal = { snapshot: () => snapshot } as EventJournal;

    const projection = getCardInspectorProjection(journal, TEST_CARD_ID);
    expect(projection?.schemaVersion).toBe(2);
    expect(projection?.attempts.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.attemptStates.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.followUpQueues.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.attentionBlockers.map(({ createdAt }) => createdAt)).toEqual([90, 110]);
    expect(getCardInspectorProjection(journal, "missing-card" as typeof TEST_CARD_ID)).toBeNull();
  });

  test("refreshes only matching activity and drops stale-card projections", async () => {
    const fake = fakeClient();
    const revisions: number[] = [];
    const binding = bindCardInspectorRenderer(fake.client, TEST_CARD_ID, (envelope) => {
      if (envelope.result.status === "ok") revisions.push(envelope.result.projection.revision);
    });
    await binding.ready;
    expect(revisions).toEqual([11]);

    fake.emit({
      kind: "attempt_activity",
      messageId: "other-card",
      revision: 12,
      boardId: inspectorProjection().card.boardId,
      cardId: "card-other" as typeof TEST_CARD_ID,
      attemptId: inspectorProjection().attempts[0]!.attemptId,
      generation: inspectorProjection().attempts[0]!.generation,
      sequence: 6 as ActivitySequence,
      projection: inspectorProjection().attempts[0]!,
    } as HostMessageEnvelope);
    await Bun.sleep(0);
    expect(fake.requests()).toBe(1);

    fake.emit({ kind: "projection_committed", messageId: "current-card", revision: 12 });
    await Bun.sleep(0);
    expect(revisions).toEqual([11, 12]);

    fake.emit({ kind: "projection_committed", messageId: "stale-payload", revision: 13 });
    await Bun.sleep(0);
    expect(fake.requests()).toBe(3);
    expect(revisions).toEqual([11, 12]);
    binding.dispose();
  });
});
