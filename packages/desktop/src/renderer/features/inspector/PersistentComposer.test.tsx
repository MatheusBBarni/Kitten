import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PersistentComposer,
  type ComposerDeliveryState,
  type ComposerLifecycleStatus,
} from "./PersistentComposer.tsx";
import { TEST_ATTEMPT_ID, TEST_GENERATION } from "./testSupport.ts";

afterEach(cleanup);

function composer(input: Partial<Parameters<typeof PersistentComposer>[0]> = {}) {
  return (
    <PersistentComposer
      status="idle"
      attemptId={TEST_ATTEMPT_ID}
      generation={TEST_GENERATION}
      draft="Inspect the renderer"
      blockerActive={false}
      busy={false}
      onDraftChange={() => {}}
      onStartAttempt={() => {}}
      onSendDirection={() => {}}
      {...input}
    />
  );
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

  test("routes trimmed initial, active-direction, and request-changes text exactly once", () => {
    const starts: string[] = [];
    const directions: string[] = [];
    const changes: string[] = [];

    const initial = render(composer({
      draft: "  Start here  ",
      onStartAttempt: (text) => starts.push(text),
    }));
    fireEvent.submit(initial.getByRole("button", { name: "Start run" }).closest("form")!);
    fireEvent.submit(initial.getByRole("button", { name: "Start run" }).closest("form")!);
    expect(starts).toEqual(["Start here"]);
    cleanup();

    const active = render(composer({
      status: "running",
      mode: "active_direction",
      draft: "  Direction  ",
      onSendDirection: (text) => directions.push(text),
    }));
    fireEvent.submit(active.getByRole("button", { name: "Send message" }).closest("form")!);
    expect(directions).toEqual(["Direction"]);
    cleanup();

    const request = render(composer({
      status: "ready_for_review",
      mode: "request_changes",
      requestChangesAvailable: true,
      draft: "  Fix the regression  ",
      onRequestChanges: (text) => changes.push(text),
    }));
    fireEvent.submit(request.getByRole("button", { name: "Send change request" }).closest("form")!);
    expect(changes).toEqual(["Fix the regression"]);
  });

  test("submits on Enter but never on Shift+Enter, IME composition, repeat, busy, or duplicate keydown", () => {
    const submissions: string[] = [];
    const view = render(composer({
      draft: "Send once",
      onStartAttempt: (text) => submissions.push(text),
    }));
    const input = view.getByLabelText("Message");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(submissions).toEqual([]);

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submissions).toEqual(["Send once"]);
    cleanup();

    const busy = render(composer({
      busy: true,
      onStartAttempt: (text) => submissions.push(text),
    }));
    fireEvent.keyDown(busy.getByLabelText("Message"), { key: "Enter" });
    expect(submissions).toEqual(["Send once"]);
  });

  test("uses host delivery states and explicit retry without confirmation language", () => {
    const states: readonly ComposerDeliveryState[] = [
      "queued", "dispatching", "dispatched", "interrupted",
    ];
    const copy = states.map((deliveryState) => renderToStaticMarkup(composer({
      status: deliveryState === "interrupted" ? "failed" : "running",
      mode: deliveryState === "interrupted" ? "initial" : "active_direction",
      deliveryState,
    }))).join("\n");

    expect(copy).toContain("accepted and queued");
    expect(copy).toContain("is dispatching");
    expect(copy).toContain("was dispatched");
    expect(copy).toContain("retry explicitly");
    expect(copy).not.toContain("confirmation");

    const retried: string[] = [];
    const interrupted = render(composer({
      status: "failed",
      deliveryState: "interrupted",
      draft: "Restore exactly",
      onRetryInterrupted: (text) => retried.push(text),
    }));
    fireEvent.submit(interrupted.getByRole("button", { name: "Retry message" }).closest("form")!);
    expect(retried).toEqual(["Restore exactly"]);
  });

  test("keeps blocked and review-only drafts visible with next-action guidance", () => {
    const blocked = renderToStaticMarkup(composer({
      status: "needs_attention",
      blockerActive: true,
    }));
    const reviewOnly = renderToStaticMarkup(composer({
      status: "ready_for_review",
    }));
    const staleEvidence = renderToStaticMarkup(composer({
      status: "ready_for_review",
      mode: "request_changes",
      requestChangesAvailable: false,
    }));

    expect(blocked).toContain("Answer the active question");
    expect(reviewOnly).toContain("Open review and choose Request changes");
    expect(staleEvidence).toContain("Current review evidence is required");
    expect(blocked).toContain("Inspect the renderer");
    expect(reviewOnly).toContain("Inspect the renderer");
    expect(staleEvidence).toContain("Inspect the renderer");
  });
});
