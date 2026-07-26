import { afterEach, describe, expect, test } from "bun:test";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type DirectAcpAttemptState,
  type QuestionId,
} from "@kitten/engine";
import { createHash } from "node:crypto";
import { createActivityIngestor } from "../attempts/activityIngestor.ts";
import { createAttentionCoordinator } from "../attention/attentionCoordinator.ts";
import {
  ATTENTION_ATTEMPT_ID,
  ATTENTION_CARD_ID,
  ATTENTION_FORM,
  ATTENTION_GENERATION,
  createAttentionFixture,
} from "../attention/testSupport.ts";
import { createEventJournal } from "../persistence/eventJournal.ts";
import type { EventJournal, PersistenceSnapshot } from "../persistence/eventJournal.ts";
import type { ReviewEvidenceRecord } from "../persistence/reviewEvidencePersistence.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import {
  workflowIds,
  type BoardId,
  type CardProjection,
  type ExecutionStatus,
} from "../workflow/workflowTypes.ts";
import type { WorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import { assertSupervisionProjection } from "../shared/rpc.ts";
import { createDesktopBoardRpc, projectSupervision } from "./boardRpc.ts";

const databases: ReturnType<typeof openSqliteDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

describe("DesktopBoardRpc workspace projection", () => {
  test("lists multiple boards for one project and exposes a blank board setup projection", async () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    let now = 10;
    const repositoryBindings: string[] = [];
    const mirroredBoardIds: string[] = [];
    const rpc = createDesktopBoardRpc(
      journal,
      createWorkflowCommandHandler(journal, { now: () => ++now }),
      {
        onRepositoryBound: (repositoryPath) => repositoryBindings.push(repositoryPath),
        onProjectionCommitted: (projection) => {
          if (projection.board !== null) mirroredBoardIds.push(projection.board.boardId);
        },
      },
    );

    const firstBoardId = workflowIds.board("board-first");
    const secondBoardId = workflowIds.board("board-second");
    await rpc.executeWorkflowCommand({
      commandId: "bind-first",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-first"),
        boardId: firstBoardId,
        repositoryPath: "/Users/name/projects/kitten",
      },
    });
    await rpc.executeWorkflowCommand({
      commandId: "bind-second",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-second"),
        boardId: secondBoardId,
        repositoryPath: "/Users/name/projects/kitten",
      },
    });

    const workspace = await rpc.getWorkspace?.({});
    expect(workspace).toMatchObject({
      result: {
        status: "ok",
        projection: {
          boards: [
            { boardId: secondBoardId, repositoryPath: "/Users/name/projects/kitten", createdAt: 12 },
            { boardId: firstBoardId, repositoryPath: "/Users/name/projects/kitten", createdAt: 11 },
          ],
        },
      },
    });
    expect(await rpc.getBoard({ mode: "new" })).toMatchObject({
      result: { status: "ok", projection: { board: null, stages: [], edges: [], cards: [] } },
    });
    expect(repositoryBindings).toEqual([
      "/Users/name/projects/kitten",
      "/Users/name/projects/kitten",
    ]);
    expect(mirroredBoardIds).toEqual([firstBoardId, secondBoardId]);
  });
});

const STAGE_ID = workflowIds.stage("stage-supervision");
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);

function board(boardId: string, updatedAt = 10) {
  return {
    boardId: workflowIds.board(boardId),
    repositoryPath: `/private/repositories/${boardId}`,
    workflowVersion: 1,
    createdAt: 1,
    updatedAt,
  };
}

function card(
  boardId: BoardId,
  cardId: string,
  executionStatus: ExecutionStatus,
  updatedAt: number,
): CardProjection {
  return {
    boardId,
    cardId: workflowIds.card(cardId),
    stageId: STAGE_ID,
    title: `private-title-${cardId}`,
    description: `private-description-${cardId}`,
    provider: "codex",
    model: "private-model",
    effort: "high",
    skillOverrideId: SKILL_ID,
    runnable: true,
    executionStatus,
    version: 3,
    createdAt: 1,
    updatedAt,
  };
}

function attempt(
  value: CardProjection,
  generation: number,
  state: DirectAcpAttemptState,
  timestamp: number,
) {
  return {
    attemptId: toOpaqueId<AttemptId>(`attempt-${value.cardId}-${generation}`)!,
    boardId: value.boardId,
    cardId: value.cardId,
    generation: toAttemptGeneration(generation)!,
    state,
    sessionId: state === "created" ? null : `private-session-${generation}`,
    failure: state === "failed"
      ? { code: "activity_failed" as const, message: "private-failure", occurredAt: timestamp }
      : null,
    createdAt: timestamp - 2,
    startedAt: state === "created" ? null : timestamp - 1,
    terminalAt: ["succeeded", "failed", "cancelled", "interrupted"].includes(state)
      ? timestamp
      : null,
  };
}

function attention(
  value: CardProjection,
  selectedAttempt: ReturnType<typeof attempt>,
  updatedAt: number,
  blockerId: string,
) {
  return {
    schemaVersion: 1 as const,
    blockerId: toOpaqueId<QuestionId>(blockerId)!,
    callId: `private-call-${blockerId}`,
    boardId: value.boardId,
    cardId: value.cardId,
    attemptId: selectedAttempt.attemptId,
    generation: selectedAttempt.generation,
    form: {
      prompt: `private-attention-prompt-${blockerId}`,
      fields: [{ id: "answer", label: "Private answer", required: true, mode: "text" as const }],
    },
    active: true,
    outcome: null,
    notification: { state: "pending" as const, attemptedAt: null, failureCode: null },
    version: 1,
    createdAt: updatedAt - 1,
    updatedAt,
    terminalAt: null,
  };
}

function evidence(
  value: CardProjection,
  selectedAttempt: ReturnType<typeof attempt>,
  createdAt: number,
) {
  return {
    evidenceId: `evidence-${value.cardId}-${selectedAttempt.generation}`,
    boardId: value.boardId,
    cardId: value.cardId,
    attemptId: selectedAttempt.attemptId,
    generation: selectedAttempt.generation,
    worktreeBindingId: `binding-${value.cardId}`,
    baseCommit: "b".repeat(40),
    headCommit: "h".repeat(40),
    policyVersion: 1,
    evidenceDigest: "d".repeat(64),
    fileCount: 1,
    totalPatchBytes: 99,
    createdAt,
  };
}

function snapshot(overrides: Partial<PersistenceSnapshot> = {}): PersistenceSnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    lastJournalOrder: 0,
    boards: [],
    stages: [],
    edges: [],
    cards: [],
    catalogRoots: [],
    catalogEntries: [],
    catalogDiagnostics: [],
    skillSnapshots: [],
    cardWorktrees: [],
    attempts: [],
    runContexts: [],
    attemptInspectors: [],
    followUpQueues: [],
    attentionBlockers: [],
    reviewEvidenceByCard: {},
    reviewDispositions: [],
    ...overrides,
  };
}

function items(
  projection: ReturnType<typeof projectSupervision>,
  status: ReturnType<typeof projectSupervision>["groups"][number]["status"],
) {
  return projection.groups.find((group) => group.status === status)!.items;
}

describe("cross-project supervision projection", () => {
  test("returns deterministic empty groups and zero counts", () => {
    const projection = projectSupervision(snapshot({ revision: 17 }));
    expect(projection).toEqual({
      kind: "supervision_projection",
      schemaVersion: 1,
      revision: 17,
      generatedAt: 0,
      groups: [
        { status: "needs_attention", priority: 0, items: [] },
        { status: "ready_for_review", priority: 1, items: [] },
        { status: "failed", priority: 2, items: [] },
        { status: "running", priority: 3, items: [] },
        { status: "settled", priority: 4, items: [] },
      ],
      counts: {
        needs_attention: 0,
        ready_for_review: 0,
        failed: 0,
        running: 0,
        settled: 0,
      },
    });
    expect(projectSupervision(snapshot({ revision: 17 }))).toEqual(projection);
    expect(() => assertSupervisionProjection(projection)).not.toThrow();
  });

  test("lets valid active attention override review, failure, running, and settled states", () => {
    const selectedBoard = board("board-attention");
    const cards = [
      card(selectedBoard.boardId, "card-review", "ready_for_review", 10),
      card(selectedBoard.boardId, "card-failed", "failed", 11),
      card(selectedBoard.boardId, "card-running", "running", 12),
      card(selectedBoard.boardId, "card-settled", "completed", 13),
    ];
    const attempts = cards.map((value, index) => attempt(value, 1, "needs_attention", 20 + index));
    const attentionBlockers = [
      ...cards.map((value, index) => (
        attention(value, attempts[index]!, 100 + index, `blocker-${index}`)
      )),
      attention(cards[0]!, attempts[0]!, 500, "blocker-latest"),
    ];
    const input = snapshot({
      boards: [selectedBoard],
      cards,
      attempts,
      attentionBlockers,
    });
    const projection = projectSupervision(input);

    expect(items(projection, "needs_attention").map(({ cardId }) => cardId)).toEqual([
      workflowIds.card("card-review"),
      workflowIds.card("card-settled"),
      workflowIds.card("card-running"),
      workflowIds.card("card-failed"),
    ]);
    expect(projectSupervision({
      ...input,
      attentionBlockers: [...attentionBlockers].reverse(),
    })).toEqual(projection);
    expect(projection.counts).toMatchObject({
      needs_attention: 4,
      ready_for_review: 0,
      failed: 0,
      running: 0,
      settled: 0,
    });
  });

  test("selects latest identities independently of incidental array order and rejects stale evidence", () => {
    const selectedBoard = board("board-selection");
    const review = card(selectedBoard.boardId, "card-review", "ready_for_review", 30);
    const stale = card(selectedBoard.boardId, "card-stale", "ready_for_review", 31);
    const older = attempt(review, 1, "failed", 40);
    const latest = attempt(review, 2, "succeeded", 50);
    const staleLatest = attempt(stale, 2, "succeeded", 60);
    const staleOlder = attempt(stale, 1, "succeeded", 45);
    const reviewEvidence = evidence(review, latest, 70);
    const staleEvidence = evidence(stale, staleOlder, 71);
    const input = snapshot({
      revision: 9,
      boards: [selectedBoard],
      cards: [review, stale],
      attempts: [latest, staleOlder, older, staleLatest],
      reviewEvidenceByCard: {
        [review.cardId]: reviewEvidence,
        [stale.cardId]: staleEvidence,
      },
    });

    const projected = projectSupervision(input);
    const shuffled = projectSupervision({
      ...input,
      attempts: [...input.attempts].reverse(),
      cards: [...input.cards].reverse(),
    });
    expect(shuffled).toEqual(projected);
    expect(items(projected, "ready_for_review")).toEqual([
      expect.objectContaining({
        cardId: review.cardId,
        attemptId: latest.attemptId,
        generation: latest.generation,
        actionableAt: 70,
        evidenceAvailability: {
          status: "available",
          evidenceId: reviewEvidence.evidenceId,
          evidenceDigest: reviewEvidence.evidenceDigest,
        },
      }),
      expect.objectContaining({
        cardId: stale.cardId,
        attemptId: staleLatest.attemptId,
        generation: staleLatest.generation,
        evidenceAvailability: {
          status: "unavailable",
          error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
        },
      }),
    ]);
  });

  test("exposes retry guidance when final-stage evidence capture leaves a succeeded card non-reviewable", () => {
    const selectedBoard = board("board-capture-failure");
    const selectedCard = card(selectedBoard.boardId, "card-capture-failure", "running", 30);
    const selectedAttempt = attempt(selectedCard, 1, "succeeded", 40);

    const projected = projectSupervision(snapshot({
      boards: [selectedBoard],
      cards: [selectedCard],
      attempts: [selectedAttempt],
      edges: [],
    }));

    expect(items(projected, "running")).toEqual([
      expect.objectContaining({
        cardId: selectedCard.cardId,
        attemptId: selectedAttempt.attemptId,
        generation: selectedAttempt.generation,
        evidenceAvailability: {
          status: "unavailable",
          error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
        },
      }),
    ]);
  });

  test("breaks equal timestamps by ascending board ID and card ID", () => {
    const boardB = board("board-b");
    const boardA = board("board-a");
    const projected = projectSupervision(snapshot({
      boards: [boardB, boardA],
      cards: [
        card(boardB.boardId, "card-a", "completed", 100),
        card(boardA.boardId, "card-z", "completed", 100),
        card(boardA.boardId, "card-a", "completed", 100),
      ],
    }));
    expect(items(projected, "settled").map(({ boardId, cardId }) => `${boardId}/${cardId}`)).toEqual([
      "board-a/card-a",
      "board-a/card-z",
      "board-b/card-a",
    ]);
  });

  test("emits every card once and keeps counts equal to group totals", () => {
    const selectedBoard = board("board-counts");
    const cards = [
      card(selectedBoard.boardId, "attention", "needs_attention", 10),
      card(selectedBoard.boardId, "review", "ready_for_review", 11),
      card(selectedBoard.boardId, "failed", "failed", 12),
      card(selectedBoard.boardId, "running", "running", 13),
      card(selectedBoard.boardId, "settled", "idle", 14),
    ];
    const projection = projectSupervision(snapshot({ boards: [selectedBoard], cards }));
    const projectedCards = projection.groups.flatMap(({ items: groupItems }) => groupItems);
    expect(new Set(projectedCards.map(({ cardId }) => cardId)).size).toBe(cards.length);
    expect(projectedCards).toHaveLength(cards.length);
    for (const group of projection.groups) {
      expect(projection.counts[group.status]).toBe(group.items.length);
    }
  });

  test("excludes workflow content, paths, transcripts, patches, secrets, and host capabilities", () => {
    const selectedBoard = board("board-private");
    const selectedCard = card(selectedBoard.boardId, "card-private", "needs_attention", 50);
    const selectedAttempt = attempt(selectedCard, 1, "needs_attention", 60);
    const projection = projectSupervision(snapshot({
      boards: [selectedBoard],
      cards: [selectedCard],
      attempts: [selectedAttempt],
      attentionBlockers: [attention(selectedCard, selectedAttempt, 70, "blocker-private")],
      attemptInspectors: [{
        attemptId: selectedAttempt.attemptId,
        updatedAt: 80,
        entries: [{ text: "PRIVATE_TRANSCRIPT_SENTINEL" }],
      } as unknown as PersistenceSnapshot["attemptInspectors"][number]],
    }));
    const serialized = JSON.stringify(projection);
    for (const forbidden of [
      "private-title",
      "private-description",
      "/private/repositories",
      "private-model",
      "private-session",
      "private-failure",
      "private-attention-prompt",
      "private-call",
      "PRIVATE_TRANSCRIPT_SENTINEL",
      "repositoryPath",
      "prompt",
      "transcript",
      "patch",
      "secret",
      "worktreePath",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(() => assertSupervisionProjection(JSON.parse(serialized))).not.toThrow();
  });

  test("reads one internally consistent snapshot per query and refreshes on the next query", async () => {
    const selectedBoard = board("board-query");
    const selectedCard = card(selectedBoard.boardId, "card-query", "idle", 10);
    let current = snapshot({
      revision: 1,
      boards: [selectedBoard],
      cards: [selectedCard],
    });
    let reads = 0;
    const journal = {
      snapshot() {
        reads += 1;
        return current;
      },
    } as unknown as EventJournal;
    const commands = {
      execute() {
        throw new Error("not used");
      },
    } as unknown as WorkflowCommandHandler;
    const rpc = createDesktopBoardRpc(journal, commands);

    const first = await rpc.getSupervision({});
    expect(first).toMatchObject({
      result: {
        status: "ok",
        projection: { revision: 1, counts: { settled: 1 } },
      },
    });
    const runningCard = { ...selectedCard, executionStatus: "running" as const, version: 4, updatedAt: 20 };
    const runningAttempt = attempt(runningCard, 1, "running", 21);
    current = snapshot({
      revision: 2,
      boards: [selectedBoard],
      cards: [runningCard],
      attempts: [runningAttempt],
    });
    const second = await rpc.getSupervision({});
    expect(second).toMatchObject({
      result: {
        status: "ok",
        projection: {
          revision: 2,
          counts: { running: 1, settled: 0 },
          groups: expect.arrayContaining([{
            status: "running",
            priority: 3,
            items: [expect.objectContaining({
              attemptId: runningAttempt.attemptId,
              generation: runningAttempt.generation,
            })],
          }]),
        },
      },
    });
    expect(reads).toBe(2);
  });

  test("refreshes attempt, attention, evidence, and card journal changes on subsequent reads", async () => {
    const fixture = createAttentionFixture();
    databases.push(fixture.database);
    const commands = createWorkflowCommandHandler(fixture.journal, { now: () => 300 });
    const rpc = createDesktopBoardRpc(fixture.journal, commands);
    const attentionCoordinator = createAttentionCoordinator({
      journal: fixture.journal,
      notifications: {
        async notify() {
          return { state: "delivered", attemptedAt: 201, failureCode: null };
        },
      },
      now: () => 200,
      createBlockerId: () => "blocker-supervision",
      createEventId: (operation) => `attention-supervision-${operation}`,
    });

    expect(await rpc.getSupervision({})).toMatchObject({
      result: { status: "ok", projection: { counts: { running: 1 } } },
    });
    const handle = await attentionCoordinator.raise({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      callId: "call-supervision",
      form: ATTENTION_FORM,
    });
    const attentionRead = await rpc.getSupervision({});
    expect(attentionRead).toMatchObject({
      result: {
        status: "ok",
        projection: {
          revision: fixture.journal.snapshot().revision,
          counts: { needs_attention: 1, running: 0 },
        },
      },
    });

    attentionCoordinator.resolve({
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      blockerId: handle.blocker.blockerId,
      expectedVersion: handle.blocker.version,
      outcome: { kind: "skipped" },
    });
    await handle.outcome;
    const ingestor = createActivityIngestor({ journal: fixture.journal });
    expect(await ingestor.ingest({
      eventId: toOpaqueId<ActivityEventId>("activity-supervision-success")!,
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      sequence: toActivitySequence(2)!,
      occurredAt: 400,
      activity: { kind: "attempt_state", state: "succeeded" },
    })).toMatchObject({ status: "committed" });

    const patchBlob = new TextEncoder().encode("diff --git a/file b/file\n");
    const persistedEvidence: ReviewEvidenceRecord = {
      evidenceId: "evidence-supervision",
      boardId: fixture.journal.snapshot().boards[0]!.boardId,
      cardId: ATTENTION_CARD_ID,
      attemptId: ATTENTION_ATTEMPT_ID,
      generation: ATTENTION_GENERATION,
      worktreeBindingId: "binding-supervision",
      baseCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      policyVersion: 1,
      evidenceDigest: createHash("sha256").update("evidence-supervision").digest("hex"),
      fileCount: 1,
      totalPatchBytes: patchBlob.byteLength,
      createdAt: 500,
      files: [{
        evidenceId: "evidence-supervision",
        fileIndex: 0,
        fileId: "file-supervision",
        status: "modified",
        oldPath: "src/file.ts",
        newPath: "src/file.ts",
        oldMode: "100644",
        newMode: "100644",
        isBinary: false,
        additions: 1,
        deletions: 0,
        patchByteLength: patchBlob.byteLength,
        patchDigest: createHash("sha256").update(patchBlob).digest("hex"),
        contentDigest: createHash("sha256").update("content-supervision").digest("hex"),
        patchBlob,
      }],
    };
    const beforeEvidence = fixture.journal.snapshot().cards[0]!;
    fixture.journal.immediate((transaction) => {
      transaction.persistReviewEvidence(persistedEvidence);
      transaction.append({
        eventId: "evidence:evidence-supervision",
        boardId: beforeEvidence.boardId,
        cardId: beforeEvidence.cardId,
        actor: "system",
        kind: "review_evidence_committed",
        occurredAt: 500,
        payload: {
          evidence: {
            evidenceId: persistedEvidence.evidenceId,
            boardId: persistedEvidence.boardId,
            cardId: persistedEvidence.cardId,
            attemptId: persistedEvidence.attemptId,
            generation: persistedEvidence.generation,
            worktreeBindingId: persistedEvidence.worktreeBindingId,
            evidenceDigest: persistedEvidence.evidenceDigest,
            createdAt: persistedEvidence.createdAt,
          },
          changes: [{
            entity: "card",
            operation: "upsert",
            value: {
              ...beforeEvidence,
              executionStatus: "ready_for_review",
              version: beforeEvidence.version + 1,
              updatedAt: 500,
            },
          }],
        },
      }, {
        preconditions: [{
          entity: "card",
          id: beforeEvidence.cardId,
          expectedVersion: beforeEvidence.version,
        }],
      });
    });

    const reviewRead = await rpc.getSupervision({});
    expect(reviewRead).toMatchObject({
      result: {
        status: "ok",
        projection: {
          revision: fixture.journal.snapshot().revision,
          counts: { needs_attention: 0, ready_for_review: 1, running: 0 },
        },
      },
    });
    if (reviewRead.result.status !== "ok") throw new Error("supervision query failed");
    expect(items(reviewRead.result.projection, "ready_for_review")).toEqual([
      expect.objectContaining({
        cardId: ATTENTION_CARD_ID,
        attemptId: ATTENTION_ATTEMPT_ID,
        generation: ATTENTION_GENERATION,
        evidenceAvailability: {
          status: "available",
          evidenceId: persistedEvidence.evidenceId,
          evidenceDigest: persistedEvidence.evidenceDigest,
        },
      }),
    ]);
  });

  test("projects a deterministic 10,000-card fixture below the local p95 target", () => {
    const boards = Array.from({ length: 20 }, (_, index) => board(`board-${index.toString().padStart(2, "0")}`));
    const cards = Array.from({ length: 10_000 }, (_, index) => (
      card(
        boards[index % boards.length]!.boardId,
        `card-${index.toString().padStart(5, "0")}`,
        index % 5 === 0 ? "failed" : index % 3 === 0 ? "running" : "completed",
        index,
      )
    ));
    const fixture = snapshot({ revision: 10_000, boards, cards });
    projectSupervision(fixture);
    const durations = Array.from({ length: 20 }, () => {
      const startedAt = performance.now();
      const projection = projectSupervision(fixture);
      expect(projection.groups.flatMap(({ items: groupItems }) => groupItems).length).toBe(10_000);
      return performance.now() - startedAt;
    }).sort((left, right) => left - right);
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(50);
  });
});
