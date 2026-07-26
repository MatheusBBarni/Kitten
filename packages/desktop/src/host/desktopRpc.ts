import type { DesktopAttemptCoordinator } from "../attempts/attemptCoordinator.ts";
import type { AttemptGeneration, AttemptId, QuestionId } from "@kitten/engine";
import type { AttentionOutcome } from "../attention/contracts.ts";
import type { AttentionCoordinator } from "../attention/attentionCoordinator.ts";
import { AttentionCoordinatorError } from "../attention/attentionCoordinator.ts";
import type { CardId } from "../workflow/workflowTypes.ts";
import type { EventJournal } from "../persistence/eventJournal.ts";
import type {
  ReviewDispositionService,
} from "./reviewDisposition.ts";
import {
  REVIEW_TEXT_PATCH_BYTE_LIMIT,
  reviewEvidenceContractError,
  type ReviewEvidenceService,
} from "./reviewEvidence.ts";
import {
  assertGetReviewDiffChunkRequest,
  assertGetReviewManifestRequest,
  assertReviewDispositionInput,
  assertSubmitCardPromptInput,
  createReviewApprovalEnvelope,
  createReviewDiffChunkEnvelope,
  createReviewManifestEnvelope,
  createSubmitCardPromptEnvelope,
  type GetReviewDiffChunkRequest,
  type GetReviewManifestRequest,
  type ContractError,
  type ReviewApprovalEnvelope,
  type ReviewDispositionInput,
  type ReviewDiffChunkEnvelope,
  type ReviewManifestEnvelope,
  type SubmitCardPromptEnvelope,
  type SubmitCardPromptInput,
} from "../shared/rpc.ts";
import {
  recordWorkflowMeasurementSafely,
  type MeasurementReason,
  type WorkflowMeasurementSink,
} from "./lifecycleDiagnostics.ts";

export interface DesktopPromptSubmissionRpc {
  submitCardPrompt(input: SubmitCardPromptInput): Promise<SubmitCardPromptEnvelope>;
}

export interface StopAttemptRpcInput {
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
}

export interface AnswerAttentionRpcInput {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly blockerId: QuestionId;
  readonly expectedVersion: number;
  readonly outcome: AttentionOutcome;
}

export interface InspectorRpcRequest<Input> {
  readonly commandId: string;
  readonly input: Input;
}

export type InspectorCommandResult =
  | { readonly status: "ok" }
  | {
      readonly status: "conflict";
      readonly conflict: {
        readonly kind: "inspector_command";
        readonly code: "stale_card" | "stale_attempt" | "stale_generation" | "stale_version";
        readonly message: string;
      };
    }
  | {
      readonly status: "rejected";
      readonly reason: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface InspectorCommandResultEnvelope {
  readonly kind: "inspector_command_result";
  readonly commandId: string;
  readonly result: InspectorCommandResult;
}

export interface DesktopInspectorRpc {
  stopAttempt(request: InspectorRpcRequest<StopAttemptRpcInput>): Promise<InspectorCommandResultEnvelope>;
  answerAttention(request: InspectorRpcRequest<AnswerAttentionRpcInput>): Promise<InspectorCommandResultEnvelope>;
}

export interface DesktopReviewRpc {
  reviewCard(input: ReviewDispositionInput): Promise<ReviewApprovalEnvelope>;
  currentRevision(): number;
}

export interface DesktopReviewEvidenceRpc {
  getReviewManifest(request: GetReviewManifestRequest): Promise<ReviewManifestEnvelope>;
  getReviewDiffChunk(request: GetReviewDiffChunkRequest): Promise<ReviewDiffChunkEnvelope>;
}

function measurementReason(
  error: ContractError | undefined,
): MeasurementReason {
  return error?.code ?? "none";
}

function recordReviewRead(
  measurement: WorkflowMeasurementSink | undefined,
  resource: "manifest" | "chunk",
  result: ReviewManifestEnvelope["result"] | ReviewDiffChunkEnvelope["result"],
): void {
  recordWorkflowMeasurementSafely(measurement, {
    schemaVersion: 1,
    name: "review_read",
    outcome: result.status,
    resource,
    reason: result.status === "rejected"
      ? measurementReason(result.error)
      : result.status === "unavailable"
        ? "storage_unavailable"
        : "none",
  });
}

export function createDesktopReviewEvidenceRpc(
  service: ReviewEvidenceService,
  measurement?: WorkflowMeasurementSink,
): DesktopReviewEvidenceRpc {
  const manifestEnvelope = (
    result: ReviewManifestEnvelope["result"],
  ): ReviewManifestEnvelope => {
    const envelope = createReviewManifestEnvelope(result);
    recordReviewRead(measurement, "manifest", envelope.result);
    return envelope;
  };
  const chunkEnvelope = (
    result: ReviewDiffChunkEnvelope["result"],
  ): ReviewDiffChunkEnvelope => {
    const envelope = createReviewDiffChunkEnvelope(result);
    recordReviewRead(measurement, "chunk", envelope.result);
    return envelope;
  };
  return {
    async getReviewManifest(request) {
      try {
        assertGetReviewManifestRequest(request);
        const result = service.manifest(request.evidenceId);
        if (result.status === "unavailable") {
          return manifestEnvelope({
            status: "rejected",
            error: reviewEvidenceContractError(result.reason),
          });
        }
        if (result.manifest.cardId !== request.cardId) {
          return manifestEnvelope({
            status: "rejected",
            error: { code: "evidence_stale", recoveryHint: "reload_evidence" },
          });
        }
        return manifestEnvelope({
          status: "ok",
          projection: result.manifest,
        });
      } catch {
        return manifestEnvelope({
          status: "rejected",
          error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
        });
      }
    },

    async getReviewDiffChunk(request) {
      try {
        assertGetReviewDiffChunkRequest(request);
        const manifestResult = service.manifest(request.evidenceId);
        if (manifestResult.status === "unavailable") {
          return chunkEnvelope({
            status: "rejected",
            error: reviewEvidenceContractError(manifestResult.reason),
          });
        }
        const file = manifestResult.manifest.files.find(
          (candidate) => candidate.fileId === request.fileId,
        );
        if (file === undefined) {
          return chunkEnvelope({
            status: "rejected",
            error: reviewEvidenceContractError("invalid_file"),
          });
        }
        if (file.isBinary) {
          return chunkEnvelope({
            status: "rejected",
            error: { code: "evidence_unsafe", recoveryHint: "none" },
          });
        }
        if (file.patchByteLength > REVIEW_TEXT_PATCH_BYTE_LIMIT) {
          return chunkEnvelope({
            status: "rejected",
            error: { code: "evidence_oversized", recoveryHint: "reduce_change_set" },
          });
        }
        const result = service.readDiffChunk(
          request.evidenceId,
          request.fileId,
          request.offset,
        );
        if (result.status === "non_text") {
          return chunkEnvelope({
            status: "rejected",
            error: { code: "evidence_unsafe", recoveryHint: "none" },
          });
        }
        if (result.status === "unavailable") {
          return chunkEnvelope({
            status: "rejected",
            error: reviewEvidenceContractError(result.reason),
          });
        }
        return chunkEnvelope({
          status: "ok",
          projection: result.chunk,
        });
      } catch {
        return chunkEnvelope({
          status: "rejected",
          error: { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" },
        });
      }
    },
  };
}

export function createDesktopReviewRpc(
  service: ReviewDispositionService,
  measurement?: WorkflowMeasurementSink,
): DesktopReviewRpc {
  return {
    async reviewCard(input) {
      assertReviewDispositionInput(input);
      const envelope = createReviewApprovalEnvelope(
        input.commandId,
        await service.reviewCard(input),
      );
      recordWorkflowMeasurementSafely(measurement, {
        schemaVersion: 1,
        name: "evidence_revalidation",
        outcome: envelope.result.status === "ok"
          ? "current"
          : envelope.result.error.code === "evidence_stale"
            ? "stale"
            : "unavailable",
        reason: envelope.result.status === "rejected"
          ? measurementReason(envelope.result.error)
          : "none",
      });
      recordWorkflowMeasurementSafely(measurement, {
        schemaVersion: 1,
        name: "review_disposition",
        outcome: envelope.result.status === "ok"
          ? envelope.result.outcome === "idempotent" ? "idempotent" : "completed"
          : "rejected",
        disposition: "approved",
        reason: envelope.result.status === "rejected"
          ? measurementReason(envelope.result.error)
          : "none",
      });
      return envelope;
    },
    currentRevision() {
      return service.currentRevision();
    },
  };
}

export function createDesktopPromptSubmissionRpc(
  coordinator: DesktopAttemptCoordinator,
  measurement?: WorkflowMeasurementSink,
): DesktopPromptSubmissionRpc {
  return {
    async submitCardPrompt(input) {
      assertSubmitCardPromptInput(input);
      const envelope = createSubmitCardPromptEnvelope(
        input.commandId,
        await coordinator.submitCardPrompt(input),
      );
      const promptOutcome = envelope.result.status === "ok"
        ? envelope.result.outcome
        : envelope.result.error.code === "blocker_active"
          ? "blocked"
          : envelope.result.error.code === "submission_interrupted"
            ? "interrupted"
            : "rejected";
      recordWorkflowMeasurementSafely(measurement, {
        schemaVersion: 1,
        name: "prompt_admission",
        outcome: promptOutcome,
        source: input.source,
        reason: envelope.result.status === "rejected"
          ? measurementReason(envelope.result.error)
          : "none",
      });
      if (input.source === "request_changes") {
        recordWorkflowMeasurementSafely(measurement, {
          schemaVersion: 1,
          name: "evidence_revalidation",
          outcome: envelope.result.status === "ok"
            ? "current"
            : envelope.result.error.code === "evidence_stale"
              ? "stale"
              : "unavailable",
          reason: envelope.result.status === "rejected"
            ? measurementReason(envelope.result.error)
            : "none",
        });
        recordWorkflowMeasurementSafely(measurement, {
          schemaVersion: 1,
          name: "review_disposition",
          outcome: envelope.result.status === "ok" ? "completed" : "rejected",
          disposition: "changes_requested",
          reason: envelope.result.status === "rejected"
            ? measurementReason(envelope.result.error)
            : "none",
        });
      }
      return envelope;
    },
  };
}

export function createDesktopInspectorRpc(
  journal: EventJournal,
  coordinator: DesktopAttemptCoordinator,
  attention?: AttentionCoordinator,
): DesktopInspectorRpc {
  return {
    async stopAttempt(request) {
      if (request.commandId.trim().length === 0) throw new Error("Inspector RPC commandId must be non-empty");
      const snapshot = journal.snapshot();
      const card = snapshot.cards.find(({ cardId }) => cardId === request.input.cardId);
      if (card === undefined) return inspectorEnvelope(request.commandId, {
        status: "rejected",
        reason: { code: "card_not_found", message: "The task no longer exists on this board." },
      });
      if (card.version !== request.input.expectedCardVersion) return inspectorEnvelope(request.commandId, {
        status: "conflict",
        conflict: { kind: "inspector_command", code: "stale_card", message: "The task changed before its run could be stopped." },
      });
      const attempt = [...snapshot.attempts]
        .reverse()
        .find((candidate) => candidate.cardId === card.cardId && (candidate.state === "running" || candidate.state === "needs_attention"));
      if (attempt === undefined) return inspectorEnvelope(request.commandId, {
        status: "rejected",
        reason: { code: "attempt_not_active", message: "The task has no active run to stop." },
      });
      const result = await coordinator.stop({ attemptId: attempt.attemptId, generation: attempt.generation });
      return inspectorEnvelope(request.commandId, result.status === "ok"
        ? { status: "ok" }
        : { status: "rejected", reason: result.reason });
    },
    async answerAttention(request) {
      if (request.commandId.trim().length === 0) throw new Error("Inspector RPC commandId must be non-empty");
      if (attention === undefined) return inspectorEnvelope(request.commandId, {
        status: "rejected",
        reason: { code: "not_ready", message: "Answering attention requests is not ready in this desktop host." },
      });
      try {
        attention.resolve(request.input);
        return inspectorEnvelope(request.commandId, { status: "ok" });
      } catch (error) {
        return inspectorEnvelope(request.commandId, {
          status: "rejected",
          reason: {
            code: error instanceof AttentionCoordinatorError ? error.code : "attention_failed",
            message: error instanceof Error ? error.message : "The attention response could not be recorded.",
          },
        });
      }
    },
  };
}

function inspectorEnvelope(
  commandId: string,
  result: InspectorCommandResult,
): InspectorCommandResultEnvelope {
  return { kind: "inspector_command_result", commandId, result };
}
