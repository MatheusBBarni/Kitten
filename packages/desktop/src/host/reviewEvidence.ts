import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type {
  EventJournal,
  ProjectionDelta,
  ReviewEvidenceFileRecord,
  ReviewEvidenceRecord,
  ReviewEvidenceSummary,
} from "../persistence/eventJournal.ts";
import {
  REVIEW_DIFF_CHUNK_BYTE_LIMIT,
  REVIEW_MANIFEST_FILE_LIMIT,
  RPC_PATH_LENGTH_LIMIT,
  type ContractError,
  type ReviewDiffChunk,
  type ReviewEvidenceFileStatus,
  type ReviewEvidenceManifest,
  type ReviewEvidencePrecondition,
} from "../shared/rpc.ts";
import type { BoardId, CardId, CardProjection } from "../workflow/workflowTypes.ts";
import { readCardWorktreeBinding } from "../worktrees/cardWorktreeProjection.ts";
import {
  type CardWorktreeBinding,
  validateCardWorktreeBinding,
} from "../worktrees/contracts.ts";

export const REVIEW_EVIDENCE_POLICY_VERSION = 1;
export const REVIEW_TEXT_PATCH_BYTE_LIMIT = 8 * 1_024 * 1_024;
export const REVIEW_TOTAL_PATCH_BYTE_LIMIT = 64 * 1_024 * 1_024;

const SHA_PATTERN = /^[0-9a-f]{40,64}$/u;
const RAW_DIFF_PATTERN =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])([0-9]{0,3})$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const EMPTY_DIGEST = createHash("sha256").update(new Uint8Array()).digest("hex");

export type ReviewEvidenceUnavailableReason =
  | "missing"
  | "stale"
  | "oversized"
  | "unsafe"
  | "unsupported"
  | "incomplete"
  | "binding_mismatch"
  | "stale_board"
  | "stale_card"
  | "stale_attempt";

export function reviewEvidenceContractError(
  reason: ReviewEvidenceUnavailableReason | "invalid_file" | "invalid_offset",
): ContractError {
  switch (reason) {
    case "missing":
      return { code: "evidence_missing", recoveryHint: "retry_evidence_capture" };
    case "stale":
    case "stale_card":
    case "stale_board":
    case "stale_attempt":
    case "invalid_file":
      return { code: "evidence_stale", recoveryHint: "reload_evidence" };
    case "oversized":
      return { code: "evidence_oversized", recoveryHint: "reduce_change_set" };
    case "binding_mismatch":
      return { code: "worktree_binding_mismatch", recoveryHint: "reload_evidence" };
    case "unsafe":
    case "unsupported":
    case "incomplete":
    case "invalid_offset":
      return { code: "evidence_unsafe", recoveryHint: "resolve_unsafe_change" };
  }
}

export class ReviewEvidenceCaptureError extends Error {
  constructor(readonly reason: ReviewEvidenceUnavailableReason) {
    super(`Review evidence is unavailable: ${reason}`);
    this.name = "ReviewEvidenceCaptureError";
  }
}

export interface ReviewEvidenceGitResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
}

export interface ReviewEvidenceGitRunner {
  run(cwd: string, args: readonly string[]): Promise<ReviewEvidenceGitResult>;
}

export interface ReviewEvidenceStat {
  readonly mode: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface ReviewEvidenceFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<ReviewEvidenceStat | null>;
  readBytes(path: string): Promise<Uint8Array>;
}

export interface CanonicalReviewEvidenceFileInput {
  readonly status: Exclude<ReviewEvidenceFileStatus, "binary">;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isBinary: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly patch: Uint8Array | string | null;
  readonly contentDigest: string | null;
}

export interface CanonicalReviewEvidenceInput {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly worktreeBindingId: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly policyVersion?: number;
  readonly createdAt: number;
  readonly files: readonly CanonicalReviewEvidenceFileInput[];
}

export interface CaptureReviewEvidenceInput {
  readonly boardId: BoardId;
  readonly expectedWorkflowVersion: number;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly expectedCardVersion: number;
  readonly worktreeBindingId: string;
}

export type CaptureReviewEvidenceResult =
  | {
      readonly status: "committed";
      readonly evidence: ReviewEvidenceSummary;
      readonly cardVersion: number;
      readonly delta: ProjectionDelta;
    }
  | {
      readonly status: "unavailable";
      readonly reason: ReviewEvidenceUnavailableReason;
    };

export interface RevalidateReviewEvidenceInput {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
  readonly evidence: ReviewEvidencePrecondition;
}

export type RevalidateReviewEvidenceResult =
  | {
      readonly status: "current";
      readonly evidenceId: string;
      readonly evidenceDigest: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason: ReviewEvidenceUnavailableReason;
    };

export type ReadReviewEvidenceManifestResult =
  | { readonly status: "ok"; readonly manifest: ReviewEvidenceManifest }
  | { readonly status: "unavailable"; readonly reason: "missing" | "incomplete" };

export type ReadReviewDiffChunkResult =
  | { readonly status: "ok"; readonly chunk: ReviewDiffChunk }
  | { readonly status: "non_text"; readonly state: "binary" }
  | {
      readonly status: "unavailable";
      readonly reason: "missing" | "invalid_file" | "invalid_offset" | "incomplete";
    };

export interface ReviewEvidenceService {
  capture(input: CaptureReviewEvidenceInput): Promise<CaptureReviewEvidenceResult>;
  revalidate(input: RevalidateReviewEvidenceInput): Promise<RevalidateReviewEvidenceResult>;
  manifest(evidenceId: string): ReadReviewEvidenceManifestResult;
  readDiffChunk(
    evidenceId: string,
    fileId: string,
    offset: number,
  ): ReadReviewDiffChunkResult;
}

export interface CreateReviewEvidenceServiceOptions {
  readonly git?: ReviewEvidenceGitRunner;
  readonly fileSystem?: ReviewEvidenceFileSystem;
  readonly now?: () => number;
  /**
   * Testable race seam. Production leaves it unset; capture always compares a
   * complete before/after worktree snapshot before opening the SQLite transaction.
   */
  readonly afterInitialCapture?: () => void | Promise<void>;
}

interface RawChangedFile {
  readonly status: Exclude<ReviewEvidenceFileStatus, "binary">;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
}

interface VerifiedWorktree {
  readonly binding: CardWorktreeBinding;
  readonly baseCommit: string;
  readonly headCommit: string;
}

interface CaptureContext {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly binding: CardWorktreeBinding;
  readonly createdAt: number;
}

const bunGitRunner: ReviewEvidenceGitRunner = {
  async run(cwd, args) {
    const child = Bun.spawn({
      cmd: ["git", ...args],
      cwd,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).arrayBuffer(),
    ]);
    return { exitCode, stdout: new Uint8Array(stdout) };
  },
};

const nodeFileSystem: ReviewEvidenceFileSystem = {
  realpath,
  async lstat(path) {
    try {
      return await lstat(path);
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { readonly code?: unknown }).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  },
  async readBytes(path) {
    return new Uint8Array(await readFile(path));
  },
};

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeDecode(bytes: Uint8Array): string | null {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

function singleLine(bytes: Uint8Array): string | null {
  const value = safeDecode(bytes)?.replace(/\r?\n$/u, "") ?? null;
  return value !== null
    && value.length > 0
    && !value.includes("\n")
    && !value.includes("\0")
    ? value
    : null;
}

function normalizePatch(patch: Uint8Array | string): Uint8Array {
  const text = typeof patch === "string" ? patch : safeDecode(patch);
  if (text === null) throw new ReviewEvidenceCaptureError("unsupported");
  const normalized = text
    .replace(/\r\n?/gu, "\n")
    // Git derives these blob IDs from raw line endings. The canonical envelope
    // already binds modes and normalized patch bytes, so retaining them would
    // make semantically equivalent CRLF/LF text hash differently.
    .replace(
      /^index [0-9a-f]+\.\.[0-9a-f]+( [0-7]{6})?$/gmu,
      "index <normalized>..<normalized>$1",
    );
  return utf8Encoder.encode(normalized);
}

function normalizeRepositoryPath(value: string | null): string | null {
  if (value === null) return null;
  if (
    value.length === 0
    || value.length > RPC_PATH_LENGTH_LIMIT
    || value.includes("\0")
    || isAbsolute(value)
    || value.startsWith("/")
    || value.endsWith("/")
  ) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  return normalized;
}

function validateDigest(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  return value;
}

function fileIdentity(input: {
  readonly status: ReviewEvidenceFileStatus;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isBinary: boolean;
}): string {
  return `file-${sha256(JSON.stringify(input)).slice(0, 32)}`;
}

function canonicalFile(
  input: CanonicalReviewEvidenceFileInput,
): Omit<ReviewEvidenceFileRecord, "evidenceId" | "fileIndex"> {
  const oldPath = normalizeRepositoryPath(input.oldPath);
  const newPath = normalizeRepositoryPath(input.newPath);
  if (oldPath === null && newPath === null) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  if (input.oldMode !== null && !/^[0-7]{6}$/u.test(input.oldMode)) {
    throw new ReviewEvidenceCaptureError("unsupported");
  }
  if (input.newMode !== null && !/^[0-7]{6}$/u.test(input.newMode)) {
    throw new ReviewEvidenceCaptureError("unsupported");
  }
  if (
    input.additions !== null
    && (!Number.isSafeInteger(input.additions) || input.additions < 0)
  ) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  if (
    input.deletions !== null
    && (!Number.isSafeInteger(input.deletions) || input.deletions < 0)
  ) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }

  const status: ReviewEvidenceFileStatus = input.isBinary ? "binary" : input.status;
  const patchBlob = input.isBinary
    ? null
    : input.patch === null
      ? (() => {
          throw new ReviewEvidenceCaptureError("incomplete");
        })()
      : normalizePatch(input.patch);
  if (patchBlob !== null && patchBlob.byteLength > REVIEW_TEXT_PATCH_BYTE_LIMIT) {
    throw new ReviewEvidenceCaptureError("oversized");
  }
  const contentDigest = validateDigest(input.contentDigest);
  if (input.isBinary && contentDigest === null) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }

  const identity = {
    status,
    oldPath,
    newPath,
    oldMode: input.oldMode,
    newMode: input.newMode,
    isBinary: input.isBinary,
  };
  return Object.freeze({
    fileId: fileIdentity(identity),
    status,
    oldPath,
    newPath,
    oldMode: input.oldMode,
    newMode: input.newMode,
    isBinary: input.isBinary,
    additions: input.isBinary ? null : input.additions,
    deletions: input.isBinary ? null : input.deletions,
    patchByteLength: patchBlob?.byteLength ?? 0,
    patchDigest: patchBlob === null ? EMPTY_DIGEST : sha256(patchBlob),
    contentDigest,
    patchBlob,
  });
}

export function canonicalizeReviewEvidence(
  input: CanonicalReviewEvidenceInput,
): ReviewEvidenceRecord {
  if (input.files.length > REVIEW_MANIFEST_FILE_LIMIT) {
    throw new ReviewEvidenceCaptureError("oversized");
  }
  if (
    !Number.isSafeInteger(input.createdAt)
    || input.createdAt < 0
    || !Number.isSafeInteger(input.generation)
    || input.generation < 0
  ) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  if (!SHA_PATTERN.test(input.baseCommit) || !SHA_PATTERN.test(input.headCommit)) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const policyVersion = input.policyVersion ?? REVIEW_EVIDENCE_POLICY_VERSION;
  if (!Number.isSafeInteger(policyVersion) || policyVersion <= 0) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const canonical = input.files.map(canonicalFile).sort((left, right) => {
    const newPath = (left.newPath ?? "").localeCompare(right.newPath ?? "");
    if (newPath !== 0) return newPath;
    const oldPath = (left.oldPath ?? "").localeCompare(right.oldPath ?? "");
    return oldPath !== 0 ? oldPath : left.fileId.localeCompare(right.fileId);
  });
  if (new Set(canonical.map(({ fileId }) => fileId)).size !== canonical.length) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const totalPatchBytes = canonical.reduce(
    (total, file) => total + file.patchByteLength,
    0,
  );
  if (totalPatchBytes > REVIEW_TOTAL_PATCH_BYTE_LIMIT) {
    throw new ReviewEvidenceCaptureError("oversized");
  }

  const envelope = {
    policyVersion,
    boardId: input.boardId,
    cardId: input.cardId,
    attemptId: input.attemptId,
    generation: input.generation,
    worktreeBindingId: input.worktreeBindingId,
    baseCommit: input.baseCommit,
    headCommit: input.headCommit,
    files: canonical.map((file) => ({
      fileId: file.fileId,
      status: file.status,
      oldPath: file.oldPath,
      newPath: file.newPath,
      oldMode: file.oldMode,
      newMode: file.newMode,
      isBinary: file.isBinary,
      additions: file.additions,
      deletions: file.deletions,
      patchByteLength: file.patchByteLength,
      patchDigest: file.patchDigest,
      contentDigest: file.contentDigest,
    })),
  };
  const evidenceDigest = sha256(JSON.stringify(envelope));
  const evidenceId = `review-${evidenceDigest}`;
  const files = canonical.map((file, fileIndex): ReviewEvidenceFileRecord => Object.freeze({
    evidenceId,
    fileIndex,
    ...file,
  }));
  return Object.freeze({
    evidenceId,
    boardId: input.boardId,
    cardId: input.cardId,
    attemptId: input.attemptId,
    generation: input.generation,
    worktreeBindingId: input.worktreeBindingId,
    baseCommit: input.baseCommit,
    headCommit: input.headCommit,
    policyVersion,
    evidenceDigest,
    fileCount: files.length,
    totalPatchBytes,
    createdAt: input.createdAt,
    files: Object.freeze(files),
  });
}

function parseRawChanges(bytes: Uint8Array): readonly RawChangedFile[] {
  const decoded = safeDecode(bytes);
  if (decoded === null || (decoded.length > 0 && !decoded.endsWith("\0"))) {
    throw new ReviewEvidenceCaptureError("unsupported");
  }
  if (decoded.length === 0) return [];
  const fields = decoded.slice(0, -1).split("\0");
  const results: RawChangedFile[] = [];
  for (let index = 0; index < fields.length;) {
    const match = RAW_DIFF_PATTERN.exec(fields[index] ?? "");
    if (match === null) throw new ReviewEvidenceCaptureError("unsupported");
    index += 1;
    const code = match[5]!;
    const firstPath = fields[index];
    if (firstPath === undefined) throw new ReviewEvidenceCaptureError("incomplete");
    index += 1;
    const secondPath = code === "R" || code === "C" ? fields[index] : undefined;
    if ((code === "R" || code === "C") && secondPath === undefined) {
      throw new ReviewEvidenceCaptureError("incomplete");
    }
    if (secondPath !== undefined) index += 1;
    const status = ({
      A: "added",
      M: "modified",
      T: "modified",
      D: "deleted",
      R: "renamed",
      C: "copied",
    } as const)[code as "A" | "M" | "T" | "D" | "R" | "C"];
    if (status === undefined) throw new ReviewEvidenceCaptureError("unsupported");
    results.push({
      status,
      oldPath: status === "added" ? null : firstPath,
      newPath: status === "deleted" ? null : secondPath ?? firstPath,
      oldMode: match[1] === "000000" ? null : match[1]!,
      newMode: match[2] === "000000" ? null : match[2]!,
    });
  }
  return results;
}

function parseUntrackedPaths(bytes: Uint8Array): readonly string[] {
  const decoded = safeDecode(bytes);
  if (decoded === null || (decoded.length > 0 && !decoded.endsWith("\0"))) {
    throw new ReviewEvidenceCaptureError("unsupported");
  }
  return decoded.length === 0 ? [] : decoded.slice(0, -1).split("\0");
}

function parseNumstat(
  bytes: Uint8Array,
): { readonly binary: boolean; readonly additions: number | null; readonly deletions: number | null } {
  const decoded = safeDecode(bytes);
  if (decoded === null) throw new ReviewEvidenceCaptureError("unsupported");
  const firstTab = decoded.indexOf("\t");
  const secondTab = firstTab < 0 ? -1 : decoded.indexOf("\t", firstTab + 1);
  if (firstTab < 1 || secondTab < 0) throw new ReviewEvidenceCaptureError("incomplete");
  const additions = decoded.slice(0, firstTab);
  const deletions = decoded.slice(firstTab + 1, secondTab);
  if (additions === "-" && deletions === "-") {
    return { binary: true, additions: null, deletions: null };
  }
  const parsedAdditions = Number(additions);
  const parsedDeletions = Number(deletions);
  if (
    !Number.isSafeInteger(parsedAdditions)
    || parsedAdditions < 0
    || !Number.isSafeInteger(parsedDeletions)
    || parsedDeletions < 0
  ) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  return {
    binary: false,
    additions: parsedAdditions,
    deletions: parsedDeletions,
  };
}

function isContainedBy(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

async function assertSafeCurrentPath(
  fileSystem: ReviewEvidenceFileSystem,
  worktreeRoot: string,
  path: string,
): Promise<{ readonly absolutePath: string; readonly stat: ReviewEvidenceStat }> {
  const normalized = normalizeRepositoryPath(path);
  if (normalized === null) throw new ReviewEvidenceCaptureError("unsafe");
  const absolutePath = resolve(worktreeRoot, ...normalized.split("/"));
  if (!isContainedBy(worktreeRoot, absolutePath)) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  const stat = await fileSystem.lstat(absolutePath);
  if (stat === null || stat.isSymbolicLink() || !stat.isFile()) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  const canonical = await fileSystem.realpath(absolutePath);
  if (canonical !== absolutePath || !isContainedBy(worktreeRoot, canonical)) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
  return { absolutePath, stat };
}

function assertSupportedModes(change: RawChangedFile): void {
  if (
    change.oldMode === "120000"
    || change.newMode === "120000"
    || change.oldMode === "160000"
    || change.newMode === "160000"
  ) {
    throw new ReviewEvidenceCaptureError("unsafe");
  }
}

async function binaryContentDigest(
  git: ReviewEvidenceGitRunner,
  fileSystem: ReviewEvidenceFileSystem,
  worktree: VerifiedWorktree,
  change: RawChangedFile,
): Promise<string> {
  if (change.newPath !== null) {
    const current = await assertSafeCurrentPath(
      fileSystem,
      worktree.binding.worktreePath,
      change.newPath,
    );
    return sha256(await fileSystem.readBytes(current.absolutePath));
  }
  if (change.oldPath === null) throw new ReviewEvidenceCaptureError("incomplete");
  const prior = await git.run(worktree.binding.worktreePath, [
    "show",
    `${worktree.baseCommit}:${change.oldPath}`,
  ]);
  if (prior.exitCode !== 0) throw new ReviewEvidenceCaptureError("incomplete");
  return sha256(prior.stdout);
}

async function captureTrackedFile(
  git: ReviewEvidenceGitRunner,
  fileSystem: ReviewEvidenceFileSystem,
  worktree: VerifiedWorktree,
  change: RawChangedFile,
): Promise<CanonicalReviewEvidenceFileInput> {
  assertSupportedModes(change);
  const paths = [...new Set([change.oldPath, change.newPath].filter(
    (path): path is string => path !== null,
  ))];
  paths.forEach(normalizeRepositoryPath);
  if (change.newPath !== null) {
    await assertSafeCurrentPath(fileSystem, worktree.binding.worktreePath, change.newPath);
  }
  const common = [
    "--no-ext-diff",
    "--no-color",
    "--find-renames",
    "--find-copies",
    worktree.baseCommit,
    "--",
    ...paths,
  ] as const;
  const [patch, numstat] = await Promise.all([
    git.run(worktree.binding.worktreePath, ["diff", "--patch", "--full-index", ...common]),
    git.run(worktree.binding.worktreePath, ["diff", "--numstat", "-z", ...common]),
  ]);
  if (patch.exitCode !== 0 || numstat.exitCode !== 0) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const stats = parseNumstat(numstat.stdout);
  const patchIsUtf8 = safeDecode(patch.stdout) !== null;
  const isBinary = stats.binary || !patchIsUtf8;
  return {
    ...change,
    isBinary,
    additions: isBinary ? null : stats.additions,
    deletions: isBinary ? null : stats.deletions,
    patch: isBinary ? null : patch.stdout,
    contentDigest: isBinary
      ? await binaryContentDigest(git, fileSystem, worktree, change)
      : null,
  };
}

async function captureUntrackedFile(
  git: ReviewEvidenceGitRunner,
  fileSystem: ReviewEvidenceFileSystem,
  worktree: VerifiedWorktree,
  path: string,
): Promise<CanonicalReviewEvidenceFileInput> {
  const current = await assertSafeCurrentPath(
    fileSystem,
    worktree.binding.worktreePath,
    path,
  );
  const [patch, numstat] = await Promise.all([
    git.run(worktree.binding.worktreePath, [
      "diff",
      "--no-index",
      "--patch",
      "--full-index",
      "--no-ext-diff",
      "--no-color",
      "--",
      "/dev/null",
      path,
    ]),
    git.run(worktree.binding.worktreePath, [
      "diff",
      "--no-index",
      "--numstat",
      "-z",
      "--",
      "/dev/null",
      path,
    ]),
  ]);
  if (![0, 1].includes(patch.exitCode) || ![0, 1].includes(numstat.exitCode)) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const stats = parseNumstat(numstat.stdout);
  const patchIsUtf8 = safeDecode(patch.stdout) !== null;
  const isBinary = stats.binary || !patchIsUtf8;
  const executable = (current.stat.mode & 0o111) !== 0;
  return {
    status: "added",
    oldPath: null,
    newPath: normalizeRepositoryPath(path),
    oldMode: null,
    newMode: executable ? "100755" : "100644",
    isBinary,
    additions: isBinary ? null : stats.additions,
    deletions: isBinary ? null : stats.deletions,
    patch: isBinary ? null : patch.stdout,
    contentDigest: isBinary
      ? sha256(await fileSystem.readBytes(current.absolutePath))
      : null,
  };
}

async function verifyWorktree(
  git: ReviewEvidenceGitRunner,
  fileSystem: ReviewEvidenceFileSystem,
  bindingInput: CardWorktreeBinding,
  trustedRepositoryPath: string,
): Promise<VerifiedWorktree> {
  let binding: CardWorktreeBinding;
  try {
    binding = validateCardWorktreeBinding(bindingInput);
  } catch {
    throw new ReviewEvidenceCaptureError("binding_mismatch");
  }
  if (binding.lifecycle !== "active" || binding.reason !== null) {
    throw new ReviewEvidenceCaptureError("binding_mismatch");
  }
  try {
    const [repositoryRoot, trustedRoot, managedRoot, worktreeRoot, repositoryGitDir] =
      await Promise.all([
        fileSystem.realpath(binding.repositoryRoot),
        fileSystem.realpath(trustedRepositoryPath),
        fileSystem.realpath(binding.managedRoot),
        fileSystem.realpath(binding.worktreePath),
        fileSystem.realpath(binding.repositoryGitDir),
      ]);
    if (
      repositoryRoot !== binding.repositoryRoot
      || trustedRoot !== binding.repositoryRoot
      || managedRoot !== binding.managedRoot
      || worktreeRoot !== binding.worktreePath
      || repositoryGitDir !== binding.repositoryGitDir
      || !isContainedBy(repositoryRoot, managedRoot)
      || !isContainedBy(managedRoot, worktreeRoot)
    ) {
      throw new ReviewEvidenceCaptureError("binding_mismatch");
    }

    const [top, commonGitDir, branch, head, baseline, ancestry, unmerged, index] =
      await Promise.all([
        git.run(worktreeRoot, ["rev-parse", "--show-toplevel"]),
        git.run(worktreeRoot, ["rev-parse", "--git-common-dir"]),
        git.run(worktreeRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
        git.run(worktreeRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
        git.run(worktreeRoot, [
          "rev-parse",
          "--verify",
          `${binding.baselineCommit}^{commit}`,
        ]),
        git.run(worktreeRoot, [
          "merge-base",
          "--is-ancestor",
          binding.baselineCommit,
          "HEAD",
        ]),
        git.run(worktreeRoot, ["ls-files", "--unmerged", "-z"]),
        git.run(worktreeRoot, ["ls-files", "--stage", "-z"]),
      ]);
    if (
      top.exitCode !== 0
      || commonGitDir.exitCode !== 0
      || branch.exitCode !== 0
      || head.exitCode !== 0
      || baseline.exitCode !== 0
      || ancestry.exitCode !== 0
      || unmerged.exitCode !== 0
      || index.exitCode !== 0
      || unmerged.stdout.byteLength !== 0
    ) {
      throw new ReviewEvidenceCaptureError("unsupported");
    }
    const reportedTop = singleLine(top.stdout);
    const reportedCommonGitDir = singleLine(commonGitDir.stdout);
    const reportedBranch = singleLine(branch.stdout);
    const reportedHead = singleLine(head.stdout);
    const reportedBaseline = singleLine(baseline.stdout);
    if (
      reportedTop === null
      || reportedCommonGitDir === null
      || reportedBranch !== binding.branch
      || reportedHead === null
      || reportedBaseline !== binding.baselineCommit
      || !SHA_PATTERN.test(reportedHead)
    ) {
      throw new ReviewEvidenceCaptureError("binding_mismatch");
    }
    const canonicalTop = await fileSystem.realpath(reportedTop);
    const canonicalGitDir = await fileSystem.realpath(resolve(worktreeRoot, reportedCommonGitDir));
    if (
      canonicalTop !== binding.worktreePath
      || canonicalGitDir !== binding.repositoryGitDir
    ) {
      throw new ReviewEvidenceCaptureError("binding_mismatch");
    }
    const indexText = safeDecode(index.stdout);
    if (
      indexText === null
      || indexText.split("\0").some((entry) => entry.startsWith("160000 "))
    ) {
      throw new ReviewEvidenceCaptureError("unsafe");
    }
    return {
      binding,
      baseCommit: binding.baselineCommit,
      headCommit: reportedHead,
    };
  } catch (error) {
    if (error instanceof ReviewEvidenceCaptureError) throw error;
    throw new ReviewEvidenceCaptureError("unsafe");
  }
}

async function captureWorktree(
  git: ReviewEvidenceGitRunner,
  fileSystem: ReviewEvidenceFileSystem,
  context: CaptureContext,
  trustedRepositoryPath: string,
): Promise<ReviewEvidenceRecord> {
  const worktree = await verifyWorktree(
    git,
    fileSystem,
    context.binding,
    trustedRepositoryPath,
  );
  const [raw, untracked] = await Promise.all([
    git.run(worktree.binding.worktreePath, [
      "diff",
      "--raw",
      "-z",
      "--no-abbrev",
      "--find-renames",
      "--find-copies",
      worktree.baseCommit,
      "--",
    ]),
    git.run(worktree.binding.worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ]),
  ]);
  if (raw.exitCode !== 0 || untracked.exitCode !== 0) {
    throw new ReviewEvidenceCaptureError("incomplete");
  }
  const trackedChanges = parseRawChanges(raw.stdout);
  const untrackedPaths = parseUntrackedPaths(untracked.stdout);
  if (trackedChanges.length + untrackedPaths.length > REVIEW_MANIFEST_FILE_LIMIT) {
    throw new ReviewEvidenceCaptureError("oversized");
  }
  const changedPaths = new Set<string>();
  for (const change of trackedChanges) {
    for (const path of [change.oldPath, change.newPath]) {
      if (path !== null) normalizeRepositoryPath(path);
    }
    const identity = change.newPath ?? change.oldPath;
    if (identity === null || changedPaths.has(identity)) {
      throw new ReviewEvidenceCaptureError("incomplete");
    }
    changedPaths.add(identity);
  }
  for (const path of untrackedPaths) {
    const normalized = normalizeRepositoryPath(path);
    if (normalized === null || changedPaths.has(normalized)) {
      throw new ReviewEvidenceCaptureError("incomplete");
    }
    changedPaths.add(normalized);
  }

  const files: CanonicalReviewEvidenceFileInput[] = [];
  for (const change of trackedChanges) {
    files.push(await captureTrackedFile(git, fileSystem, worktree, change));
  }
  for (const path of untrackedPaths) {
    files.push(await captureUntrackedFile(git, fileSystem, worktree, path));
  }
  return canonicalizeReviewEvidence({
    boardId: context.boardId,
    cardId: context.cardId,
    attemptId: context.attemptId,
    generation: context.generation,
    worktreeBindingId: worktree.binding.bindingId,
    baseCommit: worktree.baseCommit,
    headCommit: worktree.headCommit,
    createdAt: context.createdAt,
    files,
  });
}

function sameBinding(left: CardWorktreeBinding, right: CardWorktreeBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function summary(record: ReviewEvidenceRecord): ReviewEvidenceSummary {
  const { files: _files, ...value } = record;
  return Object.freeze(value);
}

function manifestFrom(
  record: ReviewEvidenceRecord,
  revision: number,
): ReviewEvidenceManifest {
  const oversized = record.fileCount > REVIEW_MANIFEST_FILE_LIMIT
    || record.totalPatchBytes > REVIEW_TOTAL_PATCH_BYTE_LIMIT
    || record.files.some((file) => (
      !file.isBinary && file.patchByteLength > REVIEW_TEXT_PATCH_BYTE_LIMIT
    ));
  return {
    kind: "review_evidence_manifest",
    schemaVersion: 1,
    revision,
    evidenceId: record.evidenceId,
    boardId: record.boardId,
    cardId: record.cardId,
    attemptId: record.attemptId,
    generation: record.generation,
    worktreeBindingId: record.worktreeBindingId,
    evidenceDigest: record.evidenceDigest,
    baseCommit: record.baseCommit,
    headCommit: record.headCommit,
    policyVersion: record.policyVersion,
    fileCount: record.fileCount,
    totalPatchBytes: record.totalPatchBytes,
    createdAt: record.createdAt,
    availability: oversized
      ? {
          status: "unavailable",
          error: reviewEvidenceContractError("oversized"),
        }
      : {
          status: "available",
          evidenceId: record.evidenceId,
          evidenceDigest: record.evidenceDigest,
        },
    files: record.files.map((file) => ({
      fileId: file.fileId,
      index: file.fileIndex,
      status: file.status,
      oldPath: file.oldPath,
      newPath: file.newPath,
      oldMode: file.oldMode,
      newMode: file.newMode,
      isBinary: file.isBinary,
      additions: file.additions,
      deletions: file.deletions,
      patchByteLength: file.patchByteLength,
      patchDigest: file.patchDigest,
      contentDigest: file.contentDigest,
    })),
  };
}

function cardReadyForReview(card: CardProjection, occurredAt: number): CardProjection {
  return {
    ...card,
    executionStatus: "ready_for_review",
    version: card.version + 1,
    updatedAt: Math.max(card.updatedAt, occurredAt),
  };
}

function asUnavailable(error: unknown): CaptureReviewEvidenceResult {
  return {
    status: "unavailable",
    reason: error instanceof ReviewEvidenceCaptureError ? error.reason : "incomplete",
  };
}

function asRevalidationUnavailable(error: unknown): RevalidateReviewEvidenceResult {
  return {
    status: "unavailable",
    reason: error instanceof ReviewEvidenceCaptureError ? error.reason : "incomplete",
  };
}

export function createReviewEvidenceService(
  journal: EventJournal,
  options: CreateReviewEvidenceServiceOptions = {},
): ReviewEvidenceService {
  const git = options.git ?? bunGitRunner;
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const now = options.now ?? Date.now;

  return {
    async capture(input) {
      const snapshot = journal.snapshot();
      const board = snapshot.boards.find(({ boardId }) => boardId === input.boardId);
      const card = snapshot.cards.find(({ cardId }) => cardId === input.cardId);
      const attempt = snapshot.attempts.find(({ attemptId }) => attemptId === input.attemptId);
      const binding = readCardWorktreeBinding(snapshot, input.cardId);
      if (board === undefined || card === undefined || card.boardId !== input.boardId) {
        return { status: "unavailable", reason: "missing" };
      }
      if (board.workflowVersion !== input.expectedWorkflowVersion) {
        return { status: "unavailable", reason: "stale_board" };
      }
      if (card.version !== input.expectedCardVersion) {
        return { status: "unavailable", reason: "stale_card" };
      }
      if (
        attempt === undefined
        || attempt.boardId !== input.boardId
        || attempt.cardId !== input.cardId
        || attempt.generation !== input.generation
        || attempt.state !== "succeeded"
      ) {
        return { status: "unavailable", reason: "stale_attempt" };
      }
      if (
        binding === null
        || binding.boardId !== input.boardId
        || binding.cardId !== input.cardId
        || binding.bindingId !== input.worktreeBindingId
      ) {
        return { status: "unavailable", reason: "binding_mismatch" };
      }
      if (
        card.executionStatus !== "running"
        || snapshot.edges.some((edge) => (
          edge.boardId === input.boardId && edge.sourceStageId === card.stageId
        ))
      ) {
        return { status: "unavailable", reason: "unsupported" };
      }
      const createdAt = Math.max(0, now());
      const context: CaptureContext = {
        boardId: input.boardId,
        cardId: input.cardId,
        attemptId: input.attemptId,
        generation: input.generation,
        binding,
        createdAt,
      };
      try {
        const first = await captureWorktree(
          git,
          fileSystem,
          context,
          board.repositoryPath,
        );
        await options.afterInitialCapture?.();
        const second = await captureWorktree(
          git,
          fileSystem,
          context,
          board.repositoryPath,
        );
        if (
          first.evidenceDigest !== second.evidenceDigest
          || first.baseCommit !== second.baseCommit
          || first.headCommit !== second.headCommit
        ) {
          throw new ReviewEvidenceCaptureError("stale");
        }

        let delta: ProjectionDelta | undefined;
        journal.immediate((transaction) => {
          const current = journal.snapshot();
          const currentBoard = current.boards.find(({ boardId }) => boardId === input.boardId);
          const currentCard = current.cards.find(({ cardId }) => cardId === input.cardId);
          const currentAttempt = current.attempts.find(
            ({ attemptId }) => attemptId === input.attemptId,
          );
          const currentBinding = readCardWorktreeBinding(current, input.cardId);
          if (
            currentBoard === undefined
            || currentBoard.workflowVersion !== input.expectedWorkflowVersion
            || currentBoard.repositoryPath !== board.repositoryPath
          ) {
            throw new ReviewEvidenceCaptureError("stale_board");
          }
          if (
            currentCard === undefined
            || currentCard.boardId !== input.boardId
            || currentCard.version !== input.expectedCardVersion
          ) {
            throw new ReviewEvidenceCaptureError("stale_card");
          }
          if (
            currentAttempt === undefined
            || currentAttempt.cardId !== input.cardId
            || currentAttempt.generation !== input.generation
            || currentAttempt.state !== "succeeded"
          ) {
            throw new ReviewEvidenceCaptureError("stale_attempt");
          }
          if (currentBinding === null || !sameBinding(currentBinding, binding)) {
            throw new ReviewEvidenceCaptureError("binding_mismatch");
          }
          transaction.persistReviewEvidence(second);
          delta = transaction.append({
            eventId: `evidence:${second.evidenceId}`,
            boardId: input.boardId,
            cardId: input.cardId,
            actor: "system",
            kind: "review_evidence_committed",
            occurredAt: second.createdAt,
            payload: {
              evidence: {
                evidenceId: second.evidenceId,
                evidenceDigest: second.evidenceDigest,
                attemptId: second.attemptId,
                generation: second.generation,
                worktreeBindingId: second.worktreeBindingId,
                boardId: second.boardId,
                cardId: second.cardId,
                createdAt: second.createdAt,
              },
              changes: [{
                entity: "card",
                operation: "upsert",
                value: cardReadyForReview(currentCard, second.createdAt),
              }],
            },
          }, {
            preconditions: [{
              entity: "board",
              id: input.boardId,
              expectedVersion: input.expectedWorkflowVersion,
            }, {
              entity: "card",
              id: input.cardId,
              expectedVersion: input.expectedCardVersion,
            }],
          });
        });
        if (delta === undefined) throw new ReviewEvidenceCaptureError("incomplete");
        return {
          status: "committed",
          evidence: summary(second),
          cardVersion: input.expectedCardVersion + 1,
          delta,
        };
      } catch (error) {
        return asUnavailable(error);
      }
    },

    async revalidate(input) {
      const record = journal.reviewEvidence(input.evidence.evidenceId);
      if (record === null) return { status: "unavailable", reason: "missing" };
      const snapshot = journal.snapshot();
      const board = snapshot.boards.find(({ boardId }) => boardId === input.boardId);
      const card = snapshot.cards.find(({ cardId }) => cardId === input.cardId);
      const binding = readCardWorktreeBinding(snapshot, input.cardId);
      if (board === undefined || card === undefined || card.boardId !== input.boardId) {
        return { status: "unavailable", reason: "missing" };
      }
      if (card.version !== input.expectedCardVersion) {
        return { status: "unavailable", reason: "stale_card" };
      }
      if (
        record.boardId !== input.boardId
        || record.cardId !== input.cardId
        || record.attemptId !== input.evidence.attemptId
        || record.generation !== input.evidence.generation
        || record.worktreeBindingId !== input.evidence.worktreeBindingId
        || record.evidenceDigest !== input.evidence.evidenceDigest
      ) {
        return { status: "unavailable", reason: "stale" };
      }
      if (
        binding === null
        || binding.bindingId !== record.worktreeBindingId
        || binding.boardId !== input.boardId
        || binding.cardId !== input.cardId
      ) {
        return { status: "unavailable", reason: "binding_mismatch" };
      }
      try {
        const current = await captureWorktree(
          git,
          fileSystem,
          {
            boardId: record.boardId,
            cardId: record.cardId,
            attemptId: record.attemptId,
            generation: record.generation,
            binding,
            createdAt: record.createdAt,
          },
          board.repositoryPath,
        );
        if (
          current.evidenceDigest !== record.evidenceDigest
          || current.baseCommit !== record.baseCommit
          || current.headCommit !== record.headCommit
        ) {
          throw new ReviewEvidenceCaptureError("stale");
        }
        return {
          status: "current",
          evidenceId: record.evidenceId,
          evidenceDigest: record.evidenceDigest,
        };
      } catch (error) {
        return asRevalidationUnavailable(error);
      }
    },

    manifest(evidenceId) {
      const record = journal.reviewEvidence(evidenceId);
      if (record === null) return { status: "unavailable", reason: "missing" };
      if (
        record.files.length !== record.fileCount
        || record.files.some((file, index) => file.fileIndex !== index)
      ) {
        return { status: "unavailable", reason: "incomplete" };
      }
      return {
        status: "ok",
        manifest: manifestFrom(record, journal.snapshot().revision),
      };
    },

    readDiffChunk(evidenceId, fileId, offset) {
      const record = journal.reviewEvidence(evidenceId);
      if (record === null) return { status: "unavailable", reason: "missing" };
      const file = record.files.find((candidate) => candidate.fileId === fileId);
      if (file === undefined) return { status: "unavailable", reason: "invalid_file" };
      if (file.isBinary || file.patchBlob === null) {
        return file.isBinary
          ? { status: "non_text", state: "binary" }
          : { status: "unavailable", reason: "incomplete" };
      }
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.patchBlob.byteLength) {
        return { status: "unavailable", reason: "invalid_offset" };
      }
      try {
        utf8Decoder.decode(file.patchBlob.subarray(0, offset));
      } catch {
        return { status: "unavailable", reason: "invalid_offset" };
      }
      let end = Math.min(
        file.patchBlob.byteLength,
        offset + REVIEW_DIFF_CHUNK_BYTE_LIMIT,
      );
      let content: string | null = null;
      while (end >= offset && content === null) {
        try {
          content = utf8Decoder.decode(file.patchBlob.subarray(offset, end));
        } catch {
          end -= 1;
        }
      }
      if (content === null) return { status: "unavailable", reason: "incomplete" };
      const complete = end === file.patchBlob.byteLength;
      return {
        status: "ok",
        chunk: {
          kind: "review_diff_chunk",
          schemaVersion: 1,
          evidenceId,
          fileId,
          offset,
          nextOffset: complete ? null : end,
          complete,
          content,
          encoding: "utf8",
        },
      };
    },
  };
}
