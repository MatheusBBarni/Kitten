import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
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
import { isSkillId } from "../workflow/workflowTypes.ts";
import type {
  CatalogDiagnostic,
  CatalogRoot,
  SkillCatalogEntry,
  SkillMetadata,
  SkillSnapshot,
} from "../catalog/contracts.ts";
import { deriveSkillIdentity } from "../catalog/skillCatalog.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import { validateCardWorktreeBinding } from "../worktrees/contracts.ts";
import type { AttemptProjection, RunContext } from "../attempts/contracts.ts";
import { validateAttemptProjection, validateRunContext } from "../attempts/contracts.ts";

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
    })
  | (JournalEventBase & {
      readonly kind: "catalog_projection_replaced";
      readonly payload: CatalogProjection;
    })
  | (JournalEventBase & {
      readonly kind: "skill_snapshot_stored";
      readonly payload: StoredSkillSnapshot;
    })
  | (JournalEventBase & {
      readonly kind: "card_worktree_binding_recorded";
      readonly cardId: CardId;
      readonly payload: CardWorktreeBinding;
    })
  | (JournalEventBase & {
      readonly kind: "attempt_lifecycle_committed";
      readonly cardId: CardId;
      readonly attemptId: string;
      readonly attemptSequence: number;
      readonly payload: AttemptLifecycleEventPayload;
    });

export interface CatalogProjection {
  readonly catalogId: string;
  readonly roots: readonly CatalogRoot[];
  readonly entries: readonly SkillCatalogEntry[];
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface StoredSkillSnapshot {
  readonly catalogId: string;
  readonly snapshot: SkillSnapshot;
  readonly storedAt: number;
}

export type AttemptLifecycleOperation = "created" | "started" | "startup_failed";

export interface AttemptLifecycleEventPayload {
  readonly operation: AttemptLifecycleOperation;
  readonly changes: readonly ProjectionChange[];
}

export type ProjectionChange =
  | { readonly entity: "board"; readonly operation: "upsert"; readonly value: BoardProjection }
  | { readonly entity: "stage"; readonly operation: "upsert"; readonly value: StageProjection }
  | { readonly entity: "edge"; readonly operation: "upsert"; readonly value: EdgeProjection }
  | { readonly entity: "edge"; readonly operation: "delete"; readonly value: EdgeProjection }
  | { readonly entity: "card"; readonly operation: "upsert"; readonly value: CardProjection }
  | { readonly entity: "catalog"; readonly operation: "replace"; readonly value: CatalogProjection }
  | { readonly entity: "skill_snapshot"; readonly operation: "insert"; readonly value: StoredSkillSnapshot }
  | { readonly entity: "card_worktree"; readonly operation: "upsert"; readonly value: CardWorktreeBinding }
  | { readonly entity: "attempt"; readonly operation: "upsert"; readonly value: AttemptProjection }
  | { readonly entity: "run_context"; readonly operation: "insert"; readonly value: RunContext };

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
  readonly catalogRoots: readonly (CatalogRoot & { readonly catalogId: string })[];
  readonly catalogEntries: readonly (SkillCatalogEntry & { readonly catalogId: string })[];
  readonly catalogDiagnostics: readonly (CatalogDiagnostic & { readonly catalogId: string })[];
  readonly skillSnapshots: readonly StoredSkillSnapshot[];
  readonly cardWorktrees: readonly CardWorktreeBinding[];
  readonly attempts: readonly AttemptProjection[];
  readonly runContexts: readonly RunContext[];
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

function optionalSkillIdField(value: unknown, label: string): SkillId | null {
  const skillId = optionalStringField(value, label);
  if (skillId !== null && !isSkillId(skillId)) {
    throw new JournalValidationError(`${label} must be a digest-backed catalog identity`);
  }
  return skillId;
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

function nullableStringField(value: unknown, label: string): string | null {
  return value === null ? null : stringField(value, label);
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  assertRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = stringField(entry, `${label}.${key}`, true);
  }
  return result;
}

function parseSkillMetadata(value: unknown, label: string): SkillMetadata {
  assertRecord(value, label);
  assertExactKeys(value, ["name", "description", "frontmatter"]);
  return {
    name: stringField(value.name, `${label}.name`),
    description: stringField(value.description, `${label}.description`),
    frontmatter: stringRecord(value.frontmatter, `${label}.frontmatter`),
  };
}

const DIAGNOSTIC_CODES = [
  "missing_root",
  "unreadable_root",
  "invalid_root",
  "missing_skill_file",
  "unreadable_skill_file",
  "non_utf8_skill_file",
  "empty_skill_file",
  "malformed_skill_file",
  "name_collision",
] as const;

function parseRootClass(value: unknown, label: string): CatalogRoot["rootClass"] {
  const rootClass = stringField(value, label);
  if (rootClass !== "project" && rootClass !== "user") {
    throw new JournalValidationError(`${label} is unsupported`);
  }
  return rootClass;
}

function parseCatalogDiagnostic(value: unknown, label: string): CatalogDiagnostic {
  assertRecord(value, label);
  assertExactKeys(value, [
    "diagnosticId", "code", "severity", "message", "rootClass", "configuredPath",
    "canonicalPath", "skillPath", "displayName", "relatedSkillIds",
  ]);
  const code = stringField(value.code, `${label}.code`);
  if (!DIAGNOSTIC_CODES.includes(code as (typeof DIAGNOSTIC_CODES)[number])) {
    throw new JournalValidationError(`${label}.code is unsupported`);
  }
  const severity = stringField(value.severity, `${label}.severity`);
  if (severity !== "error" && severity !== "warning") {
    throw new JournalValidationError(`${label}.severity is unsupported`);
  }
  if (!Array.isArray(value.relatedSkillIds)) {
    throw new JournalValidationError(`${label}.relatedSkillIds must be an array`);
  }
  return {
    diagnosticId: stringField(value.diagnosticId, `${label}.diagnosticId`),
    code: code as CatalogDiagnostic["code"],
    severity,
    message: stringField(value.message, `${label}.message`),
    rootClass: parseRootClass(value.rootClass, `${label}.rootClass`),
    configuredPath: stringField(value.configuredPath, `${label}.configuredPath`),
    canonicalPath: nullableStringField(value.canonicalPath, `${label}.canonicalPath`),
    skillPath: nullableStringField(value.skillPath, `${label}.skillPath`),
    displayName: nullableStringField(value.displayName, `${label}.displayName`),
    relatedSkillIds: value.relatedSkillIds.map((entry) => (
      stringField(entry, `${label}.relatedSkillIds[]`) as SkillId
    )),
  };
}

function parseCatalogRoot(value: unknown, label: string): CatalogRoot {
  assertRecord(value, label);
  assertExactKeys(value, [
    "rootClass", "configuredPath", "canonicalPath", "order", "valid", "diagnostics",
  ]);
  if (!Array.isArray(value.diagnostics)) {
    throw new JournalValidationError(`${label}.diagnostics must be an array`);
  }
  const canonicalPath = nullableStringField(value.canonicalPath, `${label}.canonicalPath`);
  const valid = booleanField(value.valid, `${label}.valid`);
  if (valid !== (canonicalPath !== null)) {
    throw new JournalValidationError(`${label}.valid does not match canonicalPath`);
  }
  return {
    rootClass: parseRootClass(value.rootClass, `${label}.rootClass`),
    configuredPath: stringField(value.configuredPath, `${label}.configuredPath`),
    canonicalPath,
    order: integerField(value.order, `${label}.order`),
    valid,
    diagnostics: value.diagnostics.map((entry) => parseCatalogDiagnostic(entry, `${label}.diagnostics[]`)),
  };
}

function parseCatalogEntry(value: unknown, label: string): SkillCatalogEntry {
  assertRecord(value, label);
  assertExactKeys(value, [
    "skillId", "canonicalPath", "rootClass", "rootPath", "digest", "metadata", "order",
    "hasNameCollision", "diagnostics",
  ]);
  if (!Array.isArray(value.diagnostics)) {
    throw new JournalValidationError(`${label}.diagnostics must be an array`);
  }
  const digest = stringField(value.digest, `${label}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new JournalValidationError(`${label}.digest must be a lowercase SHA-256 digest`);
  }
  const skillId = stringField(value.skillId, `${label}.skillId`) as SkillId;
  const canonicalPath = stringField(value.canonicalPath, `${label}.canonicalPath`);
  if (skillId !== deriveSkillIdentity(canonicalPath, digest)) {
    throw new JournalValidationError(`${label}.skillId does not match location and digest`);
  }
  return {
    skillId,
    canonicalPath,
    rootClass: parseRootClass(value.rootClass, `${label}.rootClass`),
    rootPath: stringField(value.rootPath, `${label}.rootPath`),
    digest,
    metadata: parseSkillMetadata(value.metadata, `${label}.metadata`),
    order: integerField(value.order, `${label}.order`),
    hasNameCollision: booleanField(value.hasNameCollision, `${label}.hasNameCollision`),
    diagnostics: value.diagnostics.map((entry) => parseCatalogDiagnostic(entry, `${label}.diagnostics[]`)),
  };
}

function parseCatalogProjection(value: unknown): CatalogProjection {
  assertRecord(value, "payload");
  assertExactKeys(value, ["catalogId", "roots", "entries", "diagnostics"]);
  if (!Array.isArray(value.roots) || !Array.isArray(value.entries) || !Array.isArray(value.diagnostics)) {
    throw new JournalValidationError("catalog projection collections must be arrays");
  }
  return {
    catalogId: stringField(value.catalogId, "payload.catalogId"),
    roots: value.roots.map((entry) => parseCatalogRoot(entry, "payload.roots[]")),
    entries: value.entries.map((entry) => parseCatalogEntry(entry, "payload.entries[]")),
    diagnostics: value.diagnostics.map((entry) => parseCatalogDiagnostic(entry, "payload.diagnostics[]")),
  };
}

function parseSkillSnapshot(value: unknown, label: string): SkillSnapshot {
  assertRecord(value, label);
  assertExactKeys(value, [
    "snapshotId", "skillId", "canonicalPath", "rootClass", "digest", "metadata", "content",
  ]);
  const snapshotId = stringField(value.snapshotId, `${label}.snapshotId`) as SkillId;
  const skillId = stringField(value.skillId, `${label}.skillId`) as SkillId;
  if (snapshotId !== skillId) throw new JournalValidationError(`${label} identity is inconsistent`);
  const digest = stringField(value.digest, `${label}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new JournalValidationError(`${label}.digest must be a lowercase SHA-256 digest`);
  }
  const canonicalPath = stringField(value.canonicalPath, `${label}.canonicalPath`);
  const content = stringField(value.content, `${label}.content`);
  const contentDigest = createHash("sha256").update(new TextEncoder().encode(content)).digest("hex");
  if (contentDigest !== digest) throw new JournalValidationError(`${label}.digest does not match content`);
  if (skillId !== deriveSkillIdentity(canonicalPath, digest)) {
    throw new JournalValidationError(`${label}.skillId does not match location and digest`);
  }
  return {
    snapshotId,
    skillId,
    canonicalPath,
    rootClass: parseRootClass(value.rootClass, `${label}.rootClass`),
    digest,
    metadata: parseSkillMetadata(value.metadata, `${label}.metadata`),
    content,
  };
}

function parseStoredSkillSnapshot(value: unknown): StoredSkillSnapshot {
  assertRecord(value, "payload");
  assertExactKeys(value, ["catalogId", "snapshot", "storedAt"]);
  return {
    catalogId: stringField(value.catalogId, "payload.catalogId"),
    snapshot: parseSkillSnapshot(value.snapshot, "payload.snapshot"),
    storedAt: integerField(value.storedAt, "payload.storedAt"),
  };
}

function parseCardWorktreeBinding(value: unknown): CardWorktreeBinding {
  try {
    return validateCardWorktreeBinding(value);
  } catch (error) {
    throw new JournalValidationError(
      error instanceof Error ? error.message : "card worktree binding is invalid",
    );
  }
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
    defaultSkillId: optionalSkillIdField(value.defaultSkillId, "payload.defaultSkillId"),
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
    skillOverrideId: optionalSkillIdField(value.skillOverrideId, "payload.skillOverrideId"),
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
    case "catalog":
      if (operation !== "replace") throw new JournalValidationError("catalog changes must replace");
      return { entity, operation, value: parseCatalogProjection(value.value) };
    case "skill_snapshot":
      if (operation !== "insert") throw new JournalValidationError("Skill snapshot changes must insert");
      return { entity, operation, value: parseStoredSkillSnapshot(value.value) };
    case "card_worktree":
      if (operation !== "upsert") throw new JournalValidationError("card worktree changes must upsert");
      return { entity, operation, value: parseCardWorktreeBinding(value.value) };
    case "attempt":
      if (operation !== "upsert") throw new JournalValidationError("attempt changes must upsert");
      try {
        return { entity, operation, value: validateAttemptProjection(value.value) };
      } catch (error) {
        throw new JournalValidationError(error instanceof Error ? error.message : "attempt projection is invalid");
      }
    case "run_context":
      if (operation !== "insert") throw new JournalValidationError("Run Context changes must insert");
      try {
        return { entity, operation, value: validateRunContext(value.value) };
      } catch (error) {
        throw new JournalValidationError(error instanceof Error ? error.message : "Run Context is invalid");
      }
    default:
      throw new JournalValidationError("projection change entity is unsupported");
  }
}

function parseAttemptLifecyclePayload(value: unknown): AttemptLifecycleEventPayload {
  assertRecord(value, "payload");
  assertExactKeys(value, ["operation", "changes"]);
  const operation = stringField(value.operation, "payload.operation") as AttemptLifecycleOperation;
  if (operation !== "created" && operation !== "started" && operation !== "startup_failed") {
    throw new JournalValidationError("attempt lifecycle operation is unsupported");
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) {
    throw new JournalValidationError("attempt lifecycle changes must be a non-empty array");
  }
  const changes = value.changes.map(parseProjectionChange);
  const attempts = changes.filter((change) => change.entity === "attempt");
  const cards = changes.filter((change) => change.entity === "card");
  const contexts = changes.filter((change) => change.entity === "run_context");
  if (attempts.length !== 1) throw new JournalValidationError("attempt lifecycle requires one attempt change");
  const attempt = attempts[0]?.value;
  if (operation === "created") {
    if (cards.length !== 1 || contexts.length !== 1 || changes.length !== 3 || attempt?.state !== "starting") {
      throw new JournalValidationError("attempt creation requires starting attempt, Run Context, and card changes");
    }
  } else if (operation === "started") {
    if (cards.length !== 0 || contexts.length !== 0 || changes.length !== 1 || attempt?.state !== "running") {
      throw new JournalValidationError("attempt startup requires one running attempt change");
    }
  } else if (cards.length !== 1 || contexts.length !== 0 || changes.length !== 2 || attempt?.state !== "failed") {
    throw new JournalValidationError("attempt startup failure requires failed attempt and card changes");
  }
  return { operation, changes };
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
      const mismatchedChange = payload.changes.find((change) => {
        if (
          change.entity === "catalog"
          || change.entity === "skill_snapshot"
          || change.entity === "card_worktree"
          || change.entity === "attempt"
          || change.entity === "run_context"
        ) return true;
        return change.value.boardId !== boardId;
      });
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
    case "catalog_projection_replaced": {
      const payload = parseCatalogProjection(input.payload);
      if (payload.catalogId !== boardId) {
        throw new JournalValidationError("boardId does not match catalogId");
      }
      if (Object.hasOwn(input, "cardId")) {
        throw new JournalValidationError("catalog event cannot carry cardId");
      }
      return { eventId, boardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "skill_snapshot_stored": {
      const payload = parseStoredSkillSnapshot(input.payload);
      if (payload.catalogId !== boardId) {
        throw new JournalValidationError("boardId does not match catalogId");
      }
      if (Object.hasOwn(input, "cardId")) {
        throw new JournalValidationError("Skill snapshot event cannot carry cardId");
      }
      return { eventId, boardId, actor, kind: input.kind, occurredAt, payload, ...attempt };
    }
    case "card_worktree_binding_recorded": {
      const payload = parseCardWorktreeBinding(input.payload);
      const cardId = stringField(input.cardId, "cardId") as CardId;
      if (payload.boardId !== boardId || payload.cardId !== cardId) {
        throw new JournalValidationError("card worktree event identity does not match payload");
      }
      return {
        eventId,
        boardId,
        cardId,
        actor,
        kind: input.kind,
        occurredAt,
        payload,
        ...attempt,
      };
    }
    case "attempt_lifecycle_committed": {
      const payload = parseAttemptLifecyclePayload(input.payload);
      const cardId = stringField(input.cardId, "cardId") as CardId;
      const attemptId = stringField(input.attemptId, "attemptId");
      const attempt = payload.changes.find((change) => change.entity === "attempt")?.value as AttemptProjection;
      if (attempt.boardId !== boardId || attempt.cardId !== cardId || attempt.attemptId !== attemptId) {
        throw new JournalValidationError("attempt lifecycle event identity does not match attempt projection");
      }
      const card = payload.changes.find((change) => change.entity === "card")?.value;
      if (card !== undefined && (card.boardId !== boardId || card.cardId !== cardId)) {
        throw new JournalValidationError("attempt lifecycle event identity does not match card projection");
      }
      const context = payload.changes.find((change) => change.entity === "run_context")?.value;
      if (context !== undefined && (
        context.attemptId !== attemptId
        || context.generation !== attempt.generation
        || context.card.cardId !== cardId
        || context.workflow.boardId !== boardId
      )) {
        throw new JournalValidationError("attempt lifecycle event identity does not match Run Context");
      }
      return {
        eventId,
        boardId,
        cardId,
        attemptId,
        attemptSequence: integerField(input.attemptSequence, "attemptSequence"),
        actor,
        kind: input.kind,
        occurredAt,
        payload,
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
    case "card_worktree": {
      const value = change.value;
      const cardStatement = database.query<{ readonly boardId: string }, [string]>(
        "SELECT board_id AS boardId FROM cards WHERE card_id = ?",
      );
      const card = cardStatement.get(value.cardId);
      cardStatement.finalize();
      if (card?.boardId !== value.boardId) {
        throw new Error(`Card ${value.cardId} does not belong to board ${value.boardId}`);
      }
      const existingStatement = database.query<{
        readonly bindingId: string;
        readonly boardId: string;
        readonly repositoryRoot: string;
        readonly repositoryGitDir: string;
        readonly managedRoot: string;
        readonly worktreePath: string;
        readonly branch: string;
        readonly baselineBranch: string;
        readonly baselineCommit: string;
        readonly createdAt: number;
      }, [string]>(`
        SELECT binding_id AS bindingId, board_id AS boardId,
          repository_root AS repositoryRoot, repository_git_dir AS repositoryGitDir,
          managed_root AS managedRoot, worktree_path AS worktreePath, branch,
          baseline_branch AS baselineBranch, baseline_commit AS baselineCommit,
          created_at AS createdAt
        FROM card_worktrees WHERE card_id = ?
      `);
      const existing = existingStatement.get(value.cardId);
      existingStatement.finalize();
      if (existing !== null && JSON.stringify(existing) !== JSON.stringify({
        bindingId: value.bindingId,
        boardId: value.boardId,
        repositoryRoot: value.repositoryRoot,
        repositoryGitDir: value.repositoryGitDir,
        managedRoot: value.managedRoot,
        worktreePath: value.worktreePath,
        branch: value.branch,
        baselineBranch: value.baselineBranch,
        baselineCommit: value.baselineCommit,
        createdAt: value.createdAt,
      })) {
        throw new Error(`Card worktree identity conflict: ${value.cardId}`);
      }
      const upsert = database.query<void, [
        string, string, number, string, string, string, string, string, string, string,
        string, string, string | null, number, number,
      ]>(`
        INSERT INTO card_worktrees(
          card_id, board_id, binding_version, binding_id, repository_root,
          repository_git_dir, managed_root, worktree_path, branch, baseline_branch,
          baseline_commit, lifecycle, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET
          lifecycle = excluded.lifecycle,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `);
      upsert.run(
        value.cardId,
        value.boardId,
        value.bindingVersion,
        value.bindingId,
        value.repositoryRoot,
        value.repositoryGitDir,
        value.managedRoot,
        value.worktreePath,
        value.branch,
        value.baselineBranch,
        value.baselineCommit,
        value.lifecycle,
        value.reason,
        value.createdAt,
        value.updatedAt,
      );
      upsert.finalize();
      return;
    }
    case "catalog": {
      const value = change.value;
      const deleteDiagnostics = database.query<void, [string]>(
        "DELETE FROM skill_catalog_diagnostics WHERE catalog_id = ?",
      );
      deleteDiagnostics.run(value.catalogId);
      deleteDiagnostics.finalize();
      const deleteEntries = database.query<void, [string]>(
        "DELETE FROM skill_catalog_entries WHERE catalog_id = ?",
      );
      deleteEntries.run(value.catalogId);
      deleteEntries.finalize();
      const deleteRoots = database.query<void, [string]>(
        "DELETE FROM skill_catalog_roots WHERE catalog_id = ?",
      );
      deleteRoots.run(value.catalogId);
      deleteRoots.finalize();
      const insertRoot = database.query<void, [string, number, string, string, string | null, number, string]>(`
        INSERT INTO skill_catalog_roots(
          catalog_id, root_order, root_class, configured_path, canonical_path, valid, diagnostics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      value.roots.forEach((root) => insertRoot.run(
        value.catalogId,
        root.order,
        root.rootClass,
        root.configuredPath,
        root.canonicalPath,
        root.valid ? 1 : 0,
        JSON.stringify(root.diagnostics),
      ));
      insertRoot.finalize();
      const insertEntry = database.query<void, [
        string, string, number, string, string, string, string, string, number, string,
      ]>(`
        INSERT INTO skill_catalog_entries(
          catalog_id, skill_id, entry_order, canonical_path, root_class, root_path, digest,
          metadata_json, has_name_collision, diagnostics_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      value.entries.forEach((entry) => insertEntry.run(
        value.catalogId,
        entry.skillId,
        entry.order,
        entry.canonicalPath,
        entry.rootClass,
        entry.rootPath,
        entry.digest,
        JSON.stringify(entry.metadata),
        entry.hasNameCollision ? 1 : 0,
        JSON.stringify(entry.diagnostics),
      ));
      insertEntry.finalize();
      const insertDiagnostic = database.query<void, [string, string, number, string]>(`
        INSERT INTO skill_catalog_diagnostics(
          catalog_id, diagnostic_id, diagnostic_order, diagnostic_json
        ) VALUES (?, ?, ?, ?)
      `);
      value.diagnostics.forEach((entry, order) => insertDiagnostic.run(
        value.catalogId,
        entry.diagnosticId,
        order,
        JSON.stringify(entry),
      ));
      insertDiagnostic.finalize();
      return;
    }
    case "skill_snapshot": {
      const value = change.value;
      const snapshot = value.snapshot;
      const insertSnapshot = database.query<void, [
        string, string, string, string, string, string, string, Uint8Array, number,
      ]>(`
        INSERT INTO skill_snapshots(
          snapshot_id, catalog_id, skill_id, canonical_path, root_class, digest,
          metadata_json, content, stored_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_id) DO NOTHING
      `);
      insertSnapshot.run(
        snapshot.snapshotId,
        value.catalogId,
        snapshot.skillId,
        snapshot.canonicalPath,
        snapshot.rootClass,
        snapshot.digest,
        JSON.stringify(snapshot.metadata),
        new TextEncoder().encode(snapshot.content),
        value.storedAt,
      );
      insertSnapshot.finalize();
      const readSnapshot = database.query<{
        readonly catalogId: string;
        readonly skillId: string;
        readonly canonicalPath: string;
        readonly rootClass: string;
        readonly digest: string;
        readonly metadataJson: string;
        readonly content: Uint8Array;
        readonly storedAt: number;
      }, [string]>(`
        SELECT catalog_id AS catalogId, skill_id AS skillId, canonical_path AS canonicalPath,
          root_class AS rootClass, digest, metadata_json AS metadataJson, content,
          stored_at AS storedAt
        FROM skill_snapshots WHERE snapshot_id = ?
      `);
      const persisted = readSnapshot.get(snapshot.snapshotId);
      readSnapshot.finalize();
      if (persisted === null || JSON.stringify({
        ...persisted,
        content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(persisted.content),
      }) !== JSON.stringify({
        catalogId: value.catalogId,
        skillId: snapshot.skillId,
        canonicalPath: snapshot.canonicalPath,
        rootClass: snapshot.rootClass,
        digest: snapshot.digest,
        metadataJson: JSON.stringify(snapshot.metadata),
        content: snapshot.content,
        storedAt: value.storedAt,
      })) {
        throw new Error(`Skill snapshot identity conflict: ${snapshot.snapshotId}`);
      }
      return;
    }
    case "attempt": {
      const value = change.value;
      const cardStatement = database.query<{ readonly boardId: string }, [string]>(
        "SELECT board_id AS boardId FROM cards WHERE card_id = ?",
      );
      const card = cardStatement.get(value.cardId);
      cardStatement.finalize();
      if (card?.boardId !== value.boardId) {
        throw new Error(`Attempt card ${value.cardId} does not belong to board ${value.boardId}`);
      }
      const existingStatement = database.query<{
        readonly boardId: string;
        readonly cardId: string;
        readonly generation: number;
        readonly createdAt: number;
      }, [string]>(`
        SELECT board_id AS boardId, card_id AS cardId, generation, created_at AS createdAt
        FROM attempts WHERE attempt_id = ?
      `);
      const existing = existingStatement.get(value.attemptId);
      existingStatement.finalize();
      if (existing !== null && JSON.stringify(existing) !== JSON.stringify({
        boardId: value.boardId,
        cardId: value.cardId,
        generation: value.generation,
        createdAt: value.createdAt,
      })) {
        throw new Error(`Attempt identity conflict: ${value.attemptId}`);
      }
      const upsert = database.query<void, [
        string, string, string, number, string, string | null, string | null,
        number, number | null, number | null,
      ]>(`
        INSERT INTO attempts(
          attempt_id, board_id, card_id, generation, state, session_id, failure_json,
          created_at, started_at, terminal_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET
          state = excluded.state,
          session_id = excluded.session_id,
          failure_json = excluded.failure_json,
          started_at = excluded.started_at,
          terminal_at = excluded.terminal_at
      `);
      upsert.run(
        value.attemptId,
        value.boardId,
        value.cardId,
        value.generation,
        value.state,
        value.sessionId,
        value.failure === null ? null : JSON.stringify(value.failure),
        value.createdAt,
        value.startedAt,
        value.terminalAt,
      );
      upsert.finalize();
      return;
    }
    case "run_context": {
      const value = change.value;
      const insert = database.query<void, [string, string, string, number, string]>(`
        INSERT INTO run_contexts(attempt_id, board_id, card_id, generation, context_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id) DO NOTHING
      `);
      const serialized = JSON.stringify(value);
      insert.run(value.attemptId, value.workflow.boardId, value.card.cardId, value.generation, serialized);
      insert.finalize();
      const persistedStatement = database.query<{ readonly contextJson: string }, [string]>(
        "SELECT context_json AS contextJson FROM run_contexts WHERE attempt_id = ?",
      );
      const persisted = persistedStatement.get(value.attemptId);
      persistedStatement.finalize();
      if (persisted?.contextJson !== serialized) {
        throw new Error(`Run Context identity conflict: ${value.attemptId}`);
      }
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
    : event.kind === "catalog_projection_replaced"
      ? [{ entity: "catalog", operation: "replace", value: event.payload }]
      : event.kind === "skill_snapshot_stored"
        ? [{ entity: "skill_snapshot", operation: "insert", value: event.payload }]
        : event.kind === "card_worktree_binding_recorded"
          ? [{ entity: "card_worktree", operation: "upsert", value: event.payload }]
        : event.kind === "attempt_lifecycle_committed"
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

interface CatalogRootRow {
  readonly catalogId: string;
  readonly order: number;
  readonly rootClass: string;
  readonly configuredPath: string;
  readonly canonicalPath: string | null;
  readonly valid: number;
  readonly diagnosticsJson: string;
}

interface CatalogEntryRow {
  readonly catalogId: string;
  readonly skillId: string;
  readonly order: number;
  readonly canonicalPath: string;
  readonly rootClass: string;
  readonly rootPath: string;
  readonly digest: string;
  readonly metadataJson: string;
  readonly hasNameCollision: number;
  readonly diagnosticsJson: string;
}

interface CatalogDiagnosticRow {
  readonly catalogId: string;
  readonly diagnosticJson: string;
}

interface SkillSnapshotRow {
  readonly snapshotId: string;
  readonly catalogId: string;
  readonly skillId: string;
  readonly canonicalPath: string;
  readonly rootClass: string;
  readonly digest: string;
  readonly metadataJson: string;
  readonly content: Uint8Array;
  readonly storedAt: number;
}

interface CardWorktreeRow {
  readonly bindingVersion: number;
  readonly bindingId: string;
  readonly boardId: string;
  readonly cardId: string;
  readonly repositoryRoot: string;
  readonly repositoryGitDir: string;
  readonly managedRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baselineBranch: string;
  readonly baselineCommit: string;
  readonly lifecycle: string;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface AttemptRow {
  readonly attemptId: string;
  readonly boardId: string;
  readonly cardId: string;
  readonly generation: number;
  readonly state: string;
  readonly sessionId: string | null;
  readonly failureJson: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly terminalAt: number | null;
}

interface RunContextRow {
  readonly contextJson: string;
}

function parsePersistedJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new JournalValidationError(`${label} is not JSON`);
  }
}

export function readPersistenceSnapshot(database: Database): PersistenceSnapshot {
  const metadataStatement = database.query<MetadataRow, []>(`
    SELECT revision, last_journal_order AS lastJournalOrder
    FROM projection_metadata WHERE singleton = 1
  `);
  const metadata = metadataStatement.get();
  metadataStatement.finalize();
  if (metadata === null) throw new Error("Projection metadata is missing");

  const boardsStatement = database.query<BoardRow, []>(`
    SELECT board_id AS boardId, repository_path AS repositoryPath,
      workflow_version AS workflowVersion, created_at AS createdAt, updated_at AS updatedAt
    FROM boards ORDER BY board_id
  `);
  const boards = boardsStatement.all();
  boardsStatement.finalize();
  const stagesStatement = database.query<StageRow, []>(`
    SELECT stage_id AS stageId, board_id AS boardId, label, position,
      default_skill_id AS defaultSkillId, configured, workflow_version AS workflowVersion,
      updated_at AS updatedAt
    FROM workflow_stages ORDER BY board_id, position, stage_id
  `);
  const stageRows = stagesStatement.all();
  stagesStatement.finalize();
  const stages = stageRows.map((row) => ({ ...row, configured: row.configured === 1 }));
  const edgesStatement = database.query<EdgeProjection, []>(`
    SELECT board_id AS boardId, source_stage_id AS sourceStageId,
      target_stage_id AS targetStageId, workflow_version AS workflowVersion
    FROM workflow_edges ORDER BY board_id, source_stage_id, target_stage_id
  `);
  const edges = edgesStatement.all();
  edgesStatement.finalize();
  const cardsStatement = database.query<CardRow, []>(`
    SELECT card_id AS cardId, board_id AS boardId, stage_id AS stageId, title, description,
      provider, model, effort, skill_override_id AS skillOverrideId, runnable,
      execution_status AS executionStatus, version, created_at AS createdAt, updated_at AS updatedAt
    FROM cards ORDER BY board_id, stage_id, card_id
  `);
  const cardRows = cardsStatement.all();
  cardsStatement.finalize();
  const cards = cardRows.map((row) => ({ ...row, runnable: row.runnable === 1 }));
  const catalogRootsStatement = database.query<CatalogRootRow, []>(`
    SELECT catalog_id AS catalogId, root_order AS 'order', root_class AS rootClass,
      configured_path AS configuredPath, canonical_path AS canonicalPath, valid,
      diagnostics_json AS diagnosticsJson
    FROM skill_catalog_roots ORDER BY catalog_id, root_order
  `);
  const catalogRootRows = catalogRootsStatement.all();
  catalogRootsStatement.finalize();
  const catalogRoots = catalogRootRows.map((row) => ({
    catalogId: row.catalogId,
    ...parseCatalogRoot({
      rootClass: row.rootClass,
      configuredPath: row.configuredPath,
      canonicalPath: row.canonicalPath,
      order: row.order,
      valid: row.valid === 1,
      diagnostics: parsePersistedJson(row.diagnosticsJson, "persisted root diagnostics"),
    }, "persisted catalog root"),
  }));
  const catalogEntriesStatement = database.query<CatalogEntryRow, []>(`
    SELECT catalog_id AS catalogId, skill_id AS skillId, entry_order AS 'order',
      canonical_path AS canonicalPath, root_class AS rootClass, root_path AS rootPath,
      digest, metadata_json AS metadataJson, has_name_collision AS hasNameCollision,
      diagnostics_json AS diagnosticsJson
    FROM skill_catalog_entries ORDER BY catalog_id, entry_order
  `);
  const catalogEntryRows = catalogEntriesStatement.all();
  catalogEntriesStatement.finalize();
  const catalogEntries = catalogEntryRows.map((row) => ({
    catalogId: row.catalogId,
    ...parseCatalogEntry({
      skillId: row.skillId,
      canonicalPath: row.canonicalPath,
      rootClass: row.rootClass,
      rootPath: row.rootPath,
      digest: row.digest,
      metadata: parsePersistedJson(row.metadataJson, "persisted Skill metadata"),
      order: row.order,
      hasNameCollision: row.hasNameCollision === 1,
      diagnostics: parsePersistedJson(row.diagnosticsJson, "persisted entry diagnostics"),
    }, "persisted catalog entry"),
  }));
  const catalogDiagnosticsStatement = database.query<CatalogDiagnosticRow, []>(`
    SELECT catalog_id AS catalogId, diagnostic_json AS diagnosticJson
    FROM skill_catalog_diagnostics ORDER BY catalog_id, diagnostic_order
  `);
  const catalogDiagnosticRows = catalogDiagnosticsStatement.all();
  catalogDiagnosticsStatement.finalize();
  const catalogDiagnostics = catalogDiagnosticRows.map((row) => ({
    catalogId: row.catalogId,
    ...parseCatalogDiagnostic(
      parsePersistedJson(row.diagnosticJson, "persisted catalog diagnostic"),
      "persisted catalog diagnostic",
    ),
  }));
  const skillSnapshotsStatement = database.query<SkillSnapshotRow, []>(`
    SELECT snapshot_id AS snapshotId, catalog_id AS catalogId, skill_id AS skillId,
      canonical_path AS canonicalPath, root_class AS rootClass, digest,
      metadata_json AS metadataJson, content, stored_at AS storedAt
    FROM skill_snapshots ORDER BY snapshot_id
  `);
  const skillSnapshotRows = skillSnapshotsStatement.all();
  skillSnapshotsStatement.finalize();
  const skillSnapshots = skillSnapshotRows.map((row): StoredSkillSnapshot => ({
    catalogId: row.catalogId,
    snapshot: parseSkillSnapshot({
      snapshotId: row.snapshotId,
      skillId: row.skillId,
      canonicalPath: row.canonicalPath,
      rootClass: row.rootClass,
      digest: row.digest,
      metadata: parsePersistedJson(row.metadataJson, "persisted snapshot metadata"),
      content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(row.content),
    }, "persisted Skill snapshot"),
    storedAt: row.storedAt,
  }));
  const cardWorktreesStatement = database.query<CardWorktreeRow, []>(`
    SELECT binding_version AS bindingVersion, binding_id AS bindingId,
      board_id AS boardId, card_id AS cardId, repository_root AS repositoryRoot,
      repository_git_dir AS repositoryGitDir, managed_root AS managedRoot,
      worktree_path AS worktreePath, branch, baseline_branch AS baselineBranch,
      baseline_commit AS baselineCommit, lifecycle, reason,
      created_at AS createdAt, updated_at AS updatedAt
    FROM card_worktrees ORDER BY board_id, card_id
  `);
  const cardWorktreeRows = cardWorktreesStatement.all();
  cardWorktreesStatement.finalize();
  const cardWorktrees = cardWorktreeRows.map(parseCardWorktreeBinding);
  const attemptsStatement = database.query<AttemptRow, []>(`
    SELECT attempt_id AS attemptId, board_id AS boardId, card_id AS cardId, generation,
      state, session_id AS sessionId, failure_json AS failureJson,
      created_at AS createdAt, started_at AS startedAt, terminal_at AS terminalAt
    FROM attempts ORDER BY board_id, card_id, generation
  `);
  const attemptRows = attemptsStatement.all();
  attemptsStatement.finalize();
  const attempts = attemptRows.map((row) => validateAttemptProjection({
    ...row,
    failure: row.failureJson === null
      ? null
      : parsePersistedJson(row.failureJson, "persisted attempt failure"),
  }));
  const runContextsStatement = database.query<RunContextRow, []>(`
    SELECT context_json AS contextJson FROM run_contexts ORDER BY board_id, card_id, generation
  `);
  const runContextRows = runContextsStatement.all();
  runContextsStatement.finalize();
  const runContexts = runContextRows.map((row) => validateRunContext(
    parsePersistedJson(row.contextJson, "persisted Run Context"),
  ));

  return {
    schemaVersion: 1,
    revision: metadata.revision,
    lastJournalOrder: metadata.lastJournalOrder,
    boards,
    stages,
    edges,
    cards,
    catalogRoots,
    catalogEntries,
    catalogDiagnostics,
    skillSnapshots,
    cardWorktrees,
    attempts,
    runContexts,
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
  const statement = database.query<JournalRow, []>(`
    SELECT event_id AS eventId, board_id AS boardId, card_id AS cardId,
      attempt_id AS attemptId, attempt_sequence AS attemptSequence, actor, kind,
      occurred_at AS occurredAt, payload_json AS payloadJson
    FROM journal_events ORDER BY journal_order
  `);
  const rows = statement.all();
  statement.finalize();

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
