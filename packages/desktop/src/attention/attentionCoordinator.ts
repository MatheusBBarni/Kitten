import type { AttemptGeneration, AttemptId, QuestionId } from "@kitten/engine";
import { isDirectAcpTerminalState } from "@kitten/engine";
import { markCardNeedsAttention, resumeCardAfterAttention } from "../board/cardTransitionCoordinator.ts";
import type {
  AttentionBlockerOperation,
  EventJournal,
  ProjectionChange,
} from "../persistence/eventJournal.ts";
import { ProjectionVersionConflictError } from "../persistence/eventJournal.ts";
import type { CardNotificationService } from "../notifications/cardNotificationService.ts";
import type {
  AttentionBlockerProjection,
  AttentionForm,
  AttentionOutcome,
} from "./contracts.ts";
import { validateAttentionForm, validateAttentionOutcome } from "./contracts.ts";

export interface AttentionRequestHandle {
  readonly blocker: AttentionBlockerProjection;
  readonly outcome: Promise<AttentionOutcome>;
}

export type AttentionRejectionCode =
  | "unknown_attempt"
  | "stale_generation"
  | "attempt_terminal"
  | "invalid_state"
  | "duplicate_call_id"
  | "blocker_active"
  | "unknown_blocker"
  | "duplicate_outcome"
  | "stale_version";

export class AttentionCoordinatorError extends Error {
  constructor(readonly code: AttentionRejectionCode, message: string) {
    super(message);
    this.name = "AttentionCoordinatorError";
  }
}

export interface AttentionCoordinator {
  raise(input: {
    readonly attemptId: AttemptId;
    readonly generation: AttemptGeneration;
    readonly callId: string;
    readonly form: AttentionForm;
  }): Promise<AttentionRequestHandle>;
  resolve(input: {
    readonly attemptId: AttemptId;
    readonly generation: AttemptGeneration;
    readonly blockerId: QuestionId;
    readonly expectedVersion: number;
    readonly outcome: AttentionOutcome;
  }): AttentionBlockerProjection;
  cancelActive(input: { readonly attemptId: AttemptId; readonly generation: AttemptGeneration }): AttentionBlockerProjection | null;
  hasActive(attemptId: AttemptId): boolean;
}

interface PendingOutcome {
  readonly promise: Promise<AttentionOutcome>;
  resolve(outcome: AttentionOutcome): void;
}

export function createAttentionCoordinator(options: {
  readonly journal: EventJournal;
  readonly notifications: CardNotificationService;
  readonly now?: () => number;
  readonly createBlockerId?: () => string;
  readonly createEventId?: (operation: AttentionBlockerOperation) => string;
}): AttentionCoordinator {
  const now = options.now ?? Date.now;
  const createBlockerId = options.createBlockerId ?? (() => `blocker:${crypto.randomUUID()}`);
  const createEventId = options.createEventId ?? ((operation) => `attention:${operation}:${crypto.randomUUID()}`);
  const pending = new Map<QuestionId, PendingOutcome>();

  const coordinator: AttentionCoordinator = {
    async raise(input) {
      const form = validateAttentionForm(input.form);
      const snapshot = options.journal.snapshot();
      const attempt = snapshot.attempts.find((candidate) => candidate.attemptId === input.attemptId);
      if (attempt === undefined) throw new AttentionCoordinatorError("unknown_attempt", "Attempt does not exist");
      if (attempt.generation !== input.generation) {
        throw new AttentionCoordinatorError("stale_generation", "Attempt generation is stale");
      }
      if (isDirectAcpTerminalState(attempt.state)) {
        throw new AttentionCoordinatorError("attempt_terminal", `Attempt is terminal (${attempt.state})`);
      }
      if (attempt.state !== "running") {
        if (snapshot.attentionBlockers.some((blocker) => blocker.attemptId === input.attemptId && blocker.active)) {
          throw new AttentionCoordinatorError("blocker_active", "Attempt already has an active Attention Blocker");
        }
        throw new AttentionCoordinatorError("invalid_state", `Attempt cannot raise a blocker from ${attempt.state}`);
      }
      if (snapshot.attentionBlockers.some((blocker) => blocker.attemptId === input.attemptId && blocker.callId === input.callId)) {
        throw new AttentionCoordinatorError("duplicate_call_id", `Call identity ${input.callId} already exists`);
      }
      if (snapshot.attentionBlockers.some((blocker) => blocker.attemptId === input.attemptId && blocker.active)) {
        throw new AttentionCoordinatorError("blocker_active", "Attempt already has an active Attention Blocker");
      }
      const card = snapshot.cards.find((candidate) => candidate.cardId === attempt.cardId);
      if (card === undefined || card.boardId !== attempt.boardId) {
        throw new AttentionCoordinatorError("unknown_attempt", "Attempt card does not exist");
      }
      const blockerId = createBlockerId().trim() as QuestionId;
      if (blockerId.length === 0 || snapshot.attentionBlockers.some((blocker) => blocker.blockerId === blockerId)) {
        throw new AttentionCoordinatorError("invalid_state", "Attention Blocker identity is invalid or duplicated");
      }
      const occurredAt = Math.max(0, now());
      const blocker: AttentionBlockerProjection = {
        schemaVersion: 1,
        blockerId,
        callId: input.callId,
        boardId: attempt.boardId,
        cardId: attempt.cardId,
        attemptId: attempt.attemptId,
        generation: attempt.generation,
        form,
        active: true,
        outcome: null,
        notification: { state: "pending", attemptedAt: null, failureCode: null },
        version: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        terminalAt: null,
      };
      const blockedCard = markCardNeedsAttention(card, occurredAt);
      const blockedAttempt = { ...attempt, state: "needs_attention" as const };
      appendAttention(options.journal, {
        eventId: createEventId("raised"),
        operation: "raised",
        actor: "agent",
        blocker,
        changes: [
          { entity: "attention_blocker", operation: "upsert", value: blocker },
          { entity: "card", operation: "upsert", value: blockedCard },
          { entity: "attempt", operation: "upsert", value: blockedAttempt },
        ],
        expectedCardVersion: card.version,
        expectedBlockerVersion: 0,
      });

      const deferred = createPendingOutcome();
      pending.set(blockerId, deferred);
      const delivery = await options.notifications.notify({
        blockerId,
        cardId: card.cardId,
        cardTitle: card.title,
      });
      const current = options.journal.snapshot().attentionBlockers.find((candidate) => candidate.blockerId === blockerId);
      if (current === undefined) throw new AttentionCoordinatorError("unknown_blocker", "Committed blocker projection disappeared");
      const notificationRecorded: AttentionBlockerProjection = {
        ...current,
        notification: delivery.state === "delivered"
          ? { state: "delivered", attemptedAt: delivery.attemptedAt, failureCode: null }
          : delivery,
        version: current.version + 1,
        updatedAt: Math.max(current.updatedAt, delivery.attemptedAt),
      };
      appendAttention(options.journal, {
        eventId: createEventId("notification_recorded"),
        operation: "notification_recorded",
        actor: "system",
        blocker: notificationRecorded,
        changes: [{ entity: "attention_blocker", operation: "upsert", value: notificationRecorded }],
        expectedBlockerVersion: current.version,
      });
      return { blocker: notificationRecorded, outcome: deferred.promise };
    },

    resolve(input) {
      const outcome = validateAttentionOutcome(input.outcome);
      const snapshot = options.journal.snapshot();
      const attempt = snapshot.attempts.find((candidate) => candidate.attemptId === input.attemptId);
      if (attempt === undefined) throw new AttentionCoordinatorError("unknown_attempt", "Attempt does not exist");
      if (attempt.generation !== input.generation) {
        throw new AttentionCoordinatorError("stale_generation", "Attempt generation is stale");
      }
      if (isDirectAcpTerminalState(attempt.state)) {
        throw new AttentionCoordinatorError("attempt_terminal", `Attempt is terminal (${attempt.state})`);
      }
      const blocker = snapshot.attentionBlockers.find((candidate) => candidate.blockerId === input.blockerId);
      if (blocker === undefined || blocker.attemptId !== input.attemptId) {
        throw new AttentionCoordinatorError("unknown_blocker", "Attention Blocker does not exist for this attempt");
      }
      if (blocker.generation !== input.generation) {
        throw new AttentionCoordinatorError("stale_generation", "Attention Blocker generation is stale");
      }
      if (!blocker.active || blocker.outcome !== null) {
        throw new AttentionCoordinatorError("duplicate_outcome", "Attention Blocker already has a terminal outcome");
      }
      if (blocker.version !== input.expectedVersion) {
        throw new AttentionCoordinatorError("stale_version", `Attention Blocker version is stale: expected ${input.expectedVersion}, actual ${blocker.version}`);
      }
      if (attempt.state !== "needs_attention") {
        throw new AttentionCoordinatorError("invalid_state", `Attempt is not attention-blocked (${attempt.state})`);
      }
      const card = snapshot.cards.find((candidate) => candidate.cardId === blocker.cardId);
      if (card === undefined) throw new AttentionCoordinatorError("unknown_attempt", "Attention Blocker card does not exist");
      const occurredAt = Math.max(0, now());
      const resolved: AttentionBlockerProjection = {
        ...blocker,
        active: false,
        outcome,
        version: blocker.version + 1,
        updatedAt: Math.max(blocker.updatedAt, occurredAt),
        terminalAt: occurredAt,
      };
      const runningCard = resumeCardAfterAttention(card, occurredAt);
      const runningAttempt = { ...attempt, state: "running" as const };
      try {
        appendAttention(options.journal, {
          eventId: createEventId("resolved"),
          operation: "resolved",
          actor: outcome.kind === "timed_out" ? "system" : "operator",
          blocker: resolved,
          changes: [
            { entity: "attention_blocker", operation: "upsert", value: resolved },
            { entity: "card", operation: "upsert", value: runningCard },
            { entity: "attempt", operation: "upsert", value: runningAttempt },
          ],
          expectedCardVersion: card.version,
          expectedBlockerVersion: blocker.version,
        });
      } catch (error) {
        if (error instanceof ProjectionVersionConflictError) {
          throw new AttentionCoordinatorError("stale_version", error.message);
        }
        throw error;
      }
      pending.get(blocker.blockerId)?.resolve(outcome);
      pending.delete(blocker.blockerId);
      return resolved;
    },

    cancelActive(input) {
      const blocker = options.journal.snapshot().attentionBlockers.find((candidate) => (
        candidate.attemptId === input.attemptId
        && candidate.generation === input.generation
        && candidate.active
      ));
      if (blocker === undefined) return null;
      return coordinator.resolve({
        ...input,
        blockerId: blocker.blockerId,
        expectedVersion: blocker.version,
        outcome: { kind: "cancelled" },
      });
    },

    hasActive(attemptId) {
      return options.journal.snapshot().attentionBlockers.some((blocker) => blocker.attemptId === attemptId && blocker.active);
    },
  };
  return coordinator;
}

function createPendingOutcome(): PendingOutcome {
  let resolve!: (outcome: AttentionOutcome) => void;
  const promise = new Promise<AttentionOutcome>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function appendAttention(journal: EventJournal, input: {
  readonly eventId: string;
  readonly operation: AttentionBlockerOperation;
  readonly actor: "agent" | "operator" | "system";
  readonly blocker: AttentionBlockerProjection;
  readonly changes: readonly ProjectionChange[];
  readonly expectedCardVersion?: number;
  readonly expectedBlockerVersion: number;
}): void {
  journal.append({
    eventId: input.eventId,
    boardId: input.blocker.boardId,
    cardId: input.blocker.cardId,
    actor: input.actor,
    kind: "attention_blocker_committed",
    occurredAt: input.blocker.updatedAt,
    payload: { operation: input.operation, changes: input.changes },
  }, {
    preconditions: [
      { entity: "attention_blocker", id: input.blocker.blockerId, expectedVersion: input.expectedBlockerVersion },
      ...(input.expectedCardVersion === undefined
        ? []
        : [{ entity: "card" as const, id: input.blocker.cardId, expectedVersion: input.expectedCardVersion }]),
    ],
  });
}
