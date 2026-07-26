import { describe, expect, test } from "bun:test";
import type { AttemptGeneration, AttemptId, QuestionId } from "@kitten/engine";
import type { AttentionCoordinator } from "../attention/attentionCoordinator.ts";
import type { DesktopAttemptCoordinator } from "../attempts/attemptCoordinator.ts";
import type { EventJournal } from "../persistence/eventJournal.ts";
import {
  REVIEW_DIFF_CHUNK_BYTE_LIMIT,
  type ReviewEvidenceManifest,
} from "../shared/rpc.ts";
import { workflowIds, type CardProjection } from "../workflow/workflowTypes.ts";
import type { ReviewEvidenceService } from "./reviewEvidence.ts";
import type { ReviewDispositionService } from "./reviewDisposition.ts";
import {
  REVIEW_TEXT_PATCH_BYTE_LIMIT,
} from "./reviewEvidence.ts";
import {
  createDesktopInspectorRpc,
  createDesktopPromptSubmissionRpc,
  createDesktopReviewRpc,
  createDesktopReviewEvidenceRpc,
} from "./desktopRpc.ts";

const CARD: CardProjection = {
  cardId: workflowIds.card("card-inspector-rpc"),
  boardId: workflowIds.board("board-inspector-rpc"),
  stageId: workflowIds.stage("stage-inspector-rpc"),
  title: "Review the latest UI",
  description: "Check the task inspector",
  provider: "codex",
  model: "gpt-5.6-luna",
  effort: "high",
  skillOverrideId: null,
  runnable: true,
  executionStatus: "idle",
  version: 4,
  createdAt: 1,
  updatedAt: 2,
};

function journal(cards: readonly CardProjection[] = [CARD]): EventJournal {
  return { snapshot: () => ({ cards }) } as unknown as EventJournal;
}

function coordinator(start: DesktopAttemptCoordinator["start"]): DesktopAttemptCoordinator {
  return { start } as unknown as DesktopAttemptCoordinator;
}

describe("desktop inspector RPC", () => {
  test("exposes one validated submission RPC and returns its content-free envelope", async () => {
    const received: unknown[] = [];
    const coordinator = {
      async submitCardPrompt(input: unknown) {
        received.push(input);
        return {
          status: "ok",
          outcome: "queued",
          cardVersion: CARD.version,
          attemptId: "attempt-rpc" as AttemptId,
          generation: 2 as AttemptGeneration,
        } as const;
      },
    } as unknown as DesktopAttemptCoordinator;
    const rpc = createDesktopPromptSubmissionRpc(coordinator);
    const input = {
      commandId: "submit-command",
      boardId: CARD.boardId,
      cardId: CARD.cardId,
      expectedCardVersion: CARD.version,
      content: "Persist me before success",
      source: "composer" as const,
      activeAttempt: {
        attemptId: "attempt-rpc" as AttemptId,
        generation: 2 as AttemptGeneration,
      },
    };

    expect(await rpc.submitCardPrompt(input)).toEqual({
      kind: "submit_card_prompt_result",
      commandId: "submit-command",
      result: {
        status: "ok",
        outcome: "queued",
        cardVersion: CARD.version,
        attemptId: "attempt-rpc" as AttemptId,
        generation: 2 as AttemptGeneration,
      },
    });
    expect(received).toEqual([input]);
    await expect(rpc.submitCardPrompt({ ...input, content: " " })).rejects.toThrow(
      "prompt content must be non-empty",
    );
  });

  test("keeps stop and attention behavior separate from prompt admission", async () => {
    const rejected = createDesktopInspectorRpc(journal(), coordinator(async () => ({
      status: "rejected",
      reason: { code: "card_not_found", message: "unused" },
    })));
    expect((await rejected.answerAttention({ commandId: "answer", input: {} as never })).result).toMatchObject({
      status: "rejected",
      reason: { code: "not_ready" },
    });

    const missingCard = createDesktopInspectorRpc(journal([]), coordinator(async () => ({
      status: "rejected",
      reason: { code: "card_not_found", message: "unused" },
    })));
    expect((await missingCard.stopAttempt({
      commandId: "stop-missing",
      input: { cardId: CARD.cardId, expectedCardVersion: CARD.version },
    })).result).toMatchObject({
      status: "rejected",
      reason: { code: "card_not_found" },
    });

    const inactive = createDesktopInspectorRpc({
      snapshot: () => ({ cards: [CARD], attempts: [] }),
    } as unknown as EventJournal, coordinator(async () => ({
      status: "rejected",
      reason: { code: "card_not_found", message: "unused" },
    })));
    expect((await inactive.stopAttempt({
      commandId: "stop-inactive",
      input: { cardId: CARD.cardId, expectedCardVersion: CARD.version },
    })).result).toMatchObject({
      status: "rejected",
      reason: { code: "attempt_not_active" },
    });
  });

  test("version-fences stop requests and cancels only the card's live attempt", async () => {
    const attemptId = "attempt-inspector-rpc" as AttemptId;
    const generation = 3 as AttemptGeneration;
    const stops: unknown[] = [];
    const service = {
      async start() { return { status: "rejected", reason: { code: "unused", message: "unused" } } as const; },
      async stop(input: unknown) { stops.push(input); return { status: "ok" } as const; },
    } as unknown as DesktopAttemptCoordinator;
    const activeJournal = {
      snapshot: () => ({
        cards: [CARD],
        attempts: [{
          attemptId,
          boardId: CARD.boardId,
          cardId: CARD.cardId,
          generation,
          state: "running",
          sessionId: "session-inspector-rpc",
          failure: null,
          createdAt: 1,
          startedAt: 2,
          terminalAt: null,
        }],
      }),
    } as unknown as EventJournal;
    const rpc = createDesktopInspectorRpc(activeJournal, service);

    expect((await rpc.stopAttempt({
      commandId: "stop-stale",
      input: { cardId: CARD.cardId, expectedCardVersion: CARD.version - 1 },
    })).result).toMatchObject({ status: "conflict", conflict: { code: "stale_card" } });
    expect(stops).toEqual([]);

    expect((await rpc.stopAttempt({
      commandId: "stop-live",
      input: { cardId: CARD.cardId, expectedCardVersion: CARD.version },
    })).result).toEqual({ status: "ok" });
    expect(stops).toEqual([{ attemptId, generation }]);
  });

  test("forwards structured attention answers to the durable coordinator", async () => {
    const resolved: unknown[] = [];
    const attention = {
      resolve(input: unknown) { resolved.push(input); return {} as never; },
    } as unknown as AttentionCoordinator;
    const rpc = createDesktopInspectorRpc(journal(), coordinator(async () => ({
      status: "rejected",
      reason: { code: "card_not_found", message: "unused" },
    })), attention);
    const input = {
      attemptId: "attempt-attention" as AttemptId,
      generation: 2 as AttemptGeneration,
      blockerId: "question-attention" as QuestionId,
      expectedVersion: 4,
      outcome: { kind: "submitted" as const, answers: { base: { selectedOptionIds: ["main"] } } },
    };

    expect((await rpc.answerAttention({ commandId: "answer-attention", input })).result).toEqual({ status: "ok" });
    expect(resolved).toEqual([input]);
  });
});

function evidenceManifest(): ReviewEvidenceManifest {
  return {
    kind: "review_evidence_manifest",
    schemaVersion: 1,
    revision: 9,
    evidenceId: "evidence-rpc",
    boardId: workflowIds.board("board-rpc"),
    cardId: CARD.cardId,
    attemptId: "attempt-rpc" as ReviewEvidenceManifest["attemptId"],
    generation: 2 as ReviewEvidenceManifest["generation"],
    worktreeBindingId: "binding-rpc",
    evidenceDigest: "a".repeat(64),
    baseCommit: "b".repeat(40),
    headCommit: "c".repeat(40),
    policyVersion: 1,
    fileCount: 3,
    totalPatchBytes: REVIEW_TEXT_PATCH_BYTE_LIMIT + 12,
    createdAt: 10,
    availability: {
      status: "available",
      evidenceId: "evidence-rpc",
      evidenceDigest: "a".repeat(64),
    },
    files: [
      {
        fileId: "file-text",
        index: 0,
        status: "modified",
        oldPath: "src/a.ts",
        newPath: "src/a.ts",
        oldMode: "100644",
        newMode: "100644",
        isBinary: false,
        additions: 1,
        deletions: 1,
        patchByteLength: REVIEW_DIFF_CHUNK_BYTE_LIMIT + 4,
        patchDigest: "d".repeat(64),
        contentDigest: null,
      },
      {
        fileId: "file-binary",
        index: 1,
        status: "binary",
        oldPath: null,
        newPath: "assets/a.bin",
        oldMode: null,
        newMode: "100644",
        isBinary: true,
        additions: null,
        deletions: null,
        patchByteLength: 0,
        patchDigest: "e".repeat(64),
        contentDigest: "f".repeat(64),
      },
      {
        fileId: "file-oversized",
        index: 2,
        status: "modified",
        oldPath: "src/large.ts",
        newPath: "src/large.ts",
        oldMode: "100644",
        newMode: "100644",
        isBinary: false,
        additions: 1,
        deletions: 0,
        patchByteLength: REVIEW_TEXT_PATCH_BYTE_LIMIT + 1,
        patchDigest: "1".repeat(64),
        contentDigest: null,
      },
    ],
  };
}

function evidenceService(
  overrides: Partial<ReviewEvidenceService> = {},
): ReviewEvidenceService {
  const manifest = evidenceManifest();
  return {
    async capture() {
      return { status: "unavailable", reason: "unsupported" };
    },
    async revalidate() {
      return { status: "unavailable", reason: "unsupported" };
    },
    manifest() {
      return { status: "ok", manifest };
    },
    readDiffChunk(_evidenceId, fileId, offset) {
      if (fileId !== "file-text") {
        return { status: "unavailable", reason: "invalid_file" };
      }
      const content = offset === 0
        ? "a".repeat(REVIEW_DIFF_CHUNK_BYTE_LIMIT)
        : "done";
      return {
        status: "ok",
        chunk: {
          kind: "review_diff_chunk",
          schemaVersion: 1,
          evidenceId: manifest.evidenceId,
          fileId,
          offset,
          nextOffset: offset === 0 ? REVIEW_DIFF_CHUNK_BYTE_LIMIT : null,
          complete: offset !== 0,
          content,
          encoding: "utf8",
        },
      };
    },
    ...overrides,
  };
}

describe("desktop review evidence RPC", () => {
  test("returns deterministic summary-only manifests scoped to card and evidence identity", async () => {
    const requested: string[] = [];
    const service = evidenceService({
      manifest(evidenceId) {
        requested.push(evidenceId);
        return { status: "ok", manifest: evidenceManifest() };
      },
    });
    const rpc = createDesktopReviewEvidenceRpc(service);

    const envelope = await rpc.getReviewManifest({
      cardId: CARD.cardId,
      evidenceId: "evidence-rpc",
    });

    expect(requested).toEqual(["evidence-rpc"]);
    expect(envelope.result.status).toBe("ok");
    if (envelope.result.status !== "ok") return;
    expect(envelope.result.projection.files.map(({ fileId }) => fileId)).toEqual([
      "file-text",
      "file-binary",
      "file-oversized",
    ]);
    expect(JSON.stringify(envelope)).not.toMatch(/patchBlob|patchContent|database|worktreePath/);
  });

  test("maps missing, stale, incomplete, binary, oversized, and thrown host states to stable codes", async () => {
    const missing = createDesktopReviewEvidenceRpc(evidenceService({
      manifest() {
        return { status: "unavailable", reason: "missing" };
      },
    }));
    const incomplete = createDesktopReviewEvidenceRpc(evidenceService({
      manifest() {
        return { status: "unavailable", reason: "incomplete" };
      },
    }));
    const thrown = createDesktopReviewEvidenceRpc(evidenceService({
      manifest() {
        throw new Error("/private/repository/raw-host-error");
      },
    }));
    const rpc = createDesktopReviewEvidenceRpc(evidenceService());

    expect((await missing.getReviewManifest({
      cardId: CARD.cardId,
      evidenceId: "evidence-rpc",
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
    });
    expect((await rpc.getReviewManifest({
      cardId: workflowIds.card("another-card"),
      evidenceId: "evidence-rpc",
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_stale", recoveryHint: "reload_evidence" },
    });
    expect((await incomplete.getReviewManifest({
      cardId: CARD.cardId,
      evidenceId: "evidence-rpc",
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
    });
    expect((await thrown.getReviewManifest({
      cardId: CARD.cardId,
      evidenceId: "evidence-rpc",
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
    });
    expect((await rpc.getReviewDiffChunk({
      evidenceId: "evidence-rpc",
      fileId: "file-binary",
      offset: 0,
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_unsafe", recoveryHint: "none" },
    });
    expect((await rpc.getReviewDiffChunk({
      evidenceId: "evidence-rpc",
      fileId: "file-oversized",
      offset: 0,
    })).result).toEqual({
      status: "rejected",
      error: { code: "evidence_oversized", recoveryHint: "reduce_change_set" },
    });
  });

  test("rejects invalid identities, offsets, and client chunk-cap overrides before reading patch text", async () => {
    let reads = 0;
    const service = evidenceService({
      readDiffChunk() {
        reads += 1;
        return { status: "unavailable", reason: "incomplete" };
      },
    });
    const rpc = createDesktopReviewEvidenceRpc(service);

    for (const request of [
      { evidenceId: "", fileId: "file-text", offset: 0 },
      { evidenceId: "evidence-rpc", fileId: "", offset: 0 },
      { evidenceId: "evidence-rpc", fileId: "file-text", offset: -1 },
      { evidenceId: "evidence-rpc", fileId: "file-text", offset: 0.5 },
      {
        evidenceId: "evidence-rpc",
        fileId: "file-text",
        offset: 0,
        maxBytes: REVIEW_DIFF_CHUNK_BYTE_LIMIT + 1,
      },
    ]) {
      expect((await rpc.getReviewDiffChunk(request as never)).result).toEqual({
        status: "rejected",
        error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
      });
    }
    expect(reads).toBe(0);
  });

  test("returns exact terminal state with monotonically advancing chunks within 64 KiB", async () => {
    const rpc = createDesktopReviewEvidenceRpc(evidenceService());
    const first = await rpc.getReviewDiffChunk({
      evidenceId: "evidence-rpc",
      fileId: "file-text",
      offset: 0,
    });
    expect(first.result.status).toBe("ok");
    if (first.result.status !== "ok") return;
    expect(new TextEncoder().encode(first.result.projection.content).byteLength)
      .toBe(REVIEW_DIFF_CHUNK_BYTE_LIMIT);
    expect(first.result.projection).toMatchObject({
      offset: 0,
      nextOffset: REVIEW_DIFF_CHUNK_BYTE_LIMIT,
      complete: false,
    });

    const terminal = await rpc.getReviewDiffChunk({
      evidenceId: "evidence-rpc",
      fileId: "file-text",
      offset: first.result.projection.nextOffset!,
    });
    expect(terminal.result.status).toBe("ok");
    if (terminal.result.status !== "ok") return;
    expect(terminal.result.projection).toMatchObject({
      offset: REVIEW_DIFF_CHUNK_BYTE_LIMIT,
      nextOffset: null,
      complete: true,
      content: "done",
    });
  });
});

describe("desktop review approval RPC", () => {
  test("validates the complete evidence precondition and returns the bounded approval envelope", async () => {
    const received: unknown[] = [];
    const service: ReviewDispositionService = {
      async reviewCard(input) {
        received.push(input);
        return { status: "ok", outcome: "approved", cardVersion: 5 };
      },
      currentRevision() {
        return 12;
      },
    };
    const rpc = createDesktopReviewRpc(service);
    const input = {
      commandId: "approve-rpc",
      boardId: CARD.boardId,
      cardId: CARD.cardId,
      expectedCardVersion: CARD.version,
      disposition: "approved" as const,
      evidence: {
        evidenceId: "evidence-rpc",
        evidenceDigest: "a".repeat(64),
        attemptId: "attempt-rpc" as AttemptId,
        generation: 2 as AttemptGeneration,
        worktreeBindingId: "kw-reviewrpc001",
      },
    };
    expect(await rpc.reviewCard(input)).toEqual({
      kind: "review_approval_result",
      commandId: input.commandId,
      result: { status: "ok", outcome: "approved", cardVersion: 5 },
    });
    expect(received).toEqual([input]);
    expect(rpc.currentRevision()).toBe(12);
    await expect(rpc.reviewCard({
      ...input,
      evidence: { ...input.evidence, evidenceDigest: "" },
    })).rejects.toThrow("contract string must contain");
    expect(received).toHaveLength(1);
  });
});
