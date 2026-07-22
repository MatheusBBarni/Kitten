import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FollowUpQueueId } from "../../../attempts/followUpQueue.ts";
import { PersistentComposer, type ComposerLifecycleStatus } from "./PersistentComposer.tsx";
import { inspectorProjection, TEST_ATTEMPT_ID, TEST_GENERATION, TEST_QUEUE_ID } from "./testSupport.ts";

function descendants(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return (node.type === type ? [node] : []).concat(descendants(node.props.children as ReactNode, type));
}

function composer(input: Partial<Parameters<typeof PersistentComposer>[0]> = {}) {
  return PersistentComposer({
    status: "idle",
    attemptId: TEST_ATTEMPT_ID,
    generation: TEST_GENERATION,
    queue: null,
    draft: "Inspect the renderer",
    blockerActive: false,
    busy: false,
    onDraftChange() {},
    onStartAttempt() {},
    onQueueFollowUp() {},
    onRemoveQueuedFollowUp() {},
    onConfirmQueuedFollowUp() {},
    ...input,
  });
}

describe("PersistentComposer", () => {
  test("remains rendered for every selected-card lifecycle state", () => {
    const states: readonly ComposerLifecycleStatus[] = [
      "idle", "running", "needs_attention", "failed", "cancelled", "interrupted", "ready_for_review", "completed",
    ];
    for (const status of states) {
      const markup = renderToStaticMarkup(composer({ status }));
      expect(markup).toContain("Persistent composer");
      expect(markup).toContain("Inspect the renderer");
    }
  });

  test("routes idle text only to startAttempt and running text only to queueFollowUp", () => {
    const starts: string[] = [];
    const queues: string[] = [];
    const submit = (view: ReactNode) => (
      descendants(view, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void
    )({ preventDefault() {} });

    submit(composer({ status: "idle", onStartAttempt: (text) => starts.push(text), onQueueFollowUp: (text) => queues.push(text) }));
    submit(composer({ status: "running", onStartAttempt: (text) => starts.push(text), onQueueFollowUp: (text) => queues.push(text) }));
    submit(composer({ status: "needs_attention", blockerActive: true, onStartAttempt: (text) => starts.push(text), onQueueFollowUp: (text) => queues.push(text) }));

    expect(starts).toEqual(["Inspect the renderer"]);
    expect(queues).toEqual(["Inspect the renderer"]);
  });

  test("renders FIFO removal and explicit head confirmation without automatic dispatch", () => {
    const queue = inspectorProjection({ queue: "settled" }).followUpQueues[0]!;
    const removed: FollowUpQueueId[] = [];
    const confirmed: FollowUpQueueId[] = [];
    const view = composer({
      status: "running",
      queue,
      onRemoveQueuedFollowUp: (queueId) => removed.push(queueId),
      onConfirmQueuedFollowUp: (queueId) => confirmed.push(queueId),
    });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("Ready for confirmation");
    expect(markup).toContain("Remove draft");
    expect(markup).toContain("Send confirmed follow-up");
    expect(confirmed).toEqual([]);

    const buttons = descendants(view, "button");
    (buttons.find(({ props }) => props.children === "Remove draft")!.props.onClick as () => void)();
    (buttons.find(({ props }) => props.children === "Send confirmed follow-up")!.props.onClick as () => void)();
    expect(removed).toEqual([TEST_QUEUE_ID]);
    expect(confirmed).toEqual([TEST_QUEUE_ID]);
  });
});
