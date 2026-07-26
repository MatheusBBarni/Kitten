import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersistentComposer, type ComposerLifecycleStatus } from "./PersistentComposer.tsx";
import { TEST_ATTEMPT_ID, TEST_GENERATION } from "./testSupport.ts";

function descendants(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return (node.type === type ? [node] : []).concat(descendants(node.props.children as ReactNode, type));
}

function action(node: ReactNode, label: string): ReactElement<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = actionOrNull(child, label);
      if (match !== null) return match;
    }
  }
  return actionOrNull(node, label)!;
}

function actionOrNull(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = actionOrNull(child, label);
      if (match !== null) return match;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (typeof node.props.onPress === "function" && node.props.children === label) return node;
  return actionOrNull(node.props.children as ReactNode, label);
}

function composer(input: Partial<Parameters<typeof PersistentComposer>[0]> = {}) {
  return PersistentComposer({
    status: "idle",
    attemptId: TEST_ATTEMPT_ID,
    generation: TEST_GENERATION,
    draft: "Inspect the renderer",
    blockerActive: false,
    busy: false,
    onDraftChange() {},
    onStartAttempt() {},
    onSendDirection() {},
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

  test("routes idle text only to startAttempt and running text only to sendDirection", () => {
    const starts: string[] = [];
    const directions: string[] = [];
    const submit = (view: ReactNode) => (
      descendants(view, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void
    )({ preventDefault() {} });

    submit(composer({ status: "idle", onStartAttempt: (text) => starts.push(text), onSendDirection: (text) => directions.push(text) }));
    submit(composer({ status: "running", onStartAttempt: (text) => starts.push(text), onSendDirection: (text) => directions.push(text) }));
    submit(composer({ status: "needs_attention", blockerActive: true, onStartAttempt: (text) => starts.push(text), onSendDirection: (text) => directions.push(text) }));

    expect(starts).toEqual(["Inspect the renderer"]);
    expect(directions).toEqual(["Inspect the renderer"]);
  });

  test("uses cockpit-like immediate send language without confirmation controls", () => {
    const view = composer({ status: "running" });
    const markup = renderToStaticMarkup(view);
    expect(markup).toContain("Steer active task");
    expect(markup).toContain("Press Enter to send a direction");
    expect(markup).toContain("Send message");
    expect(markup).not.toContain("Queue a follow-up");
    expect(markup).not.toContain("confirmation");
  });
});
