import type {
  EventJournal,
  PersistenceSnapshot,
  ProjectionDelta,
} from "../persistence/eventJournal.ts";
import type { CardWorktreeBinding } from "./contracts.ts";

export interface RecordCardWorktreeBindingInput {
  readonly eventId: string;
  readonly binding: CardWorktreeBinding;
  readonly actor?: "operator" | "system";
}

/** Appends the binding lifecycle fact before exposing its updated projection. */
export function recordCardWorktreeBinding(
  journal: EventJournal,
  input: RecordCardWorktreeBindingInput,
): ProjectionDelta {
  return journal.append({
    eventId: input.eventId,
    boardId: input.binding.boardId,
    cardId: input.binding.cardId,
    actor: input.actor ?? "system",
    kind: "card_worktree_binding_recorded",
    occurredAt: input.binding.updatedAt,
    payload: input.binding,
  });
}

export function readCardWorktreeBinding(
  snapshot: PersistenceSnapshot,
  cardId: CardWorktreeBinding["cardId"],
): CardWorktreeBinding | null {
  return snapshot.cardWorktrees.find((binding) => binding.cardId === cardId) ?? null;
}
