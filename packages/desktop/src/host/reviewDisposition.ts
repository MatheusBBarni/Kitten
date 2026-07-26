import {
  DuplicateJournalEventError,
  ProjectionVersionConflictError,
  type EventJournal,
  type ReviewDispositionProjection,
  type ReviewEvidenceSummary,
} from "../persistence/eventJournal.ts";
import {
  type ContractError,
  type ReviewApprovalResult,
  type ReviewDispositionInput,
} from "../shared/rpc.ts";
import { readCardWorktreeBinding } from "../worktrees/cardWorktreeProjection.ts";
import type { CardProjection } from "../workflow/workflowTypes.ts";
import {
  reviewEvidenceContractError,
  type ReviewEvidenceService,
} from "./reviewEvidence.ts";
import {
  silentLifecycleDiagnostics,
  type LifecycleDiagnostics,
} from "./lifecycleDiagnostics.ts";

export type EvidenceBoundReviewInput = Pick<
  ReviewDispositionInput,
  "boardId" | "cardId" | "expectedCardVersion" | "evidence"
>;

export interface EvidenceBoundReviewPreconditions {
  readonly card: CardProjection;
  readonly evidence: ReviewEvidenceSummary;
}

export type EvidenceBoundReviewPreconditionResult =
  | { readonly status: "ok"; readonly value: EvidenceBoundReviewPreconditions }
  | { readonly status: "rejected"; readonly error: ContractError };

export interface ReviewDispositionService {
  reviewCard(input: ReviewDispositionInput): Promise<ReviewApprovalResult>;
  currentRevision(): number;
}

function rejected(error: ContractError): ReviewApprovalResult {
  return { status: "rejected", error };
}

function staleProjection(
  expectedVersion?: number,
  actualVersion?: number,
): ContractError {
  return {
    code: "stale_projection",
    recoveryHint: "refresh_projection",
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(actualVersion === undefined ? {} : { actualVersion }),
  };
}

function exactEvidence(
  evidence: ReviewEvidenceSummary,
  input: EvidenceBoundReviewInput,
): boolean {
  return (
    evidence.evidenceId === input.evidence.evidenceId
    && evidence.evidenceDigest === input.evidence.evidenceDigest
    && evidence.attemptId === input.evidence.attemptId
    && evidence.generation === input.evidence.generation
    && evidence.worktreeBindingId === input.evidence.worktreeBindingId
    && evidence.boardId === input.boardId
    && evidence.cardId === input.cardId
  );
}

export function evidenceBoundReviewPreconditions(
  journal: EventJournal,
  input: EvidenceBoundReviewInput,
): EvidenceBoundReviewPreconditionResult {
  const snapshot = journal.snapshot();
  const card = snapshot.cards.find((candidate) => (
    candidate.cardId === input.cardId && candidate.boardId === input.boardId
  ));
  if (card === undefined) {
    return { status: "rejected", error: staleProjection(input.expectedCardVersion) };
  }
  if (card.version !== input.expectedCardVersion) {
    return {
      status: "rejected",
      error: staleProjection(input.expectedCardVersion, card.version),
    };
  }
  if (card.executionStatus !== "ready_for_review") {
    return {
      status: "rejected",
      error: card.executionStatus === "completed"
        ? staleProjection(input.expectedCardVersion, card.version)
        : reviewEvidenceContractError("missing"),
    };
  }

  const evidence = snapshot.reviewEvidenceByCard[card.cardId];
  if (evidence === undefined) {
    return { status: "rejected", error: reviewEvidenceContractError("missing") };
  }
  if (!exactEvidence(evidence, input)) {
    return { status: "rejected", error: reviewEvidenceContractError("stale") };
  }
  const reference = journal.eventById(`evidence:${input.evidence.evidenceId}`);
  const referencedChange = reference?.kind === "review_evidence_committed"
    ? reference.payload.changes.find((change) => change.entity === "card")
    : undefined;
  const referencedCard = referencedChange?.entity === "card"
    ? referencedChange.value
    : undefined;
  if (reference === null) {
    return { status: "rejected", error: reviewEvidenceContractError("missing") };
  }
  if (
    reference.kind !== "review_evidence_committed"
    || reference.boardId !== input.boardId
    || reference.cardId !== input.cardId
    || reference.payload.evidence.evidenceId !== input.evidence.evidenceId
    || reference.payload.evidence.evidenceDigest !== input.evidence.evidenceDigest
    || reference.payload.evidence.attemptId !== input.evidence.attemptId
    || reference.payload.evidence.generation !== input.evidence.generation
    || reference.payload.evidence.worktreeBindingId !== input.evidence.worktreeBindingId
    || referencedCard?.cardId !== card.cardId
    || referencedCard.version !== card.version
    || referencedCard.executionStatus !== "ready_for_review"
  ) {
    return { status: "rejected", error: reviewEvidenceContractError("stale") };
  }

  const attempt = snapshot.attempts.find((candidate) => (
    candidate.attemptId === input.evidence.attemptId
    && candidate.boardId === input.boardId
    && candidate.cardId === input.cardId
  ));
  if (
    attempt === undefined
    || attempt.generation !== input.evidence.generation
    || attempt.state !== "succeeded"
  ) {
    return { status: "rejected", error: reviewEvidenceContractError("stale_attempt") };
  }

  const binding = readCardWorktreeBinding(snapshot, input.cardId);
  if (
    binding === null
    || binding.boardId !== input.boardId
    || binding.cardId !== input.cardId
    || binding.bindingId !== input.evidence.worktreeBindingId
  ) {
    return {
      status: "rejected",
      error: reviewEvidenceContractError("binding_mismatch"),
    };
  }

  return { status: "ok", value: { card, evidence } };
}

function exactDuplicate(
  journal: EventJournal,
  eventId: string,
  input: ReviewDispositionInput,
): ReviewApprovalResult | null {
  const prior = journal.eventById(eventId);
  if (prior === null) return null;
  if (
    prior.kind !== "review_disposition_committed"
    || prior.boardId !== input.boardId
    || prior.cardId !== input.cardId
  ) {
    return rejected({ code: "invalid_prompt", recoveryHint: "none" });
  }
  const disposition = prior.payload.changes.find(
    (change) => change.entity === "review_disposition",
  )?.value;
  const card = prior.payload.changes.find(
    (change) => change.entity === "card",
  )?.value;
  if (
    disposition === undefined
    || card === undefined
    || disposition.reviewId !== input.commandId
    || disposition.disposition !== input.disposition
    || disposition.reviewedCardVersion !== input.expectedCardVersion
    || disposition.evidenceId !== input.evidence.evidenceId
    || disposition.evidenceDigest !== input.evidence.evidenceDigest
    || disposition.attemptId !== input.evidence.attemptId
    || disposition.generation !== input.evidence.generation
    || disposition.worktreeBindingId !== input.evidence.worktreeBindingId
  ) {
    return rejected({ code: "invalid_prompt", recoveryHint: "none" });
  }
  return {
    status: "ok",
    outcome: "idempotent",
    cardVersion: card.version,
  };
}

export function createReviewDispositionService(options: {
  readonly journal: EventJournal;
  readonly evidence: Pick<ReviewEvidenceService, "revalidate">;
  readonly now?: () => number;
  readonly diagnostics?: LifecycleDiagnostics;
  readonly afterRevalidation?: () => void | Promise<void>;
}): ReviewDispositionService {
  const now = options.now ?? Date.now;
  const diagnostics = options.diagnostics ?? silentLifecycleDiagnostics;
  return {
    async reviewCard(input) {
      const eventId = `review:${input.commandId}`;
      const duplicate = exactDuplicate(options.journal, eventId, input);
      if (duplicate !== null) return duplicate;

      const initial = evidenceBoundReviewPreconditions(options.journal, input);
      if (initial.status === "rejected") return rejected(initial.error);

      const current = await options.evidence.revalidate({
        boardId: input.boardId,
        cardId: input.cardId,
        expectedCardVersion: input.expectedCardVersion,
        evidence: input.evidence,
      });
      if (current.status === "unavailable") {
        return rejected(reviewEvidenceContractError(current.reason));
      }
      if (
        current.evidenceId !== input.evidence.evidenceId
        || current.evidenceDigest !== input.evidence.evidenceDigest
      ) {
        return rejected(reviewEvidenceContractError("stale"));
      }
      await options.afterRevalidation?.();

      const occurredAt = Math.max(0, now());
      let completedVersion: number | null = null;
      let atomicRejection: ContractError | null = null;
      try {
        options.journal.immediate((transaction) => {
          const guarded = evidenceBoundReviewPreconditions(options.journal, input);
          if (guarded.status === "rejected") {
            atomicRejection = guarded.error;
            return;
          }
          const disposition: ReviewDispositionProjection = {
            reviewId: input.commandId,
            boardId: input.boardId,
            cardId: input.cardId,
            evidenceId: input.evidence.evidenceId,
            evidenceDigest: input.evidence.evidenceDigest,
            attemptId: input.evidence.attemptId,
            generation: input.evidence.generation,
            worktreeBindingId: input.evidence.worktreeBindingId,
            disposition: input.disposition,
            reviewer: "operator",
            reviewedCardVersion: guarded.value.card.version,
            occurredAt,
          };
          const completedCard: CardProjection = {
            ...guarded.value.card,
            executionStatus: "completed",
            version: guarded.value.card.version + 1,
            updatedAt: Math.max(guarded.value.card.updatedAt, occurredAt),
          };
          transaction.append({
            eventId,
            boardId: input.boardId,
            cardId: input.cardId,
            actor: "operator",
            kind: "review_disposition_committed",
            occurredAt,
            payload: {
              changes: [
                { entity: "review_disposition", operation: "insert", value: disposition },
                { entity: "card", operation: "upsert", value: completedCard },
              ],
            },
          }, {
            preconditions: [{
              entity: "card",
              id: input.cardId,
              expectedVersion: input.expectedCardVersion,
            }],
          });
          completedVersion = completedCard.version;
        });
      } catch (error) {
        if (error instanceof ProjectionVersionConflictError) {
          return rejected(staleProjection(error.expectedVersion, error.actualVersion));
        }
        if (error instanceof DuplicateJournalEventError) {
          return exactDuplicate(options.journal, eventId, input)
            ?? rejected({ code: "invalid_prompt", recoveryHint: "none" });
        }
        throw error;
      }
      if (atomicRejection !== null) return rejected(atomicRejection);
      if (completedVersion === null) {
        return rejected(reviewEvidenceContractError("incomplete"));
      }

      diagnostics.record({
        name: "review_disposition_recorded",
        boardId: input.boardId,
        cardId: input.cardId,
        outcome: "completed",
      });
      return {
        status: "ok",
        outcome: "approved",
        cardVersion: completedVersion,
      };
    },
    currentRevision() {
      return options.journal.snapshot().revision;
    },
  };
}
