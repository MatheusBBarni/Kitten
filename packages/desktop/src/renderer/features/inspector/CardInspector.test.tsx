import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ActivitySequence } from "@kitten/engine";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import { getCardInspectorProjection } from "../../../attempts/activityIngestor.ts";
import type { EventJournal, PersistenceSnapshot } from "../../../persistence/eventJournal.ts";
import type { HostMessageEnvelope } from "../../../shared/rpc.ts";
import type { CardInspectorProjection } from "../../../attempts/inspectorProjection.ts";
import type { ReviewEvidenceManifest, SubmitCardPromptInput } from "../../../shared/rpc.ts";
import { createCardInspectorEnvelope } from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import {
  inspectorCard,
  inspectorProjection,
  reviewManifest,
  TEST_ATTEMPT_ID,
  TEST_BOARD_ID,
  TEST_CARD_ID,
  TEST_GENERATION,
} from "./testSupport.ts";
import { CardInspector } from "./CardInspector.tsx";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import { resetDesktopViewStore, useDesktopViewStore } from "../../state/desktopViewStore.ts";

afterEach(() => {
  cleanup();
  resetDesktopViewStore();
  window.localStorage.clear();
});

function fakeClient(options: {
  readonly unavailable?: boolean;
  readonly projection?: CardInspectorProjection;
  readonly manifest?: ReviewEvidenceManifest;
  readonly staleThirdRequest?: boolean;
} = {}) {
  let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
  let requests = 0;
  const accepted = options.projection ?? inspectorProjection();
  const starts: string[] = [];
  const submissions: SubmitCardPromptInput[] = [];
  let chunkRequests = 0;
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
      if (options.staleThirdRequest === true && requests === 3) {
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
    async getReviewManifest() {
      if (options.manifest === undefined) throw new Error("not used");
      return {
        kind: "review_manifest",
        result: { status: "ok", projection: options.manifest },
      };
    },
    async getReviewDiffChunk() {
      chunkRequests += 1;
      throw new Error("not used");
    },
    async getCatalog() { throw new Error("not used"); },
    async executeWorkflowCommand() { throw new Error("not used"); },
    async submitCardPrompt(input) {
      starts.push(input.content);
      submissions.push(input);
      return {
        kind: "submit_card_prompt_result",
        commandId: input.commandId,
        result: {
          status: "ok",
          outcome: input.activeAttempt === undefined ? "admitted" : "queued",
          cardVersion: input.expectedCardVersion + (input.activeAttempt === undefined ? 1 : 0),
          attemptId: input.activeAttempt?.attemptId ?? accepted.attempts.at(-1)!.attemptId,
          generation: input.activeAttempt?.generation ?? accepted.attempts.at(-1)!.generation,
        },
      };
    },
    async answerAttention() { throw new Error("not used"); },
    async getSettings() { throw new Error("not used"); },
    async updatePreferences() { throw new Error("not used"); },
    async updateProfileDefaults() { throw new Error("not used"); },
    async updateCatalogRoots() { throw new Error("not used"); },
    async setExecutionLimit() { throw new Error("not used"); },
    subscribe(listener) { subscriber = listener; return () => { subscriber = undefined; }; },
    dispose() {},
  };
  return {
    client,
    emit: (message: HostMessageEnvelope) => subscriber?.(message),
    requests: () => requests,
    starts,
    submissions,
    chunkRequests: () => chunkRequests,
  };
}

function renderInspector(inspector: React.ReactNode) {
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>{inspector}</QueryClientProvider>,
  );
}

describe("selected-card inspector binding", () => {
  test("binds selected attempt and draft state to the renderer view store", async () => {
    const fake = fakeClient();
    useDesktopViewStore.getState().openWorkbench({
      target: {
        repositoryKey: "/Users/name/projects/kitten",
        boardId: TEST_BOARD_ID,
        cardId: TEST_CARD_ID,
      },
      mode: "desktop",
      origin: {
        repositoryKey: "/Users/name/projects/kitten",
        boardId: TEST_BOARD_ID,
        boardMode: "active",
        anchor: { stageId: "stage-doing", cardId: TEST_CARD_ID, scrollLeft: 0, scrollTop: 0 },
        focusTargetId: `card-open-${TEST_CARD_ID}`,
      },
    });
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard()}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />,
    );

    await view.findByText("Orchestrated Work History");
    expect(useDesktopViewStore.getState().selectedAttemptId).toBe(TEST_ATTEMPT_ID);
    await userEvent.setup().type(view.getByLabelText("Message"), "Store-owned draft");
    expect(Object.values(useDesktopViewStore.getState().drafts)).toContain("Store-owned draft");
  });

  test("opens a labelled desktop workbench with metadata, history, composer, settings, and edit controls", async () => {
    const fake = fakeClient();
    const user = userEvent.setup();
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard()}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
        onSaveTask={async () => true}
      />,
    );

    const workbench = await view.findByRole("complementary", { name: "Implement supervision surface" });
    expect(workbench.getAttribute("data-workbench-presentation")).toBe("desktop");
    expect(within(workbench).getByRole("button", { name: /Settings/ })).toBeDefined();
    expect(within(workbench).getByRole("button", { name: "Close workbench" })).toBeDefined();
    expect(view.getByText("Keep durable evidence visible")).toBeDefined();
    expect(view.getAllByText("codex").length).toBeGreaterThan(0);
    expect(view.getAllByText("gpt-5").length).toBeGreaterThan(0);
    expect(view.getByText("Persistent composer")).toBeDefined();
    expect(await view.findByText("Orchestrated Work History")).toBeDefined();
    expect(document.querySelector(".motion-reduce\\:animate-none")).not.toBeNull();

    await user.click(view.getByRole("button", { name: "Edit task" }));
    expect(await view.findByRole("dialog", { name: "Edit task" })).toBeDefined();
    expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Implement supervision surface");
    expect(view.getByRole("button", { name: "Save task" })).toBeDefined();
  });

  test("exposes an explicit Back action in the narrow workbench", async () => {
    const fake = fakeClient();
    let open = true;
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard()}
        repositoryKey="/Users/name/projects/kitten"
        presentation="narrow"
        isOpen
        onOpenChange={(nextOpen) => {
          open = nextOpen;
        }}
      />,
    );

    const workbench = await view.findByRole("complementary", { name: "Implement supervision surface" });
    expect(workbench.getAttribute("data-workbench-presentation")).toBe("narrow");
    expect(within(workbench).queryByRole("button", { name: "Close workbench" })).toBeNull();
    await userEvent.setup().click(within(workbench).getByRole("button", { name: "Back to board" }));
    expect(open).toBeFalse();
  });

  test("keeps idle start available when only inspector history is unavailable", async () => {
    const fake = fakeClient({ unavailable: true });
    const user = userEvent.setup();
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard("idle")}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />,
    );

    expect(await view.findByText("History is unavailable until the desktop host reconnects.")).toBeDefined();
    await user.type(view.getByLabelText("Message"), "Review the latest UI changes");
    const start = view.getByRole("button", { name: "Start run" });
    expect(start.hasAttribute("disabled")).toBeFalse();
    await user.click(start);
    await waitFor(() => expect(fake.starts).toEqual(["Review the latest UI changes"]));
  });

  test("keeps the newest cockpit activity in view when history refreshes", async () => {
    const fake = fakeClient();
    const prior = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 640 });
    try {
      const view = renderInspector(
        <CardInspector
          client={fake.client}
          card={inspectorCard()}
          repositoryKey="/Users/name/projects/kitten"
          isOpen
        />,
      );
      await view.findByText("Orchestrated Work History");
      const history = document.querySelector<HTMLElement>(".inspector-history-scroll");
      if (history === null) throw new Error("missing inspector history surface");
      await waitFor(() => expect(history.scrollTop).toBe(640));
    } finally {
      if (prior === undefined) delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      else Object.defineProperty(HTMLElement.prototype, "scrollHeight", prior);
    }
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
      reviewEvidenceByCard: {
        [TEST_CARD_ID]: {
          evidenceId: "evidence-renderer-projection",
          evidenceDigest: "c".repeat(64),
          boardId: TEST_BOARD_ID,
          cardId: TEST_CARD_ID,
          attemptId: TEST_ATTEMPT_ID,
          generation: TEST_GENERATION,
          worktreeBindingId: "binding-renderer-projection",
          baseCommit: "base",
          headCommit: "head",
          policyVersion: 1,
          fileCount: 2,
          totalPatchBytes: 256,
          createdAt: 121,
        },
      },
    } as unknown as PersistenceSnapshot;
    const journal = { snapshot: () => snapshot } as EventJournal;

    const projection = getCardInspectorProjection(journal, TEST_CARD_ID);
    expect(projection?.schemaVersion).toBe(3);
    expect(projection?.attempts.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.attemptStates.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.followUpQueues.map(({ generation }) => Number(generation))).toEqual([1, 2]);
    expect(projection?.attentionBlockers.map(({ createdAt }) => createdAt)).toEqual([90, 110]);
    expect(projection?.reviewEvidence).toEqual([{
      evidenceId: "evidence-renderer-projection",
      evidenceDigest: "c".repeat(64),
      attemptId: TEST_ATTEMPT_ID,
      generation: TEST_GENERATION,
      worktreeBindingId: "binding-renderer-projection",
      fileCount: 2,
      totalPatchBytes: 256,
      createdAt: 121,
    }]);
    expect(getCardInspectorProjection(journal, "missing-card" as typeof TEST_CARD_ID)).toBeNull();
  });

  test("shows queued acceptance immediately and clears only the accepted draft", async () => {
    const fake = fakeClient();
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={inspectorCard("running")}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />,
    );
    const message = await view.findByLabelText("Message");
    await userEvent.setup().type(message, "Queue this direction{Enter}");

    await waitFor(() => expect(fake.submissions).toHaveLength(1));
    expect(fake.submissions[0]?.source).toBe("composer");
    expect(await view.findByText("Message accepted and queued for the next safe turn boundary.")).toBeDefined();
    expect(view.getByRole("status")).toBeDefined();
    expect((message as HTMLTextAreaElement).value).toBe("");
  });

  test("restores an interrupted draft exactly and dispatches only after explicit retry", async () => {
    const base = inspectorProjection({
      status: "failed",
      terminalOutcome: "interrupted",
      queue: "active",
    });
    const interrupted = {
      ...base,
      followUpQueues: [{
        ...base.followUpQueues[0]!,
        version: 3,
        updatedAt: 112,
        drafts: [{
          ...base.followUpQueues[0]!.drafts[0]!,
          text: "  Preserve exact retry text  ",
          state: "interrupted" as const,
          updatedAt: 112,
          dispatchingAt: 111,
          interruptedAt: 112,
        }],
      }],
    };
    const fake = fakeClient({ projection: interrupted });
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={interrupted.card}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />,
    );

    const message = await view.findByLabelText("Message") as HTMLTextAreaElement;
    await waitFor(() => expect(message.value).toBe("  Preserve exact retry text  "));
    expect(fake.submissions).toHaveLength(0);
    await userEvent.setup().click(view.getByRole("button", { name: "Retry message" }));
    await waitFor(() => expect(fake.submissions).toHaveLength(1));
    expect(fake.submissions[0]?.source).toBe("initial");
    expect(fake.submissions[0]?.content).toBe("Preserve exact retry text");
  });

  test("seeds and focuses Request changes without mutating the host", async () => {
    const projection = inspectorProjection({
      status: "ready_for_review",
      terminalOutcome: "succeeded",
    });
    const fake = fakeClient({ projection });
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={projection.card}
        repositoryKey="/Users/name/projects/kitten"
        draftSource="request_changes"
        isOpen
      />,
    );

    await view.findByText("Orchestrated Work History");
    const message = view.getByLabelText("Message") as HTMLTextAreaElement;
    expect(message.value).toBe("Please address these review findings:");
    expect(document.activeElement).toBe(message);
    expect(fake.submissions).toHaveLength(0);
    expect(view.getByRole("button", { name: "Send change request" })).toBeDefined();
  });

  test("opens review from the producing manifest without requesting a diff chunk", async () => {
    const projection = inspectorProjection({
      status: "ready_for_review",
      terminalOutcome: "succeeded",
      evidence: true,
    });
    const opened: string[] = [];
    const fake = fakeClient({ projection, manifest: reviewManifest() });
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={projection.card}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
        onOpenReview={(manifest) => opened.push(manifest.evidenceId)}
      />,
    );

    await userEvent.setup().click(await view.findByRole("button", { name: "Open review" }));
    expect(opened).toEqual(["evidence-inspector-renderer"]);
    expect(fake.chunkRequests()).toBe(0);
  });

  test("keeps attention-blocked drafts intact with next-action guidance", async () => {
    const projection = inspectorProjection({ status: "needs_attention", blocker: "active" });
    const fake = fakeClient({ projection });
    const view = renderInspector(
      <CardInspector
        client={fake.client}
        card={projection.card}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />,
    );
    const message = await view.findByLabelText("Message") as HTMLTextAreaElement;
    await userEvent.setup().type(message, "Keep this blocked draft");

    expect(message.value).toBe("Keep this blocked draft");
    expect(view.getByText("Answer the active question before sending this message. Your draft is saved.")).toBeDefined();
    expect(view.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBeTrue();
    expect(fake.submissions).toHaveLength(0);
  });

  test("preserves upward reading position and follows streamed refresh only near the end", async () => {
    const fake = fakeClient();
    let scrollHeight = 640;
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
    try {
      const view = renderInspector(
        <CardInspector
          client={fake.client}
          card={inspectorCard()}
          repositoryKey="/Users/name/projects/kitten"
          isOpen
        />,
      );
      await view.findByText("Orchestrated Work History");
      const history = document.querySelector<HTMLElement>(".inspector-history-scroll");
      if (history === null) throw new Error("missing inspector history surface");

      history.scrollTop = 200;
      fireEvent.scroll(history);
      scrollHeight = 700;
      fake.emit({ kind: "projection_committed", messageId: "upward-reader", revision: 13 });
      await waitFor(() => expect(fake.requests()).toBe(2));
      expect(history.scrollTop).toBe(200);

      history.scrollTop = 590;
      fireEvent.scroll(history);
      scrollHeight = 760;
      fake.emit({ kind: "projection_committed", messageId: "near-end-reader", revision: 14 });
      await waitFor(() => expect(fake.requests()).toBe(3));
      expect(history.scrollTop).toBe(760);
    } finally {
      if (heightDescriptor === undefined) delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      else Object.defineProperty(HTMLElement.prototype, "scrollHeight", heightDescriptor);
      if (clientDescriptor === undefined) delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      else Object.defineProperty(HTMLElement.prototype, "clientHeight", clientDescriptor);
    }
  });

  test("refreshes only matching activity and drops stale-card projections", async () => {
    const fake = fakeClient({ staleThirdRequest: true });
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
