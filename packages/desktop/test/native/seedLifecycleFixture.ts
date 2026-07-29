import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptGeneration,
  type AttemptId,
  type NormalizedAttemptEvent,
  type ProfileId,
  type QuestionId,
} from "@kitten/engine";
import {
  createAttemptInspectorProjection,
  projectAttemptActivity,
  type AttemptInspectorProjection,
} from "../../src/attempts/inspectorProjection.ts";
import type { AttemptProjection, RunContext } from "../../src/attempts/contracts.ts";
import {
  createFollowUpQueue,
  interruptFollowUpDispatch,
  markFollowUpDispatching,
  type FollowUpQueueId,
  type FollowUpQueueProjection,
} from "../../src/attempts/followUpQueue.ts";
import type { AttentionBlockerProjection } from "../../src/attention/contracts.ts";
import {
  closeSqliteDatabase,
  openSqliteDatabase,
} from "../../src/persistence/sqliteDatabase.ts";
import { migrateDatabase } from "../../src/persistence/migrations.ts";
import {
  createEventJournal,
  type EventJournal,
  type PersistenceSnapshot,
  type ReviewEvidenceRecord,
} from "../../src/persistence/eventJournal.ts";
import {
  createReviewEvidenceService,
  REVIEW_EVIDENCE_POLICY_VERSION,
  REVIEW_TEXT_PATCH_BYTE_LIMIT,
} from "../../src/host/reviewEvidence.ts";
import type { CardWorktreeBinding } from "../../src/worktrees/contracts.ts";
import {
  workflowIds,
  type BoardId,
  type CardId,
  type CardProjection,
  type ExecutionStatus,
  type StageId,
} from "../../src/workflow/workflowTypes.ts";
import { declaredLifecycleFixture } from "./lifecycleMatrix.ts";

export const NATIVE_FIXTURE_IDS = {
  primaryBoard: workflowIds.board("native-board-primary"),
  secondaryBoard: workflowIds.board("native-board-secondary"),
  doingStage: workflowIds.stage("native-stage-doing"),
  reviewStage: workflowIds.stage("native-stage-review"),
  attentionCard: workflowIds.card("native-card-attention"),
  runningCard: workflowIds.card("native-card-running"),
  failedCard: workflowIds.card("native-card-failed"),
  reviewCard: workflowIds.card("native-card-review"),
  settledCard: workflowIds.card("native-card-settled"),
  queuedCard: workflowIds.card("native-card-queued"),
  interruptedCard: workflowIds.card("native-card-interrupted"),
  oversizedCard: workflowIds.card("native-card-oversized"),
  secondaryCard: workflowIds.card("native-card-secondary"),
} as const;

const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);
const FIXTURE_TIME = 1_800_000_000_000;
const TEXT_PATCH = new TextEncoder().encode(
  "diff --git a/src/native.ts b/src/native.ts\n"
  + "--- a/src/native.ts\n"
  + "+++ b/src/native.ts\n"
  + "@@ -1 +1 @@\n"
  + "-export const state = \"before\";\n"
  + "+export const state = \"reviewed\";\n",
);

export interface SeededLifecycleFixture {
  readonly fixtureId: string;
  readonly fixtureDirectory: string;
  readonly databasePath: string;
  readonly repositoryPath: string;
  readonly snapshot: PersistenceSnapshot;
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Kitten Native Fixture",
      GIT_AUTHOR_EMAIL: "native-fixture@example.invalid",
      GIT_AUTHOR_DATE: "2027-01-15T08:00:00Z",
      GIT_COMMITTER_NAME: "Kitten Native Fixture",
      GIT_COMMITTER_EMAIL: "native-fixture@example.invalid",
      GIT_COMMITTER_DATE: "2027-01-15T08:00:00Z",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Git fixture command failed: git ${args.join(" ")}`);
  }
  return result.stdout.toString().trim();
}

function initializeRepository(path: string): string {
  mkdirSync(path, { recursive: true });
  runGit(path, ["init", "-b", "main"]);
  writeFileSync(join(path, "README.md"), "# Kitten native lifecycle fixture\n");
  writeFileSync(join(path, "src-native.ts"), "export const state = \"before\";\n");
  runGit(path, ["add", "."]);
  runGit(path, ["commit", "-m", "fixture baseline"]);
  return runGit(path, ["rev-parse", "HEAD"]);
}

function card(
  cardId: CardId,
  stageId: StageId,
  title: string,
  executionStatus: ExecutionStatus,
  index: number,
): CardProjection {
  const occurredAt = FIXTURE_TIME + index;
  return {
    cardId,
    boardId: NATIVE_FIXTURE_IDS.primaryBoard,
    stageId,
    title,
    description: "Synthetic local lifecycle evidence. No user workspace content.",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus,
    version: executionStatus === "idle" ? 1 : 2,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function worktreeBinding(
  _fixtureDirectory: string,
  repositoryPath: string,
  baselineCommit: string,
  boardId: BoardId,
  cardId: CardId,
  index: number,
): CardWorktreeBinding {
  const bindingId = `kw-native${String(index).padStart(8, "0")}`;
  const managedRoot = resolve(repositoryPath, ".kitten/worktrees/cards");
  const worktreePath = resolve(managedRoot, bindingId);
  mkdirSync(managedRoot, { recursive: true });
  if (cardId === NATIVE_FIXTURE_IDS.reviewCard) {
    runGit(repositoryPath, [
      "worktree",
      "add",
      "-b",
      `kitten/card/${bindingId}`,
      worktreePath,
      baselineCommit,
    ]);
    writeFileSync(join(worktreePath, "src-native.ts"), "export const state = \"reviewed\";\n");
    mkdirSync(join(worktreePath, "assets"), { recursive: true });
    writeFileSync(join(worktreePath, "assets", "native.bin"), new Uint8Array([0, 1, 2, 3]));
  } else if (cardId === NATIVE_FIXTURE_IDS.oversizedCard) {
    runGit(repositoryPath, [
      "worktree",
      "add",
      "-b",
      `kitten/card/${bindingId}`,
      worktreePath,
      baselineCommit,
    ]);
    writeFileSync(
      join(worktreePath, "src-native.ts"),
      "x".repeat(REVIEW_TEXT_PATCH_BYTE_LIMIT + 1_024),
    );
  } else {
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, "FIXTURE.txt"),
      `Synthetic native fixture ${cardId}\n`,
    );
  }
  return {
    bindingVersion: 1,
    bindingId,
    boardId,
    cardId,
    repositoryRoot: realpathSync(repositoryPath),
    repositoryGitDir: realpathSync(join(repositoryPath, ".git")),
    managedRoot,
    worktreePath,
    branch: `kitten/card/${bindingId}`,
    baselineBranch: "main",
    baselineCommit,
    lifecycle: "active",
    reason: null,
    createdAt: FIXTURE_TIME + index,
    updatedAt: FIXTURE_TIME + index,
  };
}

function runContext(
  cardValue: CardProjection,
  stageLabel: string,
  attemptId: AttemptId,
  generation: AttemptGeneration,
  binding: CardWorktreeBinding,
): RunContext {
  const canonicalSkillPath = join(
    binding.repositoryRoot,
    ".agents/skills/native-fixture/SKILL.md",
  );
  return {
    schemaVersion: 1,
    attemptId,
    generation,
    capturedAt: cardValue.updatedAt,
    card: {
      cardId: cardValue.cardId,
      title: cardValue.title,
      description: cardValue.description,
      version: 1,
    },
    stage: { stageId: cardValue.stageId, label: stageLabel },
    workflow: { boardId: cardValue.boardId, version: 1 },
    skill: {
      snapshotId: SKILL_ID,
      skillId: SKILL_ID,
      canonicalPath: canonicalSkillPath,
      rootClass: "project",
      digest: "a".repeat(64),
      metadata: {
        name: "Native lifecycle fixture",
        description: "Deterministic packaged-app verification",
        frontmatter: { name: "native-lifecycle-fixture" },
      },
      content: "Exercise only deterministic synthetic lifecycle state.",
    },
    profile: {
      profileId: "profile-native-codex" as ProfileId,
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      protocolVersion: 1,
      recipeId: "native-capture",
      adapterVersion: "fixture-v1",
      readinessCheckedAt: cardValue.updatedAt,
    },
    repository: {
      trusted: true,
      canonicalPath: binding.repositoryRoot,
      checkedAt: cardValue.updatedAt,
      message: "Synthetic fixture repository verified",
    },
    worktree: binding,
  };
}

function activity(
  attemptId: AttemptId,
  generation: AttemptGeneration,
  sequence: number,
  occurredAt: number,
  value: NormalizedAttemptEvent["activity"],
): NormalizedAttemptEvent {
  return {
    eventId: toOpaqueId<ActivityEventId>(`native-activity-${attemptId}-${sequence}`)!,
    attemptId,
    generation,
    sequence: toActivitySequence(sequence)!,
    occurredAt,
    activity: value,
  };
}

function attemptInspector(
  context: RunContext,
  terminal: "failed" | "cancelled" | "succeeded" | null,
): AttemptInspectorProjection {
  let projection = createAttemptInspectorProjection(context);
  projection = projectAttemptActivity(projection, activity(
    context.attemptId,
    context.generation,
    2,
    context.capturedAt + 1,
    {
      kind: "user_message",
      messageId: `native-user-${context.attemptId}`,
      text: "Inspect the deterministic lifecycle state and report the bounded outcome.",
    },
  ));
  projection = projectAttemptActivity(projection, activity(
    context.attemptId,
    context.generation,
    3,
    context.capturedAt + 2,
    {
      kind: "agent_message",
      messageId: `native-agent-${context.attemptId}`,
      textDelta: "The synthetic worktree is ready for supervised verification.",
    },
  ));
  projection = projectAttemptActivity(projection, activity(
    context.attemptId,
    context.generation,
    4,
    context.capturedAt + 3,
    {
      kind: "tool_call",
      call: {
        toolCallId: `native-tool-${context.attemptId}`,
        kind: "read",
        status: "completed",
        locations: ["src/native.ts"],
      },
    },
  ));
  if (terminal !== null) {
    projection = projectAttemptActivity(projection, activity(
      context.attemptId,
      context.generation,
      5,
      context.capturedAt + 4,
      { kind: "attempt_state", state: terminal },
    ));
  }
  return projection;
}

function seedAttempt(
  journal: EventJournal,
  cardValue: CardProjection,
  binding: CardWorktreeBinding,
  state: AttemptProjection["state"],
  index: number,
): { readonly attempt: AttemptProjection; readonly context: RunContext } {
  const attemptId = toOpaqueId<AttemptId>(`native-attempt-${cardValue.cardId}`)!;
  const generation = toAttemptGeneration(1)!;
  const terminal = state === "failed" || state === "cancelled" || state === "succeeded"
    ? state
    : null;
  const context = runContext(
    cardValue,
    cardValue.stageId === NATIVE_FIXTURE_IDS.reviewStage ? "Review" : "Doing",
    attemptId,
    generation,
    binding,
  );
  const starting: AttemptProjection = {
    attemptId,
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    generation,
    state: "starting",
    sessionId: null,
    failure: null,
    createdAt: cardValue.updatedAt,
    startedAt: null,
    terminalAt: null,
  };
  const running: AttemptProjection = {
    ...starting,
    state: "running",
    sessionId: `native-session-${index}`,
    startedAt: cardValue.updatedAt + 1,
  };
  const attempt: AttemptProjection = {
    ...running,
    state,
    sessionId: state === "running" || state === "needs_attention"
      ? running.sessionId
      : null,
    failure: state === "failed"
      ? {
          code: "activity_failed",
          message: "The agent reported a failed attempt",
          occurredAt: cardValue.updatedAt + 4,
        }
      : null,
    terminalAt: terminal === null ? null : cardValue.updatedAt + 4,
  };
  journal.append({
    eventId: `native-worktree-${index}`,
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    actor: "system",
    kind: "card_worktree_binding_recorded",
    occurredAt: cardValue.updatedAt,
    payload: binding,
  });
  journal.append({
    eventId: `native-attempt-${index}`,
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    attemptId,
    attemptSequence: 0,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: cardValue.updatedAt,
    payload: {
      operation: "created",
      changes: [
        {
          entity: "card",
          operation: "upsert",
          value: {
            ...cardValue,
            executionStatus: "running",
            version: 2,
          },
        },
        { entity: "attempt", operation: "upsert", value: starting },
        { entity: "run_context", operation: "insert", value: context },
      ],
    },
  });
  journal.append({
    eventId: `native-attempt-started-${index}`,
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    attemptId,
    attemptSequence: 1,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: cardValue.updatedAt + 1,
    payload: {
      operation: "started",
      changes: [{
        entity: "attempt",
        operation: "upsert",
        value: running,
      }],
    },
  });
  const activities: NormalizedAttemptEvent["activity"][] = [
    {
      kind: "user_message",
      messageId: `native-user-${attemptId}`,
      text: "Inspect the deterministic lifecycle state and report the bounded outcome.",
    },
    {
      kind: "agent_message",
      messageId: `native-agent-${attemptId}`,
      textDelta: "The synthetic worktree is ready for supervised verification.",
    },
    {
      kind: "tool_call",
      call: {
        toolCallId: `native-tool-${attemptId}`,
        kind: "read",
        status: "completed",
        locations: ["src/native.ts"],
      },
    },
    ...(terminal === null
      ? []
      : [{ kind: "attempt_state", state: terminal } as const]),
  ];
  for (const [activityIndex, normalizedActivity] of activities.entries()) {
    const sequence = activityIndex + 2;
    journal.append({
      eventId: `native-attempt-activity-${index}-${sequence}`,
      boardId: cardValue.boardId,
      cardId: cardValue.cardId,
      attemptId,
      attemptSequence: sequence,
      actor: "agent",
      kind: "attempt_activity_committed",
      occurredAt: cardValue.updatedAt + sequence,
      payload: {
        generation,
        activity: normalizedActivity,
      },
    });
  }
  return { attempt, context };
}

function attentionBlocker(
  cardValue: CardProjection,
  attempt: AttemptProjection,
): AttentionBlockerProjection {
  return {
    schemaVersion: 1,
    blockerId: "native-question-attention" as QuestionId,
    callId: "native-attention-call",
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    form: {
      title: "Verification choice required",
      context: "The synthetic run is paused at a deterministic decision.",
      prompt: "Which bounded verification path should the agent continue with?",
      fields: [{
        id: "path",
        label: "Verification path",
        required: true,
        mode: "single",
        options: [
          { id: "focused", label: "Focused checks" },
          { id: "complete", label: "Complete matrix" },
        ],
        allowsCustom: false,
      }],
    },
    active: true,
    outcome: null,
    notification: {
      state: "delivered",
      attemptedAt: cardValue.updatedAt + 3,
      failureCode: null,
    },
    version: 1,
    createdAt: cardValue.updatedAt + 2,
    updatedAt: cardValue.updatedAt + 3,
    terminalAt: null,
  };
}

function queueFor(
  cardValue: CardProjection,
  attempt: AttemptProjection,
  interrupted: boolean,
): readonly FollowUpQueueProjection[] {
  const queueId = `native-queue-${cardValue.cardId}` as FollowUpQueueId;
  const queued = createFollowUpQueue({
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    queueId,
    text: interrupted
      ? "Explicitly retry this interrupted direction."
      : "Continue with the queued verification direction.",
    occurredAt: cardValue.updatedAt + 5,
  });
  if (!interrupted) return [queued];
  const dispatching = markFollowUpDispatching(
    queued,
    queueId,
    cardValue.updatedAt + 6,
    { attemptId: attempt.attemptId, generation: attempt.generation, expectedVersion: queued.version },
  );
  const interruptedQueue = interruptFollowUpDispatch(
    dispatching,
    queueId,
    cardValue.updatedAt + 7,
    {
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      expectedVersion: dispatching.version,
    },
  );
  return [queued, dispatching, interruptedQueue];
}

function evidenceRecord(
  cardValue: CardProjection,
  attempt: AttemptProjection,
  binding: CardWorktreeBinding,
  oversized: boolean,
): ReviewEvidenceRecord {
  const largePatch = oversized
    ? new Uint8Array(REVIEW_TEXT_PATCH_BYTE_LIMIT + 1).fill(97)
    : TEXT_PATCH;
  const textFile = {
    evidenceId: `native-evidence-${cardValue.cardId}`,
    fileIndex: 0,
    fileId: oversized ? "native-file-oversized" : "native-file-text",
    status: "modified" as const,
    oldPath: oversized ? "src/oversized.ts" : "src/native.ts",
    newPath: oversized ? "src/oversized.ts" : "src/native.ts",
    oldMode: "100644",
    newMode: "100644",
    isBinary: false,
    additions: 1,
    deletions: 1,
    patchByteLength: largePatch.byteLength,
    patchDigest: createHash("sha256").update(largePatch).digest("hex"),
    contentDigest: null,
    patchBlob: largePatch,
  };
  const binaryFile = oversized ? null : {
    evidenceId: textFile.evidenceId,
    fileIndex: 1,
    fileId: "native-file-binary",
    status: "binary" as const,
    oldPath: null,
    newPath: "assets/native.bin",
    oldMode: null,
    newMode: "100644",
    isBinary: true,
    additions: null,
    deletions: null,
    patchByteLength: 0,
    patchDigest: createHash("sha256").update(new Uint8Array()).digest("hex"),
    contentDigest: createHash("sha256").update("native-binary").digest("hex"),
    patchBlob: null,
  };
  const files = binaryFile === null ? [textFile] : [textFile, binaryFile];
  const evidenceId = textFile.evidenceId;
  return {
    evidenceId,
    boardId: cardValue.boardId,
    cardId: cardValue.cardId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    worktreeBindingId: binding.bindingId,
    baseCommit: binding.baselineCommit,
    headCommit: binding.baselineCommit,
    policyVersion: REVIEW_EVIDENCE_POLICY_VERSION,
    evidenceDigest: createHash("sha256")
      .update(`${evidenceId}:${largePatch.byteLength}`)
      .digest("hex"),
    fileCount: files.length,
    totalPatchBytes: files.reduce((total, file) => total + file.patchByteLength, 0),
    createdAt: cardValue.updatedAt + 8,
    files,
  };
}

function persistEvidence(
  journal: EventJournal,
  cardValue: CardProjection,
  attempt: AttemptProjection,
  binding: CardWorktreeBinding,
  oversized: boolean,
): void {
  const evidence = evidenceRecord(cardValue, attempt, binding, oversized);
  journal.immediate((transaction) => {
    transaction.persistReviewEvidence(evidence);
    transaction.append({
      eventId: `evidence:${evidence.evidenceId}`,
      boardId: cardValue.boardId,
      cardId: cardValue.cardId,
      actor: "system",
      kind: "review_evidence_committed",
      occurredAt: evidence.createdAt,
      payload: {
        evidence: {
          evidenceId: evidence.evidenceId,
          evidenceDigest: evidence.evidenceDigest,
          attemptId: evidence.attemptId,
          generation: evidence.generation,
          worktreeBindingId: evidence.worktreeBindingId,
          boardId: evidence.boardId,
          cardId: evidence.cardId,
          createdAt: evidence.createdAt,
        },
        changes: [{ entity: "card", operation: "upsert", value: cardValue }],
      },
    });
  });
}

function seedBoard(
  journal: EventJournal,
  boardId: BoardId,
  repositoryPath: string,
  timestamp: number,
): void {
  journal.append({
    eventId: `native-board-${boardId}`,
    boardId,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: timestamp,
    payload: {
      boardId,
      repositoryPath,
      workflowVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
}

async function seedPopulatedFixture(
  journal: EventJournal,
  fixtureDirectory: string,
  repositoryPath: string,
  baselineCommit: string,
  includeOversized: boolean,
  makeReviewStale: boolean,
): Promise<void> {
  seedBoard(journal, NATIVE_FIXTURE_IDS.primaryBoard, repositoryPath, FIXTURE_TIME);
  journal.append({
    eventId: "native-stage-doing",
    boardId: NATIVE_FIXTURE_IDS.primaryBoard,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: FIXTURE_TIME + 1,
    payload: {
      stageId: NATIVE_FIXTURE_IDS.doingStage,
      boardId: NATIVE_FIXTURE_IDS.primaryBoard,
      label: "Doing",
      position: 0,
      defaultSkillId: SKILL_ID,
      configured: true,
      workflowVersion: 1,
      updatedAt: FIXTURE_TIME + 1,
    },
  });
  journal.append({
    eventId: "native-stage-review",
    boardId: NATIVE_FIXTURE_IDS.primaryBoard,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: FIXTURE_TIME + 2,
    payload: {
      stageId: NATIVE_FIXTURE_IDS.reviewStage,
      boardId: NATIVE_FIXTURE_IDS.primaryBoard,
      label: "Review",
      position: 1,
      defaultSkillId: SKILL_ID,
      configured: true,
      workflowVersion: 1,
      updatedAt: FIXTURE_TIME + 2,
    },
  });

  const cards = [
    card(NATIVE_FIXTURE_IDS.attentionCard, NATIVE_FIXTURE_IDS.doingStage, "Choose verification path", "needs_attention", 10),
    card(NATIVE_FIXTURE_IDS.runningCard, NATIVE_FIXTURE_IDS.doingStage, "Run lifecycle harness", "running", 20),
    card(NATIVE_FIXTURE_IDS.failedCard, NATIVE_FIXTURE_IDS.doingStage, "Recover failed packaged launch", "failed", 30),
    card(NATIVE_FIXTURE_IDS.reviewCard, NATIVE_FIXTURE_IDS.reviewStage, "Review native evidence", "ready_for_review", 40),
    card(NATIVE_FIXTURE_IDS.settledCard, NATIVE_FIXTURE_IDS.doingStage, "Settled synthetic task", "cancelled", 50),
    card(NATIVE_FIXTURE_IDS.queuedCard, NATIVE_FIXTURE_IDS.doingStage, "Queued direct-send direction", "running", 60),
    card(NATIVE_FIXTURE_IDS.interruptedCard, NATIVE_FIXTURE_IDS.doingStage, "Interrupted explicit direction", "running", 70),
    ...(includeOversized
      ? [card(NATIVE_FIXTURE_IDS.oversizedCard, NATIVE_FIXTURE_IDS.reviewStage, "Oversized review evidence", "ready_for_review", 80)]
      : []),
  ];

  const stateByCard = new Map<CardId, AttemptProjection["state"]>([
    [NATIVE_FIXTURE_IDS.attentionCard, "needs_attention"],
    [NATIVE_FIXTURE_IDS.runningCard, "running"],
    [NATIVE_FIXTURE_IDS.failedCard, "failed"],
    [NATIVE_FIXTURE_IDS.reviewCard, "succeeded"],
    [NATIVE_FIXTURE_IDS.settledCard, "cancelled"],
    [NATIVE_FIXTURE_IDS.queuedCard, "running"],
    [NATIVE_FIXTURE_IDS.interruptedCard, "running"],
    [NATIVE_FIXTURE_IDS.oversizedCard, "succeeded"],
  ]);
  const reviewEvidence = createReviewEvidenceService(journal, {
    now: () => FIXTURE_TIME + 48,
  });

  for (const [index, cardValue] of cards.entries()) {
    journal.append({
      eventId: `native-card-${index}`,
      boardId: cardValue.boardId,
      cardId: cardValue.cardId,
      actor: "operator",
      kind: "card_upserted",
      occurredAt: cardValue.createdAt,
      payload: {
        ...cardValue,
        executionStatus: "idle",
        version: 1,
      },
    });
    const binding = worktreeBinding(
      fixtureDirectory,
      repositoryPath,
      baselineCommit,
      cardValue.boardId,
      cardValue.cardId,
      index + 1,
    );
    const seeded = seedAttempt(
      journal,
      cardValue,
      binding,
      stateByCard.get(cardValue.cardId)!,
      index + 1,
    );
    if (cardValue.cardId === NATIVE_FIXTURE_IDS.attentionCard) {
      const blocker = attentionBlocker(cardValue, seeded.attempt);
      journal.append({
        eventId: "native-attention-raised",
        boardId: cardValue.boardId,
        cardId: cardValue.cardId,
        actor: "agent",
        kind: "attention_blocker_committed",
        occurredAt: blocker.updatedAt,
        payload: {
          operation: "raised",
          changes: [
            {
              entity: "attention_blocker",
              operation: "upsert",
              value: blocker,
            },
            {
              entity: "card",
              operation: "upsert",
              value: {
                ...cardValue,
                executionStatus: "needs_attention",
                version: 3,
                updatedAt: blocker.updatedAt,
              },
            },
            {
              entity: "attempt",
              operation: "upsert",
              value: {
                ...seeded.attempt,
                state: "needs_attention",
              },
            },
          ],
        },
      });
    }
    if (
      cardValue.cardId === NATIVE_FIXTURE_IDS.queuedCard
      || cardValue.cardId === NATIVE_FIXTURE_IDS.interruptedCard
    ) {
      const queues = queueFor(
        cardValue,
        seeded.attempt,
        cardValue.cardId === NATIVE_FIXTURE_IDS.interruptedCard,
      );
      for (const queue of queues) {
        const operation = queue.drafts[0]?.state === "interrupted"
          ? "interrupted"
          : queue.drafts[0]?.state === "dispatching"
            ? "dispatching"
            : "enqueued";
        journal.append({
          eventId: `native-queue-${cardValue.cardId}-${operation}`,
          boardId: cardValue.boardId,
          cardId: cardValue.cardId,
          actor: "operator",
          kind: "follow_up_queue_committed",
          occurredAt: queue.updatedAt,
          payload: { operation, queue },
        });
      }
    }
    if (cardValue.cardId === NATIVE_FIXTURE_IDS.reviewCard) {
      const captured = await reviewEvidence.capture({
        boardId: cardValue.boardId,
        expectedWorkflowVersion: 1,
        cardId: cardValue.cardId,
        attemptId: seeded.attempt.attemptId,
        generation: seeded.attempt.generation,
        expectedCardVersion: 2,
        worktreeBindingId: binding.bindingId,
      });
      if (captured.status !== "committed") {
        throw new Error(`Native review evidence capture failed: ${captured.reason}`);
      }
      if (makeReviewStale) {
        writeFileSync(
          join(binding.worktreePath, "src-native.ts"),
          "export const state = \"stale-after-capture\";\n",
        );
      }
    } else if (cardValue.cardId === NATIVE_FIXTURE_IDS.oversizedCard) {
      persistEvidence(
        journal,
        cardValue,
        seeded.attempt,
        binding,
        cardValue.cardId === NATIVE_FIXTURE_IDS.oversizedCard,
      );
    }
  }

  const secondaryRepository = join(fixtureDirectory, "repositories", "secondary");
  initializeRepository(secondaryRepository);
  seedBoard(
    journal,
    NATIVE_FIXTURE_IDS.secondaryBoard,
    realpathSync(secondaryRepository),
    FIXTURE_TIME - 100,
  );
  journal.append({
    eventId: "native-secondary-stage",
    boardId: NATIVE_FIXTURE_IDS.secondaryBoard,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: FIXTURE_TIME - 99,
    payload: {
      stageId: workflowIds.stage("native-secondary-stage"),
      boardId: NATIVE_FIXTURE_IDS.secondaryBoard,
      label: "Queued",
      position: 0,
      defaultSkillId: null,
      configured: false,
      workflowVersion: 1,
      updatedAt: FIXTURE_TIME - 99,
    },
  });
  journal.append({
    eventId: "native-secondary-card",
    boardId: NATIVE_FIXTURE_IDS.secondaryBoard,
    cardId: NATIVE_FIXTURE_IDS.secondaryCard,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: FIXTURE_TIME - 98,
    payload: {
      ...card(
        NATIVE_FIXTURE_IDS.secondaryCard,
        workflowIds.stage("native-secondary-stage"),
        "Secondary repository task",
        "idle",
        90,
      ),
      boardId: NATIVE_FIXTURE_IDS.secondaryBoard,
      createdAt: FIXTURE_TIME - 98,
      updatedAt: FIXTURE_TIME - 98,
    },
  });
}

export async function seedLifecycleFixture(
  fixtureId: string,
  outputRoot: string,
): Promise<SeededLifecycleFixture> {
  const declared = declaredLifecycleFixture(fixtureId);
  const resolvedOutputRoot = resolve(outputRoot);
  const fixtureDirectory = resolve(resolvedOutputRoot, fixtureId);
  if (!fixtureDirectory.startsWith(`${resolvedOutputRoot}/`)) {
    throw new Error("Lifecycle fixture directory escapes its output root");
  }
  if (existsSync(fixtureDirectory)) {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
  mkdirSync(fixtureDirectory, { recursive: true });
  const repositoryPath = join(fixtureDirectory, "repositories", "primary");
  const baselineCommit = initializeRepository(repositoryPath);
  const databasePath = join(fixtureDirectory, "workflow.sqlite");
  const database = openSqliteDatabase({ filename: databasePath });
  try {
    migrateDatabase(database, { now: () => FIXTURE_TIME - 1_000 });
    const journal = createEventJournal(database);
    if (declared.state !== "empty_workspace") {
      await seedPopulatedFixture(
        journal,
        fixtureDirectory,
        realpathSync(repositoryPath),
        baselineCommit,
        declared.state === "review_too_large",
        declared.state === "review_stale_evidence",
      );
    }
    const snapshot = journal.snapshot();
    writeFileSync(
      join(fixtureDirectory, "fixture.json"),
      `${JSON.stringify({
        matrixVersion: "lifecycle-v1",
        fixtureId,
        state: declared.state,
        database: "workflow.sqlite",
        repository: "repositories/primary",
      }, null, 2)}\n`,
    );
    chmodSync(databasePath, 0o600);
    return {
      fixtureId,
      fixtureDirectory,
      databasePath,
      repositoryPath: realpathSync(repositoryPath),
      snapshot,
    };
  } finally {
    closeSqliteDatabase(database);
  }
}

if (import.meta.main) {
  const fixtureId = process.argv[2];
  const outputRoot = process.argv[3];
  if (fixtureId === undefined || outputRoot === undefined) {
    throw new Error("Usage: bun run test/native/seedLifecycleFixture.ts <fixture-id> <output-root>");
  }
  const seeded = await seedLifecycleFixture(fixtureId, outputRoot);
  console.log(JSON.stringify({
    fixtureId: seeded.fixtureId,
    databasePath: seeded.databasePath,
    revision: seeded.snapshot.revision,
  }));
}
