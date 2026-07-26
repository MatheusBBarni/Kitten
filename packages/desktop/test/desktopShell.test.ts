import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  startDesktopShell,
  type DesktopWindowFactory,
} from "../src/main.ts";
import {
  CONTRACT_ERROR_CODES,
  ProjectionBoundaryError,
  REVIEW_DIFF_CHUNK_BYTE_LIMIT,
  REVIEW_MANIFEST_FILE_LIMIT,
  SUBMISSION_SOURCES,
  assertContractError,
  assertGetReviewDiffChunkRequest,
  assertGetReviewManifestRequest,
  assertProjectionPayload,
  assertReviewDiffChunk,
  assertReviewDispositionInput,
  assertReviewEvidenceManifest,
  assertSubmitCardPromptInput,
  assertSupervisionProjection,
  createBootstrapEnvelope,
  createCardInspectorEnvelope,
  createCommandResultEnvelope,
  createEmptyDesktopSnapshot,
  createEmptyWorkflowBoardProjection,
  createEmptyWorkflowCatalogProjection,
  createReviewApprovalEnvelope,
  createReviewDiffChunkEnvelope,
  createReviewManifestEnvelope,
  createSettingsEnvelope,
  createSubmitCardPromptEnvelope,
  createSupervisionEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type HostMessageEnvelope,
  type ReviewDiffChunk,
  type ReviewEvidenceFileSummary,
  type ReviewEvidenceManifest,
  type ReviewEvidencePrecondition,
  type SubmitCardPromptInput,
  type SupervisionProjection,
} from "../src/shared/rpc.ts";
import {
  bindDesktopRenderer,
  type DesktopRpcClient,
} from "../src/renderer/client.ts";
import type {
  DesktopPromptSubmissionRpc,
  DesktopReviewEvidenceRpc,
} from "../src/host/desktopRpc.ts";
import type { DesktopBoardRpc } from "../src/host/boardRpc.ts";
import { workflowIds, type WorkflowCommand } from "../src/workflow/workflowTypes.ts";

function reviewEvidencePrecondition(): ReviewEvidencePrecondition {
  return {
    evidenceId: "evidence-1",
    evidenceDigest: "digest-evidence-1",
    attemptId: "attempt-1" as ReviewEvidencePrecondition["attemptId"],
    generation: 1 as ReviewEvidencePrecondition["generation"],
    worktreeBindingId: "binding-1",
  };
}

function reviewFile(index: number): ReviewEvidenceFileSummary {
  return {
    fileId: `file-${index}`,
    index,
    status: "added",
    oldPath: null,
    newPath: `src/file-${index}.ts`,
    oldMode: null,
    newMode: "100644",
    isBinary: false,
    additions: 1,
    deletions: 0,
    patchByteLength: 12,
    patchDigest: `patch-digest-${index}`,
    contentDigest: `content-digest-${index}`,
  };
}

function reviewManifest(fileCount = 1): ReviewEvidenceManifest {
  const files = Array.from({ length: fileCount }, (_, index) => reviewFile(index));
  return {
    kind: "review_evidence_manifest",
    schemaVersion: 1,
    revision: 7,
    evidenceId: "evidence-1",
    boardId: workflowIds.board("board-contract"),
    cardId: workflowIds.card("card-contract"),
    attemptId: "attempt-1" as ReviewEvidenceManifest["attemptId"],
    generation: 1 as ReviewEvidenceManifest["generation"],
    worktreeBindingId: "binding-1",
    evidenceDigest: "digest-evidence-1",
    baseCommit: "base-commit",
    headCommit: "head-commit",
    policyVersion: 1,
    fileCount,
    totalPatchBytes: files.reduce((total, file) => total + file.patchByteLength, 0),
    createdAt: 1_000,
    availability: {
      status: "available",
      evidenceId: "evidence-1",
      evidenceDigest: "digest-evidence-1",
    },
    files,
  };
}

function reviewChunk(content = "diff", complete = true): ReviewDiffChunk {
  const decodedBytes = new TextEncoder().encode(content).byteLength;
  return {
    kind: "review_diff_chunk",
    schemaVersion: 1,
    evidenceId: "evidence-1",
    fileId: "file-0",
    offset: 0,
    nextOffset: complete ? null : decodedBytes,
    complete,
    content,
    encoding: "utf8",
  };
}

function supervisionProjection(): SupervisionProjection {
  return {
    kind: "supervision_projection",
    schemaVersion: 1,
    revision: 7,
    generatedAt: 1_000,
    groups: [{
      status: "ready_for_review",
      priority: 1,
      items: [{
        boardId: workflowIds.board("board-contract"),
        cardId: workflowIds.card("card-contract"),
        cardVersion: 3,
        attemptId: "attempt-1" as SupervisionProjection["groups"][number]["items"][number]["attemptId"],
        generation: 1 as SupervisionProjection["groups"][number]["items"][number]["generation"],
        status: "ready_for_review",
        priority: 1,
        evidenceAvailability: {
          status: "available",
          evidenceId: "evidence-1",
          evidenceDigest: "digest-evidence-1",
        },
        actionableAt: 900,
        updatedAt: 1_000,
      }],
    }],
    counts: {
      needs_attention: 0,
      ready_for_review: 1,
      failed: 0,
      running: 0,
      settled: 0,
    },
  };
}

function submitCardPrompt(source: SubmitCardPromptInput["source"]): SubmitCardPromptInput {
  return {
    commandId: `command-${source}`,
    boardId: workflowIds.board("board-contract"),
    cardId: workflowIds.card("card-contract"),
    expectedCardVersion: 3,
    content: "Please continue.",
    source,
    ...(source === "request_changes" ? { evidence: reviewEvidencePrecondition() } : {}),
  };
}

class FakeWindowFactory implements DesktopWindowFactory {
  handler?: (params: { readonly knownRevision?: number }) => Promise<BootstrapEnvelope>;
  inspectorHandler?: (params: { readonly cardId: string }) => Promise<CardInspectorEnvelope>;
  boardHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetBoard"];
  workspaceHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetWorkspace"];
  supervisionHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetSupervision"];
  reviewManifestHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetReviewManifest"];
  reviewDiffChunkHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetReviewDiffChunk"];
  catalogHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onGetCatalog"];
  repositoryPickerHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onPickRepositoryDirectory"];
  workflowCommandHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onExecuteWorkflowCommand"];
  promptSubmissionHandler?: Parameters<DesktopWindowFactory["open"]>[0]["onSubmitCardPrompt"];
  readonly messages: HostMessageEnvelope[] = [];
  handlerRemovalCount = 0;
  closeCount = 0;

  open({
    onGetDesktopSnapshot,
    onGetCardInspector,
    onGetBoard,
    onGetWorkspace,
    onGetSupervision,
    onGetReviewManifest,
    onGetReviewDiffChunk,
    onGetCatalog,
    onPickRepositoryDirectory,
    onExecuteWorkflowCommand,
    onSubmitCardPrompt,
  }: Parameters<DesktopWindowFactory["open"]>[0]) {
    this.handler = onGetDesktopSnapshot;
    this.inspectorHandler = onGetCardInspector;
    this.boardHandler = onGetBoard;
    this.workspaceHandler = onGetWorkspace;
    this.supervisionHandler = onGetSupervision;
    this.reviewManifestHandler = onGetReviewManifest;
    this.reviewDiffChunkHandler = onGetReviewDiffChunk;
    this.catalogHandler = onGetCatalog;
    this.repositoryPickerHandler = onPickRepositoryDirectory;
    this.workflowCommandHandler = onExecuteWorkflowCommand;
    this.promptSubmissionHandler = onSubmitCardPrompt;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => {
        this.handler = undefined;
        this.inspectorHandler = undefined;
        this.boardHandler = undefined;
        this.workspaceHandler = undefined;
        this.supervisionHandler = undefined;
        this.reviewManifestHandler = undefined;
        this.reviewDiffChunkHandler = undefined;
        this.catalogHandler = undefined;
        this.repositoryPickerHandler = undefined;
        this.workflowCommandHandler = undefined;
        this.promptSubmissionHandler = undefined;
        this.handlerRemovalCount += 1;
      },
      close: () => {
        this.closeCount += 1;
      },
    };
  }
}

describe("typed desktop RPC contract", () => {
  test("discriminates bootstrap, conflict, and unavailable outcomes", () => {
    const bootstrap = createBootstrapEnvelope({
      status: "ok",
      projection: createEmptyDesktopSnapshot(),
    });
    const conflict = createCommandResultEnvelope<never>("command-1", {
      status: "conflict",
      conflict: { kind: "stale_projection", expectedRevision: 1, actualRevision: 2 },
    });
    const unavailable = createCommandResultEnvelope<never>("command-2", {
      status: "unavailable",
      unavailable: { resource: "desktop_host", reason: "not_ready" },
    });

    expect(bootstrap.kind).toBe("bootstrap");
    expect(bootstrap.result.status).toBe("ok");
    expect(conflict.kind).toBe("command_result");
    expect(conflict.result.status).toBe("conflict");
    if (conflict.result.status === "conflict") {
      expect(conflict.result.conflict.actualRevision).toBe(2);
    }
    expect(unavailable.result.status).toBe("unavailable");
    if (unavailable.result.status === "unavailable") {
      expect(unavailable.result.unavailable.reason).toBe("not_ready");
    }
  });

  test("rejects privileged resources, secrets, class instances, and cycles", () => {
    for (const key of [
      "acpConnection",
      "acpSession",
      "databaseHandle",
      "filesystemHandle",
      "gitProcess",
      "patchBlob",
      "prompt",
      "sqliteHandle",
      "skillContents",
      "transcript",
      "worktree",
      "worktreePath",
      "apiToken",
    ]) {
      expect(() => assertProjectionPayload({ [key]: {} })).toThrow(ProjectionBoundaryError);
    }
    expect(() => assertProjectionPayload({ openedAt: new Date() })).toThrow(
      "resource handles and class instances are forbidden",
    );
    expect(() => assertProjectionPayload({ bytes: new Uint8Array([1, 2, 3]) })).toThrow(
      "resource handles and class instances are forbidden",
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertProjectionPayload(cyclic)).toThrow("cyclic projection values are forbidden");
    expect(() => assertProjectionPayload({ count: Number.NaN })).toThrow("must be JSON data");
    const shared = { id: "projection-1" };
    expect(assertProjectionPayload({ first: shared, second: shared })).toEqual({
      first: shared,
      second: shared,
    });
  });

  test("accepts the maximum summary-only manifest and rejects excess or undeclared patch data", () => {
    const maximum = reviewManifest(REVIEW_MANIFEST_FILE_LIMIT);
    expect(assertReviewEvidenceManifest(maximum)).toBeUndefined();
    const serialized = JSON.stringify(maximum);
    expect(serialized).not.toContain("patchBlob");
    expect(serialized).not.toContain("patchContent");

    expect(() => assertReviewEvidenceManifest({
      ...maximum,
      fileCount: REVIEW_MANIFEST_FILE_LIMIT + 1,
      files: [...maximum.files, reviewFile(REVIEW_MANIFEST_FILE_LIMIT)],
    })).toThrow("review manifest file limit or count is invalid");
    expect(() => assertReviewEvidenceManifest({
      ...reviewManifest(),
      files: [{ ...reviewFile(0), patchBlob: "forbidden" }],
    })).toThrow(ProjectionBoundaryError);
    expect(() => assertReviewEvidenceManifest({
      ...reviewManifest(),
      files: [{ ...reviewFile(0), newPath: "/private/repository/src/file.ts" }],
    })).toThrow("review file path must be repository-relative");
  });

  test("accepts a 64 KiB decoded chunk and rejects oversized or inconsistent offsets", () => {
    const exact = reviewChunk("é".repeat(REVIEW_DIFF_CHUNK_BYTE_LIMIT / 2), false);
    expect(assertReviewDiffChunk(exact)).toBeUndefined();
    expect(exact.nextOffset).toBe(REVIEW_DIFF_CHUNK_BYTE_LIMIT);

    expect(() => assertReviewDiffChunk(
      reviewChunk("a".repeat(REVIEW_DIFF_CHUNK_BYTE_LIMIT + 1)),
    )).toThrow("review chunk exceeds the decoded byte limit");
    expect(() => assertReviewDiffChunk({
      ...reviewChunk("diff", false),
      nextOffset: 3,
    })).toThrow("review chunk offset metadata is inconsistent");
    expect(() => assertReviewDiffChunk({
      ...reviewChunk("diff"),
      nextOffset: 4,
    })).toThrow("complete review chunks must not expose a next offset");
  });

  test("accepts only bounded review query identities and host-owned chunk limits", () => {
    expect(assertGetReviewManifestRequest({
      cardId: "card-1",
      evidenceId: "evidence-1",
    })).toBeUndefined();
    expect(assertGetReviewDiffChunkRequest({
      evidenceId: "evidence-1",
      fileId: "file-1",
      offset: 0,
    })).toBeUndefined();
    for (const request of [
      { evidenceId: "", fileId: "file-1", offset: 0 },
      { evidenceId: " evidence-1", fileId: "file-1", offset: 0 },
      { evidenceId: "evidence-1", fileId: "file-1", offset: -1 },
      { evidenceId: "evidence-1", fileId: "file-1", offset: 0.25 },
      {
        evidenceId: "evidence-1",
        fileId: "file-1",
        offset: 0,
        maxBytes: REVIEW_DIFF_CHUNK_BYTE_LIMIT + 1,
      },
    ]) {
      expect(() => assertGetReviewDiffChunkRequest(request)).toThrow(
        ProjectionBoundaryError,
      );
    }
  });

  test("accepts exactly the declared submission sources and stable errors", () => {
    expect(SUBMISSION_SOURCES).toEqual(["initial", "composer", "request_changes"]);
    for (const source of SUBMISSION_SOURCES) {
      expect(assertSubmitCardPromptInput(submitCardPrompt(source))).toBeUndefined();
    }
    const precondition = reviewEvidencePrecondition();
    expect(assertReviewDispositionInput({
      commandId: "command-approve",
      boardId: workflowIds.board("board-contract"),
      cardId: workflowIds.card("card-contract"),
      expectedCardVersion: 3,
      disposition: "approved",
      evidence: precondition,
    })).toBeUndefined();
    expect(() => assertReviewDispositionInput({
      commandId: "command-approve",
      boardId: workflowIds.board("board-contract"),
      cardId: workflowIds.card("card-contract"),
      expectedCardVersion: 3,
      disposition: "changes_requested",
      evidence: precondition,
    })).toThrow("approval disposition must be approved");
    expect(() => assertSubmitCardPromptInput({
      ...submitCardPrompt("composer"),
      source: "unknown",
    })).toThrow("contract discriminant is not declared");
    expect(() => assertSubmitCardPromptInput({
      ...submitCardPrompt("composer"),
      source: "request_changes",
    })).toThrow("only request-changes submissions require evidence");

    for (const code of CONTRACT_ERROR_CODES) {
      expect(assertContractError({ code, recoveryHint: "none" })).toBeUndefined();
    }
    expect(() => assertContractError({
      code: "unknown_error",
      recoveryHint: "none",
    })).toThrow("contract discriminant is not declared");
    expect(() => assertContractError({
      code: "evidence_stale",
      recoveryHint: "unknown_hint",
    })).toThrow("contract discriminant is not declared");
  });

  test("keeps supervision items bounded and content-free", () => {
    const projection = supervisionProjection();
    expect(assertSupervisionProjection(projection)).toBeUndefined();
    expect(Object.keys(projection.groups[0]!.items[0]!).sort()).toEqual([
      "actionableAt",
      "attemptId",
      "boardId",
      "cardId",
      "cardVersion",
      "evidenceAvailability",
      "generation",
      "priority",
      "status",
      "updatedAt",
    ]);
    expect(() => assertSupervisionProjection({
      ...projection,
      groups: [{
        ...projection.groups[0]!,
        items: [{
          ...projection.groups[0]!.items[0]!,
          prompt: "host authority",
        }],
      }],
    })).toThrow(ProjectionBoundaryError);
    expect(() => assertSupervisionProjection({
      ...projection,
      groups: [{
        ...projection.groups[0]!,
        items: [{
          ...projection.groups[0]!.items[0]!,
          boardId: "b".repeat(257),
        }],
      }],
    })).toThrow("contract string must contain 1-256 characters");
  });

  test("round-trips new and existing envelopes without losing discriminants", () => {
    const manifest = reviewManifest();
    const precondition = reviewEvidencePrecondition();
    const envelopes = [
      createSupervisionEnvelope({ status: "ok", projection: supervisionProjection() }),
      createReviewManifestEnvelope({ status: "ok", projection: manifest }),
      createReviewDiffChunkEnvelope({ status: "ok", projection: reviewChunk() }),
      createSubmitCardPromptEnvelope("command-submit", {
        status: "ok",
        outcome: "queued",
        cardVersion: 3,
        attemptId: precondition.attemptId,
        generation: precondition.generation,
      }),
      createReviewApprovalEnvelope("command-review", {
        status: "ok",
        outcome: "approved",
        cardVersion: 4,
      }),
      createBootstrapEnvelope({ status: "ok", projection: createEmptyDesktopSnapshot() }),
      createWorkflowBoardEnvelope({
        status: "ok",
        projection: createEmptyWorkflowBoardProjection(),
      }),
      createCardInspectorEnvelope({
        status: "unavailable",
        unavailable: { resource: "card_inspector", reason: "not_ready" },
      }),
      createSettingsEnvelope({
        status: "unavailable",
        unavailable: { resource: "desktop_settings", reason: "not_ready" },
      }),
    ] as const;

    const roundTripped = envelopes.map((envelope) => JSON.parse(JSON.stringify(envelope)));
    expect(roundTripped.map((envelope) => envelope.kind)).toEqual([
      "supervision",
      "review_manifest",
      "review_diff_chunk",
      "submit_card_prompt_result",
      "review_approval_result",
      "bootstrap",
      "workflow_board",
      "card_inspector",
      "desktop_settings",
    ]);
    expect(roundTripped[0].result.projection.groups[0].status).toBe("ready_for_review");
    expect(roundTripped[1].result.projection.availability.status).toBe("available");
    expect(roundTripped[2].result.projection.encoding).toBe("utf8");
    expect(roundTripped[3].result.outcome).toBe("queued");
    expect(roundTripped[4].result.outcome).toBe("approved");
  });
});

describe("desktop host lifecycle", () => {
  test("serves typed board defaults and publishes only committed host projections", async () => {
    const command: WorkflowCommand = {
      kind: "bind_repository",
      mutationId: workflowIds.mutation("mutation-shell-board"),
      boardId: workflowIds.board("board-shell"),
      repositoryPath: "/repo",
    };
    const defaultFactory = new FakeWindowFactory();
    const defaultShell = startDesktopShell({ windowFactory: defaultFactory });
    expect(await defaultFactory.boardHandler?.({})).toMatchObject({
      result: { status: "ok", projection: { board: null } },
    });
    expect(await defaultFactory.catalogHandler?.({})).toMatchObject({
      result: { status: "ok", projection: { catalog: { catalogId: "default" } } },
    });
    expect(await defaultFactory.workspaceHandler?.({})).toMatchObject({
      result: { status: "ok", projection: { boards: [] } },
    });
    expect(await defaultFactory.repositoryPickerHandler?.({})).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "repository_picker", reason: "not_ready" } },
    });
    expect(await defaultFactory.workflowCommandHandler?.({ commandId: "command-default", command })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "workflow_command", reason: "not_ready" } },
    });
    const stoppedBoard = defaultFactory.boardHandler;
    const stoppedCatalog = defaultFactory.catalogHandler;
    const stoppedCommand = defaultFactory.workflowCommandHandler;
    defaultShell.stop();
    expect(await stoppedBoard?.({})).toMatchObject({ result: { status: "unavailable", unavailable: { reason: "host_stopped" } } });
    expect(await stoppedCatalog?.({})).toMatchObject({ result: { status: "unavailable", unavailable: { reason: "host_stopped" } } });
    expect(await stoppedCommand?.({ commandId: "command-stopped", command })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "desktop_host", reason: "host_stopped" } },
    });

    const projected = {
      ...createEmptyWorkflowBoardProjection(7),
      board: { boardId: command.boardId, repositoryPath: "/repo", workflowVersion: 1, createdAt: 1, updatedAt: 1 },
    };
    let outcome: "committed" | "idempotent" = "committed";
    const boardRpc: DesktopBoardRpc = {
      async getBoard() {
        return createWorkflowBoardEnvelope({ status: "ok", projection: projected });
      },
      async getSupervision() {
        return createSupervisionEnvelope({ status: "ok", projection: supervisionProjection() });
      },
      async getCatalog() {
        return createWorkflowCatalogEnvelope({ status: "ok", projection: createEmptyWorkflowCatalogProjection(7) });
      },
      async executeWorkflowCommand({ commandId }) {
        return createWorkflowCommandEnvelope(commandId, { status: "ok", outcome, projection: projected });
      },
    };
    const factory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: factory, boardRpc });
    expect(await factory.boardHandler?.({})).toMatchObject({ result: { status: "ok", projection: { revision: 7 } } });
    expect(await factory.supervisionHandler?.({})).toMatchObject({
      result: { status: "ok", projection: { revision: 7 } },
    });
    expect(await factory.catalogHandler?.({})).toMatchObject({ result: { status: "ok", projection: { revision: 7 } } });
    expect(await factory.workflowCommandHandler?.({ commandId: "command-committed", command })).toMatchObject({
      result: { status: "ok", outcome: "committed" },
    });
    expect(factory.messages).toEqual([{
      kind: "projection_committed",
      messageId: "workflow:command-committed",
      revision: 7,
    }]);
    outcome = "idempotent";
    await factory.workflowCommandHandler?.({ commandId: "command-idempotent", command });
    expect(factory.messages).toHaveLength(1);

    const pickerFactory = new FakeWindowFactory();
    startDesktopShell({
      windowFactory: pickerFactory,
      async pickRepositoryDirectory() {
        return {
          kind: "repository_directory_picker",
          result: { status: "selected", path: "/Users/name/projects/kitten" },
        };
      },
    });
    expect(await pickerFactory.repositoryPickerHandler?.({})).toMatchObject({
      result: { status: "selected", path: "/Users/name/projects/kitten" },
    });
  });

  test("fails board RPC closed when the host adapter throws", async () => {
    const failure = async (): Promise<never> => { throw new Error("unsafe projection"); };
    const boardRpc: DesktopBoardRpc = {
      getBoard: failure,
      getSupervision: failure,
      getCatalog: failure,
      executeWorkflowCommand: failure,
    };
    const command: WorkflowCommand = {
      kind: "bind_repository",
      mutationId: workflowIds.mutation("mutation-board-failure"),
      boardId: workflowIds.board("board-failure"),
      repositoryPath: "/repo",
    };
    const factory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: factory, boardRpc });
    expect(await factory.boardHandler?.({})).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "workflow_board", reason: "projection_rejected" } },
    });
    expect(await factory.supervisionHandler?.({})).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "supervision", reason: "projection_rejected" } },
    });
    expect(await factory.catalogHandler?.({})).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "workflow_catalog", reason: "projection_rejected" } },
    });
    expect(await factory.workflowCommandHandler?.({ commandId: "command-failure", command })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "workflow_command", reason: "projection_rejected" } },
    });
  });

  test("registers manifest and chunk handlers, delegates identities, and content-minimizes host failures", async () => {
    const unavailableFactory = new FakeWindowFactory();
    const unavailableShell = startDesktopShell({ windowFactory: unavailableFactory });
    const manifestRequest = {
      cardId: workflowIds.card("card-contract"),
      evidenceId: "evidence-1",
    };
    const chunkRequest = {
      evidenceId: "evidence-1",
      fileId: "file-0",
      offset: 0,
    };
    expect(await unavailableFactory.reviewManifestHandler?.(manifestRequest)).toEqual({
      kind: "review_manifest",
      result: {
        status: "unavailable",
        unavailable: { resource: "review_manifest", reason: "not_ready" },
      },
    });
    expect(await unavailableFactory.reviewDiffChunkHandler?.(chunkRequest)).toEqual({
      kind: "review_diff_chunk",
      result: {
        status: "unavailable",
        unavailable: { resource: "review_diff_chunk", reason: "not_ready" },
      },
    });
    unavailableShell.stop();

    const calls: unknown[] = [];
    const reviewEvidenceRpc: DesktopReviewEvidenceRpc = {
      async getReviewManifest(request) {
        calls.push(request);
        return createReviewManifestEnvelope({
          status: "ok",
          projection: reviewManifest(),
        });
      },
      async getReviewDiffChunk(request) {
        calls.push(request);
        return createReviewDiffChunkEnvelope({
          status: "ok",
          projection: reviewChunk(),
        });
      },
    };
    const factory = new FakeWindowFactory();
    const shell = startDesktopShell({ windowFactory: factory, reviewEvidenceRpc });
    const manifest = await factory.reviewManifestHandler?.(manifestRequest);
    const chunk = await factory.reviewDiffChunkHandler?.(chunkRequest);

    expect(calls).toEqual([manifestRequest, chunkRequest]);
    expect(JSON.parse(JSON.stringify([manifest, chunk]))).toEqual([manifest, chunk]);
    expect(JSON.stringify([manifest, chunk])).not.toMatch(
      /patchBlob|database|gitProcess|worktreePath/,
    );

    const stoppedManifest = factory.reviewManifestHandler;
    const stoppedChunk = factory.reviewDiffChunkHandler;
    shell.stop();
    expect(await stoppedManifest?.(manifestRequest)).toMatchObject({
      result: {
        status: "unavailable",
        unavailable: { resource: "review_manifest", reason: "host_stopped" },
      },
    });
    expect(await stoppedChunk?.(chunkRequest)).toMatchObject({
      result: {
        status: "unavailable",
        unavailable: { resource: "review_diff_chunk", reason: "host_stopped" },
      },
    });

    const rejectedFactory = new FakeWindowFactory();
    startDesktopShell({
      windowFactory: rejectedFactory,
      reviewEvidenceRpc: {
        async getReviewManifest() {
          throw new Error("/private/repository/raw-host-error");
        },
        async getReviewDiffChunk() {
          throw new Error("/private/repository/raw-host-error");
        },
      },
    });
    expect(await rejectedFactory.reviewManifestHandler?.(manifestRequest)).toMatchObject({
      result: {
        status: "unavailable",
        unavailable: { resource: "review_manifest", reason: "projection_rejected" },
      },
    });
    expect(await rejectedFactory.reviewDiffChunkHandler?.(chunkRequest)).toMatchObject({
      result: {
        status: "unavailable",
        unavailable: { resource: "review_diff_chunk", reason: "projection_rejected" },
      },
    });
  });

  test("registers and forwards the unified prompt submission with a not-ready fallback", async () => {
    const unavailableFactory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: unavailableFactory });
    const request = submitCardPrompt("composer");
    expect(await unavailableFactory.promptSubmissionHandler?.(request)).toMatchObject({
      result: { status: "rejected", error: { code: "invalid_prompt" } },
    });

    const calls: string[] = [];
    const promptSubmissionRpc: DesktopPromptSubmissionRpc = {
      async submitCardPrompt(value) {
        calls.push("submit");
        return createSubmitCardPromptEnvelope(value.commandId, {
          status: "ok",
          outcome: "queued",
          cardVersion: value.expectedCardVersion,
          attemptId: "attempt-submit" as never,
          generation: 1 as never,
        });
      },
    };
    const factory = new FakeWindowFactory();
    startDesktopShell({ windowFactory: factory, promptSubmissionRpc });
    expect((await factory.promptSubmissionHandler?.(request))?.result.status).toBe("ok");
    expect(calls).toEqual(["submit"]);
  });

  test("registers bootstrap, delivers messages, and removes everything on teardown", async () => {
    const factory = new FakeWindowFactory();
    const shell = startDesktopShell({ windowFactory: factory });

    expect(factory.handler).toBeFunction();
    const registeredHandler = factory.handler;
    const bootstrap = await registeredHandler?.({});
    expect(bootstrap?.result).toEqual({
      status: "ok",
      projection: createEmptyDesktopSnapshot(),
    });

    const message: HostMessageEnvelope = {
      kind: "projection_committed",
      messageId: "message-1",
      revision: 1,
    };
    expect(shell.publish(message)).toBeTrue();
    expect(factory.messages).toEqual([message]);

    shell.stop();
    shell.stop();
    expect(factory.handler).toBeUndefined();
    expect(factory.handlerRemovalCount).toBe(1);
    expect(factory.closeCount).toBe(1);
    expect(shell.publish(message)).toBeFalse();
    expect(await registeredHandler?.({})).toEqual({
      kind: "bootstrap",
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_host", reason: "host_stopped" },
      },
    });
  });

  test("fails closed when a snapshot provider exposes a privileged value", async () => {
    const factory = new FakeWindowFactory();
    startDesktopShell({
      windowFactory: factory,
      getSnapshot: () => ({ ...createEmptyDesktopSnapshot(), secret: "nope" }) as never,
    });

    expect(await factory.handler?.({})).toEqual({
      kind: "bootstrap",
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_snapshot", reason: "projection_rejected" },
      },
    });
  });

  test("fails closed for unavailable, missing, stopped, and rejected inspector projections", async () => {
    const unavailableFactory = new FakeWindowFactory();
    const unavailableShell = startDesktopShell({ windowFactory: unavailableFactory });
    expect(await unavailableFactory.inspectorHandler?.({ cardId: "card-1" })).toEqual({
      kind: "card_inspector",
      result: {
        status: "unavailable",
        unavailable: { resource: "card_inspector", reason: "not_ready" },
      },
    });
    expect(await unavailableFactory.inspectorHandler?.({ cardId: "   " })).toMatchObject({
      result: { status: "unavailable", unavailable: { reason: "not_ready" } },
    });
    const stoppedHandler = unavailableFactory.inspectorHandler;
    unavailableShell.stop();
    expect(await stoppedHandler?.({ cardId: "card-1" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "desktop_host", reason: "host_stopped" } },
    });

    const missingFactory = new FakeWindowFactory();
    const missingShell = startDesktopShell({
      windowFactory: missingFactory,
      getCardInspector: () => null,
    });
    expect(await missingFactory.inspectorHandler?.({ cardId: "card-missing" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "card_inspector", reason: "not_ready" } },
    });
    missingShell.stop();

    const rejectedFactory = new FakeWindowFactory();
    const rejectedShell = startDesktopShell({
      windowFactory: rejectedFactory,
      getCardInspector() { throw new Error("unsafe projection"); },
    });
    expect(await rejectedFactory.inspectorHandler?.({ cardId: "card-1" })).toMatchObject({
      result: { status: "unavailable", unavailable: { resource: "card_inspector", reason: "projection_rejected" } },
    });
    rejectedShell.stop();
  });
});

describe("renderer lifecycle", () => {
  test("loads only through the client and cleans up its subscription", async () => {
    let snapshotRequests = 0;
    let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
    let unsubscribeCount = 0;
    let disposeCount = 0;
    const envelopes: BootstrapEnvelope[] = [];
    const client: DesktopRpcClient = {
      async getDesktopSnapshot() {
        snapshotRequests += 1;
        return createBootstrapEnvelope({
          status: "ok",
          projection: createEmptyDesktopSnapshot(),
        });
      },
      async getCardInspector() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async getBoard() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async getReviewManifest() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async getReviewDiffChunk() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async getCatalog() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async executeWorkflowCommand() {
        throw new Error("not used by bootstrap lifecycle");
      },
      async submitCardPrompt() { throw new Error("not used by bootstrap lifecycle"); },
      async answerAttention() { throw new Error("not used by bootstrap lifecycle"); },
      async getSettings() { throw new Error("not used by bootstrap lifecycle"); },
      async updatePreferences() { throw new Error("not used by bootstrap lifecycle"); },
      async updateProfileDefaults() { throw new Error("not used by bootstrap lifecycle"); },
      async updateCatalogRoots() { throw new Error("not used by bootstrap lifecycle"); },
      async setExecutionLimit() { throw new Error("not used by bootstrap lifecycle"); },
      subscribe(listener) {
        subscriber = listener;
        return () => {
          subscriber = undefined;
          unsubscribeCount += 1;
        };
      },
      dispose() {
        disposeCount += 1;
      },
    };

    const lifecycle = bindDesktopRenderer(client, (envelope) => envelopes.push(envelope));
    await lifecycle.ready;
    subscriber?.({ kind: "projection_committed", messageId: "message-2", revision: 1 });
    await Bun.sleep(0);

    expect(snapshotRequests).toBe(2);
    expect(envelopes).toHaveLength(2);
    lifecycle.dispose();
    lifecycle.dispose();
    expect(unsubscribeCount).toBe(1);
    expect(disposeCount).toBe(1);
    expect(subscriber).toBeUndefined();
  });
});

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => /\.(?:ts|tsx)$/.test(path));
}

describe("desktop package boundaries", () => {
  test("registers only the new RPC endpoints whose production handlers exist", async () => {
    const rpcSource = await readFile(join(import.meta.dir, "../src/shared/rpc.ts"), "utf8");
    const schema = rpcSource.slice(
      rpcSource.indexOf("export type DesktopRpcSchema"),
      rpcSource.indexOf("const forbiddenProjectionKeys"),
    );
    expect(schema).toMatch(/\bgetSupervision\s*:/);
    expect(schema).toMatch(/\bgetReviewManifest\s*:/);
    expect(schema).toMatch(/\bgetReviewDiffChunk\s*:/);
    expect(schema).toMatch(/\bsubmitCardPrompt\s*:/);
    expect(schema).not.toMatch(/\bqueueFollowUp\s*:/);
    expect(schema).not.toMatch(/\bconfirmQueuedFollowUp\s*:/);
  });

  test("renderer imports no host implementation", async () => {
    const rendererDirectory = join(import.meta.dir, "../src/renderer");
    for (const path of await sourceFiles(rendererDirectory)) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*(?:\/host\/|\/main\.ts|electrobun\/bun)/);
    }
  });

  test("registers no HTTP listener", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    for (const path of await sourceFiles(sourceDirectory)) {
      const source = await readFile(path, "utf8");
      expect(source).not.toMatch(/Bun\.serve|node:http|createServer\s*\(|from\s+["']https?["']/);
    }
  });

  test("keeps SQLite imports inside the desktop host persistence package", async () => {
    const sourceDirectory = join(import.meta.dir, "../src");
    for (const path of await sourceFiles(sourceDirectory)) {
      const source = await readFile(path, "utf8");
      if (source.includes('from "bun:sqlite"')) {
        expect(path).toContain("/src/persistence/");
        expect(path).not.toContain("/src/renderer/");
      }
    }
  });

  test("keeps every direct desktop dependency exact-pinned", async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dir, "../package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(manifest.dependencies["@kitten/engine"]).toBe("workspace:*");
    for (const version of [
      ...Object.entries(manifest.dependencies)
        .filter(([name]) => name !== "@kitten/engine")
        .map(([, version]) => version),
      ...Object.values(manifest.devDependencies),
    ]) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
    expect(manifest.devDependencies.electrobun).toBe("1.18.1");
    expect(manifest.dependencies.react).toBe("19.2.7");
    expect(manifest.dependencies["react-dom"]).toBe("19.2.7");
  });
});
