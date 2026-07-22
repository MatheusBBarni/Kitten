import { describe, expect, test } from "bun:test";
import { createEventJournal } from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";
import { workflowIds, type CardId, type WorkflowCommand } from "../src/workflow/workflowTypes.ts";
import { createDesktopBoardRpc } from "../src/host/boardRpc.ts";
import {
  createBootstrapEnvelope,
  createCardInspectorEnvelope,
  createEmptyDesktopSnapshot,
  createWorkflowCatalogEnvelope,
  type HostMessageEnvelope,
  type WorkflowBoardProjection,
  type WorkflowCatalogProjection,
} from "../src/shared/rpc.ts";
import {
  bindWorkflowBoardRenderer,
  type DesktopRpcClient,
} from "../src/renderer/client.ts";
import {
  createBlankBoard,
  createStageWithCatalogSkill,
  executeBoardCommand,
  moveCardCommand,
  reorderStagesCommand,
  type IdentityFactory,
} from "../src/renderer/features/board/boardInteractions.ts";
import {
  keyboardStageReorderIntent,
} from "../src/renderer/features/board/workflowCanvas.ts";

class SequentialIdentities implements IdentityFactory {
  private sequence = 0;
  next(scope: "board" | "stage" | "mutation" | "command"): string {
    this.sequence += 1;
    return `${scope}-${this.sequence}`;
  }
}

describe("Workflow Board fake typed RPC", () => {
  test("refreshes committed projections after keyboard stage reorder and card movement", async () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    let timestamp = 10;
    const commands = createWorkflowCommandHandler(journal, { now: () => ++timestamp });
    const boardRpc = createDesktopBoardRpc(journal, commands);
    expect(await boardRpc.getBoard({ boardId: "board-missing" })).toMatchObject({
      result: { status: "ok", projection: { board: null, stages: [], edges: [], cards: [] } },
    });
    expect(await boardRpc.getCatalog({})).toMatchObject({
      result: { status: "ok", projection: { catalog: { catalogId: "default" } } },
    });
    expect(await boardRpc.executeWorkflowCommand({
      commandId: "invalid-repository",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-invalid-repository"),
        boardId: workflowIds.board("board-invalid-repository"),
        repositoryPath: "   ",
      },
    })).toMatchObject({ result: { status: "rejected", rejection: { kind: "invalid_repository" } } });
    const skillId = workflowIds.skill(`skill:${"d".repeat(64)}`);
    const catalog: WorkflowCatalogProjection = {
      kind: "workflow_catalog_projection",
      revision: 0,
      catalog: {
        catalogId: "default",
        roots: [],
        diagnostics: [],
        entries: [{
          skillId,
          canonicalPath: "/repo/.agents/skills/execute/SKILL.md",
          rootClass: "project",
          rootPath: "/repo/.agents/skills",
          digest: "d".repeat(64),
          metadata: { name: "execute", description: "Execute work", frontmatter: {} },
          order: 0,
          hasNameCollision: false,
          diagnostics: [],
        }],
      },
    };
    const subscribers = new Set<(message: HostMessageEnvelope) => void>();
    const client: DesktopRpcClient = {
      async getDesktopSnapshot() {
        return createBootstrapEnvelope({ status: "ok", projection: createEmptyDesktopSnapshot() });
      },
      async getCardInspector() {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "not_ready" },
        });
      },
      getBoard() {
        return boardRpc.getBoard({});
      },
      async getCatalog() {
        return createWorkflowCatalogEnvelope({ status: "ok", projection: catalog });
      },
      async executeWorkflowCommand(commandId, command) {
        const envelope = await boardRpc.executeWorkflowCommand({ commandId, command });
        if (envelope.result.status === "ok" && envelope.result.outcome === "committed") {
          for (const subscriber of subscribers) {
            subscriber({
              kind: "projection_committed",
              messageId: `message-${commandId}`,
              revision: envelope.result.projection.revision,
            });
          }
        }
        return envelope;
      },
      async startAttempt() { throw new Error("not used by board integration"); },
      async queueFollowUp() { throw new Error("not used by board integration"); },
      async removeQueuedFollowUp() { throw new Error("not used by board integration"); },
      async confirmQueuedFollowUp() { throw new Error("not used by board integration"); },
      async answerAttention() { throw new Error("not used by board integration"); },
      async getSettings() { throw new Error("not used by board integration"); },
      async updatePreferences() { throw new Error("not used by board integration"); },
      async updateProfileDefaults() { throw new Error("not used by board integration"); },
      async updateCatalogRoots() { throw new Error("not used by board integration"); },
      async setExecutionLimit() { throw new Error("not used by board integration"); },
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      dispose() {
        subscribers.clear();
      },
    };

    const observedBoards: WorkflowBoardProjection[] = [];
    const binding = bindWorkflowBoardRenderer(client, {
      onBoard(envelope) {
        if (envelope.result.status === "ok") observedBoards.push(envelope.result.projection);
      },
      onCatalog() {},
    });

    try {
      await binding.ready;
      const identities = new SequentialIdentities();
      const initial = observedBoards.at(-1)!;
      const createdBoard = await createBlankBoard(client, initial, "/repo", identities);
      expect(createdBoard.status).toBe("ok");
      if (createdBoard.status !== "ok") throw new Error("board setup failed");
      const firstStage = await createStageWithCatalogSkill(
        client,
        createdBoard.projection,
        "Backlog",
        skillId,
        catalog,
        identities,
      );
      expect(firstStage.status).toBe("ok");
      if (firstStage.status !== "ok") throw new Error("first stage setup failed");
      const secondStage = await createStageWithCatalogSkill(
        client,
        firstStage.projection,
        "Doing",
        skillId,
        catalog,
        identities,
      );
      expect(secondStage.status).toBe("ok");
      if (secondStage.status !== "ok") throw new Error("second stage setup failed");
      const board = secondStage.projection.board!;
      expect(await boardRpc.executeWorkflowCommand({
        commandId: "stale-stage",
        command: {
          kind: "create_stage",
          mutationId: workflowIds.mutation("mutation-stale-stage"),
          boardId: board.boardId,
          expectedWorkflowVersion: 0,
          stageId: workflowIds.stage("stage-stale"),
          label: "Stale",
        },
      })).toMatchObject({ result: { status: "conflict", conflict: { kind: "stale_workflow" } } });
      const connected = await executeBoardCommand(client, {
        kind: "connect_stages",
        mutationId: workflowIds.mutation(identities.next("mutation")),
        boardId: board.boardId,
        expectedWorkflowVersion: board.workflowVersion,
        edges: [{
          sourceStageId: secondStage.projection.stages[0]!.stageId,
          targetStageId: secondStage.projection.stages[1]!.stageId,
        }],
      }, identities);
      expect(connected.status).toBe("ok");
      if (connected.status !== "ok") throw new Error("connect failed");

      const keyboardIntent = keyboardStageReorderIntent(
        connected.projection.board!,
        connected.projection.stages,
        connected.projection.stages.find(({ label }) => label === "Backlog")!.stageId,
        "next",
      );
      expect(keyboardIntent).not.toBeNull();
      const reordered = await executeBoardCommand(
        client,
        reorderStagesCommand(keyboardIntent!, identities),
        identities,
      );
      expect(reordered.status).toBe("ok");
      if (reordered.status !== "ok") throw new Error("reorder failed");
      expect(reordered.projection.stages.map(({ label }) => label)).toEqual(["Doing", "Backlog"]);

      const cardId: CardId = workflowIds.card("card-integration");
      const currentBoard = reordered.projection.board!;
      const createCardCommand = {
        kind: "create_card",
        mutationId: workflowIds.mutation(identities.next("mutation")),
        boardId: currentBoard.boardId,
        expectedWorkflowVersion: currentBoard.workflowVersion,
        cardId,
        stageId: reordered.projection.stages.find(({ label }) => label === "Backlog")!.stageId,
        title: "Keyboard-created card",
        description: "Fake RPC projection refresh",
        provider: "codex",
        model: "gpt-5",
        effort: "high",
        skillOverrideId: null,
        runnable: true,
      } satisfies WorkflowCommand;
      const cardCreated = await executeBoardCommand(client, createCardCommand, identities);
      expect(cardCreated.status).toBe("ok");
      if (cardCreated.status !== "ok") throw new Error("card create failed");
      expect(await boardRpc.executeWorkflowCommand({
        commandId: "idempotent-card",
        command: createCardCommand,
      })).toMatchObject({ result: { status: "ok", outcome: "idempotent" } });
      const projectedCard = cardCreated.projection.cards[0]!;
      const targetStageId = cardCreated.projection.stages.find(({ label }) => label === "Doing")!.stageId;
      const moveCommand = moveCardCommand(cardCreated.projection, projectedCard, targetStageId, identities);
      expect(moveCommand).not.toBeNull();
      const moved = await executeBoardCommand(client, moveCommand!, identities);
      expect(moved.status).toBe("ok");
      if (moved.status !== "ok") throw new Error("card move failed");
      expect(moved.projection.cards[0]?.stageId).toBe(targetStageId);

      await Bun.sleep(0);
      expect(observedBoards.at(-1)?.revision).toBe(moved.projection.revision);
      expect(observedBoards.at(-1)?.cards[0]?.stageId).toBe(targetStageId);
    } finally {
      binding.dispose();
      closeSqliteDatabase(database);
    }
  });
});
