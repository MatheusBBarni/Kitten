import type { AttemptGeneration, AttemptId, ProfileId } from "@kitten/engine";
import { toAttemptGeneration, toOpaqueId } from "@kitten/engine";
import { createEventJournal, type EventJournal } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import type { RunContext } from "../attempts/contracts.ts";
import { workflowIds, type CardProjection } from "../workflow/workflowTypes.ts";
import type { AttentionForm } from "./contracts.ts";

export const ATTENTION_BOARD_ID = workflowIds.board("board-attention");
export const ATTENTION_STAGE_ID = workflowIds.stage("stage-doing");
export const ATTENTION_CARD_ID = workflowIds.card("card-attention");
export const ATTENTION_ATTEMPT_ID = toOpaqueId<AttemptId>("attempt-attention")!;
export const ATTENTION_GENERATION = toAttemptGeneration(1)!;
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);

export const ATTENTION_FORM: AttentionForm = {
  title: "Choose a safe action",
  context: "The agent needs a decision.",
  prompt: "Which option should the agent use?",
  fields: [{
    id: "choice",
    label: "Action",
    required: true,
    mode: "single",
    options: [{ id: "safe", label: "Use safe option" }],
    allowsCustom: true,
  }],
};

export function createAttentionFixture() {
  const database = openSqliteDatabase({ filename: ":memory:" });
  migrateDatabase(database, { now: () => 1 });
  const journal = createEventJournal(database);
  seedAttentionAttempt(journal);
  return { database, journal };
}

export function seedAttentionAttempt(journal: EventJournal): void {
  const card: CardProjection = {
    cardId: ATTENTION_CARD_ID,
    boardId: ATTENTION_BOARD_ID,
    stageId: ATTENTION_STAGE_ID,
    title: "Card safe title",
    description: "secret prompt and code must not leave the app",
    provider: "secret-provider",
    model: "secret-model",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: 3,
    updatedAt: 3,
  };
  journal.append({
    eventId: "attention-seed-board", boardId: ATTENTION_BOARD_ID, actor: "operator",
    kind: "board_upserted", occurredAt: 1,
    payload: {
      boardId: ATTENTION_BOARD_ID, repositoryPath: "/secret/path", workflowVersion: 1,
      createdAt: 1, updatedAt: 1,
    },
  });
  journal.append({
    eventId: "attention-seed-stage", boardId: ATTENTION_BOARD_ID, actor: "operator",
    kind: "stage_upserted", occurredAt: 2,
    payload: {
      stageId: ATTENTION_STAGE_ID, boardId: ATTENTION_BOARD_ID, label: "Doing", position: 0,
      defaultSkillId: SKILL_ID, configured: true, workflowVersion: 1, updatedAt: 2,
    },
  });
  journal.append({
    eventId: "attention-seed-card", boardId: ATTENTION_BOARD_ID, cardId: ATTENTION_CARD_ID,
    actor: "operator", kind: "card_upserted", occurredAt: 3, payload: card,
  });
  const starting = {
    attemptId: ATTENTION_ATTEMPT_ID,
    boardId: ATTENTION_BOARD_ID,
    cardId: ATTENTION_CARD_ID,
    generation: ATTENTION_GENERATION,
    state: "starting" as const,
    sessionId: null,
    failure: null,
    createdAt: 100,
    startedAt: null,
    terminalAt: null,
  };
  journal.append({
    eventId: "attention-attempt-created", boardId: ATTENTION_BOARD_ID, cardId: ATTENTION_CARD_ID,
    attemptId: ATTENTION_ATTEMPT_ID, attemptSequence: 0, actor: "system",
    kind: "attempt_lifecycle_committed", occurredAt: 100,
    payload: {
      operation: "created",
      changes: [
        { entity: "card", operation: "upsert", value: { ...card, executionStatus: "running", version: 2, updatedAt: 100 } },
        { entity: "attempt", operation: "upsert", value: starting },
        { entity: "run_context", operation: "insert", value: attentionContext() },
      ],
    },
  });
  journal.append({
    eventId: "attention-attempt-started", boardId: ATTENTION_BOARD_ID, cardId: ATTENTION_CARD_ID,
    attemptId: ATTENTION_ATTEMPT_ID, attemptSequence: 1, actor: "system",
    kind: "attempt_lifecycle_committed", occurredAt: 101,
    payload: {
      operation: "started",
      changes: [{
        entity: "attempt", operation: "upsert",
        value: { ...starting, state: "running", sessionId: "session-attention", startedAt: 101 },
      }],
    },
  });
}

function attentionContext(): RunContext {
  return {
    schemaVersion: 1,
    attemptId: ATTENTION_ATTEMPT_ID,
    generation: ATTENTION_GENERATION,
    capturedAt: 100,
    card: { cardId: ATTENTION_CARD_ID, title: "Card safe title", description: "Fixture", version: 1 },
    stage: { stageId: ATTENTION_STAGE_ID, label: "Doing" },
    workflow: { boardId: ATTENTION_BOARD_ID, version: 1 },
    skill: {
      snapshotId: SKILL_ID,
      skillId: SKILL_ID,
      canonicalPath: "/secret/path/.agents/skills/fixture/SKILL.md",
      rootClass: "project",
      digest: "a".repeat(64),
      metadata: { name: "fixture", description: "Fixture", frontmatter: { name: "fixture" } },
      content: "Execute fixture",
    },
    profile: {
      profileId: "profile-codex" as ProfileId,
      provider: "secret-provider",
      model: "secret-model",
      effort: "high",
      protocolVersion: 1,
      recipeId: "codex-acp",
      adapterVersion: "1.2.3",
      readinessCheckedAt: 90,
    },
    repository: { trusted: true, canonicalPath: "/secret/path", checkedAt: 90, message: "verified" },
    worktree: {
      bindingVersion: 1,
      bindingId: "kw-attention001",
      boardId: ATTENTION_BOARD_ID,
      cardId: ATTENTION_CARD_ID,
      repositoryRoot: "/secret/path",
      repositoryGitDir: "/secret/path/.git",
      managedRoot: "/secret/path/.kitten/worktrees/cards",
      worktreePath: "/secret/path/.kitten/worktrees/cards/kw-attention001",
      branch: "kitten/card/kw-attention001",
      baselineBranch: "main",
      baselineCommit: "b".repeat(40),
      lifecycle: "active",
      reason: null,
      createdAt: 90,
      updatedAt: 90,
    },
  };
}

export function staleGeneration(): AttemptGeneration {
  return toAttemptGeneration(2)!;
}
