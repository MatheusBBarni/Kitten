import type { RPCSchema } from "electrobun/bun";
import type { ActivitySequence, AttemptGeneration, AttemptId } from "@kitten/engine";
import type {
  AttemptInspectorProjection,
  CardInspectorProjection,
} from "../attempts/inspectorProjection.ts";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import type {
  BoardProjection,
  CardProjection,
  EdgeProjection,
  StageProjection,
  WorkflowCommand,
  WorkflowConflict,
  WorkflowRejection,
} from "../workflow/workflowTypes.ts";
import type { CatalogProjection } from "../persistence/eventJournal.ts";
import type {
  AnswerAttentionRpcInput,
  InspectorCommandResultEnvelope,
  InspectorRpcRequest,
  StopAttemptRpcInput,
} from "../host/desktopRpc.ts";
import type {
  DesktopSettingsProjection,
  SetExecutionLimitInput,
  SettingsCommandEnvelope,
  SettingsCommandRequest,
  SettingsCommandResult,
  SettingsEnvelope,
  SettingsQueryResult,
  SettingsSection,
  SettingsTheme,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "./desktopRpc.ts";
export type {
  AnswerAttentionRpcInput,
  InspectorCommandResultEnvelope,
  StopAttemptRpcInput,
} from "../host/desktopRpc.ts";
export type {
  DesktopSettingsProjection,
  DesktopSettingsRpc,
  FutureCardProfileDefaults,
  SetExecutionLimitInput,
  SettingsCommandEnvelope,
  SettingsCommandRequest,
  SettingsCommandResult,
  SettingsEnvelope,
  SettingsProfileProjection,
  SettingsQueryResult,
  SettingsSection,
  SettingsTheme,
  SettingsUnavailable,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "./desktopRpc.ts";

export type JsonPrimitive = boolean | number | string | null;
export type ProjectionValue =
  | JsonPrimitive
  | { readonly [key: string]: ProjectionValue }
  | readonly ProjectionValue[];

export const REVIEW_MANIFEST_FILE_LIMIT = 2_000;
export const REVIEW_DIFF_CHUNK_BYTE_LIMIT = 64 * 1_024;
export const RPC_IDENTIFIER_LENGTH_LIMIT = 256;
export const RPC_PATH_LENGTH_LIMIT = 4_096;

export const SUPERVISION_STATUSES = [
  "needs_attention",
  "ready_for_review",
  "failed",
  "running",
  "settled",
] as const;
export type SupervisionStatus = (typeof SUPERVISION_STATUSES)[number];
export type SupervisionPriority = 0 | 1 | 2 | 3 | 4;

export const SUBMISSION_SOURCES = [
  "initial",
  "composer",
  "request_changes",
] as const;
export type PromptSubmissionSource = (typeof SUBMISSION_SOURCES)[number];

export const CONTRACT_ERROR_CODES = [
  "stale_projection",
  "evidence_missing",
  "evidence_stale",
  "evidence_oversized",
  "evidence_unsafe",
  "worktree_binding_mismatch",
  "attempt_active",
  "blocker_active",
  "submission_interrupted",
  "invalid_prompt",
] as const;
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];

export const CONTRACT_RECOVERY_HINTS = [
  "refresh_projection",
  "reload_evidence",
  "retry_evidence_capture",
  "reduce_change_set",
  "resolve_unsafe_change",
  "wait_for_attempt",
  "resolve_blocker",
  "retry_submission",
  "edit_prompt",
  "none",
] as const;
export type ContractRecoveryHint = (typeof CONTRACT_RECOVERY_HINTS)[number];

export interface ContractError {
  readonly code: ContractErrorCode;
  readonly recoveryHint: ContractRecoveryHint;
  readonly expectedVersion?: number;
  readonly actualVersion?: number;
}

export type ReviewEvidenceAvailability =
  | { readonly status: "not_applicable" }
  | {
      readonly status: "available";
      readonly evidenceId: string;
      readonly evidenceDigest: string;
    }
  | {
      readonly status: "unavailable";
      readonly error: ContractError;
    };

export interface SupervisionItem {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly cardVersion: number;
  readonly attemptId: AttemptId | null;
  readonly generation: AttemptGeneration | null;
  readonly status: SupervisionStatus;
  readonly priority: SupervisionPriority;
  readonly evidenceAvailability: ReviewEvidenceAvailability;
  readonly actionableAt: number;
  readonly updatedAt: number;
}

export interface SupervisionGroup {
  readonly status: SupervisionStatus;
  readonly priority: SupervisionPriority;
  readonly items: readonly SupervisionItem[];
}

export type SupervisionCounts = Readonly<Record<SupervisionStatus, number>>;

export interface SupervisionProjection {
  readonly kind: "supervision_projection";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly generatedAt: number;
  readonly groups: readonly SupervisionGroup[];
  readonly counts: SupervisionCounts;
}

export const REVIEW_EVIDENCE_FILE_STATUSES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "binary",
] as const;
export type ReviewEvidenceFileStatus = (typeof REVIEW_EVIDENCE_FILE_STATUSES)[number];

export interface ReviewEvidenceFileSummary {
  readonly fileId: string;
  readonly index: number;
  readonly status: ReviewEvidenceFileStatus;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isBinary: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly patchByteLength: number;
  readonly patchDigest: string;
  readonly contentDigest: string | null;
}

export interface ReviewEvidenceManifest {
  readonly kind: "review_evidence_manifest";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly evidenceId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
  readonly evidenceDigest: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly policyVersion: number;
  readonly fileCount: number;
  readonly totalPatchBytes: number;
  readonly createdAt: number;
  readonly availability: ReviewEvidenceAvailability;
  readonly files: readonly ReviewEvidenceFileSummary[];
}

export interface ReviewDiffChunk {
  readonly kind: "review_diff_chunk";
  readonly schemaVersion: 1;
  readonly evidenceId: string;
  readonly fileId: string;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly complete: boolean;
  readonly content: string;
  readonly encoding: "utf8";
}

export interface GetReviewManifestRequest {
  readonly cardId: CardId;
  readonly evidenceId: string;
}

export interface GetReviewDiffChunkRequest {
  readonly evidenceId: string;
  readonly fileId: string;
  readonly offset: number;
}

export interface ReviewEvidencePrecondition {
  readonly evidenceId: string;
  readonly evidenceDigest: string;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
}

export interface SubmitCardPromptInput {
  readonly commandId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
  readonly content: string;
  readonly source: PromptSubmissionSource;
  readonly activeAttempt?: {
    readonly attemptId: AttemptId;
    readonly generation: AttemptGeneration;
  };
  readonly evidence?: ReviewEvidencePrecondition;
}

export type SubmitCardPromptResult =
  | {
      readonly status: "ok";
      readonly outcome: "admitted" | "queued";
      readonly cardVersion: number;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
    }
  | {
      readonly status: "rejected";
      readonly error: ContractError;
    };

export interface ReviewDispositionInput {
  readonly commandId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
  readonly disposition: "approved";
  readonly evidence: ReviewEvidencePrecondition;
}

export type ReviewApprovalResult =
  | {
      readonly status: "ok";
      readonly outcome: "approved" | "idempotent";
      readonly cardVersion: number;
    }
  | {
      readonly status: "rejected";
      readonly error: ContractError;
    };

export interface SupervisionEnvelope {
  readonly kind: "supervision";
  readonly result: DesktopQueryResult<SupervisionProjection>;
}

export interface ReviewManifestEnvelope {
  readonly kind: "review_manifest";
  readonly result:
    | RpcSuccess<ReviewEvidenceManifest>
    | { readonly status: "rejected"; readonly error: ContractError }
    | RpcUnavailable;
}

export interface ReviewDiffChunkEnvelope {
  readonly kind: "review_diff_chunk";
  readonly result:
    | RpcSuccess<ReviewDiffChunk>
    | { readonly status: "rejected"; readonly error: ContractError }
    | RpcUnavailable;
}

export interface SubmitCardPromptEnvelope {
  readonly kind: "submit_card_prompt_result";
  readonly commandId: string;
  readonly result: SubmitCardPromptResult;
}

export interface ReviewApprovalEnvelope {
  readonly kind: "review_approval_result";
  readonly commandId: string;
  readonly result: ReviewApprovalResult;
}

export interface DesktopSnapshot {
  readonly kind: "desktop_snapshot";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly workspace: {
    readonly status: "unbound" | "bound";
    readonly boardCount: number;
  };
  readonly settings: {
    readonly theme: SettingsTheme;
    readonly executionLimit: number;
  };
}

export interface WorkflowBoardProjection {
  readonly kind: "workflow_board_projection";
  readonly revision: number;
  readonly board: BoardProjection | null;
  readonly stages: readonly StageProjection[];
  readonly edges: readonly EdgeProjection[];
  readonly cards: readonly CardProjection[];
}

export interface WorkflowCatalogProjection {
  readonly kind: "workflow_catalog_projection";
  readonly revision: number;
  readonly catalog: CatalogProjection;
}

export interface WorkspaceBoardSummary {
  readonly boardId: BoardId;
  readonly repositoryPath: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly workflowVersion: number;
}

export interface WorkspaceProjection {
  readonly kind: "workspace_projection";
  readonly revision: number;
  readonly boards: readonly WorkspaceBoardSummary[];
}

export interface RpcSuccess<TProjection> {
  readonly status: "ok";
  readonly projection: TProjection;
}

export interface RpcConflict {
  readonly status: "conflict";
  readonly conflict: {
    readonly kind: "stale_projection";
    readonly expectedRevision: number;
    readonly actualRevision: number;
  };
}

export interface RpcUnavailable {
  readonly status: "unavailable";
  readonly unavailable: {
    readonly resource:
      | "desktop_host"
      | "desktop_snapshot"
      | "workflow_board"
      | "workflow_catalog"
      | "workflow_command"
      | "card_inspector"
      | "desktop_settings"
      | "settings_command"
      | "supervision"
      | "review_manifest"
      | "review_diff_chunk"
      | "prompt_submission"
      | "review_disposition";
    readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
  };
}

export type WorkflowCommandRpcResult =
  | {
      readonly status: "ok";
      readonly outcome: "committed" | "idempotent";
      readonly projection: WorkflowBoardProjection;
    }
  | {
      readonly status: "conflict";
      readonly conflict: WorkflowConflict;
    }
  | {
      readonly status: "rejected";
      readonly rejection: WorkflowRejection;
    }
  | RpcUnavailable;

export interface WorkflowBoardEnvelope {
  readonly kind: "workflow_board";
  readonly result: DesktopQueryResult<WorkflowBoardProjection>;
}

export interface WorkflowCatalogEnvelope {
  readonly kind: "workflow_catalog";
  readonly result: DesktopQueryResult<WorkflowCatalogProjection>;
}

export interface WorkspaceEnvelope {
  readonly kind: "workspace";
  readonly result: DesktopQueryResult<WorkspaceProjection>;
}

export type RepositoryDirectoryPickerResult =
  | { readonly status: "selected"; readonly path: string; readonly boardId?: BoardId }
  | { readonly status: "cancelled" }
  | {
      readonly status: "unavailable";
      readonly unavailable: {
        readonly resource: "repository_picker";
        readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
      };
    };

export interface RepositoryDirectoryPickerEnvelope {
  readonly kind: "repository_directory_picker";
  readonly result: RepositoryDirectoryPickerResult;
}

export interface WorkflowCommandEnvelope {
  readonly kind: "workflow_command_result";
  readonly commandId: string;
  readonly result: WorkflowCommandRpcResult;
}

export type DesktopQueryResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcUnavailable;

export type DesktopCommandResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcConflict
  | RpcUnavailable;

export interface DesktopCommandEnvelope<TCommand extends ProjectionValue = ProjectionValue> {
  readonly kind: "command";
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly command: TCommand;
}

export interface DesktopCommandResultEnvelope<TProjection> {
  readonly kind: "command_result";
  readonly commandId: string;
  readonly result: DesktopCommandResult<TProjection>;
}

export interface BootstrapEnvelope {
  readonly kind: "bootstrap";
  readonly result: DesktopQueryResult<DesktopSnapshot>;
}

export interface CardInspectorEnvelope {
  readonly kind: "card_inspector";
  readonly result: DesktopQueryResult<CardInspectorProjection>;
}

export type HostMessageEnvelope =
  | {
      readonly kind: "projection_committed";
      readonly messageId: string;
      readonly revision: number;
    }
  | {
      readonly kind: "settings_committed";
      readonly messageId: string;
      readonly revision: number;
      readonly changedSections: readonly SettingsSection[];
    }
  | {
      readonly kind: "host_unavailable";
      readonly messageId: string;
      readonly reason: RpcUnavailable["unavailable"]["reason"];
    }
  | {
      readonly kind: "attempt_activity";
      readonly messageId: string;
      readonly revision: number;
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
      readonly sequence: ActivitySequence;
      readonly projection: AttemptInspectorProjection;
    };

export type DesktopRpcSchema = {
  bun: RPCSchema<{
    requests: {
      reportNativeCaptureReady: {
        params: {
          readonly fixtureId: string;
          readonly state: string;
          readonly result: "ready" | "failed";
          readonly reason?: string;
        };
        response: { readonly accepted: boolean };
      };
      getDesktopSnapshot: {
        params: { readonly knownRevision?: number };
        response: BootstrapEnvelope;
      };
      getCardInspector: {
        params: { readonly cardId: string };
        response: CardInspectorEnvelope;
      };
      getBoard: {
        params: { readonly boardId?: string; readonly mode?: "active" | "new" };
        response: WorkflowBoardEnvelope;
      };
      getWorkspace: {
        params: { readonly knownRevision?: number };
        response: WorkspaceEnvelope;
      };
      getSupervision: {
        params: { readonly knownRevision?: number };
        response: SupervisionEnvelope;
      };
      getReviewManifest: {
        params: GetReviewManifestRequest;
        response: ReviewManifestEnvelope;
      };
      getReviewDiffChunk: {
        params: GetReviewDiffChunkRequest;
        response: ReviewDiffChunkEnvelope;
      };
      getCatalog: {
        params: { readonly catalogId?: string };
        response: WorkflowCatalogEnvelope;
      };
      pickRepositoryDirectory: {
        params: Record<never, never>;
        response: RepositoryDirectoryPickerEnvelope;
      };
      executeWorkflowCommand: {
        params: { readonly commandId: string; readonly command: WorkflowCommand };
        response: WorkflowCommandEnvelope;
      };
      submitCardPrompt: {
        params: SubmitCardPromptInput;
        response: SubmitCardPromptEnvelope;
      };
      stopAttempt: {
        params: InspectorRpcRequest<StopAttemptRpcInput>;
        response: InspectorCommandResultEnvelope;
      };
      answerAttention: {
        params: InspectorRpcRequest<AnswerAttentionRpcInput>;
        response: InspectorCommandResultEnvelope;
      };
      reviewCard: {
        params: ReviewDispositionInput;
        response: ReviewApprovalEnvelope;
      };
      getSettings: {
        params: { readonly knownRevision?: number };
        response: SettingsEnvelope;
      };
      updatePreferences: {
        params: SettingsCommandRequest<UpdatePreferencesInput>;
        response: SettingsCommandEnvelope;
      };
      updateProfileDefaults: {
        params: SettingsCommandRequest<UpdateProfileDefaultsInput>;
        response: SettingsCommandEnvelope;
      };
      updateCatalogRoots: {
        params: SettingsCommandRequest<UpdateCatalogRootsInput>;
        response: SettingsCommandEnvelope;
      };
      setExecutionLimit: {
        params: SettingsCommandRequest<SetExecutionLimitInput>;
        response: SettingsCommandEnvelope;
      };
    };
    messages: Record<never, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<never, never>;
    messages: {
      hostMessage: HostMessageEnvelope;
    };
  }>;
};

const forbiddenProjectionKeys = [
  "acpconnection",
  "acpsession",
  "database",
  "databasehandle",
  "filesystem",
  "filesystemhandle",
  "gitprocess",
  "patchblob",
  "prompt",
  "sqlite",
  "sqlitehandle",
  "skillcontent",
  "skillcontents",
  "transcript",
  "worktree",
  "worktreepath",
  "worktreeobject",
  "secret",
  "secrets",
  "password",
  "credential",
  "credentials",
  "token",
  "privatekey",
  "apikey",
] as const;

const allowedProjectionIdentityKeys = new Set(["worktreebindingid"]);

function isAllowedProjectionKey(normalized: string, path: string): boolean {
  return allowedProjectionIdentityKeys.has(normalized)
    || (
      normalized === "prompt"
      && /^\$\.result\.projection\.attentionBlockers\[\d+\]\.form$/.test(path)
    );
}

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function assertProjectionNode(value: unknown, path: string, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== "object") {
    throw new ProjectionBoundaryError(path, "projection values must be JSON data");
  }

  if (seen.has(value)) {
    throw new ProjectionBoundaryError(path, "cyclic projection values are forbidden");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProjectionNode(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectionBoundaryError(path, "resource handles and class instances are forbidden");
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (
      !isAllowedProjectionKey(normalized, path)
      && forbiddenProjectionKeys.some((forbidden) => normalized.includes(forbidden))
    ) {
      throw new ProjectionBoundaryError(`${path}.${key}`, "privileged resources and secrets are forbidden");
    }
    assertProjectionNode(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export class ProjectionBoundaryError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Unsafe RPC projection at ${path}: ${reason}`);
    this.name = "ProjectionBoundaryError";
  }
}

export function assertProjectionPayload<T>(value: T): T {
  assertProjectionNode(value, "$", new WeakSet());
  return value;
}

type ContractRecord = Record<string, unknown>;

const supervisionPriorityByStatus: Readonly<Record<SupervisionStatus, SupervisionPriority>> = {
  needs_attention: 0,
  ready_for_review: 1,
  failed: 2,
  running: 3,
  settled: 4,
};

function contractRecord(value: unknown, path: string): ContractRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectionBoundaryError(path, "contract value must be an object");
  }
  return value as ContractRecord;
}

function assertExactKeys(value: ContractRecord, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ProjectionBoundaryError(`${path}.${key}`, "contract field is not declared");
    }
  }
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProjectionBoundaryError(path, "contract value must be a non-negative safe integer");
  }
}

function assertBoundedString(
  value: unknown,
  path: string,
  maximumLength = RPC_IDENTIFIER_LENGTH_LIMIT,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new ProjectionBoundaryError(path, `contract string must contain 1-${maximumLength} characters`);
  }
}

function assertNullableBoundedString(
  value: unknown,
  path: string,
  maximumLength = RPC_IDENTIFIER_LENGTH_LIMIT,
): void {
  if (value !== null) assertBoundedString(value, path, maximumLength);
}

function assertOpaqueIdentifier(value: unknown, path: string): void {
  assertBoundedString(value, path);
  if (value.trim() !== value || value.trim().length === 0) {
    throw new ProjectionBoundaryError(path, "opaque identity must not contain surrounding whitespace");
  }
}

function assertRepositoryRelativePath(value: unknown, path: string): void {
  if (value === null) return;
  assertBoundedString(value, path, RPC_PATH_LENGTH_LIMIT);
  if (
    value.startsWith("/")
    || value.startsWith("\\")
    || /^[A-Za-z]:[\\/]/u.test(value)
    || value.includes("\\")
    || value.includes("\0")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new ProjectionBoundaryError(path, "review file path must be repository-relative");
  }
}

function assertDeclaredValue<const TDeclared extends readonly string[]>(
  value: unknown,
  declared: TDeclared,
  path: string,
): asserts value is TDeclared[number] {
  if (typeof value !== "string" || !declared.includes(value)) {
    throw new ProjectionBoundaryError(path, "contract discriminant is not declared");
  }
}

function assertContractErrorRecord(value: unknown, path: string): asserts value is ContractError {
  const error = contractRecord(value, path);
  assertExactKeys(error, ["code", "recoveryHint", "expectedVersion", "actualVersion"], path);
  assertDeclaredValue(error.code, CONTRACT_ERROR_CODES, `${path}.code`);
  assertDeclaredValue(error.recoveryHint, CONTRACT_RECOVERY_HINTS, `${path}.recoveryHint`);
  if (error.expectedVersion !== undefined) {
    assertNonNegativeInteger(error.expectedVersion, `${path}.expectedVersion`);
  }
  if (error.actualVersion !== undefined) {
    assertNonNegativeInteger(error.actualVersion, `${path}.actualVersion`);
  }
}

export function assertContractError(value: unknown): asserts value is ContractError {
  assertProjectionPayload(value);
  assertContractErrorRecord(value, "$");
}

function assertEvidenceAvailability(
  value: unknown,
  path: string,
): asserts value is ReviewEvidenceAvailability {
  const availability = contractRecord(value, path);
  if (availability.status === "not_applicable") {
    assertExactKeys(availability, ["status"], path);
    return;
  }
  if (availability.status === "available") {
    assertExactKeys(availability, ["status", "evidenceId", "evidenceDigest"], path);
    assertBoundedString(availability.evidenceId, `${path}.evidenceId`);
    assertBoundedString(availability.evidenceDigest, `${path}.evidenceDigest`);
    return;
  }
  if (availability.status === "unavailable") {
    assertExactKeys(availability, ["status", "error"], path);
    assertContractErrorRecord(availability.error, `${path}.error`);
    if (
      ![
        "evidence_missing",
        "evidence_stale",
        "evidence_oversized",
        "evidence_unsafe",
        "worktree_binding_mismatch",
      ].includes(availability.error.code)
    ) {
      throw new ProjectionBoundaryError(`${path}.error.code`, "evidence availability requires an evidence error");
    }
    return;
  }
  throw new ProjectionBoundaryError(`${path}.status`, "evidence availability status is not declared");
}

function assertSupervisionItem(
  value: unknown,
  groupStatus: SupervisionStatus,
  path: string,
): asserts value is SupervisionItem {
  const item = contractRecord(value, path);
  assertExactKeys(item, [
    "boardId",
    "cardId",
    "cardVersion",
    "attemptId",
    "generation",
    "status",
    "priority",
    "evidenceAvailability",
    "actionableAt",
    "updatedAt",
  ], path);
  assertBoundedString(item.boardId, `${path}.boardId`);
  assertBoundedString(item.cardId, `${path}.cardId`);
  assertNonNegativeInteger(item.cardVersion, `${path}.cardVersion`);
  assertNullableBoundedString(item.attemptId, `${path}.attemptId`);
  if (item.generation !== null) assertNonNegativeInteger(item.generation, `${path}.generation`);
  if ((item.attemptId === null) !== (item.generation === null)) {
    throw new ProjectionBoundaryError(path, "attempt identity and generation must be present together");
  }
  assertDeclaredValue(item.status, SUPERVISION_STATUSES, `${path}.status`);
  assertNonNegativeInteger(item.priority, `${path}.priority`);
  if (
    item.status !== groupStatus
    || item.priority !== supervisionPriorityByStatus[item.status]
  ) {
    throw new ProjectionBoundaryError(path, "supervision item status and priority must match its group");
  }
  assertEvidenceAvailability(item.evidenceAvailability, `${path}.evidenceAvailability`);
  assertNonNegativeInteger(item.actionableAt, `${path}.actionableAt`);
  assertNonNegativeInteger(item.updatedAt, `${path}.updatedAt`);
}

export function assertSupervisionProjection(
  value: unknown,
): asserts value is SupervisionProjection {
  assertProjectionPayload(value);
  const projection = contractRecord(value, "$");
  assertExactKeys(projection, [
    "kind",
    "schemaVersion",
    "revision",
    "generatedAt",
    "groups",
    "counts",
  ], "$");
  if (projection.kind !== "supervision_projection" || projection.schemaVersion !== 1) {
    throw new ProjectionBoundaryError("$", "supervision projection kind or schema version is invalid");
  }
  assertNonNegativeInteger(projection.revision, "$.revision");
  assertNonNegativeInteger(projection.generatedAt, "$.generatedAt");
  if (!Array.isArray(projection.groups)) {
    throw new ProjectionBoundaryError("$.groups", "supervision groups must be an array");
  }
  const observedCounts = Object.fromEntries(
    SUPERVISION_STATUSES.map((status) => [status, 0]),
  ) as Record<SupervisionStatus, number>;
  const observedGroups = new Set<SupervisionStatus>();
  projection.groups.forEach((entry, index) => {
    const group = contractRecord(entry, `$.groups[${index}]`);
    assertExactKeys(group, ["status", "priority", "items"], `$.groups[${index}]`);
    assertDeclaredValue(group.status, SUPERVISION_STATUSES, `$.groups[${index}].status`);
    if (observedGroups.has(group.status)) {
      throw new ProjectionBoundaryError(`$.groups[${index}].status`, "supervision groups must be unique");
    }
    observedGroups.add(group.status);
    assertNonNegativeInteger(group.priority, `$.groups[${index}].priority`);
    if (group.priority !== supervisionPriorityByStatus[group.status]) {
      throw new ProjectionBoundaryError(`$.groups[${index}].priority`, "supervision priority is invalid");
    }
    if (!Array.isArray(group.items)) {
      throw new ProjectionBoundaryError(`$.groups[${index}].items`, "supervision items must be an array");
    }
    const groupStatus = group.status;
    group.items.forEach((item, itemIndex) => {
      assertSupervisionItem(item, groupStatus, `$.groups[${index}].items[${itemIndex}]`);
    });
    observedCounts[groupStatus] = group.items.length;
  });
  const counts = contractRecord(projection.counts, "$.counts");
  assertExactKeys(counts, SUPERVISION_STATUSES, "$.counts");
  for (const status of SUPERVISION_STATUSES) {
    assertNonNegativeInteger(counts[status], `$.counts.${status}`);
    if (counts[status] !== observedCounts[status]) {
      throw new ProjectionBoundaryError(`$.counts.${status}`, "supervision count does not match items");
    }
  }
}

function assertReviewEvidenceFileSummary(
  value: unknown,
  expectedIndex: number,
  path: string,
): asserts value is ReviewEvidenceFileSummary {
  const file = contractRecord(value, path);
  assertExactKeys(file, [
    "fileId",
    "index",
    "status",
    "oldPath",
    "newPath",
    "oldMode",
    "newMode",
    "isBinary",
    "additions",
    "deletions",
    "patchByteLength",
    "patchDigest",
    "contentDigest",
  ], path);
  assertBoundedString(file.fileId, `${path}.fileId`);
  assertNonNegativeInteger(file.index, `${path}.index`);
  if (file.index !== expectedIndex) {
    throw new ProjectionBoundaryError(`${path}.index`, "file summary index is not canonical");
  }
  assertDeclaredValue(file.status, REVIEW_EVIDENCE_FILE_STATUSES, `${path}.status`);
  assertRepositoryRelativePath(file.oldPath, `${path}.oldPath`);
  assertRepositoryRelativePath(file.newPath, `${path}.newPath`);
  assertNullableBoundedString(file.oldMode, `${path}.oldMode`);
  assertNullableBoundedString(file.newMode, `${path}.newMode`);
  if (file.oldPath === null && file.newPath === null) {
    throw new ProjectionBoundaryError(path, "file summary requires an old or new path");
  }
  if (typeof file.isBinary !== "boolean" || file.isBinary !== (file.status === "binary")) {
    throw new ProjectionBoundaryError(`${path}.isBinary`, "binary flag must match file status");
  }
  if (file.additions !== null) assertNonNegativeInteger(file.additions, `${path}.additions`);
  if (file.deletions !== null) assertNonNegativeInteger(file.deletions, `${path}.deletions`);
  assertNonNegativeInteger(file.patchByteLength, `${path}.patchByteLength`);
  assertBoundedString(file.patchDigest, `${path}.patchDigest`);
  assertNullableBoundedString(file.contentDigest, `${path}.contentDigest`);
}

export function assertReviewEvidenceManifest(
  value: unknown,
): asserts value is ReviewEvidenceManifest {
  assertProjectionPayload(value);
  const manifest = contractRecord(value, "$");
  assertExactKeys(manifest, [
    "kind",
    "schemaVersion",
    "revision",
    "evidenceId",
    "boardId",
    "cardId",
    "attemptId",
    "generation",
    "worktreeBindingId",
    "evidenceDigest",
    "baseCommit",
    "headCommit",
    "policyVersion",
    "fileCount",
    "totalPatchBytes",
    "createdAt",
    "availability",
    "files",
  ], "$");
  if (manifest.kind !== "review_evidence_manifest" || manifest.schemaVersion !== 1) {
    throw new ProjectionBoundaryError("$", "review manifest kind or schema version is invalid");
  }
  assertNonNegativeInteger(manifest.revision, "$.revision");
  for (const key of [
    "evidenceId",
    "boardId",
    "cardId",
    "attemptId",
    "worktreeBindingId",
    "evidenceDigest",
    "baseCommit",
    "headCommit",
  ] as const) {
    assertBoundedString(manifest[key], `$.${key}`);
  }
  assertNonNegativeInteger(manifest.generation, "$.generation");
  assertNonNegativeInteger(manifest.policyVersion, "$.policyVersion");
  assertNonNegativeInteger(manifest.fileCount, "$.fileCount");
  assertNonNegativeInteger(manifest.totalPatchBytes, "$.totalPatchBytes");
  assertNonNegativeInteger(manifest.createdAt, "$.createdAt");
  if (!Array.isArray(manifest.files)) {
    throw new ProjectionBoundaryError("$.files", "review manifest files must be an array");
  }
  if (
    manifest.files.length > REVIEW_MANIFEST_FILE_LIMIT
    || manifest.fileCount !== manifest.files.length
  ) {
    throw new ProjectionBoundaryError("$.files", "review manifest file limit or count is invalid");
  }
  const fileIds = new Set<string>();
  manifest.files.forEach((file, index) => {
    assertReviewEvidenceFileSummary(file, index, `$.files[${index}]`);
    if (fileIds.has(file.fileId)) {
      throw new ProjectionBoundaryError(`$.files[${index}].fileId`, "file identifiers must be unique");
    }
    fileIds.add(file.fileId);
  });
  assertEvidenceAvailability(manifest.availability, "$.availability");
  if (
    manifest.availability.status === "available"
    && (
      manifest.availability.evidenceId !== manifest.evidenceId
      || manifest.availability.evidenceDigest !== manifest.evidenceDigest
    )
  ) {
    throw new ProjectionBoundaryError("$.availability", "available evidence identity must match the manifest");
  }
}

export function assertReviewDiffChunk(value: unknown): asserts value is ReviewDiffChunk {
  assertProjectionPayload(value);
  const chunk = contractRecord(value, "$");
  assertExactKeys(chunk, [
    "kind",
    "schemaVersion",
    "evidenceId",
    "fileId",
    "offset",
    "nextOffset",
    "complete",
    "content",
    "encoding",
  ], "$");
  if (
    chunk.kind !== "review_diff_chunk"
    || chunk.schemaVersion !== 1
    || chunk.encoding !== "utf8"
  ) {
    throw new ProjectionBoundaryError("$", "review chunk kind, schema version, or encoding is invalid");
  }
  assertBoundedString(chunk.evidenceId, "$.evidenceId");
  assertBoundedString(chunk.fileId, "$.fileId");
  assertNonNegativeInteger(chunk.offset, "$.offset");
  if (typeof chunk.content !== "string") {
    throw new ProjectionBoundaryError("$.content", "review chunk content must be text");
  }
  if (typeof chunk.complete !== "boolean") {
    throw new ProjectionBoundaryError("$.complete", "review chunk completion must be boolean");
  }
  const decodedBytes = new TextEncoder().encode(chunk.content).byteLength;
  if (decodedBytes > REVIEW_DIFF_CHUNK_BYTE_LIMIT) {
    throw new ProjectionBoundaryError("$.content", "review chunk exceeds the decoded byte limit");
  }
  if (chunk.complete) {
    if (chunk.nextOffset !== null) {
      throw new ProjectionBoundaryError("$.nextOffset", "complete review chunks must not expose a next offset");
    }
    return;
  }
  assertNonNegativeInteger(chunk.nextOffset, "$.nextOffset");
  if (decodedBytes === 0 || chunk.nextOffset !== chunk.offset + decodedBytes) {
    throw new ProjectionBoundaryError("$.nextOffset", "review chunk offset metadata is inconsistent");
  }
}

export function assertGetReviewManifestRequest(
  value: unknown,
): asserts value is GetReviewManifestRequest {
  assertProjectionPayload(value);
  const request = contractRecord(value, "$");
  assertExactKeys(request, ["cardId", "evidenceId"], "$");
  assertOpaqueIdentifier(request.cardId, "$.cardId");
  assertOpaqueIdentifier(request.evidenceId, "$.evidenceId");
}

export function assertGetReviewDiffChunkRequest(
  value: unknown,
): asserts value is GetReviewDiffChunkRequest {
  assertProjectionPayload(value);
  const request = contractRecord(value, "$");
  assertExactKeys(request, ["evidenceId", "fileId", "offset"], "$");
  assertOpaqueIdentifier(request.evidenceId, "$.evidenceId");
  assertOpaqueIdentifier(request.fileId, "$.fileId");
  assertNonNegativeInteger(request.offset, "$.offset");
}

function assertReviewEvidencePrecondition(
  value: unknown,
  path: string,
): asserts value is ReviewEvidencePrecondition {
  const evidence = contractRecord(value, path);
  assertExactKeys(evidence, [
    "evidenceId",
    "evidenceDigest",
    "attemptId",
    "generation",
    "worktreeBindingId",
  ], path);
  assertBoundedString(evidence.evidenceId, `${path}.evidenceId`);
  assertBoundedString(evidence.evidenceDigest, `${path}.evidenceDigest`);
  assertBoundedString(evidence.attemptId, `${path}.attemptId`);
  assertNonNegativeInteger(evidence.generation, `${path}.generation`);
  assertBoundedString(evidence.worktreeBindingId, `${path}.worktreeBindingId`);
}

export function assertSubmitCardPromptInput(
  value: unknown,
): asserts value is SubmitCardPromptInput {
  assertProjectionPayload(value);
  const input = contractRecord(value, "$");
  assertExactKeys(input, [
    "commandId",
    "boardId",
    "cardId",
    "expectedCardVersion",
    "content",
    "source",
    "activeAttempt",
    "evidence",
  ], "$");
  assertBoundedString(input.commandId, "$.commandId");
  assertBoundedString(input.boardId, "$.boardId");
  assertBoundedString(input.cardId, "$.cardId");
  assertNonNegativeInteger(input.expectedCardVersion, "$.expectedCardVersion");
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    throw new ProjectionBoundaryError("$.content", "prompt content must be non-empty");
  }
  assertDeclaredValue(input.source, SUBMISSION_SOURCES, "$.source");
  if (input.activeAttempt !== undefined) {
    const attempt = contractRecord(input.activeAttempt, "$.activeAttempt");
    assertExactKeys(attempt, ["attemptId", "generation"], "$.activeAttempt");
    assertBoundedString(attempt.attemptId, "$.activeAttempt.attemptId");
    assertNonNegativeInteger(attempt.generation, "$.activeAttempt.generation");
  }
  if (input.evidence !== undefined) {
    assertReviewEvidencePrecondition(input.evidence, "$.evidence");
  }
  if ((input.source === "request_changes") !== (input.evidence !== undefined)) {
    throw new ProjectionBoundaryError("$.evidence", "only request-changes submissions require evidence");
  }
}

export function assertReviewDispositionInput(
  value: unknown,
): asserts value is ReviewDispositionInput {
  assertProjectionPayload(value);
  const input = contractRecord(value, "$");
  assertExactKeys(input, [
    "commandId",
    "boardId",
    "cardId",
    "expectedCardVersion",
    "disposition",
    "evidence",
  ], "$");
  assertBoundedString(input.commandId, "$.commandId");
  assertBoundedString(input.boardId, "$.boardId");
  assertBoundedString(input.cardId, "$.cardId");
  assertNonNegativeInteger(input.expectedCardVersion, "$.expectedCardVersion");
  if (input.disposition !== "approved") {
    throw new ProjectionBoundaryError("$.disposition", "approval disposition must be approved");
  }
  assertReviewEvidencePrecondition(input.evidence, "$.evidence");
}

function assertSubmitCardPromptResult(
  value: unknown,
  path: string,
): asserts value is SubmitCardPromptResult {
  const result = contractRecord(value, path);
  if (result.status === "ok") {
    assertExactKeys(result, ["status", "outcome", "cardVersion", "attemptId", "generation"], path);
    assertDeclaredValue(result.outcome, ["admitted", "queued"], `${path}.outcome`);
    assertNonNegativeInteger(result.cardVersion, `${path}.cardVersion`);
    assertBoundedString(result.attemptId, `${path}.attemptId`);
    assertNonNegativeInteger(result.generation, `${path}.generation`);
    return;
  }
  if (result.status === "rejected") {
    assertExactKeys(result, ["status", "error"], path);
    assertContractErrorRecord(result.error, `${path}.error`);
    return;
  }
  throw new ProjectionBoundaryError(`${path}.status`, "submission result status is not declared");
}

function assertReviewApprovalResult(
  value: unknown,
  path: string,
): asserts value is ReviewApprovalResult {
  const result = contractRecord(value, path);
  if (result.status === "ok") {
    assertExactKeys(result, ["status", "outcome", "cardVersion"], path);
    assertDeclaredValue(result.outcome, ["approved", "idempotent"], `${path}.outcome`);
    assertNonNegativeInteger(result.cardVersion, `${path}.cardVersion`);
    return;
  }
  if (result.status === "rejected") {
    assertExactKeys(result, ["status", "error"], path);
    assertContractErrorRecord(result.error, `${path}.error`);
    return;
  }
  throw new ProjectionBoundaryError(`${path}.status`, "approval result status is not declared");
}

export function createEmptyDesktopSnapshot(): DesktopSnapshot {
  return {
    kind: "desktop_snapshot",
    schemaVersion: 1,
    revision: 0,
    workspace: { status: "unbound", boardCount: 0 },
    settings: { theme: "system", executionLimit: 1 },
  };
}

export function createEmptyWorkspaceProjection(revision = 0): WorkspaceProjection {
  return {
    kind: "workspace_projection",
    revision,
    boards: [],
  };
}

export function createEmptyWorkflowBoardProjection(revision = 0): WorkflowBoardProjection {
  return {
    kind: "workflow_board_projection",
    revision,
    board: null,
    stages: [],
    edges: [],
    cards: [],
  };
}

export function createEmptyWorkflowCatalogProjection(revision = 0): WorkflowCatalogProjection {
  return {
    kind: "workflow_catalog_projection",
    revision,
    catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
  };
}

export function createEmptySupervisionProjection(revision = 0): SupervisionProjection {
  return {
    kind: "supervision_projection",
    schemaVersion: 1,
    revision,
    generatedAt: 0,
    groups: SUPERVISION_STATUSES.map((status, priority) => ({
      status,
      priority: priority as SupervisionPriority,
      items: [],
    })),
    counts: Object.fromEntries(
      SUPERVISION_STATUSES.map((status) => [status, 0]),
    ) as Record<SupervisionStatus, number>,
  };
}

export function createSupervisionEnvelope(
  result: DesktopQueryResult<SupervisionProjection>,
): SupervisionEnvelope {
  if (result.status === "ok") assertSupervisionProjection(result.projection);
  return assertProjectionPayload({ kind: "supervision", result });
}

export function createReviewManifestEnvelope(
  result: ReviewManifestEnvelope["result"],
): ReviewManifestEnvelope {
  if (result.status === "ok") assertReviewEvidenceManifest(result.projection);
  if (result.status === "rejected") assertContractError(result.error);
  return assertProjectionPayload({ kind: "review_manifest", result });
}

export function createReviewDiffChunkEnvelope(
  result: ReviewDiffChunkEnvelope["result"],
): ReviewDiffChunkEnvelope {
  if (result.status === "ok") assertReviewDiffChunk(result.projection);
  if (result.status === "rejected") assertContractError(result.error);
  return assertProjectionPayload({ kind: "review_diff_chunk", result });
}

export function createSubmitCardPromptEnvelope(
  commandId: string,
  result: SubmitCardPromptResult,
): SubmitCardPromptEnvelope {
  assertBoundedString(commandId, "$.commandId");
  assertProjectionPayload(result);
  assertSubmitCardPromptResult(result, "$.result");
  return assertProjectionPayload({ kind: "submit_card_prompt_result", commandId, result });
}

export function createReviewApprovalEnvelope(
  commandId: string,
  result: ReviewApprovalResult,
): ReviewApprovalEnvelope {
  assertBoundedString(commandId, "$.commandId");
  assertProjectionPayload(result);
  assertReviewApprovalResult(result, "$.result");
  return assertProjectionPayload({ kind: "review_approval_result", commandId, result });
}

export function createBootstrapEnvelope(
  result: DesktopQueryResult<DesktopSnapshot>,
): BootstrapEnvelope {
  return assertProjectionPayload({ kind: "bootstrap", result });
}

export function createCardInspectorEnvelope(
  result: DesktopQueryResult<CardInspectorProjection>,
): CardInspectorEnvelope {
  return assertProjectionPayload({ kind: "card_inspector", result });
}

export function createWorkflowBoardEnvelope(
  result: DesktopQueryResult<WorkflowBoardProjection>,
): WorkflowBoardEnvelope {
  return assertProjectionPayload({ kind: "workflow_board", result });
}

export function createWorkflowCatalogEnvelope(
  result: DesktopQueryResult<WorkflowCatalogProjection>,
): WorkflowCatalogEnvelope {
  return assertProjectionPayload({ kind: "workflow_catalog", result });
}

export function createWorkspaceEnvelope(
  result: DesktopQueryResult<WorkspaceProjection>,
): WorkspaceEnvelope {
  return assertProjectionPayload({ kind: "workspace", result });
}

export function createRepositoryDirectoryPickerEnvelope(
  result: RepositoryDirectoryPickerResult,
): RepositoryDirectoryPickerEnvelope {
  return assertProjectionPayload({ kind: "repository_directory_picker", result });
}

export function createWorkflowCommandEnvelope(
  commandId: string,
  result: WorkflowCommandRpcResult,
): WorkflowCommandEnvelope {
  if (commandId.trim().length === 0) throw new Error("Workflow commandId must be non-empty");
  return assertProjectionPayload({ kind: "workflow_command_result", commandId, result });
}

export function createSettingsEnvelope(result: SettingsQueryResult): SettingsEnvelope {
  return assertProjectionPayload({ kind: "desktop_settings", result });
}

export function createSettingsCommandEnvelope(
  commandId: string,
  result: SettingsCommandResult,
): SettingsCommandEnvelope {
  if (commandId.trim().length === 0) throw new Error("Settings commandId must be non-empty");
  return assertProjectionPayload({ kind: "settings_command_result", commandId, result });
}

export function createCommandResultEnvelope<TProjection>(
  commandId: string,
  result: DesktopCommandResult<TProjection>,
): DesktopCommandResultEnvelope<TProjection> {
  return assertProjectionPayload({ kind: "command_result", commandId, result });
}

export function assertHostMessage(message: HostMessageEnvelope): HostMessageEnvelope {
  return assertProjectionPayload(message);
}

export function createAttemptActivityMessage(input: Omit<
  Extract<HostMessageEnvelope, { kind: "attempt_activity" }>,
  "kind"
>): HostMessageEnvelope {
  return assertHostMessage({ kind: "attempt_activity", ...input });
}
