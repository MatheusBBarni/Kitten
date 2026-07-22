import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ActivitySequence } from "@kitten/engine";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import { getCardInspectorProjection } from "../../../attempts/activityIngestor.ts";
import type { EventJournal, PersistenceSnapshot } from "../../../persistence/eventJournal.ts";
import type { HostMessageEnvelope } from "../../../shared/rpc.ts";
import { createCardInspectorEnvelope } from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import { inspectorCard, inspectorProjection, TEST_CARD_ID } from "./testSupport.ts";
import { CardInspector } from "./CardInspector.tsx";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";

afterEach(cleanup);

function fakeClient(options: { readonly unavailable?: boolean } = {}) {
  let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
  let requests = 0;
  const accepted = inspectorProjection();
  const starts: string[] = [];
  const client: DesktopRpcClient = {
    async getDesktopSnapshot() { throw new Error("not used"); },
    async getCardInspector() {
      requests += 1;
      if (options.unavailable) {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "not_ready" },
        });
      }
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
    async startAttempt(_commandId, input) {
      starts.push(input.initialPrompt);
      return { kind: "inspector_command_result", commandId: _commandId, result: { status: "ok" } };
    },
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
  return { client, emit: (message: HostMessageEnvelope) => subscriber?.(message), requests: () => requests, starts };
}

function renderInspector(inspector: React.ReactNode) {
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>{inspector}</QueryClientProvider>,
  );
}

describe("selected-card inspector binding", () => {
  test("opens a task side sheet with metadata, history, composer, and edit controls", async () => {
    const fake = fakeClient();
    const user = userEvent.setup();
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard()}
        isOpen
        onSaveTask={async () => true}
      />,
    );

    expect(await view.findByRole("dialog", { name: "Implement supervision surface" })).toBeDefined();
    expect(view.getByRole("dialog", { name: "Implement supervision surface" }).className).toContain("sm:w-[min(56rem,72vw)]");
    expect(view.getByText("Keep durable evidence visible")).toBeDefined();
    expect(view.getAllByText("codex").length).toBeGreaterThan(0);
    expect(view.getAllByText("gpt-5").length).toBeGreaterThan(0);
    expect(view.getByText("Persistent composer")).toBeDefined();
    expect(await view.findByText("Orchestrated Work History")).toBeDefined();

    await user.click(view.getByRole("button", { name: "Edit task" }));
    expect(await view.findByRole("dialog", { name: "Edit task" })).toBeDefined();
    expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Implement supervision surface");
    expect(view.getByRole("button", { name: "Save task" })).toBeDefined();
  });

  test("keeps idle start available when only inspector history is unavailable", async () => {
    const fake = fakeClient({ unavailable: true });
    const user = userEvent.setup();
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard("idle")}
        isOpen
        draftStore={{ read: () => "", write() {} }}
      />,
    );

    expect(await view.findByText("History is unavailable until the desktop host reconnects.")).toBeDefined();
    await user.type(view.getByLabelText("Message"), "Review the latest UI changes");
    const start = view.getByRole("button", { name: "Start run" });
    expect(start.hasAttribute("disabled")).toBeFalse();
    await user.click(start);
    await waitFor(() => expect(fake.starts).toEqual(["Review the latest UI changes"]));
  });

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
