import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export type ReviewEvidenceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "binary";

const REVIEW_EVIDENCE_FILE_STATUSES: readonly ReviewEvidenceFileStatus[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "binary",
];

export interface ReviewEvidenceFileRecord {
  readonly evidenceId: string;
  readonly fileIndex: number;
  readonly fileId: string;
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
  readonly patchBlob: Uint8Array | null;
}

export interface ReviewEvidenceRecord {
  readonly evidenceId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly policyVersion: number;
  readonly evidenceDigest: string;
  readonly fileCount: number;
  readonly totalPatchBytes: number;
  readonly createdAt: number;
  readonly files: readonly ReviewEvidenceFileRecord[];
}

export type ReviewEvidenceSummary = Omit<ReviewEvidenceRecord, "files">;
export type ReviewEvidenceFileMetadata = Omit<ReviewEvidenceFileRecord, "patchBlob">;
export type ReviewEvidenceManifestRecord = ReviewEvidenceSummary & {
  readonly files: readonly ReviewEvidenceFileMetadata[];
};

export interface ReviewEvidenceReference {
  readonly evidenceId: string;
  readonly evidenceDigest: string;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly createdAt: number;
}

export type PersistReviewEvidenceResult = "inserted" | "idempotent";

export class ReviewEvidenceValidationError extends Error {
  constructor(message: string) {
    super(`Invalid review evidence: ${message}`);
    this.name = "ReviewEvidenceValidationError";
  }
}

export class ReviewEvidenceIdentityConflictError extends Error {
  constructor(readonly evidenceId: string) {
    super(`Review evidence identity conflict: ${evidenceId}`);
    this.name = "ReviewEvidenceIdentityConflictError";
  }
}

interface ReviewEvidenceRow {
  readonly evidenceId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly policyVersion: number;
  readonly evidenceDigest: string;
  readonly fileCount: number;
  readonly totalPatchBytes: number;
  readonly createdAt: number;
}

interface ReviewEvidenceFileRow {
  readonly evidenceId: string;
  readonly fileIndex: number;
  readonly fileId: string;
  readonly status: ReviewEvidenceFileStatus;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isBinary: number;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly patchByteLength: number;
  readonly patchDigest: string;
  readonly contentDigest: string | null;
  readonly patchBlob: Uint8Array | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ReviewEvidenceValidationError(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  if (
    Object.keys(value).length !== expected.size
    || Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new ReviewEvidenceValidationError(`${label} fields are invalid`);
  }
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReviewEvidenceValidationError(`${label} must be non-empty`);
  }
  return value;
}

function nullableNonEmpty(value: unknown, label: string): string | null {
  return value === null ? null : nonEmpty(value, label);
}

function integer(value: unknown, label: string, positive = false): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < (positive ? 1 : 0)
  ) {
    throw new ReviewEvidenceValidationError(
      `${label} must be a ${positive ? "positive" : "non-negative"} safe integer`,
    );
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

function digest(value: unknown, label: string): string {
  const parsed = nonEmpty(value, label);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new ReviewEvidenceValidationError(`${label} must be a lowercase SHA-256 digest`);
  }
  return parsed;
}

function nullableDigest(value: unknown, label: string): string | null {
  return value === null ? null : digest(value, label);
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function validateFile(
  input: unknown,
  evidenceId: string,
  expectedIndex: number,
): ReviewEvidenceFileRecord {
  const value = record(input, `files[${expectedIndex}]`);
  exactKeys(value, [
    "evidenceId",
    "fileIndex",
    "fileId",
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
    "patchBlob",
  ], `files[${expectedIndex}]`);
  const fileEvidenceId = nonEmpty(value.evidenceId, `files[${expectedIndex}].evidenceId`);
  const fileIndex = integer(value.fileIndex, `files[${expectedIndex}].fileIndex`);
  if (fileEvidenceId !== evidenceId || fileIndex !== expectedIndex) {
    throw new ReviewEvidenceValidationError("file identity or canonical ordering is invalid");
  }
  const status = nonEmpty(value.status, `files[${expectedIndex}].status`) as ReviewEvidenceFileStatus;
  if (!REVIEW_EVIDENCE_FILE_STATUSES.includes(status)) {
    throw new ReviewEvidenceValidationError(`files[${expectedIndex}].status is unsupported`);
  }
  const oldPath = nullableNonEmpty(value.oldPath, `files[${expectedIndex}].oldPath`);
  const newPath = nullableNonEmpty(value.newPath, `files[${expectedIndex}].newPath`);
  if (oldPath === null && newPath === null) {
    throw new ReviewEvidenceValidationError("each file requires an old or new path");
  }
  if (typeof value.isBinary !== "boolean" || value.isBinary !== (status === "binary")) {
    throw new ReviewEvidenceValidationError("file binary identity is inconsistent");
  }
  const patchBlob = value.patchBlob === null
    ? null
    : value.patchBlob instanceof Uint8Array
      ? new Uint8Array(value.patchBlob)
      : (() => {
          throw new ReviewEvidenceValidationError("file patchBlob must be bytes or null");
        })();
  const patchByteLength = integer(
    value.patchByteLength,
    `files[${expectedIndex}].patchByteLength`,
  );
  if (
    (value.isBinary && (patchBlob !== null || patchByteLength !== 0))
    || (!value.isBinary && (patchBlob === null || patchBlob.byteLength !== patchByteLength))
  ) {
    throw new ReviewEvidenceValidationError("file patch bytes are inconsistent");
  }
  const patchDigest = digest(value.patchDigest, `files[${expectedIndex}].patchDigest`);
  if (
    patchBlob !== null
    && createHash("sha256").update(patchBlob).digest("hex") !== patchDigest
  ) {
    throw new ReviewEvidenceValidationError("file patch digest does not match patch bytes");
  }
  const contentDigest = nullableDigest(
    value.contentDigest,
    `files[${expectedIndex}].contentDigest`,
  );
  if (value.isBinary && contentDigest === null) {
    throw new ReviewEvidenceValidationError("binary file content digest is required");
  }
  return Object.freeze({
    evidenceId,
    fileIndex,
    fileId: nonEmpty(value.fileId, `files[${expectedIndex}].fileId`),
    status,
    oldPath,
    newPath,
    oldMode: nullableNonEmpty(value.oldMode, `files[${expectedIndex}].oldMode`),
    newMode: nullableNonEmpty(value.newMode, `files[${expectedIndex}].newMode`),
    isBinary: value.isBinary,
    additions: nullableInteger(value.additions, `files[${expectedIndex}].additions`),
    deletions: nullableInteger(value.deletions, `files[${expectedIndex}].deletions`),
    patchByteLength,
    patchDigest,
    contentDigest,
    patchBlob,
  });
}

export function validateReviewEvidence(input: unknown): ReviewEvidenceRecord {
  const value = record(input, "manifest");
  exactKeys(value, [
    "evidenceId",
    "boardId",
    "cardId",
    "attemptId",
    "generation",
    "worktreeBindingId",
    "baseCommit",
    "headCommit",
    "policyVersion",
    "evidenceDigest",
    "fileCount",
    "totalPatchBytes",
    "createdAt",
    "files",
  ], "manifest");
  const evidenceId = nonEmpty(value.evidenceId, "evidenceId");
  if (!Array.isArray(value.files)) {
    throw new ReviewEvidenceValidationError("files must be an array");
  }
  const files = value.files.map((file, index) => validateFile(file, evidenceId, index));
  const fileCount = integer(value.fileCount, "fileCount");
  const totalPatchBytes = integer(value.totalPatchBytes, "totalPatchBytes");
  if (files.length !== fileCount) {
    throw new ReviewEvidenceValidationError("fileCount does not match files");
  }
  if (new Set(files.map((file) => file.fileId)).size !== files.length) {
    throw new ReviewEvidenceValidationError("file identifiers must be unique");
  }
  if (files.reduce((total, file) => total + file.patchByteLength, 0) !== totalPatchBytes) {
    throw new ReviewEvidenceValidationError("totalPatchBytes does not match files");
  }
  return Object.freeze({
    evidenceId,
    boardId: nonEmpty(value.boardId, "boardId") as BoardId,
    cardId: nonEmpty(value.cardId, "cardId") as CardId,
    attemptId: nonEmpty(value.attemptId, "attemptId") as AttemptId,
    generation: integer(value.generation, "generation") as AttemptGeneration,
    worktreeBindingId: nonEmpty(value.worktreeBindingId, "worktreeBindingId"),
    baseCommit: nonEmpty(value.baseCommit, "baseCommit"),
    headCommit: nonEmpty(value.headCommit, "headCommit"),
    policyVersion: integer(value.policyVersion, "policyVersion", true),
    evidenceDigest: digest(value.evidenceDigest, "evidenceDigest"),
    fileCount,
    totalPatchBytes,
    createdAt: integer(value.createdAt, "createdAt"),
    files: Object.freeze(files),
  });
}

function rowSummary(row: ReviewEvidenceRow): ReviewEvidenceSummary {
  return Object.freeze({ ...row });
}

function readEvidenceRow(database: Database, evidenceId: string): ReviewEvidenceRow | null {
  const statement = database.query<ReviewEvidenceRow, [string]>(`
    SELECT evidence_id AS evidenceId, board_id AS boardId, card_id AS cardId,
      attempt_id AS attemptId, generation, worktree_binding_id AS worktreeBindingId,
      base_commit AS baseCommit, head_commit AS headCommit, policy_version AS policyVersion,
      evidence_digest AS evidenceDigest, file_count AS fileCount,
      patch_bytes AS totalPatchBytes, created_at AS createdAt
    FROM review_evidence WHERE evidence_id = ?
  `);
  const row = statement.get(evidenceId);
  statement.finalize();
  return row;
}

export function readReviewEvidenceSummary(
  database: Database,
  evidenceId: string,
): ReviewEvidenceSummary | null {
  const row = readEvidenceRow(database, evidenceId);
  return row === null ? null : rowSummary(row);
}

function readEvidenceFiles(
  database: Database,
  evidenceId: string,
): readonly ReviewEvidenceFileRecord[] {
  const statement = database.query<ReviewEvidenceFileRow, [string]>(`
    SELECT evidence_id AS evidenceId, file_index AS fileIndex, file_id AS fileId,
      status, old_path AS oldPath, new_path AS newPath, old_mode AS oldMode,
      new_mode AS newMode, is_binary AS isBinary, additions, deletions,
      patch_size AS patchByteLength, patch_digest AS patchDigest,
      content_digest AS contentDigest, patch_blob AS patchBlob
    FROM review_evidence_files
    WHERE evidence_id = ?
    ORDER BY file_index
  `);
  const rows = statement.all(evidenceId);
  statement.finalize();
  return rows.map((row) => Object.freeze({
    ...row,
    isBinary: row.isBinary === 1,
    patchBlob: row.patchBlob === null ? null : new Uint8Array(row.patchBlob),
  }));
}

function readEvidenceFileMetadata(
  database: Database,
  evidenceId: string,
): readonly ReviewEvidenceFileMetadata[] {
  const statement = database.query<
    Omit<ReviewEvidenceFileRow, "patchBlob">,
    [string]
  >(`
    SELECT evidence_id AS evidenceId, file_index AS fileIndex, file_id AS fileId,
      status, old_path AS oldPath, new_path AS newPath, old_mode AS oldMode,
      new_mode AS newMode, is_binary AS isBinary, additions, deletions,
      patch_size AS patchByteLength, patch_digest AS patchDigest,
      content_digest AS contentDigest
    FROM review_evidence_files
    WHERE evidence_id = ?
    ORDER BY file_index
  `);
  const rows = statement.all(evidenceId);
  statement.finalize();
  return rows.map((row) => Object.freeze({
    ...row,
    isBinary: row.isBinary === 1,
  }));
}

export function readReviewEvidenceManifest(
  database: Database,
  evidenceId: string,
): ReviewEvidenceManifestRecord | null {
  const row = readEvidenceRow(database, evidenceId);
  if (row === null) return null;
  return Object.freeze({
    ...row,
    files: Object.freeze(readEvidenceFileMetadata(database, evidenceId)),
  });
}

export function readReviewEvidenceFile(
  database: Database,
  evidenceId: string,
  fileId: string,
): ReviewEvidenceFileRecord | null {
  const statement = database.query<ReviewEvidenceFileRow, [string, string]>(`
    SELECT evidence_id AS evidenceId, file_index AS fileIndex, file_id AS fileId,
      status, old_path AS oldPath, new_path AS newPath, old_mode AS oldMode,
      new_mode AS newMode, is_binary AS isBinary, additions, deletions,
      patch_size AS patchByteLength, patch_digest AS patchDigest,
      content_digest AS contentDigest, patch_blob AS patchBlob
    FROM review_evidence_files
    WHERE evidence_id = ? AND file_id = ?
  `);
  const row = statement.get(evidenceId, fileId);
  statement.finalize();
  if (row === null) return null;
  return Object.freeze({
    ...row,
    isBinary: row.isBinary === 1,
    patchBlob: row.patchBlob === null ? null : new Uint8Array(row.patchBlob),
  });
}

export function readReviewEvidence(
  database: Database,
  evidenceId: string,
): ReviewEvidenceRecord | null {
  const row = readEvidenceRow(database, evidenceId);
  if (row === null) return null;
  return Object.freeze({
    ...row,
    files: Object.freeze(readEvidenceFiles(database, evidenceId)),
  });
}

function equivalent(
  persisted: ReviewEvidenceRecord,
  candidate: ReviewEvidenceRecord,
): boolean {
  const persistedSummary = { ...persisted, files: undefined };
  const candidateSummary = { ...candidate, files: undefined };
  return JSON.stringify(persistedSummary) === JSON.stringify(candidateSummary)
    && persisted.files.length === candidate.files.length
    && persisted.files.every((file, index) => {
      const other = candidate.files[index];
      if (other === undefined) return false;
      return JSON.stringify({ ...file, patchBlob: undefined })
        === JSON.stringify({ ...other, patchBlob: undefined })
        && bytesEqual(file.patchBlob, other.patchBlob);
    });
}

export function persistReviewEvidence(
  database: Database,
  input: unknown,
): PersistReviewEvidenceResult {
  const evidence = validateReviewEvidence(input);
  const prior = readReviewEvidence(database, evidence.evidenceId);
  if (prior !== null) {
    if (!equivalent(prior, evidence)) {
      throw new ReviewEvidenceIdentityConflictError(evidence.evidenceId);
    }
    return "idempotent";
  }
  const insertEvidence = database.query<void, [
    string, string, string, string, number, string, string, string,
    number, string, number, number, number,
  ]>(`
    INSERT INTO review_evidence(
      evidence_id, board_id, card_id, attempt_id, generation, worktree_binding_id,
      base_commit, head_commit, policy_version, evidence_digest, file_count,
      patch_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvidence.run(
    evidence.evidenceId,
    evidence.boardId,
    evidence.cardId,
    evidence.attemptId,
    evidence.generation,
    evidence.worktreeBindingId,
    evidence.baseCommit,
    evidence.headCommit,
    evidence.policyVersion,
    evidence.evidenceDigest,
    evidence.fileCount,
    evidence.totalPatchBytes,
    evidence.createdAt,
  );
  insertEvidence.finalize();
  const insertFile = database.query<void, [
    string, number, string, string, string | null, string | null,
    string | null, string | null, number, number | null, number | null,
    number, string, string | null, Uint8Array | null,
  ]>(`
    INSERT INTO review_evidence_files(
      evidence_id, file_index, file_id, status, old_path, new_path,
      old_mode, new_mode, is_binary, additions, deletions, patch_size,
      patch_digest, content_digest, patch_blob
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    for (const file of evidence.files) {
      insertFile.run(
        file.evidenceId,
        file.fileIndex,
        file.fileId,
        file.status,
        file.oldPath,
        file.newPath,
        file.oldMode,
        file.newMode,
        file.isBinary ? 1 : 0,
        file.additions,
        file.deletions,
        file.patchByteLength,
        file.patchDigest,
        file.contentDigest,
        file.patchBlob,
      );
    }
  } finally {
    insertFile.finalize();
  }
  const persisted = readReviewEvidence(database, evidence.evidenceId);
  if (persisted === null || !equivalent(persisted, evidence)) {
    throw new ReviewEvidenceIdentityConflictError(evidence.evidenceId);
  }
  return "inserted";
}

export function readLatestReviewEvidenceByCard(
  database: Database,
): Readonly<Record<string, ReviewEvidenceSummary>> {
  const statement = database.query<ReviewEvidenceRow, []>(`
    SELECT evidence_id AS evidenceId, board_id AS boardId, card_id AS cardId,
      attempt_id AS attemptId, generation, worktree_binding_id AS worktreeBindingId,
      base_commit AS baseCommit, head_commit AS headCommit, policy_version AS policyVersion,
      evidence_digest AS evidenceDigest, file_count AS fileCount,
      patch_bytes AS totalPatchBytes, created_at AS createdAt
    FROM review_evidence AS evidence
    WHERE NOT EXISTS (
      SELECT 1 FROM review_evidence AS newer
      WHERE newer.card_id = evidence.card_id
        AND (
          newer.created_at > evidence.created_at
          OR (
            newer.created_at = evidence.created_at
            AND newer.evidence_id > evidence.evidence_id
          )
        )
    )
    ORDER BY card_id
  `);
  const rows = statement.all();
  statement.finalize();
  return Object.freeze(Object.fromEntries(rows.map((row) => [
    row.cardId,
    rowSummary(row),
  ])));
}
