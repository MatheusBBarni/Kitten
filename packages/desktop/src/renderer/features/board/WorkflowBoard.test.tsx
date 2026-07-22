import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowBoardProjection, WorkflowCatalogProjection } from "../../../shared/rpc.ts";
import { workflowIds, type CardProjection, type StageProjection } from "../../../workflow/workflowTypes.ts";
import { boardInteractionMessage } from "./boardInteractions.ts";
import { BlankBoardSetup, BoardCanvas } from "./WorkflowBoard.tsx";

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

function button(view: ReactNode, label: string): ReactElement<Record<string, unknown>> {
  return descendants(view, "button").find(({ props }) => props.children === label)!;
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
        onRepositoryPathChange={noop}
        onStarterLabelChange={noop}
        onApplyStarter={noop}
        onCreateManual={noop}
      />,
    );

    expect(markup).toContain("Edit starter template");
    expect(markup).toContain("Set up manually");
    expect(markup).toContain("Existing workflows are never replaced");
    expect(markup).toContain("value=\"Backlog\"");
    expect(markup).toContain("value=\"Doing\"");
    expect(markup).toContain("Create starter workflow");
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
        onConnect={noop}
        onMoveCard={noop}
        onSelectCard={noop}
        onDragStart={noop}
      />,
    );

    expect(markup.match(/<dt>Workflow Stage<\/dt>/g)).toHaveLength(3);
    expect(markup.match(/<dt>Execution Status<\/dt>/g)).toHaveLength(3);
    expect(markup).toContain("Stage Lock: movement is disabled while Execution Status is running.");
    expect(markup).toContain("Stage Lock: movement is disabled while Execution Status is needs_attention.");
    expect(markup).toContain("Attention required");
    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup).toContain("Move earlier");
    expect(markup).toContain("Move later");
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
    const paths: string[] = [];
    const labels: Array<[number, string]> = [];
    let starterCreates = 0;
    let manualCreates = 0;
    const starter = BlankBoardSetup({
      mode: "starter",
      repositoryPath: "/repo",
      starterLabels: ["Backlog", "Doing"],
      busy: false,
      onModeChange: (mode) => modes.push(mode),
      onRepositoryPathChange: (path) => paths.push(path),
      onStarterLabelChange: (index, label) => labels.push([index, label]),
      onApplyStarter: () => starterCreates += 1,
      onCreateManual: () => manualCreates += 1,
    });

    (button(starter, "Edit starter template").props.onClick as () => void)();
    (button(starter, "Set up manually").props.onClick as () => void)();
    const inputs = descendants(starter, "input");
    const change = (element: ReactElement<Record<string, unknown>>, value: string) => (
      element.props.onChange as (event: { currentTarget: { value: string } }) => void
    )({ currentTarget: { value } });
    change(inputs[0]!, "/next-repo");
    change(inputs[1]!, "Inbox");
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
      onRepositoryPathChange: noop,
      onStarterLabelChange: noop,
      onApplyStarter: () => starterCreates += 1,
      onCreateManual: () => manualCreates += 1,
    });
    (descendants(manual, "form")[0]!.props.onSubmit as (event: { preventDefault(): void }) => void)({
      preventDefault: () => prevented += 1,
    });

    expect(modes).toEqual(["starter", "manual"]);
    expect(paths).toEqual(["/next-repo"]);
    expect(labels).toEqual([[0, "Inbox"]]);
    expect(starterCreates).toBe(1);
    expect(manualCreates).toBe(1);
    expect(prevented).toBe(2);
  });

  test("proposes only stable reorder, connect, configure, movement, and inspector intents", () => {
    expect(BoardCanvas({
      projection: { ...projection, board: null },
      catalog,
      selectedCardId: null,
      busy: false,
      draggedStageId: null,
      onConfigureStage: noop,
      onReorder: noop,
      onConnect: noop,
      onMoveCard: noop,
      onSelectCard: noop,
      onDragStart: noop,
    })).toBeNull();

    const reorders: unknown[] = [];
    const movements: string[] = [];
    const selections: string[] = [];
    const drags: string[] = [];
    const configurations: string[] = [];
    let connects = 0;
    const unconfiguredStages: readonly StageProjection[] = [
      { ...stages[0]!, configured: false, defaultSkillId: null },
      stages[1]!,
    ];
    const disconnected = { ...projection, stages: unconfiguredStages, edges: [] };
    const createView = (draggedStageId: typeof backlogId | null) => BoardCanvas({
      projection: disconnected,
      catalog,
      selectedCardId: null,
      busy: false,
      draggedStageId,
      onConfigureStage: (stage) => configurations.push(stage.stageId),
      onReorder: (intent) => reorders.push(intent),
      onConnect: () => connects += 1,
      onMoveCard: (selected, targetStageId) => movements.push(`${selected.cardId}:${targetStageId}`),
      onSelectCard: (selected) => selections.push(selected.cardId),
      onDragStart: (stageId) => drags.push(stageId),
    });
    const view = createView(null);

    (button(view, "Connect ordered path").props.onClick as () => void)();
    (button(view, "Configure stage Skill").props.onClick as () => void)();
    (button(view, "Move later").props.onClick as () => void)();
    (button(view, "Move earlier").props.onClick as () => void)();
    const cards = descendants(view, "button").filter(({ props }) => props.className === "card-title-button");
    (cards[0]!.props.onClick as () => void)();
    const connectedView = BoardCanvas({
      projection: { ...projection, stages: unconfiguredStages },
      catalog,
      selectedCardId: null,
      busy: false,
      draggedStageId: null,
      onConfigureStage: noop,
      onReorder: noop,
      onConnect: noop,
      onMoveCard: (selected, targetStageId) => movements.push(`${selected.cardId}:${targetStageId}`),
      onSelectCard: noop,
      onDragStart: noop,
    });
    const moveButtons = descendants(connectedView, "button").filter(({ props }) => props.children === "Move to next stage");
    (moveButtons.at(-1)!.props.onClick as () => void)();

    const stageColumn = descendants(view, "li").find(({ props }) => props.draggable === true)!;
    (stageColumn.props.onDragStart as () => void)();
    let prevented = 0;
    (stageColumn.props.onDragOver as (event: { preventDefault(): void }) => void)({ preventDefault: () => prevented += 1 });
    const drop = stageColumn.props.onDrop as (event: {
      preventDefault(): void;
      clientX: number;
      currentTarget: { getBoundingClientRect(): { left: number; width: number } };
    }) => void;
    drop({ preventDefault: () => prevented += 1, clientX: 2, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 10 }) } });

    const draggedView = createView(backlogId);
    const doingColumn = descendants(draggedView, "li").filter(({ props }) => props.draggable === true)[1]!;
    (doingColumn.props.onDrop as typeof drop)({
      preventDefault: () => prevented += 1,
      clientX: 9,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 10 }) },
    });

    expect(connects).toBe(1);
    expect(configurations).toEqual([backlogId]);
    expect(drags).toEqual([backlogId]);
    expect(selections).toEqual([runningCard.cardId]);
    expect(movements).toEqual([`${idleCard.cardId}:${doingId}`]);
    expect(reorders).toHaveLength(2);
    expect(prevented).toBe(3);
  });
});
