import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttentionOutcome } from "../../../attention/contracts.ts";
import { AttentionBlockerPanel, attentionAnswersFromForm } from "./AttentionBlockerPanel.tsx";
import { attentionBlocker } from "./testSupport.ts";

function descendants(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return (node.type === type ? [node] : []).concat(descendants(node.props.children as ReactNode, type));
}

function action(node: ReactNode, label: string): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = action(child, label);
      if (match !== null) return match;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (typeof node.props.onPress === "function" && node.props.children === label) return node;
  return action(node.props.children as ReactNode, label);
}

describe("AttentionBlockerPanel", () => {
  test("renders a labeled answer-first form with live status and initial focus", () => {
    const blocker = attentionBlocker();
    const markup = renderToStaticMarkup(
      <AttentionBlockerPanel blocker={blocker} busy={false} onOutcome={() => {}} />,
    );
    expect(markup).toContain("Attention required");
    expect(markup).toContain("Choose the verification scope");
    expect(markup).toContain("Which verification gate should run?");
    expect(markup).toContain("aria-live=\"assertive\"");
    expect(markup).toContain("tabindex=\"0\"");
    expect(markup).toContain("Submit answer");
    expect(markup).toContain("Skip question");
    expect(markup).toContain("Cancel question");
  });

  test("builds structured answers and exposes explicit skip and cancel outcomes", () => {
    const blocker = attentionBlocker();
    const formData = new FormData();
    formData.append("attention:scope", "full");
    formData.append("attention-custom:notes", "Run coverage too");
    expect(attentionAnswersFromForm(blocker, formData)).toEqual({
      scope: { selectedOptionIds: ["full"] },
      notes: { selectedOptionIds: [], customText: "Run coverage too" },
    });
    expect(attentionAnswersFromForm(blocker, new FormData())).toBeNull();

    const outcomes: AttentionOutcome[] = [];
    const view = AttentionBlockerPanel({ blocker, busy: false, onOutcome: (outcome) => outcomes.push(outcome) });
    (action(view, "Skip question")!.props.onPress as () => void)();
    (action(view, "Cancel question")!.props.onPress as () => void)();
    expect(outcomes).toEqual([{ kind: "skipped" }, { kind: "cancelled" }]);
  });
});
