import { describe, expect, test } from "bun:test";
import type { DesktopRpcClient } from "../../client.ts";
import {
  createWorkflowCommandEnvelope,
  type HostMessageEnvelope,
  type WorkflowBoardProjection,
  type WorkflowCatalogProjection,
  type WorkflowCommandRpcResult,
} from "../../../shared/rpc.ts";
import {
  workflowIds,
  type CardProjection,
  type StageProjection,
  type WorkflowCommand,
} from "../../../workflow/workflowTypes.ts";
import {
  applyStarterTemplate,
  assignCatalogSkillToStage,
  boardInteractionMessage,
  cardMovementAffordance,
  connectStagesCommand,
  createBlankBoard,
  createBrowserIdentityFactory,
  createStageWithCatalogSkill,
  executeBoardCommand,
  moveCardCommand,
  reorderStagesCommand,
  selectableCatalogEntries,
  stageConfigurationReason,
  type IdentityFactory,
} from "./boardInteractions.ts";

const boardId = workflowIds.board("board-interactions");
const firstStageId = workflowIds.stage("stage-first");
const secondStageId = workflowIds.stage("stage-second");
const skillId = workflowIds.skill(`skill:${"e".repeat(64)}`);
const invalidSkillId = workflowIds.skill(`skill:${"f".repeat(64)}`);

const board = { boardId, repositoryPath: "/repo", workflowVersion: 3, createdAt: 1, updatedAt: 3 };
const stages: readonly StageProjection[] = [
  { stageId: firstStageId, boardId, label: "Backlog", position: 0, defaultSkillId: skillId, configured: true, workflowVersion: 3, updatedAt: 3 },
  { stageId: secondStageId, boardId, label: "Doing", position: 1, defaultSkillId: skillId, configured: true, workflowVersion: 3, updatedAt: 3 },
];
const projection: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 3,
  board,
  stages,
  edges: [{ boardId, sourceStageId: firstStageId, targetStageId: secondStageId, workflowVersion: 3 }],
  cards: [],
};
const blank: WorkflowBoardProjection = { ...projection, revision: 0, board: null, stages: [], edges: [], cards: [] };
const catalog: WorkflowCatalogProjection = {
  kind: "workflow_catalog_projection",
  revision: 1,
  catalog: {
    catalogId: "default",
    roots: [],
    diagnostics: [],
    entries: [{
      skillId,
      canonicalPath: "/repo/.agents/skills/execute/SKILL.md",
      rootClass: "project",
      rootPath: "/repo/.agents/skills",
      digest: "e".repeat(64),
      metadata: { name: "execute", description: "Execute", frontmatter: {} },
      order: 0,
      hasNameCollision: false,
      diagnostics: [],
    }, {
      skillId: invalidSkillId,
      canonicalPath: "/user/skills/execute/SKILL.md",
      rootClass: "user",
      rootPath: "/user/skills",
      digest: "f".repeat(64),
      metadata: { name: "execute", description: "Collision", frontmatter: {} },
      order: 1,
      hasNameCollision: true,
      diagnostics: [],
    }],
  },
};

class Identities implements IdentityFactory {
  sequence = 0;
  next(scope: "board" | "stage" | "mutation" | "command") {
    return `${scope}-${++this.sequence}`;
  }
}

class QueueClient implements DesktopRpcClient {
  readonly commands: WorkflowCommand[] = [];
  constructor(private readonly results: WorkflowCommandRpcResult[]) {}
  async executeWorkflowCommand(commandId: string, command: WorkflowCommand) {
    this.commands.push(command);
    const result = this.results.shift();
    if (result === undefined) throw new Error("missing queued result");
    return createWorkflowCommandEnvelope(commandId, result);
  }
  async getDesktopSnapshot(): Promise<never> { throw new Error("not used"); }
  async getCardInspector(): Promise<never> { throw new Error("not used"); }
  async getBoard(): Promise<never> { throw new Error("not used"); }
  async getCatalog(): Promise<never> { throw new Error("not used"); }
  async startAttempt(): Promise<never> { throw new Error("not used"); }
  async queueFollowUp(): Promise<never> { throw new Error("not used"); }
  async removeQueuedFollowUp(): Promise<never> { throw new Error("not used"); }
  async confirmQueuedFollowUp(): Promise<never> { throw new Error("not used"); }
  async answerAttention(): Promise<never> { throw new Error("not used"); }
  async getSettings(): Promise<never> { throw new Error("not used"); }
  async updatePreferences(): Promise<never> { throw new Error("not used"); }
  async updateProfileDefaults(): Promise<never> { throw new Error("not used"); }
  async updateCatalogRoots(): Promise<never> { throw new Error("not used"); }
  async setExecutionLimit(): Promise<never> { throw new Error("not used"); }
  subscribe(_listener: (message: HostMessageEnvelope) => void) { return () => {}; }
  dispose() {}
}

function ok(nextProjection: WorkflowBoardProjection): WorkflowCommandRpcResult {
  return { status: "ok", outcome: "committed", projection: nextProjection };
}

function card(status: CardProjection["executionStatus"]): CardProjection {
  return {
    cardId: workflowIds.card(`card-${status}`),
    boardId,
    stageId: firstStageId,
    title: status,
    description: status,
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: status,
    version: 2,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("board interactions", () => {
  test("filters catalog identities and explains every non-runnable stage state", () => {
    expect(selectableCatalogEntries(catalog).map(({ skillId: id }) => id)).toEqual([skillId]);
    expect(stageConfigurationReason({ ...stages[0]!, configured: false }, catalog)).toContain("not selected");
    expect(stageConfigurationReason({ ...stages[0]!, defaultSkillId: invalidSkillId }, catalog)).toContain("no longer valid");
    expect(stageConfigurationReason(stages[0]!, catalog)).toBeNull();
    expect(createBrowserIdentityFactory().next("board")).toStartWith("board:");
  });

  test("exposes settled immediate-successor movement and explicit locks", () => {
    expect(cardMovementAffordance(blank, card("idle"))).toEqual({
      allowed: false,
      targetStageId: null,
      reason: "Workflow Board is not configured.",
    });
    expect(cardMovementAffordance(projection, card("running"))).toMatchObject({ allowed: false, targetStageId: secondStageId });
    expect(cardMovementAffordance(projection, card("needs_attention")).reason).toContain("Stage Lock");
    expect(cardMovementAffordance({ ...projection, edges: [] }, card("idle"))).toMatchObject({ allowed: false, targetStageId: null });
    expect(cardMovementAffordance(projection, card("idle"))).toEqual({
      allowed: true,
      targetStageId: secondStageId,
      reason: "Move to the immediate successor.",
    });
  });

  test("validates blank setup and creates a board only through typed commands", async () => {
    const identities = new Identities();
    const client = new QueueClient([ok(projection)]);
    expect(await createBlankBoard(client, projection, "/repo", identities)).toMatchObject({ status: "invalid" });
    expect(await createBlankBoard(client, blank, "   ", identities)).toMatchObject({ status: "invalid" });
    expect(await createBlankBoard(client, blank, " /repo ", identities)).toMatchObject({ status: "ok" });
    expect(client.commands[0]).toMatchObject({ kind: "bind_repository", repositoryPath: "/repo" });
  });

  test("applies an editable starter as sequential version-fenced commands", async () => {
    const firstProjection = { ...projection, stages: [stages[0]!], edges: [] };
    const client = new QueueClient([
      ok({ ...blank, board: { ...board, workflowVersion: 1 } }),
      ok(firstProjection),
      ok(projection),
      ok(projection),
    ]);
    expect(await applyStarterTemplate(client, blank, "/repo", [], new Identities())).toMatchObject({ status: "invalid" });
    expect(await applyStarterTemplate(client, blank, "/repo", ["Backlog", "Doing"], new Identities())).toMatchObject({ status: "ok" });
    expect(client.commands.map(({ kind }) => kind)).toEqual([
      "bind_repository",
      "create_stage",
      "create_stage",
      "connect_stages",
    ]);

    const conflict: WorkflowCommandRpcResult = {
      status: "conflict",
      conflict: { kind: "stale_workflow", boardId, expectedVersion: 1, actualVersion: 2 },
    };
    expect(await applyStarterTemplate(new QueueClient([conflict]), blank, "/repo", ["Backlog"], new Identities())).toBe(conflict);
  });

  test("creates configured or unconfigured stages only from catalog identities", async () => {
    expect(await createStageWithCatalogSkill(new QueueClient([]), blank, "Doing", skillId, catalog, new Identities())).toMatchObject({ status: "invalid" });
    expect(await createStageWithCatalogSkill(new QueueClient([]), projection, " ", skillId, catalog, new Identities())).toMatchObject({ status: "invalid" });
    expect(await createStageWithCatalogSkill(new QueueClient([]), projection, "Doing", invalidSkillId, catalog, new Identities())).toMatchObject({ status: "invalid" });

    const createdProjection = { ...projection, board: { ...board, workflowVersion: 4 } };
    const unconfigured = new QueueClient([ok(createdProjection)]);
    expect(await createStageWithCatalogSkill(unconfigured, projection, " Review ", null, catalog, new Identities())).toMatchObject({ status: "ok" });
    expect(unconfigured.commands).toHaveLength(1);

    const configured = new QueueClient([ok(createdProjection), ok(createdProjection)]);
    expect(await createStageWithCatalogSkill(configured, projection, "Review", skillId, catalog, new Identities())).toMatchObject({ status: "ok" });
    expect(configured.commands.map(({ kind }) => kind)).toEqual(["create_stage", "assign_stage_skill"]);
  });

  test("configures existing stages and rejects stale renderer selections", async () => {
    expect(await assignCatalogSkillToStage(new QueueClient([]), blank, firstStageId, skillId, catalog, new Identities())).toMatchObject({ status: "invalid" });
    expect(await assignCatalogSkillToStage(new QueueClient([]), projection, firstStageId, invalidSkillId, catalog, new Identities())).toMatchObject({ status: "invalid" });
    expect(await assignCatalogSkillToStage(new QueueClient([]), projection, workflowIds.stage("gone"), skillId, catalog, new Identities())).toMatchObject({ status: "invalid" });
    const client = new QueueClient([ok(projection)]);
    expect(await assignCatalogSkillToStage(client, projection, firstStageId, skillId, catalog, new Identities())).toMatchObject({ status: "ok" });
    expect(client.commands[0]?.kind).toBe("assign_stage_skill");
  });

  test("builds only linear reorder, connect, and settled movement commands", async () => {
    const identities = new Identities();
    const reorder = reorderStagesCommand({
      boardId,
      expectedWorkflowVersion: 3,
      movedStageId: firstStageId,
      orderedStageIds: [secondStageId, firstStageId],
    }, identities);
    expect(reorder.kind).toBe("reorder_stages");
    expect(connectStagesCommand(blank, identities)).toBeNull();
    expect(connectStagesCommand({ ...projection, stages: [stages[0]!] }, identities)).toBeNull();
    expect(connectStagesCommand(projection, identities)).toMatchObject({
      kind: "connect_stages",
      edges: [{ sourceStageId: firstStageId, targetStageId: secondStageId }],
    });
    expect(moveCardCommand(projection, card("running"), secondStageId, identities)).toBeNull();
    expect(moveCardCommand(projection, card("idle"), firstStageId, identities)).toBeNull();
    expect(moveCardCommand(projection, card("idle"), secondStageId, identities)).toMatchObject({ kind: "move_card" });
    expect(await executeBoardCommand(new QueueClient([ok(projection)]), reorder, identities)).toMatchObject({ status: "ok" });
  });

  test("maps typed results to accessible recovery messages", () => {
    expect(boardInteractionMessage(ok(projection))).toBeNull();
    expect(boardInteractionMessage({ status: "invalid", message: "Invalid setup" })).toBe("Invalid setup");
    expect(boardInteractionMessage({
      status: "conflict",
      conflict: { kind: "stale_workflow", boardId, expectedVersion: 2, actualVersion: 3 },
    })).toContain("Workflow changed");
    expect(boardInteractionMessage({
      status: "conflict",
      conflict: { kind: "stale_card", cardId: card("idle").cardId, expectedVersion: 1, actualVersion: 2 },
    })).toContain("Card changed");
    expect(boardInteractionMessage({
      status: "rejected",
      rejection: { kind: "invalid_workflow", message: "Graph rejected" },
    })).toContain("Graph rejected");
    expect(boardInteractionMessage({
      status: "unavailable",
      unavailable: { resource: "workflow_command", reason: "not_ready" },
    })).toContain("reconnect");
  });
});
