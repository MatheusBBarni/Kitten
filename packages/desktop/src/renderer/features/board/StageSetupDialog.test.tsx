import { afterEach, describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import { StageSetupDialog } from "./StageSetupDialog.tsx";

const noop = () => {};

afterEach(cleanup);

function descendants(node: ReactNode, type: string): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child, type));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return (node.type === type ? [node] : []).concat(descendants(node.props.children as ReactNode, type));
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node].concat(elements(node.props.children as ReactNode));
}

describe("StageSetupDialog", () => {
  test("edits only the stage name and explains task-owned Skills", () => {
    const view = render(
      <StageSetupDialog
        label="Doing"
        busy={false}
        onLabelChange={noop}
        onSave={noop}
        onClose={noop}
      />,
    );

    expect(document.body.textContent).toContain("Stages define workflow status only.");
    expect(document.body.textContent).toContain("Each task chooses its own Workflow Skill.");
    expect(view.getByRole("textbox", { name: "Stage name" })).toBeDefined();
    expect(view.getByRole("button", { name: "Add stage" })).toBeDefined();
    expect(document.body.textContent).not.toContain("Default Workflow Skill");
  });

  test("routes form, input, and close actions through semantic controls", () => {
    const labels: string[] = [];
    let saves = 0;
    let closes = 0;
    const view = StageSetupDialog({
      label: "Doing",
      busy: false,
      onLabelChange: (label) => labels.push(label),
      onSave: () => saves += 1,
      onClose: () => closes += 1,
    });

    const form = descendants(view, "form")[0]!;
    let prevented = 0;
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: () => prevented += 1,
    });
    (view.props.onOpenChange as (open: boolean) => void)(false);
    const input = elements(view).find(({ props }) => props.value === "Doing" && typeof props.onChange === "function")!;
    (input.props.onChange as (value: string) => void)("Review");
    const cancel = elements(view).find(({ props }) => props.children === "Cancel")!;
    (cancel.props.onPress as () => void)();

    expect(prevented).toBe(1);
    expect(saves).toBe(1);
    expect(labels).toEqual(["Review"]);
    expect(closes).toBe(2);
  });

  test("uses the same focused form for renaming and blocks invalid or busy submission", () => {
    let called = 0;
    const rename = render(
      <StageSetupDialog
        mode="configure"
        label="Doing"
        busy={false}
        onLabelChange={noop}
        onSave={() => called += 1}
        onClose={noop}
      />,
    );
    expect(rename.getByRole("heading", { name: "Edit Doing" })).toBeDefined();
    expect(rename.getByRole("button", { name: "Save stage" })).toBeDefined();
    cleanup();

    const busy = StageSetupDialog({
      label: " ",
      busy: true,
      onLabelChange: noop,
      onSave: () => called += 1,
      onClose: () => called += 1,
    });
    (descendants(busy, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: noop,
    });
    (busy.props.onOpenChange as (open: boolean) => void)(false);
    expect(called).toBe(0);
  });
});
