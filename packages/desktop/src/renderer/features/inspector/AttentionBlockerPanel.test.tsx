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
    expect(markup).toContain("autofocus=\"\"");
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
    const buttons = descendants(view, "button");
    (buttons.find(({ props }) => props.children === "Skip question")!.props.onClick as () => void)();
    (buttons.find(({ props }) => props.children === "Cancel question")!.props.onClick as () => void)();
    expect(outcomes).toEqual([{ kind: "skipped" }, { kind: "cancelled" }]);
  });
});
