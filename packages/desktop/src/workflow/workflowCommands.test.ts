import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventJournal } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "./workflowCommands.ts";
import {
  workflowIds,
  type BoardId,
  type CardId,
  type MutationId,
  type StageId,
  type WorkflowCommand,
} from "./workflowTypes.ts";

const BOARD_ID = workflowIds.board("board-1");
const BACKLOG_ID = workflowIds.stage("stage-backlog");
const DOING_ID = workflowIds.stage("stage-doing");
const REVIEW_ID = workflowIds.stage("stage-review");
const CARD_ID = workflowIds.card("card-1");

function mutation(value: string): MutationId {
  return workflowIds.mutation(value);
}

function migratedDatabase(filename = ":memory:") {
  const database = openSqliteDatabase({ filename });
  migrateDatabase(database, { now: () => 1 });
  return database;
}

function commandHarness(filename = ":memory:") {
  const database = migratedDatabase(filename);
  const journal = createEventJournal(database);
  let timestamp = 100;
  const commands = createWorkflowCommandHandler(journal, { now: () => ++timestamp });
  return { database, journal, commands };
}

function bind(boardId: BoardId = BOARD_ID): WorkflowCommand {
  return {
    kind: "bind_repository",
    mutationId: mutation("bind"),
    boardId,
    repositoryPath: "/tmp/trusted-repository",
  };
}

function createStage(
  stageId: StageId,
  label: string,
  expectedWorkflowVersion: number,
  mutationId = mutation(`create-${stageId}`),
): WorkflowCommand {
  return {
    kind: "create_stage",
    mutationId,
    boardId: BOARD_ID,
    expectedWorkflowVersion,
    stageId,
    label,
  };
}

function createCard(
  expectedWorkflowVersion: number,
  cardId: CardId = CARD_ID,
): WorkflowCommand {
  return {
    kind: "create_card",
    mutationId: mutation(`create-${cardId}`),
    boardId: BOARD_ID,
    expectedWorkflowVersion,
    cardId,
    stageId: BACKLOG_ID,
    title: "Implement workflow commands",
    description: "Keep stage and execution status separate.",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
  };
}

function buildLinearWorkflow(harness: ReturnType<typeof commandHarness>): number {
  expect(harness.commands.execute(bind()).status).toBe("committed");
  expect(harness.commands.execute(createStage(BACKLOG_ID, "Backlog", 1)).status).toBe("committed");
  expect(harness.commands.execute(createStage(DOING_ID, "Doing", 2)).status).toBe("committed");
  expect(harness.commands.execute(createStage(REVIEW_ID, "Review", 3)).status).toBe("committed");
  expect(harness.commands.execute({
    kind: "connect_stages",
    mutationId: mutation("connect"),
    boardId: BOARD_ID,
    expectedWorkflowVersion: 4,
    edges: [
      { sourceStageId: BACKLOG_ID, targetStageId: DOING_ID },
      { sourceStageId: DOING_ID, targetStageId: REVIEW_ID },
    ],
  }).status).toBe("committed");
  return 5;
}

describe("workflow board and stage commands", () => {
  test("persists partial and fully disconnected adjacent paths", () => {
    const harness = commandHarness();
    try {
      let workflowVersion = buildLinearWorkflow(harness);
      expect(harness.commands.execute({
        kind: "connect_stages",
        mutationId: mutation("connect-partial"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion++,
        edges: [{ sourceStageId: DOING_ID, targetStageId: REVIEW_ID }],
      }).status).toBe("committed");
      expect(harness.journal.snapshot().edges).toEqual([
        { boardId: BOARD_ID, sourceStageId: DOING_ID, targetStageId: REVIEW_ID, workflowVersion: 6 },
      ]);

      expect(harness.commands.execute({
        kind: "connect_stages",
        mutationId: mutation("disconnect-all"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        edges: [],
      }).status).toBe("committed");
      expect(harness.journal.snapshot().edges).toEqual([]);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });

  test("materializes configured state, preserves the path, and reorders columns deterministically", () => {
    const harness = commandHarness();
    try {
      let workflowVersion = buildLinearWorkflow(harness);
      const skillId = workflowIds.skill(`skill:${"a".repeat(64)}`);
      expect(harness.commands.execute({
        kind: "assign_stage_skill",
        mutationId: mutation("assign-skill"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion++,
        stageId: BACKLOG_ID,
        defaultSkillId: skillId,
      }).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "reorder_stages",
        mutationId: mutation("reorder"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        orderedStageIds: [REVIEW_ID, BACKLOG_ID, DOING_ID],
      }).status).toBe("committed");

      const snapshot = harness.journal.snapshot();
      expect(snapshot.boards[0]?.workflowVersion).toBe(7);
      expect(snapshot.stages.map(({ stageId, position }) => [stageId, position])).toEqual([
        [REVIEW_ID, 0],
        [BACKLOG_ID, 1],
        [DOING_ID, 2],
      ]);
      expect(snapshot.stages.find(({ stageId }) => stageId === BACKLOG_ID)).toMatchObject({
        defaultSkillId: skillId,
        configured: true,
        workflowVersion: 7,
      });
      expect(snapshot.edges).toEqual([
        { boardId: BOARD_ID, sourceStageId: BACKLOG_ID, targetStageId: DOING_ID, workflowVersion: 7 },
        { boardId: BOARD_ID, sourceStageId: DOING_ID, targetStageId: REVIEW_ID, workflowVersion: 7 },
      ]);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });

  test("rejects invalid paths and stage orders without changing journal or projections", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      const before = harness.journal.snapshot();
      const eventCount = harness.journal.events().length;
      const invalidPath = harness.commands.execute({
        kind: "connect_stages",
        mutationId: mutation("invalid-path"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        edges: [
          { sourceStageId: BACKLOG_ID, targetStageId: DOING_ID },
          { sourceStageId: BACKLOG_ID, targetStageId: REVIEW_ID },
        ],
      });
      expect(invalidPath).toMatchObject({ status: "rejected", rejection: { kind: "invalid_workflow" } });
      expect(harness.commands.execute({
        kind: "reorder_stages",
        mutationId: mutation("invalid-order"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        orderedStageIds: [BACKLOG_ID, DOING_ID, DOING_ID],
      })).toMatchObject({ status: "rejected", rejection: { kind: "invalid_stage_order" } });
      expect(harness.journal.snapshot()).toEqual(before);
      expect(harness.journal.events()).toHaveLength(eventCount);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });
});

describe("version fencing and mutation identity", () => {
  test("returns typed stale conflicts and makes exact duplicate mutations idempotent", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      const beforeStale = harness.journal.snapshot();
      expect(harness.commands.execute(createStage(
        workflowIds.stage("stage-stale"),
        "Stale",
        workflowVersion - 1,
      ))).toEqual({
        status: "conflict",
        mutationId: mutation("create-stage-stale"),
        conflict: {
          kind: "stale_workflow",
          boardId: BOARD_ID,
          expectedVersion: 4,
          actualVersion: 5,
        },
      });
      expect(harness.journal.snapshot()).toEqual(beforeStale);

      const update: WorkflowCommand = {
        kind: "update_stage",
        mutationId: mutation("rename-doing"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        stageId: DOING_ID,
        label: "In progress",
      };
      expect(harness.commands.execute(update).status).toBe("committed");
      const afterCommit = harness.journal.snapshot();
      expect(harness.commands.execute(update)).toEqual({
        status: "idempotent",
        mutationId: update.mutationId,
        eventId: `workflow:${update.mutationId}`,
      });
      expect(harness.commands.execute({ ...update, label: "Different command" })).toMatchObject({
        status: "rejected",
        rejection: { kind: "mutation_identity_conflict" },
      });
      expect(harness.journal.snapshot()).toEqual(afterCommit);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });

  test("rejects stale card writes without changing the projection", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      expect(harness.commands.execute(createCard(workflowVersion)).status).toBe("committed");
      const before = harness.journal.snapshot();
      expect(harness.commands.execute({
        kind: "update_card",
        mutationId: mutation("stale-card"),
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: 0,
        title: "Stale",
        description: "",
        provider: "codex",
        model: "gpt-5",
        effort: "high",
        skillOverrideId: null,
        runnable: true,
      })).toMatchObject({
        status: "conflict",
        conflict: { kind: "stale_card", expectedVersion: 0, actualVersion: 1 },
      });
      expect(harness.journal.snapshot()).toEqual(before);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });
});

describe("governed card progression", () => {
  test("keeps running and needs-attention cards stage-locked and separates stage from status", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      expect(harness.commands.execute(createCard(workflowVersion)).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "set_card_execution_status",
        mutationId: mutation("running"),
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: 1,
        executionStatus: "running",
      }).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "move_card",
        mutationId: mutation("move-while-running"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 2,
        targetStageId: DOING_ID,
      })).toMatchObject({ status: "rejected", rejection: { kind: "stage_locked" } });

      expect(harness.commands.execute({
        kind: "set_card_execution_status",
        mutationId: mutation("attention"),
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: 2,
        executionStatus: "needs_attention",
      }).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "move_card",
        mutationId: mutation("move-while-attention"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 3,
        targetStageId: DOING_ID,
      })).toMatchObject({ status: "rejected", rejection: { kind: "stage_locked" } });
      expect(harness.commands.execute({
        kind: "record_agent_success",
        mutationId: mutation("agent-move-while-attention"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 3,
      })).toMatchObject({ status: "rejected", rejection: { kind: "stage_locked" } });
      expect(harness.journal.snapshot().cards[0]).toMatchObject({
        stageId: BACKLOG_ID,
        executionStatus: "needs_attention",
      });
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });

  test("permits only immediate settled moves and advances success to review without completion", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      expect(harness.commands.execute(createCard(workflowVersion)).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "move_card",
        mutationId: mutation("skip-stage"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 1,
        targetStageId: REVIEW_ID,
      })).toMatchObject({ status: "rejected", rejection: { kind: "not_immediate_successor" } });
      expect(harness.commands.execute({
        kind: "move_card",
        mutationId: mutation("move-doing"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 1,
        targetStageId: DOING_ID,
      }).status).toBe("committed");

      expect(harness.commands.execute({
        kind: "set_card_execution_status",
        mutationId: mutation("doing-running"),
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: 2,
        executionStatus: "running",
      }).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "record_agent_success",
        mutationId: mutation("doing-success"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 3,
      }).status).toBe("committed");
      expect(harness.journal.snapshot().cards[0]).toMatchObject({
        stageId: REVIEW_ID,
        executionStatus: "idle",
        version: 4,
      });

      expect(harness.commands.execute({
        kind: "set_card_execution_status",
        mutationId: mutation("review-running"),
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: 4,
        executionStatus: "running",
      }).status).toBe("committed");
      expect(harness.commands.execute({
        kind: "record_agent_success",
        mutationId: mutation("final-success"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        cardId: CARD_ID,
        expectedCardVersion: 5,
      }).status).toBe("committed");
      expect(harness.journal.snapshot().cards[0]).toMatchObject({
        stageId: REVIEW_ID,
        executionStatus: "ready_for_review",
        version: 6,
      });
      expect(harness.journal.snapshot().cards[0]?.executionStatus).not.toBe("completed");
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });
});

describe("temporary SQLite command integration", () => {
  test("rolls back a command event and every projection change when one write fails", () => {
    const harness = commandHarness();
    try {
      const workflowVersion = buildLinearWorkflow(harness);
      const before = harness.journal.snapshot();
      const eventsBefore = harness.journal.events();
      harness.database.run(`
        CREATE TRIGGER reject_next_workflow_edge
        BEFORE INSERT ON workflow_edges
        WHEN NEW.workflow_version = 6
        BEGIN
          SELECT RAISE(ABORT, 'injected workflow projection failure');
        END
      `);

      expect(() => harness.commands.execute({
        kind: "reorder_stages",
        mutationId: mutation("rollback-reorder"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        orderedStageIds: [DOING_ID, BACKLOG_ID, REVIEW_ID],
      })).toThrow("injected workflow projection failure");
      expect(harness.journal.snapshot()).toEqual(before);
      expect(harness.journal.events()).toEqual(eventsBefore);
    } finally {
      closeSqliteDatabase(harness.database);
    }
  });

  test("commits command events with projections atomically and rebuilds unchanged after reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-workflow-"));
    const filename = join(directory, "desktop.sqlite");
    try {
      const harness = commandHarness(filename);
      const workflowVersion = buildLinearWorkflow(harness);
      expect(harness.commands.execute(createCard(workflowVersion)).status).toBe("committed");
      const reorder = harness.commands.execute({
        kind: "reorder_stages",
        mutationId: mutation("durable-reorder"),
        boardId: BOARD_ID,
        expectedWorkflowVersion: workflowVersion,
        orderedStageIds: [DOING_ID, BACKLOG_ID, REVIEW_ID],
      });
      expect(reorder).toMatchObject({ status: "committed", delta: { revision: 7 } });

      const observer = openSqliteDatabase({ filename, readonly: true });
      try {
        const observed = createEventJournal(observer).snapshot();
        expect(observed.revision).toBe(7);
        expect(observed.stages.map(({ stageId }) => stageId)).toEqual([DOING_ID, BACKLOG_ID, REVIEW_ID]);
        expect(observed.cards[0]).toMatchObject({
          cardId: CARD_ID,
          stageId: BACKLOG_ID,
          executionStatus: "idle",
          version: 1,
        });
      } finally {
        closeSqliteDatabase(observer);
      }
      const live = harness.journal.snapshot();
      const events = harness.journal.events();
      expect(events.at(-1)).toMatchObject({
        kind: "workflow_command_committed",
        payload: { commandKind: "reorder_stages" },
      });
      closeSqliteDatabase(harness.database);

      const reopened = migratedDatabase(filename);
      try {
        const reopenedJournal = createEventJournal(reopened);
        expect(reopenedJournal.snapshot()).toEqual(live);
        expect(reopenedJournal.events()).toEqual(events);
        expect(rebuildProjections(reopened)).toEqual(live);
      } finally {
        closeSqliteDatabase(reopened);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
