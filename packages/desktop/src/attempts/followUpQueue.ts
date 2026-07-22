import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export type FollowUpQueueId = string & { readonly __brand: "FollowUpQueueId" };
export type FollowUpDraftState = "queued" | "awaiting_confirmation" | "confirmed" | "dispatched" | "removed";
export type FollowUpTurnState = "active" | "settled" | "dispatching";

export interface FollowUpDraft {
  readonly queueId: FollowUpQueueId;
  readonly text: string;
  readonly state: FollowUpDraftState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly confirmedAt: number | null;
  readonly dispatchedAt: number | null;
  readonly removedAt: number | null;
}

export interface FollowUpQueueProjection {
  readonly schemaVersion: 1;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly version: number;
  readonly turnState: FollowUpTurnState;
  readonly drafts: readonly FollowUpDraft[];
  readonly updatedAt: number;
}

export type FollowUpQueueOperation = "created" | "removed" | "head_ready" | "confirmed" | "dispatched";

const DRAFT_STATES: readonly FollowUpDraftState[] = [
  "queued", "awaiting_confirmation", "confirmed", "dispatched", "removed",
];
const TURN_STATES: readonly FollowUpTurnState[] = ["active", "settled", "dispatching"];

export function createFollowUpQueue(input: {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly turnState: Exclude<FollowUpTurnState, "dispatching">;
  readonly queueId: FollowUpQueueId;
  readonly text: string;
  readonly occurredAt: number;
}): FollowUpQueueProjection {
  const draft = createDraft(input.queueId, input.text, input.turnState === "settled", input.occurredAt);
  return validateFollowUpQueueProjection({
    schemaVersion: 1,
    boardId: input.boardId,
    cardId: input.cardId,
    attemptId: input.attemptId,
    generation: input.generation,
    version: 1,
    turnState: input.turnState,
    drafts: [draft],
    updatedAt: input.occurredAt,
  });
}

export function enqueueFollowUp(
  current: FollowUpQueueProjection,
  input: { readonly queueId: FollowUpQueueId; readonly text: string; readonly occurredAt: number },
): FollowUpQueueProjection {
  if (current.drafts.some((draft) => draft.queueId === input.queueId)) {
    throw new FollowUpQueueTransitionError("duplicate_queue_id", `Queue identity ${input.queueId} already exists`);
  }
  const awaiting = current.turnState === "settled" && activeDrafts(current).length === 0;
  return next(current, input.occurredAt, [
    ...current.drafts,
    createDraft(input.queueId, input.text, awaiting, input.occurredAt),
  ]);
}

export function removeFollowUp(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
): FollowUpQueueProjection {
  const target = current.drafts.find((draft) => draft.queueId === queueId);
  if (target === undefined) throw new FollowUpQueueTransitionError("queue_not_found", `Queue identity ${queueId} is unknown`);
  if (target.state !== "queued" && target.state !== "awaiting_confirmation") {
    throw new FollowUpQueueTransitionError("invalid_state", `Queue identity ${queueId} cannot be removed from ${target.state}`);
  }
  let drafts: readonly FollowUpDraft[] = current.drafts.map((draft): FollowUpDraft => draft.queueId === queueId
    ? { ...draft, state: "removed", removedAt: occurredAt, updatedAt: occurredAt }
    : draft);
  if (target.state === "awaiting_confirmation" && current.turnState === "settled") {
    drafts = promoteHead(drafts, occurredAt);
  }
  return next(current, occurredAt, drafts);
}

export function settleFollowUpTurn(
  current: FollowUpQueueProjection,
  occurredAt: number,
): FollowUpQueueProjection {
  if (current.turnState === "dispatching") {
    throw new FollowUpQueueTransitionError("invalid_state", "A dispatching turn cannot settle twice");
  }
  return next({ ...current, turnState: "settled" }, occurredAt, promoteHead(current.drafts, occurredAt));
}

export function confirmFollowUpHead(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
): FollowUpQueueProjection {
  const head = awaitingConfirmationHead(current);
  if (head === null || head.queueId !== queueId) {
    throw new FollowUpQueueTransitionError("stale_head", "The expected queue head is no longer awaiting confirmation");
  }
  if (current.turnState !== "settled") {
    throw new FollowUpQueueTransitionError("turn_active", "The active prompt turn has not settled");
  }
  return next({ ...current, turnState: "dispatching" }, occurredAt, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? { ...draft, state: "confirmed", confirmedAt: occurredAt, updatedAt: occurredAt }
      : draft
  )));
}

export function markFollowUpDispatched(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
): FollowUpQueueProjection {
  const target = current.drafts.find((draft) => draft.queueId === queueId);
  if (current.turnState !== "dispatching" || target?.state !== "confirmed") {
    throw new FollowUpQueueTransitionError("invalid_state", "Only the committed confirmed head can be dispatched");
  }
  const dispatched = current.drafts.map((draft): FollowUpDraft => draft.queueId === queueId
    ? { ...draft, state: "dispatched", dispatchedAt: occurredAt, updatedAt: occurredAt }
    : draft);
  return next({ ...current, turnState: "settled" }, occurredAt, promoteHead(dispatched, occurredAt));
}

export function awaitingConfirmationHead(current: FollowUpQueueProjection): FollowUpDraft | null {
  return activeDrafts(current).find((draft) => draft.state === "awaiting_confirmation") ?? null;
}

export function validateFollowUpQueueProjection(input: unknown): FollowUpQueueProjection {
  const value = record(input, "follow-up queue projection");
  exactKeys(value, [
    "schemaVersion", "boardId", "cardId", "attemptId", "generation", "version", "turnState", "drafts", "updatedAt",
  ]);
  if (value.schemaVersion !== 1) throw new Error("follow-up queue schemaVersion must be 1");
  const turnState = nonEmpty(value.turnState, "follow-up turnState") as FollowUpTurnState;
  if (!TURN_STATES.includes(turnState)) throw new Error("follow-up turnState is unsupported");
  if (!Array.isArray(value.drafts) || value.drafts.length === 0) throw new Error("follow-up drafts must be non-empty");
  const drafts = value.drafts.map(validateDraft);
  if (new Set(drafts.map((draft) => draft.queueId)).size !== drafts.length) {
    throw new Error("follow-up queue identities must be unique");
  }
  const active = drafts.filter((draft) => draft.state === "queued" || draft.state === "awaiting_confirmation" || draft.state === "confirmed");
  const awaiting = active.filter((draft) => draft.state === "awaiting_confirmation");
  const confirmed = active.filter((draft) => draft.state === "confirmed");
  if (awaiting.length > 1 || confirmed.length > 1 || (awaiting.length > 0 && confirmed.length > 0)) {
    throw new Error("follow-up queue permits only one actionable head");
  }
  if (awaiting[0] !== undefined && active[0]?.queueId !== awaiting[0].queueId) {
    throw new Error("only the FIFO head may await confirmation");
  }
  if (confirmed[0] !== undefined && (active[0]?.queueId !== confirmed[0].queueId || turnState !== "dispatching")) {
    throw new Error("only the FIFO head may be confirmed while dispatching");
  }
  if (turnState === "settled" && active.length > 0 && awaiting.length !== 1) {
    throw new Error("a settled queue must expose exactly one FIFO head");
  }
  if (turnState === "active" && (awaiting.length > 0 || confirmed.length > 0)) {
    throw new Error("an active turn may contain only queued drafts");
  }
  return Object.freeze({
    schemaVersion: 1,
    boardId: nonEmpty(value.boardId, "follow-up boardId") as BoardId,
    cardId: nonEmpty(value.cardId, "follow-up cardId") as CardId,
    attemptId: nonEmpty(value.attemptId, "follow-up attemptId") as AttemptId,
    generation: integer(value.generation, "follow-up generation") as AttemptGeneration,
    version: positiveInteger(value.version, "follow-up version"),
    turnState,
    drafts: Object.freeze(drafts),
    updatedAt: integer(value.updatedAt, "follow-up updatedAt"),
  });
}

export type FollowUpQueueTransitionReason =
  | "duplicate_queue_id"
  | "queue_not_found"
  | "stale_head"
  | "turn_active"
  | "invalid_state";

export class FollowUpQueueTransitionError extends Error {
  constructor(readonly reason: FollowUpQueueTransitionReason, message: string) {
    super(message);
    this.name = "FollowUpQueueTransitionError";
  }
}

function createDraft(queueId: FollowUpQueueId, text: string, awaiting: boolean, occurredAt: number): FollowUpDraft {
  if (queueId.trim().length === 0) throw new FollowUpQueueTransitionError("queue_not_found", "Queue identity is invalid");
  if (text.trim().length === 0) throw new FollowUpQueueTransitionError("invalid_state", "Follow-up text must be non-empty");
  return {
    queueId,
    text,
    state: awaiting ? "awaiting_confirmation" : "queued",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    confirmedAt: null,
    dispatchedAt: null,
    removedAt: null,
  };
}

function activeDrafts(current: FollowUpQueueProjection): readonly FollowUpDraft[] {
  return current.drafts.filter((draft) => draft.state === "queued" || draft.state === "awaiting_confirmation" || draft.state === "confirmed");
}

function promoteHead(drafts: readonly FollowUpDraft[], occurredAt: number): readonly FollowUpDraft[] {
  const first = drafts.find((draft) => draft.state === "queued");
  if (first === undefined) return drafts;
  return drafts.map((draft): FollowUpDraft => draft.queueId === first.queueId
    ? { ...draft, state: "awaiting_confirmation", updatedAt: occurredAt }
    : draft);
}

function next(
  current: FollowUpQueueProjection,
  occurredAt: number,
  drafts: readonly FollowUpDraft[],
): FollowUpQueueProjection {
  return validateFollowUpQueueProjection({
    ...current,
    version: current.version + 1,
    drafts,
    updatedAt: Math.max(current.updatedAt, occurredAt),
  });
}

function validateDraft(input: unknown): FollowUpDraft {
  const value = record(input, "follow-up draft");
  exactKeys(value, [
    "queueId", "text", "state", "createdAt", "updatedAt", "confirmedAt", "dispatchedAt", "removedAt",
  ]);
  const state = nonEmpty(value.state, "follow-up draft state") as FollowUpDraftState;
  if (!DRAFT_STATES.includes(state)) throw new Error("follow-up draft state is unsupported");
  const createdAt = integer(value.createdAt, "follow-up createdAt");
  const updatedAt = integer(value.updatedAt, "follow-up updatedAt");
  const confirmedAt = nullableInteger(value.confirmedAt, "follow-up confirmedAt");
  const dispatchedAt = nullableInteger(value.dispatchedAt, "follow-up dispatchedAt");
  const removedAt = nullableInteger(value.removedAt, "follow-up removedAt");
  if (updatedAt < createdAt) throw new Error("follow-up updatedAt precedes creation");
  if ((state === "confirmed" || state === "dispatched") !== (confirmedAt !== null)) {
    throw new Error("follow-up confirmation evidence is inconsistent");
  }
  if ((state === "dispatched") !== (dispatchedAt !== null)) throw new Error("follow-up dispatch evidence is inconsistent");
  if ((state === "removed") !== (removedAt !== null)) throw new Error("follow-up removal evidence is inconsistent");
  return Object.freeze({
    queueId: nonEmpty(value.queueId, "follow-up queueId") as FollowUpQueueId,
    text: typeof value.text === "string" && value.text.trim().length > 0 ? value.text : (() => { throw new Error("follow-up text is invalid"); })(),
    state,
    createdAt,
    updatedAt,
    confirmedAt,
    dispatchedAt,
    removedAt,
  });
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("follow-up projection contains missing or unsupported fields");
  }
}

function nonEmpty(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) throw new Error(`${label} is invalid`);
  return input;
}

function integer(input: unknown, label: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) throw new Error(`${label} is invalid`);
  return input as number;
}

function positiveInteger(input: unknown, label: string): number {
  const value = integer(input, label);
  if (value === 0) throw new Error(`${label} must be positive`);
  return value;
}

function nullableInteger(input: unknown, label: string): number | null {
  return input === null ? null : integer(input, label);
}
