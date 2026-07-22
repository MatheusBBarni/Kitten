import type {
  ActivityEventId,
  ActivitySequence,
  AttemptGeneration,
  AttemptId,
  DirectAcpAttemptState,
  DirectAcpTerminalState,
  NormalizedAttemptEvent,
  NormalizedPlanEntry,
  NormalizedToolUpdate,
  ProfileId,
} from "@kitten/engine";
import { isDirectAcpTerminalState, validateNormalizedAttemptActivity } from "@kitten/engine";
import type { BoardId, CardId, StageId } from "../workflow/workflowTypes.ts";
import { deepFreeze, type RunContext } from "./contracts.ts";

export interface InspectorRunContextEvidence {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly capturedAt: number;
  readonly card: {
    readonly cardId: CardId;
    readonly title: string;
    readonly description: string;
    readonly version: number;
  };
  readonly stage: { readonly stageId: StageId; readonly label: string };
  readonly workflow: { readonly boardId: BoardId; readonly version: number };
  readonly skill: {
    readonly snapshotId: string;
    readonly skillId: string;
    readonly digest: string;
    readonly name: string;
  };
  readonly profile: {
    readonly profileId: ProfileId;
    readonly provider: string;
    readonly model: string;
    readonly effort: string;
    readonly protocolVersion: number;
    readonly recipeId: string;
    readonly adapterVersion: string;
  };
  readonly repository: { readonly verified: true; readonly checkedAt: number };
  readonly executionBindingId: string;
}

export interface InspectorEntryEvidence {
  readonly eventIds: readonly ActivityEventId[];
  readonly firstSequence: ActivitySequence;
  readonly lastSequence: ActivitySequence;
  readonly firstOccurredAt: number;
  readonly lastOccurredAt: number;
}

export type InspectorTranscriptEntry =
  | {
      readonly kind: "agent";
      readonly messageId: string;
      readonly text: string;
      readonly evidence: InspectorEntryEvidence;
    }
  | {
      readonly kind: "user";
      readonly messageId: string;
      readonly text: string;
      readonly evidence: InspectorEntryEvidence;
    }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly call: NormalizedToolUpdate;
      readonly evidence: InspectorEntryEvidence;
    }
  | {
      readonly kind: "activity";
      readonly activity:
        | { readonly kind: "plan"; readonly entries: readonly NormalizedPlanEntry[] }
        | { readonly kind: "usage"; readonly used: number; readonly size: number }
        | { readonly kind: "attempt_state"; readonly state: Exclude<DirectAcpAttemptState, DirectAcpTerminalState> };
      readonly evidence: InspectorEntryEvidence;
    }
  | {
      readonly kind: "terminal";
      readonly outcome: DirectAcpTerminalState;
      readonly evidence: InspectorEntryEvidence;
    };

export interface AttemptInspectorProjection {
  readonly schemaVersion: 1;
  readonly attemptId: AttemptId;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly generation: AttemptGeneration;
  readonly context: InspectorRunContextEvidence;
  readonly entries: readonly InspectorTranscriptEntry[];
  readonly terminalOutcome: DirectAcpTerminalState | null;
  readonly nextSequence: ActivitySequence;
  readonly updatedAt: number;
}

export interface CardInspectorProjection {
  readonly schemaVersion: 1;
  readonly cardId: CardId;
  readonly revision: number;
  readonly attempts: readonly AttemptInspectorProjection[];
}

function evidence(event: NormalizedAttemptEvent): InspectorEntryEvidence {
  return {
    eventIds: [event.eventId],
    firstSequence: event.sequence,
    lastSequence: event.sequence,
    firstOccurredAt: event.occurredAt,
    lastOccurredAt: event.occurredAt,
  };
}

function coalescedEvidence(
  current: InspectorEntryEvidence,
  event: NormalizedAttemptEvent,
): InspectorEntryEvidence {
  return {
    ...current,
    eventIds: [...current.eventIds, event.eventId],
    lastSequence: event.sequence,
    lastOccurredAt: event.occurredAt,
  };
}

function contextEvidence(context: RunContext): InspectorRunContextEvidence {
  return {
    attemptId: context.attemptId,
    generation: context.generation,
    capturedAt: context.capturedAt,
    card: { ...context.card },
    stage: { ...context.stage },
    workflow: { ...context.workflow },
    skill: {
      snapshotId: context.skill.snapshotId,
      skillId: context.skill.skillId,
      digest: context.skill.digest,
      name: context.skill.metadata.name,
    },
    profile: {
      profileId: context.profile.profileId,
      provider: context.profile.provider,
      model: context.profile.model,
      effort: context.profile.effort,
      protocolVersion: context.profile.protocolVersion,
      recipeId: context.profile.recipeId,
      adapterVersion: context.profile.adapterVersion,
    },
    repository: { verified: true, checkedAt: context.repository.checkedAt },
    executionBindingId: context.worktree.bindingId,
  };
}

export function createAttemptInspectorProjection(context: RunContext): AttemptInspectorProjection {
  return deepFreeze({
    schemaVersion: 1,
    attemptId: context.attemptId,
    boardId: context.workflow.boardId,
    cardId: context.card.cardId,
    generation: context.generation,
    context: contextEvidence(context),
    entries: [],
    terminalOutcome: null,
    nextSequence: 2 as ActivitySequence,
    updatedAt: context.capturedAt,
  });
}

function mergedToolCall(current: NormalizedToolUpdate, update: NormalizedToolUpdate): NormalizedToolUpdate {
  return {
    ...current,
    ...update,
    toolCallId: current.toolCallId,
  };
}

/** Pure projection step; coalescing is limited to adjacent chunks so chronology stays explicit. */
export function projectAttemptActivity(
  current: AttemptInspectorProjection,
  event: NormalizedAttemptEvent,
): AttemptInspectorProjection {
  if (
    event.attemptId !== current.attemptId
    || event.generation !== current.generation
    || event.sequence !== current.nextSequence
  ) {
    throw new Error("Activity identity or sequence does not match the inspector projection");
  }
  if (current.terminalOutcome !== null) throw new Error("Terminal inspector projections are immutable");

  const entries = [...current.entries];
  const last = entries.at(-1);
  const activity = event.activity;
  let terminalOutcome: DirectAcpTerminalState | null = null;
  if (activity.kind === "agent_message") {
    if (last?.kind === "agent" && last.messageId === activity.messageId) {
      entries[entries.length - 1] = {
        ...last,
        text: `${last.text}${activity.textDelta}`,
        evidence: coalescedEvidence(last.evidence, event),
      };
    } else {
      entries.push({
        kind: "agent",
        messageId: activity.messageId,
        text: activity.textDelta,
        evidence: evidence(event),
      });
    }
  } else if (activity.kind === "user_message") {
    entries.push({
      kind: "user",
      messageId: activity.messageId,
      text: activity.text,
      evidence: evidence(event),
    });
  } else if (activity.kind === "tool_call") {
    if (last?.kind === "tool" && last.toolCallId === activity.call.toolCallId) {
      entries[entries.length - 1] = {
        ...last,
        call: mergedToolCall(last.call, activity.call),
        evidence: coalescedEvidence(last.evidence, event),
      };
    } else {
      entries.push({
        kind: "tool",
        toolCallId: activity.call.toolCallId,
        call: activity.call,
        evidence: evidence(event),
      });
    }
  } else if (activity.kind === "attempt_state" && isDirectAcpTerminalState(activity.state)) {
    terminalOutcome = activity.state;
    entries.push({ kind: "terminal", outcome: activity.state, evidence: evidence(event) });
  } else {
    entries.push({ kind: "activity", activity, evidence: evidence(event) } as InspectorTranscriptEntry);
  }

  return deepFreeze({
    ...current,
    entries,
    terminalOutcome,
    nextSequence: (Number(event.sequence) + 1) as ActivitySequence,
    updatedAt: Math.max(current.updatedAt, event.occurredAt),
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
  return value as number;
}

function parseEvidence(input: unknown): InspectorEntryEvidence {
  const value = record(input, "inspector evidence");
  if (!Array.isArray(value.eventIds) || value.eventIds.length === 0) throw new Error("inspector evidence eventIds are invalid");
  const firstSequence = integer(value.firstSequence, "inspector firstSequence") as ActivitySequence;
  const lastSequence = integer(value.lastSequence, "inspector lastSequence") as ActivitySequence;
  if (lastSequence < firstSequence || value.eventIds.length !== lastSequence - firstSequence + 1) {
    throw new Error("inspector evidence sequence range is inconsistent");
  }
  return {
    eventIds: value.eventIds.map((entry) => string(entry, "inspector eventId") as ActivityEventId),
    firstSequence,
    lastSequence,
    firstOccurredAt: integer(value.firstOccurredAt, "inspector firstOccurredAt"),
    lastOccurredAt: integer(value.lastOccurredAt, "inspector lastOccurredAt"),
  };
}

function parseEntry(input: unknown): InspectorTranscriptEntry {
  const value = record(input, "inspector entry");
  const kind = string(value.kind, "inspector entry kind");
  const entryEvidence = parseEvidence(value.evidence);
  if (kind === "agent" || kind === "user") {
    return {
      kind,
      messageId: string(value.messageId, "inspector messageId"),
      text: typeof value.text === "string" ? value.text : (() => { throw new Error("inspector text is invalid"); })(),
      evidence: entryEvidence,
    };
  }
  if (kind === "tool") {
    const activity = validateNormalizedAttemptActivity({ kind: "tool_call", call: value.call });
    if (activity.kind !== "tool_call") throw new Error("inspector tool is invalid");
    const toolCallId = string(value.toolCallId, "inspector toolCallId");
    if (toolCallId !== activity.call.toolCallId) throw new Error("inspector tool identity is inconsistent");
    return { kind, toolCallId, call: activity.call, evidence: entryEvidence };
  }
  if (kind === "terminal") {
    const outcome = string(value.outcome, "inspector terminal outcome") as DirectAcpTerminalState;
    if (!isDirectAcpTerminalState(outcome)) throw new Error("inspector terminal outcome is invalid");
    return { kind, outcome, evidence: entryEvidence };
  }
  if (kind === "activity") {
    const activity = validateNormalizedAttemptActivity(value.activity);
    if (activity.kind === "agent_message" || activity.kind === "user_message" || activity.kind === "tool_call") {
      throw new Error("inspector generic activity kind is invalid");
    }
    if (activity.kind === "attempt_state" && isDirectAcpTerminalState(activity.state)) {
      throw new Error("terminal activity requires a terminal inspector entry");
    }
    return { kind, activity, evidence: entryEvidence } as InspectorTranscriptEntry;
  }
  throw new Error("inspector entry kind is unsupported");
}

/** Validates persisted JSON before it is returned through the host boundary. */
export function validateAttemptInspectorProjection(input: unknown): AttemptInspectorProjection {
  const value = record(input, "inspector projection");
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("inspector projection schema is invalid");
  const attemptId = string(value.attemptId, "inspector attemptId") as AttemptId;
  const boardId = string(value.boardId, "inspector boardId") as BoardId;
  const cardId = string(value.cardId, "inspector cardId") as CardId;
  const generation = integer(value.generation, "inspector generation") as AttemptGeneration;
  const context = record(value.context, "inspector context") as unknown as InspectorRunContextEvidence;
  if (context.attemptId !== attemptId || context.generation !== generation || context.card?.cardId !== cardId || context.workflow?.boardId !== boardId) {
    throw new Error("inspector context identity is inconsistent");
  }
  const entries = value.entries.map(parseEntry);
  const terminalEntries = entries.filter((entry) => entry.kind === "terminal");
  const terminalOutcome = value.terminalOutcome === null
    ? null
    : string(value.terminalOutcome, "inspector terminalOutcome") as DirectAcpTerminalState;
  if (terminalOutcome !== null && !isDirectAcpTerminalState(terminalOutcome)) throw new Error("inspector terminalOutcome is invalid");
  if (
    terminalEntries.length !== (terminalOutcome === null ? 0 : 1)
    || (terminalOutcome !== null && terminalEntries[0]?.outcome !== terminalOutcome)
  ) {
    throw new Error("inspector terminal evidence is inconsistent");
  }
  const flattenedEventIds = entries.flatMap((entry) => entry.evidence.eventIds);
  if (new Set(flattenedEventIds).size !== flattenedEventIds.length) throw new Error("inspector event evidence is duplicated");
  return deepFreeze({
    schemaVersion: 1,
    attemptId,
    boardId,
    cardId,
    generation,
    context,
    entries,
    terminalOutcome,
    nextSequence: integer(value.nextSequence, "inspector nextSequence") as ActivitySequence,
    updatedAt: integer(value.updatedAt, "inspector updatedAt"),
  });
}
