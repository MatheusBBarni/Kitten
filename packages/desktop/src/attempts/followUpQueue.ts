import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export type FollowUpQueueId = string & { readonly __brand: "FollowUpQueueId" };
export type FollowUpDraftState =
  | "queued"
  | "dispatching"
  | "dispatched"
  | "removed"
  | "interrupted";

export interface FollowUpDraft {
  readonly queueId: FollowUpQueueId;
  readonly text: string;
  readonly state: FollowUpDraftState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly dispatchingAt: number | null;
  readonly dispatchedAt: number | null;
  readonly removedAt: number | null;
  readonly interruptedAt: number | null;
}

export interface FollowUpQueueProjection {
  readonly schemaVersion: 2;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly version: number;
  readonly drafts: readonly FollowUpDraft[];
  readonly updatedAt: number;
}

export interface FollowUpQueueFence {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly expectedVersion: number;
}

export type FollowUpQueueOperation =
  | "enqueued"
  | "dispatching"
  | "dispatched"
  | "removed"
  | "interrupted"
  | "retried";

const DRAFT_STATES: readonly FollowUpDraftState[] = [
  "queued",
  "dispatching",
  "dispatched",
  "removed",
  "interrupted",
];
const LEGACY_DRAFT_STATES = [
  "queued",
  "awaiting_confirmation",
  "confirmed",
  "dispatched",
  "removed",
] as const;
const LEGACY_TURN_STATES = ["active", "settled", "dispatching"] as const;

export function createFollowUpQueue(input: {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly queueId: FollowUpQueueId;
  readonly text: string;
  readonly occurredAt: number;
}): FollowUpQueueProjection {
  return validateFollowUpQueueProjection({
    schemaVersion: 2,
    boardId: input.boardId,
    cardId: input.cardId,
    attemptId: input.attemptId,
    generation: input.generation,
    version: 1,
    drafts: [createDraft(input.queueId, input.text, input.occurredAt)],
    updatedAt: input.occurredAt,
  });
}

export function enqueueFollowUp(
  current: FollowUpQueueProjection,
  input: { readonly queueId: FollowUpQueueId; readonly text: string; readonly occurredAt: number },
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  if (current.drafts.some((draft) => draft.queueId === input.queueId)) {
    throw new FollowUpQueueTransitionError(
      "duplicate_queue_id",
      `Queue identity ${input.queueId} already exists`,
    );
  }
  return next(current, input.occurredAt, [
    ...current.drafts,
    createDraft(input.queueId, input.text, input.occurredAt),
  ]);
}

export function removeFollowUp(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  const target = current.drafts.find((draft) => draft.queueId === queueId);
  if (target === undefined) {
    throw new FollowUpQueueTransitionError("queue_not_found", `Queue identity ${queueId} is unknown`);
  }
  if (target.state !== "queued" && target.state !== "interrupted") {
    throw new FollowUpQueueTransitionError(
      "invalid_state",
      `Queue identity ${queueId} cannot be removed from ${target.state}`,
    );
  }
  const timestamp = transitionTimestamp(current, occurredAt);
  return next(current, timestamp, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? { ...draft, state: "removed", removedAt: timestamp, updatedAt: timestamp }
      : draft
  )));
}

export function markFollowUpDispatching(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  const head = unresolvedFollowUpHead(current);
  if (head === null || head.queueId !== queueId || head.state !== "queued") {
    throw new FollowUpQueueTransitionError(
      "stale_head",
      "Only the queued FIFO head may enter dispatching",
    );
  }
  const timestamp = transitionTimestamp(current, occurredAt);
  return next(current, timestamp, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? { ...draft, state: "dispatching", dispatchingAt: timestamp, updatedAt: timestamp }
      : draft
  )));
}

export function markFollowUpDispatched(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  const head = unresolvedFollowUpHead(current);
  if (head?.queueId !== queueId || head.state !== "dispatching") {
    throw new FollowUpQueueTransitionError(
      "stale_head",
      "Only the dispatching FIFO head may be marked dispatched",
    );
  }
  const timestamp = transitionTimestamp(current, occurredAt);
  return next(current, timestamp, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? { ...draft, state: "dispatched", dispatchedAt: timestamp, updatedAt: timestamp }
      : draft
  )));
}

export function interruptFollowUpDispatch(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  const head = unresolvedFollowUpHead(current);
  if (head?.queueId !== queueId || head.state !== "dispatching") {
    throw new FollowUpQueueTransitionError(
      "stale_head",
      "Only the dispatching FIFO head may be interrupted",
    );
  }
  const timestamp = transitionTimestamp(current, occurredAt);
  return next(current, timestamp, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? { ...draft, state: "interrupted", interruptedAt: timestamp, updatedAt: timestamp }
      : draft
  )));
}

export function retryInterruptedFollowUp(
  current: FollowUpQueueProjection,
  queueId: FollowUpQueueId,
  occurredAt: number,
  fence: FollowUpQueueFence,
): FollowUpQueueProjection {
  assertFollowUpQueueFence(current, fence);
  const head = unresolvedFollowUpHead(current);
  if (head?.queueId !== queueId || head.state !== "interrupted") {
    throw new FollowUpQueueTransitionError(
      "stale_head",
      "Only the interrupted FIFO head may be explicitly retried",
    );
  }
  const timestamp = transitionTimestamp(current, occurredAt);
  return next(current, timestamp, current.drafts.map((draft): FollowUpDraft => (
    draft.queueId === queueId
      ? {
          ...draft,
          state: "queued",
          dispatchingAt: null,
          interruptedAt: null,
          updatedAt: timestamp,
        }
      : draft
  )));
}

export function queuedFollowUpHead(current: FollowUpQueueProjection): FollowUpDraft | null {
  const head = unresolvedFollowUpHead(current);
  return head?.state === "queued" ? head : null;
}

export function unresolvedFollowUpHead(current: FollowUpQueueProjection): FollowUpDraft | null {
  return current.drafts.find((draft) => (
    draft.state === "queued"
    || draft.state === "dispatching"
    || draft.state === "interrupted"
  )) ?? null;
}

export function followUpQueueFence(current: FollowUpQueueProjection): FollowUpQueueFence {
  return {
    attemptId: current.attemptId,
    generation: current.generation,
    expectedVersion: current.version,
  };
}

export function assertFollowUpQueueFence(
  current: FollowUpQueueProjection,
  fence: FollowUpQueueFence,
): void {
  if (fence.attemptId !== current.attemptId) {
    throw new FollowUpQueueTransitionError("stale_attempt", "Follow-up attempt identity is stale");
  }
  if (fence.generation !== current.generation) {
    throw new FollowUpQueueTransitionError("stale_generation", "Follow-up attempt generation is stale");
  }
  if (fence.expectedVersion !== current.version) {
    throw new FollowUpQueueTransitionError("stale_version", "Follow-up queue version is stale");
  }
}

export function validateFollowUpQueueProjection(input: unknown): FollowUpQueueProjection {
  const value = record(input, "follow-up queue projection");
  if (value.schemaVersion === 1) return migrateLegacyFollowUpQueueProjection(value);
  if (value.schemaVersion !== 2) throw new Error("follow-up queue schemaVersion must be 1 or 2");
  exactKeys(value, [
    "schemaVersion",
    "boardId",
    "cardId",
    "attemptId",
    "generation",
    "version",
    "drafts",
    "updatedAt",
  ]);
  if (!Array.isArray(value.drafts) || value.drafts.length === 0) {
    throw new Error("follow-up drafts must be non-empty");
  }
  const drafts = value.drafts.map(validateDraft);
  validateDraftOrder(drafts);
  const updatedAt = integer(value.updatedAt, "follow-up updatedAt");
  if (drafts.some((draft) => draft.updatedAt > updatedAt)) {
    throw new Error("follow-up queue updatedAt precedes a draft update");
  }
  return Object.freeze({
    schemaVersion: 2,
    boardId: nonEmpty(value.boardId, "follow-up boardId") as BoardId,
    cardId: nonEmpty(value.cardId, "follow-up cardId") as CardId,
    attemptId: nonEmpty(value.attemptId, "follow-up attemptId") as AttemptId,
    generation: integer(value.generation, "follow-up generation") as AttemptGeneration,
    version: positiveInteger(value.version, "follow-up version"),
    drafts: Object.freeze(drafts),
    updatedAt,
  });
}

export function parseFollowUpQueueProjection(serialized: string): FollowUpQueueProjection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("follow-up queue serialization is invalid JSON");
  }
  return validateFollowUpQueueProjection(parsed);
}

export function serializeFollowUpQueueProjection(projection: FollowUpQueueProjection): string {
  return JSON.stringify(validateFollowUpQueueProjection(projection));
}

export type FollowUpQueueTransitionReason =
  | "duplicate_queue_id"
  | "queue_not_found"
  | "stale_attempt"
  | "stale_generation"
  | "stale_version"
  | "stale_head"
  | "invalid_state";

export class FollowUpQueueTransitionError extends Error {
  constructor(readonly reason: FollowUpQueueTransitionReason, message: string) {
    super(message);
    this.name = "FollowUpQueueTransitionError";
  }
}

function createDraft(queueId: FollowUpQueueId, text: string, occurredAt: number): FollowUpDraft {
  if (queueId.trim().length === 0) {
    throw new FollowUpQueueTransitionError("queue_not_found", "Queue identity is invalid");
  }
  if (text.trim().length === 0) {
    throw new FollowUpQueueTransitionError("invalid_state", "Follow-up text must be non-empty");
  }
  const timestamp = integer(occurredAt, "follow-up occurredAt");
  return Object.freeze({
    queueId,
    text,
    state: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    dispatchingAt: null,
    dispatchedAt: null,
    removedAt: null,
    interruptedAt: null,
  });
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
    updatedAt: transitionTimestamp(current, occurredAt),
  });
}

function transitionTimestamp(current: FollowUpQueueProjection, occurredAt: number): number {
  return Math.max(current.updatedAt, integer(occurredAt, "follow-up occurredAt"));
}

function validateDraft(input: unknown): FollowUpDraft {
  const value = record(input, "follow-up draft");
  exactKeys(value, [
    "queueId",
    "text",
    "state",
    "createdAt",
    "updatedAt",
    "dispatchingAt",
    "dispatchedAt",
    "removedAt",
    "interruptedAt",
  ]);
  const state = nonEmpty(value.state, "follow-up draft state") as FollowUpDraftState;
  if (!DRAFT_STATES.includes(state)) throw new Error("follow-up draft state is unsupported");
  const createdAt = integer(value.createdAt, "follow-up createdAt");
  const updatedAt = integer(value.updatedAt, "follow-up updatedAt");
  const dispatchingAt = nullableInteger(value.dispatchingAt, "follow-up dispatchingAt");
  const dispatchedAt = nullableInteger(value.dispatchedAt, "follow-up dispatchedAt");
  const removedAt = nullableInteger(value.removedAt, "follow-up removedAt");
  const interruptedAt = nullableInteger(value.interruptedAt, "follow-up interruptedAt");
  if (updatedAt < createdAt) throw new Error("follow-up updatedAt precedes creation");
  if ((state === "dispatching" || state === "dispatched" || state === "interrupted") && dispatchingAt === null) {
    throw new Error("follow-up dispatching evidence is missing");
  }
  if (state === "queued" && [dispatchingAt, dispatchedAt, removedAt, interruptedAt].some((value) => value !== null)) {
    throw new Error("queued follow-up contains terminal or dispatch evidence");
  }
  if ((state === "dispatched") !== (dispatchedAt !== null)) {
    throw new Error("follow-up dispatched evidence is inconsistent");
  }
  if ((state === "removed") !== (removedAt !== null)) {
    throw new Error("follow-up removal evidence is inconsistent");
  }
  if (state === "interrupted" && interruptedAt === null) {
    throw new Error("follow-up interruption evidence is inconsistent");
  }
  if (state !== "interrupted" && state !== "removed" && interruptedAt !== null) {
    throw new Error("follow-up interruption evidence is inconsistent");
  }
  for (const timestamp of [dispatchingAt, dispatchedAt, removedAt, interruptedAt]) {
    if (timestamp !== null && (timestamp < createdAt || timestamp > updatedAt)) {
      throw new Error("follow-up transition timestamp is outside the draft lifetime");
    }
  }
  return Object.freeze({
    queueId: nonEmpty(value.queueId, "follow-up queueId") as FollowUpQueueId,
    text: typeof value.text === "string" && value.text.trim().length > 0
      ? value.text
      : (() => { throw new Error("follow-up text is invalid"); })(),
    state,
    createdAt,
    updatedAt,
    dispatchingAt,
    dispatchedAt,
    removedAt,
    interruptedAt,
  });
}

function validateDraftOrder(drafts: readonly FollowUpDraft[]): void {
  if (new Set(drafts.map((draft) => draft.queueId)).size !== drafts.length) {
    throw new Error("follow-up queue identities must be unique");
  }
  for (let index = 1; index < drafts.length; index += 1) {
    const previous = drafts[index - 1]!;
    const current = drafts[index]!;
    if (current.createdAt < previous.createdAt) {
      throw new Error("follow-up durable order must be chronological");
    }
  }
  const unresolved = drafts.filter((draft) => (
    draft.state === "queued"
    || draft.state === "dispatching"
    || draft.state === "interrupted"
  ));
  const dispatching = unresolved.filter((draft) => draft.state === "dispatching");
  const interrupted = unresolved.filter((draft) => draft.state === "interrupted");
  if (dispatching.length > 1 || interrupted.length > 1) {
    throw new Error("follow-up queue permits only one uncertain FIFO head");
  }
  if (dispatching[0] !== undefined && unresolved[0]?.queueId !== dispatching[0].queueId) {
    throw new Error("only the FIFO head may be dispatching");
  }
  if (interrupted[0] !== undefined && unresolved[0]?.queueId !== interrupted[0].queueId) {
    throw new Error("only the FIFO head may be interrupted");
  }
}

function migrateLegacyFollowUpQueueProjection(value: Record<string, unknown>): FollowUpQueueProjection {
  exactKeys(value, [
    "schemaVersion",
    "boardId",
    "cardId",
    "attemptId",
    "generation",
    "version",
    "turnState",
    "drafts",
    "updatedAt",
  ]);
  const turnState = nonEmpty(value.turnState, "legacy follow-up turnState");
  if (!(LEGACY_TURN_STATES as readonly string[]).includes(turnState)) {
    throw new Error("legacy follow-up turnState is unsupported");
  }
  if (!Array.isArray(value.drafts) || value.drafts.length === 0) {
    throw new Error("legacy follow-up drafts must be non-empty");
  }
  const drafts = value.drafts.map(migrateLegacyDraft);
  const ambiguous = drafts.filter((draft) => draft.state === "interrupted");
  if (turnState === "dispatching" && ambiguous.length !== 1) {
    throw new Error("legacy dispatching queue must contain one ambiguous head");
  }
  return validateFollowUpQueueProjection({
    schemaVersion: 2,
    boardId: value.boardId,
    cardId: value.cardId,
    attemptId: value.attemptId,
    generation: value.generation,
    version: value.version,
    drafts,
    updatedAt: value.updatedAt,
  });
}

function migrateLegacyDraft(input: unknown): FollowUpDraft {
  const value = record(input, "legacy follow-up draft");
  exactKeys(value, [
    "queueId",
    "text",
    "state",
    "createdAt",
    "updatedAt",
    "confirmedAt",
    "dispatchedAt",
    "removedAt",
  ]);
  const legacyState = nonEmpty(value.state, "legacy follow-up draft state");
  if (!(LEGACY_DRAFT_STATES as readonly string[]).includes(legacyState)) {
    throw new Error("legacy follow-up draft state is unsupported");
  }
  const createdAt = integer(value.createdAt, "legacy follow-up createdAt");
  const updatedAt = integer(value.updatedAt, "legacy follow-up updatedAt");
  const confirmedAt = nullableInteger(value.confirmedAt, "legacy follow-up confirmedAt");
  const dispatchedAt = nullableInteger(value.dispatchedAt, "legacy follow-up dispatchedAt");
  const removedAt = nullableInteger(value.removedAt, "legacy follow-up removedAt");
  const state: FollowUpDraftState = legacyState === "confirmed"
    ? "interrupted"
    : legacyState === "awaiting_confirmation"
      ? "queued"
      : legacyState as FollowUpDraftState;
  return {
    queueId: nonEmpty(value.queueId, "legacy follow-up queueId") as FollowUpQueueId,
    text: typeof value.text === "string" && value.text.trim().length > 0
      ? value.text
      : (() => { throw new Error("legacy follow-up text is invalid"); })(),
    state,
    createdAt,
    updatedAt,
    dispatchingAt: state === "dispatched" || state === "interrupted"
      ? confirmedAt ?? dispatchedAt ?? updatedAt
      : null,
    dispatchedAt: state === "dispatched" ? dispatchedAt : null,
    removedAt: state === "removed" ? removedAt : null,
    interruptedAt: state === "interrupted" ? updatedAt : null,
  };
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (
    input === null
    || typeof input !== "object"
    || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) {
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
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} is invalid`);
  }
  return input;
}

function integer(input: unknown, label: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 0) {
    throw new Error(`${label} is invalid`);
  }
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
