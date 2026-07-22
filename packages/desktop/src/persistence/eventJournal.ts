import type { Database } from "bun:sqlite";
import type {
  BoardId,
  BoardProjection,
  CardId,
  CardProjection,
  EdgeProjection,
  ExecutionStatus,
  SkillId,
  StageId,
  StageProjection,
  WorkflowCommandKind,
} from "../workflow/workflowTypes.ts";

export type {
  BoardProjection,
  CardProjection,
  EdgeProjection,
  ExecutionStatus,
  StageProjection,
} from "../workflow/workflowTypes.ts";

export type JournalActor = "agent" | "operator" | "system";
interface JournalEventBase {
  readonly eventId: string;
  readonly boardId: BoardId;
  readonly actor: JournalActor;
  readonly occurredAt: number;
  readonly attemptId?: string;
  readonly attemptSequence?: number;
}

export type JournalEvent =
  | (JournalEventBase & {
      readonly kind: "board_upserted";
      readonly payload: BoardProjection;
    })
  | (JournalEventBase & {
      readonly kind: "stage_upserted";
      readonly payload: StageProjection;
    })
  | (JournalEventBase & {
      readonly kind: "edge_upserted";
      readonly payload: EdgeProjection;
    })
  | (JournalEventBase & {
      readonly kind: "card_upserted";
      readonly cardId: CardId;
      readonly payload: CardProjection;
    })
  | (JournalEventBase & {
      readonly kind: "workflow_command_committed";
      readonly cardId?: CardId;
      readonly payload: WorkflowCommandEventPayload;
    });

export type ProjectionChange =
  | { readonly entity: "board"; readonly operation: "upsert"; readonly value: BoardProjection }
  | { readonly entity: "stage"; readonly operation: "upsert"; readonly value: StageProjection }
  | { readonly entity: "edge"; readonly operation: "upsert"; readonly value: EdgeProjection }
  | { readonly entity: "edge"; readonly operation: "delete"; readonly value: EdgeProjection }
  | { readonly entity: "card"; readonly operation: "upsert"; readonly value: CardProjection };

export interface WorkflowCommandEventPayload {
  readonly mutationId: string;
  readonly commandKind: WorkflowCommandKind;
  readonly commandFingerprint: string;
  readonly changes: readonly ProjectionChange[];
}

export interface ProjectionDelta {
  readonly eventId: string;
  readonly journalOrder: number;
  readonly revision: number;
  readonly changes: readonly ProjectionChange[];
}

export interface PersistenceSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly lastJournalOrder: number;
  readonly boards: readonly BoardProjection[];
  readonly stages: readonly StageProjection[];
  readonly edges: readonly EdgeProjection[];
  readonly cards: readonly CardProjection[];
}

export interface EventJournal {
  append(input: unknown, options?: JournalAppendOptions): ProjectionDelta;
  snapshot(): PersistenceSnapshot;
  events(): readonly JournalEvent[];
  eventById(eventId: string): JournalEvent | null;
}

export interface JournalAppendOptions {
  readonly preconditions?: readonly ProjectionVersionPrecondition[];
}

export type ProjectionVersionPrecondition =
  | { readonly entity: "board"; readonly id: BoardId; readonly expectedVersion: number }
  | { readonly entity: "card"; readonly id: CardId; readonly expectedVersion: number };

export class JournalValidationError extends Error {
  constructor(message: string) {
    super(`Invalid journal event: ${message}`);
    this.name = "JournalValidationError";
  }
}

export class DuplicateJournalEventError extends Error {
  constructor(readonly eventId: string) {
    super(`Journal event ${eventId} already exists`);
    this.name = "DuplicateJournalEventError";
  }
}

export class AttemptSequenceError extends Error {
  constructor(readonly attemptId: string, readonly received: number, readonly latest: number | null) {
    super(
      latest === null
        ? `Attempt ${attemptId} sequence ${received} is invalid`
        : `Attempt ${attemptId} sequence ${received} is not greater than ${latest}`,
    );
    this.name = "AttemptSequenceError";
  }
}

export class ProjectionVersionConflictError extends Error {
  constructor(
    readonly entity: ProjectionVersionPrecondition["entity"],
    readonly id: BoardId | CardId,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Stale ${entity} projection ${id}: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "ProjectionVersionConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new JournalValidationError(`${label} must be a plain object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new JournalValidationError(`missing ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new JournalValidationError(`unknown field ${key}`);
  }
}

function stringField(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new JournalValidationError(`${label} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function optionalStringField(value: unknown, label: string): string | null {
  return value === null ? null : stringField(value, label);
}

function integerField(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new JournalValidationError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function booleanField(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new JournalValidationError(`${label} must be a boolean`);
  return value;
}

function parseBoardProjection(value: unknown): BoardProjection {
  assertRecord(value, "payload");
  assertExactKeys(value, ["boardId", "repositoryPath", "workflowVersion", "createdAt", "updatedAt"]);
  const createdAt = integerField(value.createdAt, "payload.createdAt");
  const updatedAt = integerField(value.updatedAt, "payload.updatedAt");
  if (updatedAt < createdAt) throw new JournalValidationError("payload.updatedAt precedes createdAt");
  return {
    boardId: stringField(value.boardId, "payload.boardId") as BoardId,
    repositoryPath: stringField(value.repositoryPath, "payload.repositoryPath"),
    workflowVersion: integerField(value.workflowVersion, "payload.workflowVersion"),
    createdAt,
    updatedAt,
  };
}

function parseStageProjection(value: unknown): StageProjection {
  assertRecord(value, "payload");
  assertExactKeys(value, [
    "stageId", "boardId", "label", "position", "defaultSkillId", "configured",
    "workflowVersion", "updatedAt",
  ]);
  return {
    stageId: stringField(value.stageId, "payload.stageId") as StageId,
    boardId: stringField(value.boardId, "payload.boardId") as BoardId,
    label: stringField(value.label, "payload.label"),
    position: integerField(value.position, "payload.position"),
    defaultSkillId: optionalStringField(value.defaultSkillId, "payload.defaultSkillId") as SkillId | null,
    configured: booleanField(value.configured, "payload.configured"),
    workflowVersion: integerField(value.workflowVersion, "payload.workflowVersion"),
    updatedAt: integerField(value.updatedAt, "payload.updatedAt"),
  };
}

function parseEdgeProjection(value: unknown): EdgeProjection {
  assertRecord(value, "payload");
  assertExactKeys(value, ["boardId", "sourceStageId", "targetStageId", "workflowVersion"]);
  const sourceStageId = stringField(value.sourceStageId, "payload.sourceStageId") as StageId;
  const targetStageId = stringField(value.targetStageId, "payload.targetStageId") as StageId;
  if (sourceStageId === targetStageId) {
    throw new JournalValidationError("an edge cannot target its source stage");
  }
  return {
    boardId: stringField(value.boardId, "payload.boardId") as BoardId,
    sourceStageId,
    targetStageId,
    workflowVersion: integerField(value.workflowVersion, "payload.workflowVersion"),
  };
}

const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "idle", "running", "needs_attention", "ready_for_review", "completed", "failed", "cancelled",
];

function parseCardProjection(value: unknown): CardProjection {
  assertRecord(value, "payload");
  assertExactKeys(value, [
    "cardId", "boardId", "stageId", "title", "description", "provider", "model", "effort",
    "skillOverrideId", "runnable", "executionStatus", "version", "createdAt", "updatedAt",
  ]);
  const executionStatus = stringField(value.executionStatus, "payload.executionStatus");
  if (!EXECUTION_STATUSES.includes(executionStatus as ExecutionStatus)) {
    throw new JournalValidationError("payload.executionStatus is unsupported");
  }
  const createdAt = integerField(value.createdAt, "payload.createdAt");
  const updatedAt = integerField(value.updatedAt, "payload.updatedAt");
  if (updatedAt < createdAt) throw new JournalValidationError("payload.updatedAt precedes createdAt");
  return {
    cardId: stringField(value.cardId, "payload.cardId") as CardId,
    boardId: stringField(value.boardId, "payload.boardId") as BoardId,
    stageId: stringField(value.stageId, "payload.stageId") as StageId,
    title: stringField(value.title, "payload.title"),
    description: stringField(value.description, "payload.description", true),
    provider: stringField(value.provider, "payload.provider"),
    model: stringField(value.model, "payload.model"),
    effort: stringField(value.effort, "payload.effort"),
    skillOverrideId: optionalStringField(value.skillOverrideId, "payload.skillOverrideId") as SkillId | null,
    runnable: booleanField(value.runnable, "payload.runnable"),
    executionStatus: executionStatus as ExecutionStatus,
    version: integerField(value.version, "payload.version"),
    createdAt,
    updatedAt,
  };
}

const WORKFLOW_COMMAND_KINDS: readonly WorkflowCommandKind[] = [
  "bind_repository",
  "create_stage",
  "update_stage",
  "assign_stage_skill",
  "connect_stages",
  "reorder_stages",
  "create_card",
  "update_card",
  "set_card_execution_status",
  "move_card",
  "record_agent_success",
];

function parseProjectionChange(value: unknown): ProjectionChange {
  assertRecord(value, "payload.changes[]");
  assertExactKeys(value, ["entity", "operation", "value"]);
  const entity = stringField(value.entity, "payload.changes[].entity");
  const operation = stringField(value.operation, "payload.changes[].operation");
  switch (entity) {
    case "board":
      if (operation !== "upsert") throw new JournalValidationError("board changes must be upserts");
      return { entity, operation, value: parseBoardProjection(value.value) };
    case "stage":
      if (operation !== "upsert") throw new JournalValidationError("stage changes must be upserts");
      return { entity, operation, value: parseStageProjection(value.value) };
    case "edge":
      if (operation !== "upsert" && operation !== "delete") {
        throw new JournalValidationError("edge change operation is unsupported");
      }
      return { entity, operation, value: parseEdgeProjection(value.value) };
    case "card":
      if (operation !== "upsert") throw new JournalValidationError("card changes must be upserts");
      return { entity, operation, value: parseCardProjection(value.value) };
    default:
      throw new JournalValidationError("projection change entity is unsupported");
  }
}

function parseWorkflowCommandPayload(value: unknown): WorkflowCommandEventPayload {
  assertRecord(value, "payload");
  assertExactKeys(value, ["mutationId", "commandKind", "commandFingerprint", "changes"]);
  const commandKind = stringField(value.commandKind, "payload.commandKind");
  if (!WORKFLOW_COMMAND_KINDS.includes(commandKind as WorkflowCommandKind)) {
    throw new JournalValidationError("payload.commandKind is unsupported");
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new JournalValidationError("payload.changes must be a non-empty array");
  }
  return {
    mutationId: stringField(value.mutationId, "payload.mutationId"),
    commandKind: commandKind as WorkflowCommandKind,
    commandFingerprint: stringField(value.commandFingerprint, "payload.commandFingerprint"),
    changes: value.changes.map(parseProjectionChange),
  };
}

export function validateJournalEvent(input: unknown): JournalEvent {
  assertRecord(input, "event");
  assertExactKeys(
    input,
    ["eventId", "boardId", "actor", "kind", "occurredAt", "payload"],
    ["cardId", "attemptId", "attemptSequence"],
  );

  const eventId = stringField(input.eventId, "eventId");
  const boardId = stringField(input.boardId, "boardId") as BoardId;
  const actor = stringField(input.actor, "actor");
  if (actor !== "agent" && actor !== "operator" && actor !== "system") {
    throw new JournalValidationError("actor is unsupported");
  }
  const occurredAt = integerField(input.occurredAt, "occurredAt");
  const hasAttemptId = Object.hasOwn(input, "attemptId");
  const hasAttemptSequence = Object.hasOwn(input, "attemptSequence");
  if (hasAttemptId !== hasAttemptSequence) {
    throw new JournalValidationError("attemptId and attemptSequence must be provided together");
  }
  const attempt = hasAttemptId
    ? {
        attemptId: stringField(input.attemptId, "attemptId"),
        attemptSequence: integerField(input.attemptSequence, "attemptSequence"),
      }
    : {};

  switch (input.kind) {
    case "board_upserted": {
      const payload = parseBoardProjection(input.payload);
      if (payload.boardId !== boardId) throw new JournalValidationError("boardId does not match payload");
      if (Object.hasOwn(input, "cardId")) throw new JournalValidationError("board event cannot carry cardId");
      return { eventId, boardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "stage_upserted": {
      const payload = parseStageProjection(input.payload);
      if (payload.boardId !== boardId) throw new JournalValidationError("boardId does not match payload");
      if (Object.hasOwn(input, "cardId")) throw new JournalValidationError("stage event cannot carry cardId");
      return { eventId, boardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "edge_upserted": {
      const payload = parseEdgeProjection(input.payload);
      if (payload.boardId !== boardId) throw new JournalValidationError("boardId does not match payload");
      if (Object.hasOwn(input, "cardId")) throw new JournalValidationError("edge event cannot carry cardId");
      return { eventId, boardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "card_upserted": {
      const payload = parseCardProjection(input.payload);
      const cardId = stringField(input.cardId, "cardId") as CardId;
      if (payload.boardId !== boardId || payload.cardId !== cardId) {
        throw new JournalValidationError("event identity does not match payload");
      }
      return { eventId, boardId, cardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "workflow_command_committed": {
      const payload = parseWorkflowCommandPayload(input.payload);
      const mismatchedChange = payload.changes.find((change) => change.value.boardId !== boardId);
      if (mismatchedChange !== undefined) {
        throw new JournalValidationError("boardId does not match a workflow command change");
      }
      const cardId = Object.hasOwn(input, "cardId")
        ? stringField(input.cardId, "cardId") as CardId
        : undefined;
      if (cardId !== undefined) {
        const cardChanges = payload.changes.filter((change) => change.entity === "card");
        if (cardChanges.length === 0 || cardChanges.some((change) => change.value.cardId !== cardId)) {
          throw new JournalValidationError("cardId does not match workflow command changes");
        }
      }
      return {
        eventId,
        boardId,
        actor,
        kind: input.kind,
        occurredAt,
        payload,
        ...(cardId === undefined ? {} : { cardId }),
        ...attempt,
      };
    }
    default:
      throw new JournalValidationError("kind is unsupported");
  }
}

function assertStageBelongsToBoard(database: Database, boardId: string, stageId: string): void {
  const row = database.query<{ readonly boardId: string }, [string]>(
    "SELECT board_id AS boardId FROM workflow_stages WHERE stage_id = ?",
  ).get(stageId);
  if (row?.boardId !== boardId) {
    throw new Error(`Stage ${stageId} does not belong to board ${boardId}`);
  }
}

export function applyProjectionChange(database: Database, change: ProjectionChange): void {
  switch (change.entity) {
    case "board": {
      const value = change.value;
      database.query<void, [string, string, number, number, number]>(`
        INSERT INTO boards(board_id, repository_path, workflow_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(board_id) DO UPDATE SET
          repository_path = excluded.repository_path,
          workflow_version = excluded.workflow_version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(value.boardId, value.repositoryPath, value.workflowVersion, value.createdAt, value.updatedAt);
      return;
    }
    case "stage": {
      const value = change.value;
      database.query<void, [string, string, string, number, string | null, number, number, number]>(`
        INSERT INTO workflow_stages(
          stage_id, board_id, label, position, default_skill_id, configured, workflow_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET
          board_id = excluded.board_id,
          label = excluded.label,
          position = excluded.position,
          default_skill_id = excluded.default_skill_id,
          configured = excluded.configured,
          workflow_version = excluded.workflow_version,
          updated_at = excluded.updated_at
      `).run(
        value.stageId, value.boardId, value.label, value.position, value.defaultSkillId,
        value.configured ? 1 : 0, value.workflowVersion, value.updatedAt,
      );
      return;
    }
    case "edge": {
      const value = change.value;
      if (change.operation === "delete") {
        database.query<void, [string, string, string]>(`
          DELETE FROM workflow_edges
          WHERE board_id = ? AND source_stage_id = ? AND target_stage_id = ?
        `).run(value.boardId, value.sourceStageId, value.targetStageId);
        return;
      }
      assertStageBelongsToBoard(database, value.boardId, value.sourceStageId);
      assertStageBelongsToBoard(database, value.boardId, value.targetStageId);
      database.query<void, [string, string, string, number]>(`
        INSERT INTO workflow_edges(board_id, source_stage_id, target_stage_id, workflow_version)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(board_id, source_stage_id, target_stage_id) DO UPDATE SET
          workflow_version = excluded.workflow_version
      `).run(value.boardId, value.sourceStageId, value.targetStageId, value.workflowVersion);
      return;
    }
    case "card": {
      const value = change.value;
      assertStageBelongsToBoard(database, value.boardId, value.stageId);
      database.query<void, [
        string, string, string, string, string, string, string, string, string | null,
        number, string, number, number, number,
      ]>(`
        INSERT INTO cards(
          card_id, board_id, stage_id, title, description, provider, model, effort,
          skill_override_id, runnable, execution_status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET
          board_id = excluded.board_id,
          stage_id = excluded.stage_id,
          title = excluded.title,
          description = excluded.description,
          provider = excluded.provider,
          model = excluded.model,
          effort = excluded.effort,
          skill_override_id = excluded.skill_override_id,
          runnable = excluded.runnable,
          execution_status = excluded.execution_status,
          version = excluded.version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        value.cardId, value.boardId, value.stageId, value.title, value.description,
        value.provider, value.model, value.effort, value.skillOverrideId,
        value.runnable ? 1 : 0, value.executionStatus, value.version, value.createdAt, value.updatedAt,
      );
      return;
    }
  }
}

export function applyProjectionEvent(
  database: Database,
  event: JournalEvent,
): readonly ProjectionChange[] {
  const changes: readonly ProjectionChange[] = event.kind === "workflow_command_committed"
    ? event.payload.changes
    : event.kind === "board_upserted"
      ? [{ entity: "board", operation: "upsert", value: event.payload }]
      : event.kind === "stage_upserted"
        ? [{ entity: "stage", operation: "upsert", value: event.payload }]
        : event.kind === "edge_upserted"
          ? [{ entity: "edge", operation: "upsert", value: event.payload }]
          : [{ entity: "card", operation: "upsert", value: event.payload }];
  changes.forEach((change) => applyProjectionChange(database, change));
  return changes;
}

interface MetadataRow {
  readonly revision: number;
  readonly lastJournalOrder: number;
}

interface BoardRow {
  readonly boardId: BoardId;
  readonly repositoryPath: string;
  readonly workflowVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface StageRow extends Omit<StageProjection, "configured"> {
  readonly configured: number;
}

interface CardRow extends Omit<CardProjection, "runnable"> {
  readonly runnable: number;
}

export function readPersistenceSnapshot(database: Database): PersistenceSnapshot {
  const metadata = database.query<MetadataRow, []>(`
    SELECT revision, last_journal_order AS lastJournalOrder
    FROM projection_metadata WHERE singleton = 1
  `).get();
  if (metadata === null) throw new Error("Projection metadata is missing");

  const boards = database.query<BoardRow, []>(`
    SELECT board_id AS boardId, repository_path AS repositoryPath,
      workflow_version AS workflowVersion, created_at AS createdAt, updated_at AS updatedAt
    FROM boards ORDER BY board_id
  `).all();
  const stages = database.query<StageRow, []>(`
    SELECT stage_id AS stageId, board_id AS boardId, label, position,
      default_skill_id AS defaultSkillId, configured, workflow_version AS workflowVersion,
      updated_at AS updatedAt
    FROM workflow_stages ORDER BY board_id, position, stage_id
  `).all().map((row) => ({ ...row, configured: row.configured === 1 }));
  const edges = database.query<EdgeProjection, []>(`
    SELECT board_id AS boardId, source_stage_id AS sourceStageId,
      target_stage_id AS targetStageId, workflow_version AS workflowVersion
    FROM workflow_edges ORDER BY board_id, source_stage_id, target_stage_id
  `).all();
  const cards = database.query<CardRow, []>(`
    SELECT card_id AS cardId, board_id AS boardId, stage_id AS stageId, title, description,
      provider, model, effort, skill_override_id AS skillOverrideId, runnable,
      execution_status AS executionStatus, version, created_at AS createdAt, updated_at AS updatedAt
    FROM cards ORDER BY board_id, stage_id, card_id
  `).all().map((row) => ({ ...row, runnable: row.runnable === 1 }));

  return {
    schemaVersion: 1,
    revision: metadata.revision,
    lastJournalOrder: metadata.lastJournalOrder,
    boards,
    stages,
    edges,
    cards,
  };
}

interface JournalRow {
  readonly eventId: string;
  readonly boardId: string;
  readonly cardId: string | null;
  readonly attemptId: string | null;
  readonly attemptSequence: number | null;
  readonly actor: string;
  readonly kind: string;
  readonly occurredAt: number;
  readonly payloadJson: string;
}

export function readOrderedJournalEvents(database: Database): readonly JournalEvent[] {
  const rows = database.query<JournalRow, []>(`
    SELECT event_id AS eventId, board_id AS boardId, card_id AS cardId,
      attempt_id AS attemptId, attempt_sequence AS attemptSequence, actor, kind,
      occurred_at AS occurredAt, payload_json AS payloadJson
    FROM journal_events ORDER BY journal_order
  `).all();

  return rows.map((row) => {
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      throw new JournalValidationError(`persisted payload for ${row.eventId} is not JSON`);
    }
    return validateJournalEvent({
      eventId: row.eventId,
      boardId: row.boardId,
      ...(row.cardId === null ? {} : { cardId: row.cardId }),
      ...(row.attemptId === null
        ? {}
        : { attemptId: row.attemptId, attemptSequence: row.attemptSequence }),
      actor: row.actor,
      kind: row.kind,
      occurredAt: row.occurredAt,
      payload,
    });
  });
}

function assertProjectionPreconditions(
  database: Database,
  preconditions: readonly ProjectionVersionPrecondition[],
): void {
  for (const precondition of preconditions) {
    const actualVersion = precondition.entity === "board"
      ? database.query<{ readonly version: number }, [string]>(
          "SELECT workflow_version AS version FROM boards WHERE board_id = ?",
        ).get(precondition.id)?.version ?? 0
      : database.query<{ readonly version: number }, [string]>(
          "SELECT version FROM cards WHERE card_id = ?",
        ).get(precondition.id)?.version ?? 0;
    if (actualVersion !== precondition.expectedVersion) {
      throw new ProjectionVersionConflictError(
        precondition.entity,
        precondition.id,
        precondition.expectedVersion,
        actualVersion,
      );
    }
  }
}

export function createEventJournal(database: Database): EventJournal {
  return {
    append(input, options = {}) {
      const event = validateJournalEvent(input);
      let delta: ProjectionDelta | undefined;
      const appendTransaction = database.transaction(() => {
        const duplicate = database.query<{ readonly present: number }, [string]>(
          "SELECT 1 AS present FROM journal_events WHERE event_id = ?",
        ).get(event.eventId);
        if (duplicate !== null) throw new DuplicateJournalEventError(event.eventId);

        assertProjectionPreconditions(database, options.preconditions ?? []);

        if (event.attemptId !== undefined && event.attemptSequence !== undefined) {
          const latest = database.query<{ readonly sequence: number }, [string]>(`
            SELECT attempt_sequence AS sequence FROM journal_events
            WHERE attempt_id = ? ORDER BY attempt_sequence DESC LIMIT 1
          `).get(event.attemptId)?.sequence ?? null;
          if (latest !== null && event.attemptSequence <= latest) {
            throw new AttemptSequenceError(event.attemptId, event.attemptSequence, latest);
          }
        }

        const inserted = database.query<void, [
          string, string, string | null, string | null, number | null, string, string, number, string,
        ]>(`
          INSERT INTO journal_events(
            event_id, board_id, card_id, attempt_id, attempt_sequence,
            actor, kind, occurred_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.eventId,
          event.boardId,
          "cardId" in event && event.cardId !== undefined ? event.cardId : null,
          event.attemptId ?? null,
          event.attemptSequence ?? null,
          event.actor,
          event.kind,
          event.occurredAt,
          JSON.stringify(event.payload),
        );
        const journalOrder = Number(inserted.lastInsertRowid);
        const changes = applyProjectionEvent(database, event);
        database.query<void, [number]>(`
          UPDATE projection_metadata
          SET revision = revision + 1, last_journal_order = ?
          WHERE singleton = 1
        `).run(journalOrder);
        const revision = database.query<{ readonly revision: number }, []>(
          "SELECT revision FROM projection_metadata WHERE singleton = 1",
        ).get()?.revision;
        if (revision === undefined) throw new Error("Projection metadata is missing");
        delta = { eventId: event.eventId, journalOrder, revision, changes };
      });

      appendTransaction.immediate();
      if (delta === undefined) throw new Error("Journal transaction committed without a delta");
      return delta;
    },
    snapshot() {
      return readPersistenceSnapshot(database);
    },
    events() {
      return readOrderedJournalEvents(database);
    },
    eventById(eventId) {
      return readOrderedJournalEvents(database).find((event) => event.eventId === eventId) ?? null;
    },
  };
}
