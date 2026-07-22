import {
  DuplicateJournalEventError,
  ProjectionVersionConflictError,
  type EventJournal,
  type ReviewDispositionProjection,
} from "../persistence/eventJournal.ts";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import {
  silentLifecycleDiagnostics,
  type LifecycleDiagnostics,
} from "./lifecycleDiagnostics.ts";

export interface ReviewCardInput {
  readonly reviewId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
  readonly disposition: "approved";
}

export type ReviewCardResult =
  | { readonly status: "committed"; readonly disposition: ReviewDispositionProjection; readonly cardVersion: number; readonly revision: number }
  | { readonly status: "idempotent"; readonly disposition: ReviewDispositionProjection; readonly cardVersion: number; readonly revision: number }
  | { readonly status: "conflict"; readonly expectedVersion: number; readonly actualVersion: number }
  | { readonly status: "rejected"; readonly reason: "card_not_found" | "wrong_state" | "invalid_review_id" };

export interface ReviewDispositionService {
  reviewCard(input: ReviewCardInput): ReviewCardResult;
}

export function createReviewDispositionService(options: {
  readonly journal: EventJournal;
  readonly now?: () => number;
  readonly diagnostics?: LifecycleDiagnostics;
}): ReviewDispositionService {
  const now = options.now ?? Date.now;
  const diagnostics = options.diagnostics ?? silentLifecycleDiagnostics;
  return {
    reviewCard(input) {
      if (input.reviewId.trim().length === 0) return { status: "rejected", reason: "invalid_review_id" };
      const eventId = `review:${input.reviewId}`;
      const prior = options.journal.eventById(eventId);
      if (prior !== null) {
        if (
          prior.kind === "review_disposition_committed"
          && prior.boardId === input.boardId
          && prior.cardId === input.cardId
        ) {
          const disposition = prior.payload.changes.find((change) => change.entity === "review_disposition")!.value;
          const card = prior.payload.changes.find((change) => change.entity === "card")!.value;
          return { status: "idempotent", disposition, cardVersion: card.version, revision: options.journal.snapshot().revision };
        }
        return { status: "rejected", reason: "invalid_review_id" };
      }
      const card = options.journal.snapshot().cards.find((candidate) => (
        candidate.cardId === input.cardId && candidate.boardId === input.boardId
      ));
      if (card === undefined) return { status: "rejected", reason: "card_not_found" };
      if (card.version !== input.expectedCardVersion) {
        return { status: "conflict", expectedVersion: input.expectedCardVersion, actualVersion: card.version };
      }
      if (card.executionStatus !== "ready_for_review") return { status: "rejected", reason: "wrong_state" };
      const occurredAt = Math.max(0, now());
      const disposition: ReviewDispositionProjection = {
        reviewId: input.reviewId,
        boardId: input.boardId,
        cardId: input.cardId,
        disposition: input.disposition,
        reviewer: "operator",
        reviewedCardVersion: card.version,
        occurredAt,
      };
      const completedCard = {
        ...card,
        executionStatus: "completed" as const,
        version: card.version + 1,
        updatedAt: Math.max(card.updatedAt, occurredAt),
      };
      let revision: number;
      try {
        revision = options.journal.append({
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
          preconditions: [{ entity: "card", id: card.cardId, expectedVersion: input.expectedCardVersion }],
        }).revision;
      } catch (error) {
        if (error instanceof ProjectionVersionConflictError) {
          return { status: "conflict", expectedVersion: error.expectedVersion, actualVersion: error.actualVersion };
        }
        if (error instanceof DuplicateJournalEventError) {
          const committed = options.journal.eventById(eventId);
          if (
            committed?.kind === "review_disposition_committed"
            && committed.boardId === input.boardId
            && committed.cardId === input.cardId
          ) {
            const committedDisposition = committed.payload.changes.find((change) => change.entity === "review_disposition")!.value;
            const committedCard = committed.payload.changes.find((change) => change.entity === "card")!.value;
            return {
              status: "idempotent",
              disposition: committedDisposition,
              cardVersion: committedCard.version,
              revision: options.journal.snapshot().revision,
            };
          }
          return { status: "rejected", reason: "invalid_review_id" };
        }
        throw error;
      }
      diagnostics.record({
        name: "review_disposition_recorded",
        boardId: input.boardId,
        cardId: input.cardId,
        outcome: "completed",
      });
      return { status: "committed", disposition, cardVersion: completedCard.version, revision };
    },
  };
}
