import { afterEach, describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import type { WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import { workflowIds } from "../../../workflow/workflowTypes.ts";
import { StageSetupDialog } from "./StageSetupDialog.tsx";

const validSkillId = workflowIds.skill(`skill:${"a".repeat(64)}`);
const collisionSkillId = workflowIds.skill(`skill:${"b".repeat(64)}`);
const diagnostic = {
  diagnosticId: "diagnostic-collision",
  code: "name_collision" as const,
  severity: "error" as const,
  message: "Two catalog roots expose the name execute.",
  rootClass: "project" as const,
  configuredPath: "/repo/.agents/skills",
  canonicalPath: "/repo/.agents/skills",
  skillPath: "/repo/.agents/skills/execute/SKILL.md",
  displayName: "execute",
  relatedSkillIds: [validSkillId, collisionSkillId],
};
const catalog: WorkflowCatalogProjection = {
  kind: "workflow_catalog_projection",
  revision: 4,
  catalog: {
    catalogId: "default",
    roots: [],
    entries: [
      {
        skillId: validSkillId,
        canonicalPath: "/repo/.agents/skills/verify/SKILL.md",
        rootClass: "project",
        rootPath: "/repo/.agents/skills",
        digest: "a".repeat(64),
        metadata: { name: "verify", description: "Verify changes", frontmatter: {} },
        order: 0,
        hasNameCollision: false,
        diagnostics: [],
      },
      {
        skillId: collisionSkillId,
        canonicalPath: "/user/skills/execute/SKILL.md",
        rootClass: "user",
        rootPath: "/user/skills",
        digest: "b".repeat(64),
        metadata: { name: "execute", description: "Execute changes", frontmatter: {} },
        order: 1,
        hasNameCollision: true,
        diagnostics: [diagnostic],
      },
    ],
    diagnostics: [diagnostic],
  },
};

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
  test("offers only validated catalog identities and exposes collision diagnostics", () => {
    render(
      <StageSetupDialog
        catalog={catalog}
        label="Doing"
        selectedSkillId={validSkillId}
        busy={false}
        onLabelChange={noop}
        onSkillChange={noop}
        onCreate={noop}
        onClose={noop}
      />,
    );

    const markup = document.body.innerHTML;
    expect(document.body.textContent).toContain("Default Workflow Skill");
    expect(markup).toContain(`value="${validSkillId}"`);
    expect(markup).not.toContain(`value="${collisionSkillId}"`);
    expect(document.body.textContent).toContain("Name collision:");
    expect(document.body.textContent).toContain("Two catalog roots expose the name execute.");
    expect(document.body.textContent).toContain("Add unconfigured stage");
    expect(document.body.textContent).toContain("Add configured stage");
    expect(markup).not.toContain("type=\"text\" name=\"skill");
  });

  test("explains why configuration cannot continue when the catalog has no valid identity", () => {
    const invalidCatalog: WorkflowCatalogProjection = {
      ...catalog,
      catalog: { ...catalog.catalog, entries: [], diagnostics: [diagnostic] },
    };
    const view = render(
      <StageSetupDialog
        mode="configure"
        catalog={invalidCatalog}
        label="Doing"
        selectedSkillId={null}
        busy={false}
        onLabelChange={noop}
        onSkillChange={noop}
        onCreate={noop}
        onClose={noop}
      />,
    );

    expect(document.body.textContent).toContain("Fix the catalog diagnostics before configuring this stage.");
    const save = view.getByRole("button", { name: "Save stage Skill" });
    expect(save.hasAttribute("disabled")).toBeTrue();
    expect(document.body.textContent).not.toContain("Add unconfigured stage");
  });

  test("routes form, catalog selection, close, and unconfigured actions through semantic controls", () => {
    const labels: string[] = [];
    const skills: Array<typeof validSkillId | null> = [];
    const creations: boolean[] = [];
    let closes = 0;
    const view = StageSetupDialog({
      catalog,
      label: "Doing",
      selectedSkillId: validSkillId,
      busy: false,
      onLabelChange: (label) => labels.push(label),
      onSkillChange: (skillId) => skills.push(skillId),
      onCreate: (configured) => creations.push(configured),
      onClose: () => closes += 1,
    });

    const form = descendants(view, "form")[0]!;
    let prevented = 0;
    (form.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: () => prevented += 1 });
    (view.props.onOpenChange as (open: boolean) => void)(false);

    const input = elements(view).find(({ props }) => props.value === "Doing" && typeof props.onChange === "function")!;
    (input.props.onChange as (value: string) => void)("Review");
    const select = elements(view).find(({ props }) => props.label === "Default Workflow Skill")!;
    const selectChange = select.props.onChange as (value: string) => void;
    selectChange("");
    selectChange(validSkillId);

    const buttons = elements(view).filter(({ props }) => typeof props.onPress === "function");
    (buttons.find(({ props }) => props.children === "Cancel")!.props.onPress as () => void)();
    (buttons.find(({ props }) => props.children === "Add unconfigured stage")!.props.onPress as () => void)();

    expect(prevented).toBe(1);
    expect(labels).toEqual(["Review"]);
    expect(skills).toEqual([null, validSkillId]);
    expect(creations).toEqual([true, false]);
    expect(closes).toBe(2);
  });

  test("does not submit or close while busy or without a valid catalog selection", () => {
    let called = 0;
    const view = StageSetupDialog({
      catalog,
      label: "Doing",
      selectedSkillId: null,
      busy: true,
      onLabelChange: noop,
      onSkillChange: noop,
      onCreate: () => called += 1,
      onClose: () => called += 1,
    });
    (descendants(view, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({ preventDefault: noop });
    (view.props.onOpenChange as (open: boolean) => void)(false);
    expect(called).toBe(0);
  });
});
