import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowBoardProjection, WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import { workflowIds, type CardProjection, type StageProjection } from "../../../workflow/workflowTypes.ts";
import { boardInteractionMessage } from "./boardInteractions.ts";
import { BlankBoardSetup, BoardCanvas } from "./WorkflowBoard.tsx";
import { ProjectSidebar, projectName } from "./ProjectSidebar.tsx";

const boardId = workflowIds.board("board-render");
const backlogId = workflowIds.stage("stage-backlog");
const doingId = workflowIds.stage("stage-doing");
const skillId = workflowIds.skill(`skill:${"c".repeat(64)}`);
const stages: readonly StageProjection[] = [
  { stageId: backlogId, boardId, label: "Backlog", position: 0, defaultSkillId: skillId, configured: true, workflowVersion: 5, updatedAt: 5 },
  { stageId: doingId, boardId, label: "Doing", position: 1, defaultSkillId: skillId, configured: true, workflowVersion: 5, updatedAt: 5 },
];

function card(
  id: string,
  title: string,
  executionStatus: CardProjection["executionStatus"],
): CardProjection {
  return {
    cardId: workflowIds.card(id),
    boardId,
    stageId: backlogId,
    title,
    description: title,
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus,
    version: 2,
    createdAt: 1,
    updatedAt: 2,
  };
}

const runningCard = card("card-running", "Running task", "running");
const attentionCard = card("card-attention", "Blocked task", "needs_attention");
const idleCard = card("card-idle", "Ready task", "idle");
const projection: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 9,
  board: { boardId, repositoryPath: "/repo", workflowVersion: 5, createdAt: 1, updatedAt: 5 },
  stages,
  edges: [{ boardId, sourceStageId: backlogId, targetStageId: doingId, workflowVersion: 5 }],
  cards: [runningCard, attentionCard, idleCard],
};
const catalog: WorkflowCatalogProjection = {
  kind: "workflow_catalog_projection",
  revision: 9,
  catalog: {
    catalogId: "default",
    roots: [],
    diagnostics: [],
    entries: [{
      skillId,
      canonicalPath: "/repo/.agents/skills/verify/SKILL.md",
      rootClass: "project",
      rootPath: "/repo/.agents/skills",
      digest: "c".repeat(64),
      metadata: { name: "verify", description: "Verify work", frontmatter: {} },
      order: 0,
      hasNameCollision: false,
      diagnostics: [],
    }],
  },
};
const noop = () => {};

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

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement<Record<string, unknown>>(node)) return "";
  return textContent(node.props.children as ReactNode);
}

function button(view: ReactNode, label: string): ReactElement<Record<string, unknown>> {
  const matches = (node: ReactNode): ReactElement<Record<string, unknown>> | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = matches(child);
        if (match !== null) return match;
      }
      return null;
    }
    if (!isValidElement<Record<string, unknown>>(node)) return null;
    const isAction = typeof node.props.onPress === "function" || node.props.type === "submit";
    if (isAction && (textContent(node.props.children as ReactNode).trim() === label || node.props["aria-label"] === label)) {
      return node;
    }
    return matches(node.props.children as ReactNode);
  };
  return matches(view)!;
}

describe("WorkflowBoard", () => {
  test("renders an explicit editable starter choice and a separate manual path", () => {
    const markup = renderToStaticMarkup(
      <BlankBoardSetup
        mode="starter"
        repositoryPath="/repo"
        starterLabels={["Backlog", "Doing"]}
        busy={false}
        onModeChange={noop}
        onChooseRepository={noop}
        onStarterLabelChange={noop}
        onApplyStarter={noop}
        onCreateManual={noop}
      />,
    );

    expect(markup).toContain("Edit starter workflow");
    expect(markup).toContain("Start empty");
    expect(markup).toContain("Rename the stages now");
    expect(markup).toContain("value=\"Backlog\"");
    expect(markup).toContain("value=\"Doing\"");
    expect(markup).toContain("Create starter workflow");
  });

  test("renders each persisted board as an accessible project session", () => {
    const markup = renderToStaticMarkup(
      <ProjectSidebar
        workspace={{
          kind: "workspace_projection",
          revision: 9,
          boards: [{
            boardId,
            repositoryPath: "/Users/name/projects/kitten",
            createdAt: 1,
            updatedAt: 9,
            workflowVersion: 5,
          }],
        }}
        activeBoardId={boardId}
        busy={false}
        onOpenProject={noop}
        onAddBoard={noop}
        onSelectBoard={noop}
        onEditPath={noop}
      />,
    );

    expect(projectName("C:\\Projects\\kitten")).toBe("kitten");
    expect(markup).toContain("Open project");
    expect(markup).toContain("kitten");
    expect(markup).not.toContain("/Users/name/projects/kitten");
    expect(markup).not.toContain("Workflow board</");
    expect(markup).not.toContain(">Settings<");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Project actions for kitten");
  });

  test("separates stage and execution labels and locks active or attention movement", () => {
    const markup = renderToStaticMarkup(
      <BoardCanvas
        projection={projection}
        catalog={catalog}
        selectedCardId={idleCard.cardId}
        busy={false}
        draggedStageId={null}
        onConfigureStage={noop}
        onReorder={noop}
        onEditPath={noop}
        onMoveCard={noop}
        onSelectCard={noop}
        onDragStart={noop}
        onDragEnd={noop}
      />,
    );

    expect(markup).toContain("Running task");
    expect(markup).toContain("Blocked task");
    expect(markup).toContain("Ready task");
    expect(markup).toContain("Stage Lock: movement is disabled while Execution Status is running.");
    expect(markup).toContain("Stage Lock: movement is disabled while Execution Status is needs_attention.");
    expect(markup).toContain("needs attention");
    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup).toContain("Move Backlog earlier");
    expect(markup).toContain("Move Backlog later");
    expect(markup).toContain("Next stage: Doing");
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("announces typed stale workflow and card conflicts with recovery copy", () => {
    expect(boardInteractionMessage({
      status: "conflict",
      conflict: { kind: "stale_workflow", boardId, expectedVersion: 4, actualVersion: 5 },
    })).toBe(
      "Workflow changed before this action was committed. Expected version 4, now 5. Review the refreshed board and try again.",
    );
    expect(boardInteractionMessage({
      status: "conflict",
      conflict: { kind: "stale_card", cardId: idleCard.cardId, expectedVersion: 1, actualVersion: 2 },
    })).toContain("Card changed before this action was committed");
  });

  test("routes editable starter and manual forms through their keyboard-operable controls", () => {
    const modes: string[] = [];
    const labels: Array<[number, string]> = [];
    let starterCreates = 0;
    let manualCreates = 0;
    let folderPickerRequests = 0;
    const starter = BlankBoardSetup({
      mode: "starter",
      repositoryPath: "/repo",
      starterLabels: ["Backlog", "Doing"],
      busy: false,
      onModeChange: (mode) => modes.push(mode),
      onChooseRepository: () => folderPickerRequests += 1,
      onStarterLabelChange: (index, label) => labels.push([index, label]),
      onApplyStarter: () => starterCreates += 1,
      onCreateManual: () => manualCreates += 1,
    });

    (button(starter, "Edit starter workflow").props.onPress as () => void)();
    (button(starter, "Start empty").props.onPress as () => void)();
    (button(starter, "Change folder").props.onPress as () => void)();
    const inputs = elements(starter).filter(({ props }) => typeof props.onChange === "function" && typeof props.value === "string");
    const change = (element: ReactElement<Record<string, unknown>>, value: string) => (
      element.props.onChange as (value: string) => void
    )(value);
    change(inputs[0]!, "Inbox");
    let prevented = 0;
    (descendants(starter, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: () => prevented += 1,
    });

    const manual = BlankBoardSetup({
      mode: "manual",
      repositoryPath: "/repo",
      starterLabels: [],
      busy: false,
      onModeChange: noop,
      onChooseRepository: noop,
      onStarterLabelChange: noop,
      onApplyStarter: () => starterCreates += 1,
      onCreateManual: () => manualCreates += 1,
    });
    (descendants(manual, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: () => prevented += 1,
    });

    expect(modes).toEqual(["starter", "manual"]);
    expect(labels).toEqual([[0, "Inbox"]]);
    expect(folderPickerRequests).toBe(1);
    expect(starterCreates).toBe(1);
    expect(manualCreates).toBe(1);
    expect(prevented).toBe(2);
  });

  test("makes the repository surface itself open the picker and blocks board creation until a folder is selected", () => {
    let pickerRequests = 0;
    let manualCreates = 0;
    const empty = BlankBoardSetup({
      mode: "manual",
      repositoryPath: "",
      starterLabels: [],
      busy: false,
      onModeChange: noop,
      onChooseRepository: () => pickerRequests += 1,
      onStarterLabelChange: noop,
      onApplyStarter: noop,
      onCreateManual: () => manualCreates += 1,
    });

    (button(empty, "No folder selected").props.onPress as () => void)();
    expect(button(empty, "Create empty board").props.isDisabled).toBe(true);
    (descendants(empty, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault() {},
    });
    expect(pickerRequests).toBe(1);
    expect(manualCreates).toBe(0);
  });

  test("renders stable reorder, path, configure, movement, and inspector controls", () => {
    expect(renderToStaticMarkup(
      <BoardCanvas
        projection={{ ...projection, board: null }}
        catalog={catalog}
        selectedCardId={null}
        busy={false}
        draggedStageId={null}
        onConfigureStage={noop}
        onReorder={noop}
        onEditPath={noop}
        onMoveCard={noop}
        onSelectCard={noop}
        onDragStart={noop}
        onDragEnd={noop}
      />,
    )).toBe("");

    const unconfiguredStages: readonly StageProjection[] = [
      { ...stages[0]!, configured: false, defaultSkillId: null },
      stages[1]!,
    ];
    const disconnected = { ...projection, stages: unconfiguredStages, edges: [] };
    const markup = renderToStaticMarkup(
      <BoardCanvas
        projection={disconnected}
        catalog={catalog}
        selectedCardId={null}
        busy={false}
        draggedStageId={backlogId}
        onConfigureStage={noop}
        onReorder={noop}
        onEditPath={noop}
        onMoveCard={noop}
        onSelectCard={noop}
        onDragStart={noop}
        onDragEnd={noop}
      />,
    );

    expect(markup).toContain("Connect path");
    expect(markup).toContain("Configure Backlog");
    expect(markup).toContain("Move Backlog later");
    expect(markup).toContain("Drag Backlog to reorder");
    expect(markup).toContain("absolute inset-0 cursor-grab");
    expect(markup).toContain("Running task");
  });
});
