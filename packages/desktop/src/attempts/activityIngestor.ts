import type {
  AttemptGeneration,
  AttemptId,
  NormalizedAttemptEvent,
} from "@kitten/engine";
import {
  NormalizedActivityValidationError,
  classifyActivityOrder,
  isDirectAcpTerminalState,
  validateNormalizedAttemptEvent,
} from "@kitten/engine";
import {
  AttemptActivityMutationError,
  DuplicateJournalEventError,
  JournalValidationError,
  type EventJournal,
  type ProjectionDelta,
} from "../persistence/eventJournal.ts";
import type { CardId } from "../workflow/workflowTypes.ts";
import {
  createAttemptInspectorProjection,
  type AttemptInspectorProjection,
  type CardInspectorProjection,
} from "./inspectorProjection.ts";

export interface AttemptActivityBinding {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
}

export type ActivityRejectionReason =
  | "malformed_payload"
  | "unknown_attempt"
  | "stale_generation"
  | "duplicate_event_id"
  | "non_monotonic"
  | "sequence_gap"
  | "attempt_not_active"
  | "post_terminal"
  | "missing_run_context";

export type ActivityIngestResult =
  | {
      readonly status: "committed";
      readonly event: NormalizedAttemptEvent;
      readonly inspector: AttemptInspectorProjection;
      readonly delta: ProjectionDelta;
    }
  | {
      readonly status: "rejected";
      readonly reason: ActivityRejectionReason;
      readonly message: string;
    };

export interface AttemptActivityIngestor {
  ingest(input: unknown, binding?: AttemptActivityBinding): Promise<ActivityIngestResult>;
}

export interface ActivityCommitNotification {
  readonly event: NormalizedAttemptEvent;
  readonly inspector: AttemptInspectorProjection;
  readonly delta: ProjectionDelta;
}

export function createActivityIngestor(options: {
  readonly journal: EventJournal;
  readonly onCommitted?: (notification: ActivityCommitNotification) => void | Promise<void>;
}): AttemptActivityIngestor {
  return {
    async ingest(input, binding) {
      let event: NormalizedAttemptEvent;
      try {
        event = validateNormalizedAttemptEvent(input);
      } catch (error) {
        return rejected(
          "malformed_payload",
          error instanceof NormalizedActivityValidationError ? error.message : "Normalized activity is malformed",
        );
      }
      if (binding !== undefined && event.attemptId !== binding.attemptId) {
        return rejected("unknown_attempt", "Activity does not belong to the subscribed attempt");
      }
      if (binding !== undefined && event.generation !== binding.generation) {
        return rejected("stale_generation", "Activity generation does not match the subscribed attempt");
      }
      if (options.journal.eventById(event.eventId) !== null) {
        return rejected("duplicate_event_id", `Activity event ${event.eventId} already exists`);
      }

      const snapshot = options.journal.snapshot();
      const attempt = snapshot.attempts.find((candidate) => candidate.attemptId === event.attemptId);
      if (attempt === undefined) return rejected("unknown_attempt", `Attempt ${event.attemptId} does not exist`);
      if (attempt.generation !== event.generation) {
        return rejected("stale_generation", `Attempt ${event.attemptId} generation is stale`);
      }
      if (isDirectAcpTerminalState(attempt.state)) {
        return rejected("post_terminal", `Attempt ${event.attemptId} is already terminal`);
      }
      if (attempt.state !== "running" && attempt.state !== "needs_attention") {
        return rejected("attempt_not_active", `Attempt ${event.attemptId} is not active`);
      }
      const context = snapshot.runContexts.find((candidate) => candidate.attemptId === event.attemptId);
      if (context === undefined) return rejected("missing_run_context", `Attempt ${event.attemptId} has no Run Context`);
      const inspector = snapshot.attemptInspectors.find((candidate) => candidate.attemptId === event.attemptId)
        ?? createAttemptInspectorProjection(context);
      if (inspector.terminalOutcome !== null) {
        return rejected("post_terminal", `Attempt ${event.attemptId} inspector is already terminal`);
      }
      const order = classifyActivityOrder({
        attemptId: attempt.attemptId,
        generation: attempt.generation,
        nextSequence: inspector.nextSequence,
      }, event);
      if (!order.accepted) return rejected(order.reason, `Activity was rejected: ${order.reason}`);

      let delta: ProjectionDelta;
      try {
        delta = options.journal.append({
          eventId: event.eventId,
          boardId: attempt.boardId,
          cardId: attempt.cardId,
          attemptId: event.attemptId,
          attemptSequence: event.sequence,
          actor: "agent",
          kind: "attempt_activity_committed",
          occurredAt: event.occurredAt,
          payload: { generation: event.generation, activity: event.activity },
        });
      } catch (error) {
        if (error instanceof DuplicateJournalEventError) {
          return rejected("duplicate_event_id", error.message);
        }
        if (error instanceof AttemptActivityMutationError) {
          return rejected(error.reason, error.message);
        }
        if (error instanceof JournalValidationError) {
          return rejected("malformed_payload", error.message);
        }
        throw error;
      }
      const committedInspector = delta.changes.find((change) => change.entity === "attempt_inspector")?.value;
      if (committedInspector === undefined) throw new Error("Committed activity produced no inspector projection");
      const notification = { event, inspector: committedInspector, delta };
      try {
        await options.onCommitted?.(notification);
      } catch {
        // Delivery is best effort and happens strictly after durable commit.
      }
      return { status: "committed", ...notification };
    },
  };
}

function rejected(reason: ActivityRejectionReason, message: string): ActivityIngestResult {
  return { status: "rejected", reason, message };
}

export function getCardInspectorProjection(
  journal: EventJournal,
  cardId: CardId,
): CardInspectorProjection | null {
  const snapshot = journal.snapshot();
  if (!snapshot.cards.some((card) => card.cardId === cardId)) return null;
  const stored = new Map(snapshot.attemptInspectors.map((inspector) => [inspector.attemptId, inspector]));
  const attempts = snapshot.runContexts
    .filter((context) => context.card.cardId === cardId)
    .sort((left, right) => Number(left.generation) - Number(right.generation))
    .map((context) => stored.get(context.attemptId) ?? createAttemptInspectorProjection(context));
  return {
    schemaVersion: 1,
    cardId,
    revision: snapshot.revision,
    attempts,
  };
}
