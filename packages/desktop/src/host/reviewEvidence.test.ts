import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type ProfileId,
} from "@kitten/engine";
import { createActivityIngestor } from "../attempts/activityIngestor.ts";
import type { RunContext } from "../attempts/contracts.ts";
import {
  createEventJournal,
  type EventJournal,
  type ReviewEvidenceRecord,
} from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import {
  closeSqliteDatabase,
  openSqliteDatabase,
} from "../persistence/sqliteDatabase.ts";
import {
  REVIEW_DIFF_CHUNK_BYTE_LIMIT,
  type ReviewEvidencePrecondition,
} from "../shared/rpc.ts";
import {
  workflowIds,
  type BoardId,
  type CardId,
  type CardProjection,
  type StageId,
} from "../workflow/workflowTypes.ts";
import {
  recordCardWorktreeBinding,
} from "../worktrees/cardWorktreeProjection.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import {
  canonicalizeReviewEvidence,
  createReviewEvidenceService,
  REVIEW_EVIDENCE_POLICY_VERSION,
  REVIEW_TEXT_PATCH_BYTE_LIMIT,
  REVIEW_TOTAL_PATCH_BYTE_LIMIT,
  ReviewEvidenceCaptureError,
  type CanonicalReviewEvidenceFileInput,
  type CanonicalReviewEvidenceInput,
} from "./reviewEvidence.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

const BOARD_ID = workflowIds.board("board-review-evidence");
const STAGE_ID = workflowIds.stage("stage-review-evidence");
const CARD_ID = workflowIds.card("card-review-evidence");
const ATTEMPT_ID = toOpaqueId<AttemptId>("attempt-review-evidence")!;
const GENERATION = toAttemptGeneration(1)!;
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);
const BASE_COMMIT = "a".repeat(40);
const HEAD_COMMIT = "b".repeat(40);
const BINDING_ID = "kw-reviewevidence01";

function textFile(
  path: string,
  patch = "diff --git a/file b/file\n-old\n+new\n",
  overrides: Partial<CanonicalReviewEvidenceFileInput> = {},
): CanonicalReviewEvidenceFileInput {
  return {
    status: "modified",
    oldPath: path,
    newPath: path,
    oldMode: "100644",
    newMode: "100644",
    isBinary: false,
    additions: 1,
    deletions: 1,
    patch,
    contentDigest: null,
    ...overrides,
  };
}

function canonicalInput(
  files: readonly CanonicalReviewEvidenceFileInput[],
  overrides: Partial<CanonicalReviewEvidenceInput> = {},
): CanonicalReviewEvidenceInput {
  return {
    boardId: BOARD_ID,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    worktreeBindingId: BINDING_ID,
    baseCommit: BASE_COMMIT,
    headCommit: HEAD_COMMIT,
    policyVersion: REVIEW_EVIDENCE_POLICY_VERSION,
    createdAt: 1_000,
    files,
    ...overrides,
  };
}

function expectCaptureError(
  callback: () => unknown,
  reason: ReviewEvidenceCaptureError["reason"],
): void {
  try {
    callback();
    throw new Error("expected review-evidence capture to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewEvidenceCaptureError);
    expect((error as ReviewEvidenceCaptureError).reason).toBe(reason);
  }
}

describe("review evidence canonicalization", () => {
  test("is order-independent and normalizes CRLF and LF patches equivalently", () => {
    const alphaLf = textFile(
      "src/alpha.ts",
      "diff --git a/src/alpha.ts b/src/alpha.ts\nindex 1111111..2222222 100644\n-old\n+new\n",
    );
    const alphaCrlf = {
      ...alphaLf,
      patch: "diff --git a/src/alpha.ts b/src/alpha.ts\r\nindex aaaaaaa..bbbbbbb 100644\r\n-old\r\n+new\r\n",
    };
    const omega = textFile("src/omega.ts");
    const first = canonicalizeReviewEvidence(canonicalInput([omega, alphaLf]));
    const second = canonicalizeReviewEvidence(canonicalInput([alphaCrlf, omega]));

    expect(first.evidenceDigest).toBe(second.evidenceDigest);
    expect(first.evidenceId).toBe(second.evidenceId);
    expect(first.files.map(({ newPath }) => newPath)).toEqual([
      "src/alpha.ts",
      "src/omega.ts",
    ]);
    expect(new TextDecoder().decode(first.files[0]!.patchBlob!)).not.toContain("\r");
  });

  test("changes the digest for content, mode, rename, deletion, and final-newline semantics", () => {
    const baseline = canonicalizeReviewEvidence(canonicalInput([textFile("src/file.ts")]));
    const variants = [
      textFile("src/file.ts", "diff --git a/file b/file\n-old\n+different\n"),
      textFile("src/file.ts", undefined, { newMode: "100755" }),
      textFile("src/file.ts", undefined, {
        status: "renamed",
        oldPath: "src/old.ts",
        newPath: "src/file.ts",
      }),
      textFile("src/file.ts", undefined, {
        status: "deleted",
        newPath: null,
        newMode: null,
      }),
      textFile(
        "src/file.ts",
        "diff --git a/file b/file\n-old\n+new\n\\ No newline at end of file\n",
      ),
    ];
    expect(new Set(variants.map((file) => (
      canonicalizeReviewEvidence(canonicalInput([file])).evidenceDigest
    ))).size).toBe(variants.length);
    for (const file of variants) {
      expect(canonicalizeReviewEvidence(canonicalInput([file])).evidenceDigest)
        .not.toBe(baseline.evidenceDigest);
    }

    expect(canonicalizeReviewEvidence(canonicalInput(
      [textFile("src/file.ts")],
      { boardId: workflowIds.board("other-board") },
    )).evidenceDigest).not.toBe(baseline.evidenceDigest);
    expect(canonicalizeReviewEvidence(canonicalInput(
      [textFile("src/file.ts")],
      { generation: toAttemptGeneration(2)! },
    )).evidenceDigest).not.toBe(baseline.evidenceDigest);
  });

  test("keeps binary metadata and content digest without storing patch text", () => {
    const contentDigest = "c".repeat(64);
    const evidence = canonicalizeReviewEvidence(canonicalInput([textFile(
      "assets/image.png",
      null as never,
      {
        status: "added",
        oldPath: null,
        oldMode: null,
        isBinary: true,
        additions: null,
        deletions: null,
        patch: null,
        contentDigest,
      },
    )]));
    expect(evidence.files[0]).toMatchObject({
      status: "binary",
      isBinary: true,
      patchByteLength: 0,
      patchDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      contentDigest,
      patchBlob: null,
    });
  });

  test("enforces file, per-patch, aggregate, path, mode, and digest limits", () => {
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput(
        Array.from({ length: 2_001 }, (_, index) => textFile(`files/${index}.ts`, "")),
      )),
      "oversized",
    );
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([
        textFile("large.ts", "x".repeat(REVIEW_TEXT_PATCH_BYTE_LIMIT + 1)),
      ])),
      "oversized",
    );
    const exactPatch = "x".repeat(REVIEW_TEXT_PATCH_BYTE_LIMIT);
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([
        ...Array.from(
          { length: REVIEW_TOTAL_PATCH_BYTE_LIMIT / REVIEW_TEXT_PATCH_BYTE_LIMIT },
          (_, index) => textFile(`aggregate/${index}.ts`, exactPatch),
        ),
        textFile("aggregate/overflow.ts", "x"),
      ])),
      "oversized",
    );
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([textFile("../escape.ts")])),
      "unsafe",
    );
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([
        textFile("/absolute.ts"),
      ])),
      "unsafe",
    );
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([
        textFile("mode.ts", undefined, { newMode: "10064" }),
      ])),
      "unsupported",
    );
    expectCaptureError(
      () => canonicalizeReviewEvidence(canonicalInput([
        textFile("binary.dat", null as never, {
          isBinary: true,
          patch: null,
          additions: null,
          deletions: null,
          contentDigest: null,
        }),
      ])),
      "incomplete",
    );
  });
});

describe("review manifest and bounded chunks", () => {
  test("serves UTF-8-safe 64 KiB chunks and an explicit binary state", () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    const longPatch = `${"a".repeat(REVIEW_DIFF_CHUNK_BYTE_LIMIT - 1)}😀tail`;
    const evidence = canonicalizeReviewEvidence(canonicalInput([
      textFile("src/utf8.ts", longPatch),
      textFile("assets/data.bin", null as never, {
        status: "added",
        oldPath: null,
        oldMode: null,
        isBinary: true,
        additions: null,
        deletions: null,
        patch: null,
        contentDigest: "d".repeat(64),
      }),
    ]));
    try {
      journal.immediate((transaction) => transaction.persistReviewEvidence(evidence));
      const service = createReviewEvidenceService(journal);
      const manifest = service.manifest(evidence.evidenceId);
      expect(manifest.status).toBe("ok");
      if (manifest.status !== "ok") throw new Error("manifest unavailable");
      expect(manifest.manifest.files).toHaveLength(2);
      expect(JSON.stringify(manifest.manifest)).not.toContain("patchBlob");

      const text = evidence.files.find(({ newPath }) => newPath === "src/utf8.ts")!;
      const first = service.readDiffChunk(evidence.evidenceId, text.fileId, 0);
      expect(first.status).toBe("ok");
      if (first.status !== "ok") throw new Error("chunk unavailable");
      expect(new TextEncoder().encode(first.chunk.content).byteLength)
        .toBeLessThanOrEqual(REVIEW_DIFF_CHUNK_BYTE_LIMIT);
      expect(first.chunk.content.endsWith("�")).toBeFalse();
      expect(first.chunk.nextOffset).toBe(REVIEW_DIFF_CHUNK_BYTE_LIMIT - 1);
      const second = service.readDiffChunk(
        evidence.evidenceId,
        text.fileId,
        first.chunk.nextOffset!,
      );
      expect(second).toMatchObject({
        status: "ok",
        chunk: { complete: true, nextOffset: null, content: "😀tail" },
      });
      expect(service.readDiffChunk(evidence.evidenceId, text.fileId, 2)).toMatchObject({
        status: "ok",
      });
      const binary = evidence.files.find(({ isBinary }) => isBinary)!;
      expect(service.readDiffChunk(evidence.evidenceId, binary.fileId, 0)).toEqual({
        status: "non_text",
        state: "binary",
      });
      expect(service.readDiffChunk(evidence.evidenceId, "missing-file", 0)).toEqual({
        status: "unavailable",
        reason: "invalid_file",
      });
      expect(service.readDiffChunk(evidence.evidenceId, text.fileId, -1)).toEqual({
        status: "unavailable",
        reason: "invalid_offset",
      });
      expect(service.readDiffChunk("missing-evidence", text.fileId, 0)).toEqual({
        status: "unavailable",
        reason: "missing",
      });
      expect(service.manifest("missing-evidence")).toEqual({
        status: "unavailable",
        reason: "missing",
      });
    } finally {
      closeSqliteDatabase(database);
    }
  });
});

interface GitFixture {
  readonly root: string;
  readonly worktree: string;
  readonly binding: CardWorktreeBinding;
  readonly baselineCommit: string;
}

function runGit(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git fixture command failed: ${args[0] ?? "unknown"}`);
  }
  return result.stdout.toString().replace(/\r?\n$/u, "");
}

async function createGitFixture(): Promise<GitFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kitten-review-evidence-")));
  temporaryDirectories.push(root);
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "Kitten Test"]);
  runGit(root, ["config", "user.email", "kitten@example.invalid"]);
  await writeFile(join(root, "tracked.txt"), "base\n");
  await writeFile(join(root, "delete.txt"), "delete me\n");
  await writeFile(join(root, "rename.txt"), "rename me\n");
  await writeFile(join(root, "binary.dat"), new Uint8Array([0, 1, 2, 3]));
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "baseline"]);
  const baselineCommit = runGit(root, ["rev-parse", "HEAD"]);
  const managedRoot = join(root, ".kitten", "worktrees", "cards");
  const worktree = join(managedRoot, BINDING_ID);
  await mkdir(managedRoot, { recursive: true });
  runGit(root, ["worktree", "add", "-b", `kitten/card/${BINDING_ID}`, worktree, baselineCommit]);
  const repositoryGitDir = await realpath(join(root, ".git"));
  return {
    root,
    worktree: await realpath(worktree),
    baselineCommit,
    binding: {
      bindingVersion: 1,
      bindingId: BINDING_ID,
      boardId: BOARD_ID,
      cardId: CARD_ID,
      repositoryRoot: root,
      repositoryGitDir,
      managedRoot: await realpath(managedRoot),
      worktreePath: await realpath(worktree),
      branch: `kitten/card/${BINDING_ID}`,
      baselineBranch: "main",
      baselineCommit,
      lifecycle: "active",
      reason: null,
      createdAt: 10,
      updatedAt: 10,
    },
  };
}

async function addRepresentativeChanges(fixture: GitFixture): Promise<void> {
  await writeFile(join(fixture.worktree, "tracked.txt"), "changed\r\n");
  await rm(join(fixture.worktree, "delete.txt"));
  await rename(
    join(fixture.worktree, "rename.txt"),
    join(fixture.worktree, "renamed.txt"),
  );
  runGit(fixture.worktree, ["add", "-A"]);
  await writeFile(join(fixture.worktree, "untracked.txt"), "untracked\n");
  await writeFile(
    join(fixture.worktree, "binary.dat"),
    new Uint8Array([0, 9, 8, 7, 6]),
  );
  await writeFile(join(fixture.worktree, "executable.sh"), "#!/bin/sh\necho ok\n");
  await chmod(join(fixture.worktree, "executable.sh"), 0o755);
}

function runContext(binding: CardWorktreeBinding): RunContext {
  return {
    schemaVersion: 1,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    capturedAt: 100,
    card: {
      cardId: CARD_ID,
      title: "Review evidence",
      description: "Fixture",
      version: 1,
    },
    stage: { stageId: STAGE_ID, label: "Review" },
    workflow: { boardId: BOARD_ID, version: 1 },
    skill: {
      snapshotId: SKILL_ID,
      skillId: SKILL_ID,
      canonicalPath: join(binding.repositoryRoot, ".agents/skills/fixture/SKILL.md"),
      rootClass: "project",
      digest: "a".repeat(64),
      metadata: {
        name: "fixture",
        description: "Fixture",
        frontmatter: { name: "fixture" },
      },
      content: "Execute fixture",
    },
    profile: {
      profileId: "profile-codex" as ProfileId,
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      protocolVersion: 1,
      recipeId: "codex-acp",
      adapterVersion: "1.2.3",
      readinessCheckedAt: 90,
    },
    repository: {
      trusted: true,
      canonicalPath: binding.repositoryRoot,
      checkedAt: 90,
      message: "verified",
    },
    worktree: binding,
  };
}

async function seedReviewJournal(
  journal: EventJournal,
  fixture: GitFixture,
): Promise<CardProjection> {
  const card: CardProjection = {
    cardId: CARD_ID,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: "Review evidence",
    description: "Fixture",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: 3,
    updatedAt: 3,
  };
  journal.append({
    eventId: "review-evidence-board",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: 1,
    payload: {
      boardId: BOARD_ID,
      repositoryPath: fixture.root,
      workflowVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  journal.append({
    eventId: "review-evidence-stage",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: 2,
    payload: {
      stageId: STAGE_ID,
      boardId: BOARD_ID,
      label: "Review",
      position: 0,
      defaultSkillId: SKILL_ID,
      configured: true,
      workflowVersion: 1,
      updatedAt: 2,
    },
  });
  journal.append({
    eventId: "review-evidence-card",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3,
    payload: card,
  });
  recordCardWorktreeBinding(journal, {
    eventId: "review-evidence-binding",
    binding: fixture.binding,
  });
  const starting = {
    attemptId: ATTEMPT_ID,
    boardId: BOARD_ID,
    cardId: CARD_ID,
    generation: GENERATION,
    state: "starting" as const,
    sessionId: null,
    failure: null,
    createdAt: 100,
    startedAt: null,
    terminalAt: null,
  };
  journal.append({
    eventId: "review-evidence-attempt-created",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    attemptSequence: 0,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: 100,
    payload: {
      operation: "created",
      changes: [
        {
          entity: "card",
          operation: "upsert",
          value: {
            ...card,
            executionStatus: "running",
            version: 2,
            updatedAt: 100,
          },
        },
        { entity: "attempt", operation: "upsert", value: starting },
        {
          entity: "run_context",
          operation: "insert",
          value: runContext(fixture.binding),
        },
      ],
    },
  });
  journal.append({
    eventId: "review-evidence-attempt-started",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    attemptSequence: 1,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: 101,
    payload: {
      operation: "started",
      changes: [{
        entity: "attempt",
        operation: "upsert",
        value: {
          ...starting,
          state: "running",
          sessionId: "session-review",
          startedAt: 101,
        },
      }],
    },
  });
  const terminal = await createActivityIngestor({ journal }).ingest({
    eventId: toOpaqueId<ActivityEventId>("review-evidence-terminal")!,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    sequence: toActivitySequence(2)!,
    occurredAt: 102,
    activity: { kind: "attempt_state", state: "succeeded" },
  });
  expect(terminal.status).toBe("committed");
  return journal.snapshot().cards.find(({ cardId }) => cardId === CARD_ID)!;
}

interface PersistenceFixture {
  readonly filename: string;
  readonly journal: EventJournal;
  close(): void;
}

async function createPersistenceFixture(
  gitFixture: GitFixture,
): Promise<PersistenceFixture> {
  const filename = join(gitFixture.root, "review-evidence.sqlite");
  const database = openSqliteDatabase({ filename });
  migrateDatabase(database, { now: () => 1 });
  const journal = createEventJournal(database);
  await seedReviewJournal(journal, gitFixture);
  return {
    filename,
    journal,
    close: () => closeSqliteDatabase(database),
  };
}

function captureInput(
  cardVersion = 2,
  overrides: Partial<{
    boardId: BoardId;
    expectedWorkflowVersion: number;
    cardId: CardId;
    attemptId: AttemptId;
    generation: typeof GENERATION;
    expectedCardVersion: number;
    worktreeBindingId: string;
  }> = {},
) {
  return {
    boardId: BOARD_ID,
    expectedWorkflowVersion: 1,
    cardId: CARD_ID,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    expectedCardVersion: cardVersion,
    worktreeBindingId: BINDING_ID,
    ...overrides,
  };
}

function precondition(record: ReviewEvidenceRecord): ReviewEvidencePrecondition {
  return {
    evidenceId: record.evidenceId,
    evidenceDigest: record.evidenceDigest,
    attemptId: record.attemptId,
    generation: record.generation,
    worktreeBindingId: record.worktreeBindingId,
  };
}

describe("review evidence Git capture and persistence", () => {
  test("atomically captures canonical text, rename, deletion, mode, binary, and untracked evidence", async () => {
    const gitFixture = await createGitFixture();
    await addRepresentativeChanges(gitFixture);
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const before = fixture.journal.snapshot();
      const result = await createReviewEvidenceService(fixture.journal, {
        now: () => 200,
      }).capture(captureInput());
      expect(result.status).toBe("committed");
      if (result.status !== "committed") throw new Error(`capture failed: ${result.reason}`);
      expect(result.cardVersion).toBe(3);
      expect(result.evidence.fileCount).toBe(6);
      expect(result.evidence.totalPatchBytes).toBeGreaterThan(0);
      const after = fixture.journal.snapshot();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.cards[0]).toMatchObject({
        executionStatus: "ready_for_review",
        version: 3,
      });
      expect(after.reviewEvidenceByCard[CARD_ID]).toEqual(result.evidence);
      const event = fixture.journal.eventById(`evidence:${result.evidence.evidenceId}`);
      expect(event).toMatchObject({
        kind: "review_evidence_committed",
        payload: {
          evidence: {
            evidenceId: result.evidence.evidenceId,
            evidenceDigest: result.evidence.evidenceDigest,
            worktreeBindingId: BINDING_ID,
          },
        },
      });
      const stored = fixture.journal.reviewEvidence(result.evidence.evidenceId)!;
      expect(stored.files.map(({ status }) => status)).toEqual([
        "deleted",
        "binary",
        "added",
        "renamed",
        "modified",
        "added",
      ]);
      expect(stored.files.find(({ isBinary }) => isBinary)).toMatchObject({
        patchBlob: null,
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(stored.files.find(({ newPath }) => newPath === "executable.sh")).toMatchObject({
        newMode: "100755",
      });
      expect(JSON.stringify(after)).not.toContain("patchBlob");
      expect(JSON.stringify(after.reviewEvidenceByCard)).not.toContain(gitFixture.root);
    } finally {
      fixture.close();
    }
  });

  test("rolls back evidence, journal reference, and lifecycle after card mutation", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "changed\n");
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const service = createReviewEvidenceService(fixture.journal, {
        now: () => 200,
        afterInitialCapture: () => {
          const card = fixture.journal.snapshot().cards[0]!;
          fixture.journal.append({
            eventId: "concurrent-card-mutation",
            boardId: card.boardId,
            cardId: card.cardId,
            actor: "operator",
            kind: "card_upserted",
            occurredAt: 150,
            payload: { ...card, version: card.version + 1, updatedAt: 150 },
          });
        },
      });
      expect(await service.capture(captureInput())).toEqual({
        status: "unavailable",
        reason: "stale_card",
      });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
      expect(fixture.journal.snapshot().cards[0]).toMatchObject({
        executionStatus: "running",
        version: 3,
      });
      expect(
        fixture.journal.events().some(({ kind }) => kind === "review_evidence_committed"),
      ).toBeFalse();
    } finally {
      fixture.close();
    }
  });

  test("rolls back evidence and readiness after the board workflow mutates during capture", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "changed\n");
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const service = createReviewEvidenceService(fixture.journal, {
        now: () => 200,
        afterInitialCapture: () => {
          const board = fixture.journal.snapshot().boards[0]!;
          fixture.journal.append({
            eventId: "concurrent-board-mutation",
            boardId: board.boardId,
            actor: "operator",
            kind: "board_upserted",
            occurredAt: 150,
            payload: {
              ...board,
              workflowVersion: board.workflowVersion + 1,
              updatedAt: 150,
            },
          });
        },
      });
      expect(await service.capture(captureInput())).toEqual({
        status: "unavailable",
        reason: "stale_board",
      });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
      expect(fixture.journal.snapshot().cards[0]).toMatchObject({
        executionStatus: "running",
        version: 2,
      });
      expect(
        fixture.journal.events().some(({ kind }) => kind === "review_evidence_committed"),
      ).toBeFalse();
    } finally {
      fixture.close();
    }
  });

  test("rolls back evidence and lifecycle after the registered worktree binding mutates", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "changed\n");
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const service = createReviewEvidenceService(fixture.journal, {
        now: () => 200,
        afterInitialCapture: () => {
          recordCardWorktreeBinding(fixture.journal, {
            eventId: "concurrent-worktree-mutation",
            binding: {
              ...gitFixture.binding,
              lifecycle: "unavailable",
              reason: "unverified",
              updatedAt: 150,
            },
          });
        },
      });
      expect(await service.capture(captureInput())).toEqual({
        status: "unavailable",
        reason: "binding_mismatch",
      });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
      expect(fixture.journal.snapshot().cards[0]).toMatchObject({
        executionStatus: "running",
        version: 2,
      });
      expect(
        fixture.journal.events().some(({ kind }) => kind === "review_evidence_committed"),
      ).toBeFalse();
    } finally {
      fixture.close();
    }
  });

  test("rejects worktree mutation between capture passes without persisting partial state", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "first\n");
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const service = createReviewEvidenceService(fixture.journal, {
        now: () => 200,
        afterInitialCapture: () => writeFile(
          join(gitFixture.worktree, "tracked.txt"),
          "second\n",
        ),
      });
      expect(await service.capture(captureInput())).toEqual({
        status: "unavailable",
        reason: "stale",
      });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
      expect(fixture.journal.reviewEvidence("missing")).toBeNull();
    } finally {
      fixture.close();
    }
  });

  test("fails closed for binding mismatch, out-of-root binding, symlink, and gitlink inputs", async () => {
    const mismatchedGit = await createGitFixture();
    await writeFile(join(mismatchedGit.worktree, "tracked.txt"), "changed\n");
    const mismatchFixture = await createPersistenceFixture(mismatchedGit);
    try {
      expect(await createReviewEvidenceService(mismatchFixture.journal).capture(captureInput(
        2,
        { worktreeBindingId: "kw-different000001" },
      ))).toEqual({ status: "unavailable", reason: "binding_mismatch" });

      const outOfRootJournal: EventJournal = {
        ...mismatchFixture.journal,
        snapshot() {
          const snapshot = mismatchFixture.journal.snapshot();
          return {
            ...snapshot,
            cardWorktrees: [{
              ...mismatchedGit.binding,
              worktreePath: mismatchedGit.root,
              updatedAt: 11,
            }],
          };
        },
      };
      expect(await createReviewEvidenceService(outOfRootJournal).capture(captureInput()))
        .toEqual({ status: "unavailable", reason: "binding_mismatch" });
    } finally {
      mismatchFixture.close();
    }

    const symlinkGit = await createGitFixture();
    await symlink("../tracked.txt", join(symlinkGit.worktree, "unsafe-link"));
    const symlinkFixture = await createPersistenceFixture(symlinkGit);
    try {
      expect(await createReviewEvidenceService(symlinkFixture.journal).capture(captureInput()))
        .toEqual({ status: "unavailable", reason: "unsafe" });
    } finally {
      symlinkFixture.close();
    }

    const gitlinkGit = await createGitFixture();
    runGit(gitlinkGit.worktree, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${gitlinkGit.baselineCommit},nested-module`,
    ]);
    const gitlinkFixture = await createPersistenceFixture(gitlinkGit);
    try {
      expect(await createReviewEvidenceService(gitlinkFixture.journal).capture(captureInput()))
        .toEqual({ status: "unavailable", reason: "unsafe" });
    } finally {
      gitlinkFixture.close();
    }
  });

  test("revalidates current evidence and detects committed, dirty, and untracked changes as stale", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "captured\n");
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      const service = createReviewEvidenceService(fixture.journal, { now: () => 200 });
      const captured = await service.capture(captureInput());
      expect(captured.status).toBe("committed");
      if (captured.status !== "committed") throw new Error("capture failed");
      const stored = fixture.journal.reviewEvidence(captured.evidence.evidenceId)!;
      const input = {
        boardId: BOARD_ID,
        cardId: CARD_ID,
        expectedCardVersion: captured.cardVersion,
        evidence: precondition(stored),
      };
      expect(await service.revalidate(input)).toEqual({
        status: "current",
        evidenceId: stored.evidenceId,
        evidenceDigest: stored.evidenceDigest,
      });
      expect(await service.currentManifest(stored.evidenceId)).toMatchObject({
        status: "ok",
        manifest: {
          evidenceId: stored.evidenceId,
          availability: { status: "available" },
        },
      });

      runGit(gitFixture.worktree, ["add", "tracked.txt"]);
      runGit(gitFixture.worktree, ["commit", "-m", "tracked after capture"]);
      expect(await service.revalidate(input)).toEqual({
        status: "unavailable",
        reason: "stale",
      });
      expect(await service.currentManifest(stored.evidenceId)).toEqual({
        status: "unavailable",
        reason: "stale",
      });

      runGit(gitFixture.worktree, ["reset", "--soft", gitFixture.baselineCommit]);
      await writeFile(join(gitFixture.worktree, "tracked.txt"), "dirty after capture\n");
      expect(await service.revalidate(input)).toEqual({
        status: "unavailable",
        reason: "stale",
      });

      await writeFile(join(gitFixture.worktree, "tracked.txt"), "captured\n");
      runGit(gitFixture.worktree, ["reset"]);
      await writeFile(join(gitFixture.worktree, "later.txt"), "eligible untracked\n");
      expect(await service.revalidate(input)).toEqual({
        status: "unavailable",
        reason: "stale",
      });
      expect(await service.revalidate({
        ...input,
        expectedCardVersion: captured.cardVersion - 1,
      })).toEqual({ status: "unavailable", reason: "stale_card" });
      expect(await service.revalidate({
        ...input,
        evidence: { ...input.evidence, evidenceDigest: "0".repeat(64) },
      })).toEqual({ status: "unavailable", reason: "stale" });
    } finally {
      fixture.close();
    }
  });

  test("rejects oversized Git output before admitting evidence", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(
      join(gitFixture.worktree, "oversized.txt"),
      "x".repeat(REVIEW_TEXT_PATCH_BYTE_LIMIT + 1_024),
    );
    const fixture = await createPersistenceFixture(gitFixture);
    try {
      expect(await createReviewEvidenceService(fixture.journal).capture(captureInput()))
        .toEqual({ status: "unavailable", reason: "oversized" });
      expect(fixture.journal.snapshot().reviewEvidenceByCard).toEqual({});
    } finally {
      fixture.close();
    }
  });

  test("reopens SQLite with the same manifest and digest while snapshots exclude patch blobs", async () => {
    const gitFixture = await createGitFixture();
    await writeFile(join(gitFixture.worktree, "tracked.txt"), "persisted\n");
    const fixture = await createPersistenceFixture(gitFixture);
    let evidenceId: string;
    let digest: string;
    try {
      const result = await createReviewEvidenceService(fixture.journal, {
        now: () => 200,
      }).capture(captureInput());
      expect(result.status).toBe("committed");
      if (result.status !== "committed") throw new Error("capture failed");
      evidenceId = result.evidence.evidenceId;
      digest = result.evidence.evidenceDigest;
    } finally {
      fixture.close();
    }

    const reopened = openSqliteDatabase({ filename: fixture.filename });
    try {
      expect(migrateDatabase(reopened).appliedVersions).toEqual([]);
      const journal = createEventJournal(reopened);
      const service = createReviewEvidenceService(journal);
      const record = journal.reviewEvidence(evidenceId!)!;
      expect(record.evidenceDigest).toBe(digest!);
      expect(service.manifest(evidenceId!)).toMatchObject({
        status: "ok",
        manifest: {
          evidenceId,
          evidenceDigest: digest,
          files: [{ newPath: "tracked.txt" }],
        },
      });
      expect(JSON.stringify(journal.snapshot())).not.toContain("patchBlob");
      expect(journal.reviewEvidenceManifest(evidenceId!)!.files[0]).not.toHaveProperty(
        "patchBlob",
      );
      expect(journal.reviewEvidenceFile(
        evidenceId!,
        record.files[0]!.fileId,
      )?.patchBlob).toBeInstanceOf(Uint8Array);
      expect(record.files[0]!.patchBlob).toBeInstanceOf(Uint8Array);
      expect(await readFile(fixture.filename)).not.toHaveLength(0);
    } finally {
      closeSqliteDatabase(reopened);
    }
  });
});
