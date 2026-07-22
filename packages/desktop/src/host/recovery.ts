import type { ActivityEventId, ActivitySequence, AttemptId } from "@kitten/engine";
import { isDirectAcpTerminalState } from "@kitten/engine";
import {
  createAttemptInspectorProjection,
  validateAttemptInspectorProjection,
  type AttemptInspectorProjection,
} from "../attempts/inspectorProjection.ts";
import type { AttentionBlockerProjection } from "../attention/contracts.ts";
import type {
  EventJournal,
  JournalBatchAppendInput,
  ProjectionChange,
  ProjectionDelta,
} from "../persistence/eventJournal.ts";
import type { CardProjection } from "../workflow/workflowTypes.ts";
import {
  silentLifecycleDiagnostics,
  type LifecycleDiagnostics,
} from "./lifecycleDiagnostics.ts";

export interface InterruptedAttemptRecoveryResult {
  readonly interruptedAttemptIds: readonly AttemptId[];
  readonly deltas: readonly ProjectionDelta[];
}

export function recoverInterruptedAttempts(options: {
  readonly journal: EventJournal;
  readonly now?: () => number;
  readonly createEventId?: (attemptId: AttemptId) => string;
  readonly diagnostics?: LifecycleDiagnostics;
}): InterruptedAttemptRecoveryResult {
  const now = options.now ?? Date.now;
  const createEventId = options.createEventId ?? ((attemptId) => `recovery:${attemptId}:${crypto.randomUUID()}`);
  const diagnostics = options.diagnostics ?? silentLifecycleDiagnostics;
  const snapshot = options.journal.snapshot();
  const events = options.journal.events();
  const live = snapshot.attempts.filter((attempt) => !isDirectAcpTerminalState(attempt.state));
  const occurredAt = Math.max(0, now());
  const batch: JournalBatchAppendInput[] = [];

  for (const attempt of live) {
    const card = snapshot.cards.find((candidate) => candidate.cardId === attempt.cardId);
    const context = snapshot.runContexts.find((candidate) => candidate.attemptId === attempt.attemptId);
    if (card === undefined || context === undefined) {
      throw new Error(`Cannot recover attempt ${attempt.attemptId}: durable card or Run Context is missing`);
    }
    const eventId = createEventId(attempt.attemptId);
    if (eventId.trim().length === 0) throw new Error("Recovery event identity must not be empty");
    const inspector = snapshot.attemptInspectors.find((candidate) => candidate.attemptId === attempt.attemptId)
      ?? createAttemptInspectorProjection(context);
    const latestSequence = events
      .filter((event) => event.attemptId === attempt.attemptId && event.attemptSequence !== undefined)
      .reduce((latest, event) => Math.max(latest, event.attemptSequence!), -1);
    const attemptSequence = latestSequence + 1;
    const interruptedInspector = interruptInspector(inspector, eventId, attemptSequence, occurredAt);
    const interruptedAttempt = {
      ...attempt,
      state: "interrupted" as const,
      terminalAt: Math.max(attempt.createdAt, occurredAt),
    };
    const unlockedCard: CardProjection = {
      ...card,
      executionStatus: "failed",
      version: card.version + 1,
      updatedAt: Math.max(card.updatedAt, occurredAt),
    };
    const blocker = snapshot.attentionBlockers.find((candidate) => (
      candidate.attemptId === attempt.attemptId && candidate.generation === attempt.generation && candidate.active
    ));
    const changes: ProjectionChange[] = [
      { entity: "attempt", operation: "upsert", value: interruptedAttempt },
      { entity: "attempt_inspector", operation: "upsert", value: interruptedInspector },
      { entity: "card", operation: "upsert", value: unlockedCard },
    ];
    if (blocker !== undefined) {
      changes.push({
        entity: "attention_blocker",
        operation: "upsert",
        value: interruptBlocker(blocker, occurredAt),
      });
    }
    batch.push({
      event: {
        eventId,
        boardId: attempt.boardId,
        cardId: attempt.cardId,
        attemptId: attempt.attemptId,
        attemptSequence,
        actor: "system",
        kind: "attempt_interrupted",
        occurredAt,
        payload: { generation: attempt.generation, changes },
      },
      options: {
        preconditions: [
          { entity: "card", id: card.cardId, expectedVersion: card.version },
          ...(blocker === undefined
            ? []
            : [{ entity: "attention_blocker" as const, id: blocker.blockerId, expectedVersion: blocker.version }]),
        ],
      },
    });
  }

  const deltas = options.journal.appendBatch(batch);
  for (const attempt of live) {
    diagnostics.record({
      name: "attempt_recovered",
      boardId: attempt.boardId,
      cardId: attempt.cardId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      outcome: "interrupted",
    });
  }
  return { interruptedAttemptIds: live.map(({ attemptId }) => attemptId), deltas };
}

function interruptInspector(
  inspector: AttemptInspectorProjection,
  eventId: string,
  sequence: number,
  occurredAt: number,
): AttemptInspectorProjection {
  if (inspector.terminalOutcome !== null) throw new Error("A terminal inspector cannot be recovered again");
  const activitySequence = sequence as ActivitySequence;
  return validateAttemptInspectorProjection({
    ...inspector,
    entries: [
      ...inspector.entries,
      {
        kind: "terminal",
        outcome: "interrupted",
        evidence: {
          eventIds: [eventId as ActivityEventId],
          firstSequence: activitySequence,
          lastSequence: activitySequence,
          firstOccurredAt: occurredAt,
          lastOccurredAt: occurredAt,
        },
      },
    ],
    terminalOutcome: "interrupted",
    nextSequence: (sequence + 1) as ActivitySequence,
    updatedAt: Math.max(inspector.updatedAt, occurredAt),
  });
}

function interruptBlocker(
  blocker: AttentionBlockerProjection,
  occurredAt: number,
): AttentionBlockerProjection {
  return {
    ...blocker,
    active: false,
    outcome: { kind: "cancelled" },
    version: blocker.version + 1,
    updatedAt: Math.max(blocker.updatedAt, occurredAt),
    terminalAt: Math.max(blocker.createdAt, occurredAt),
  };
}
