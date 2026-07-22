import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const MANAGED_WORKTREE_ROOT_RELATIVE = ".kitten/worktrees/cards";

export const WORKTREE_UNAVAILABLE_REASONS = [
  "not_git_repository",
  "detached",
  "gitlink",
  "managed_root_invalid",
  "collision",
  "missing",
  "external",
  "symlink",
  "repository_mismatch",
  "branch_mismatch",
  "baseline_mismatch",
  "parent_changed",
  "dirty",
  "divergent",
  "unmerged",
  "live",
  "removed",
  "unverified",
  "git_failed",
] as const;

export type WorktreeUnavailableReason = (typeof WORKTREE_UNAVAILABLE_REASONS)[number];

export type CardWorktreeLifecycle =
  | "active"
  | "unavailable"
  | "cleanup_refused"
  | "removed";

/** Durable desktop-owned identity for the one managed worktree assigned to a card. */
export interface CardWorktreeBinding {
  readonly bindingVersion: 1;
  readonly bindingId: string;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly repositoryRoot: string;
  readonly repositoryGitDir: string;
  readonly managedRoot: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly baselineBranch: string;
  readonly baselineCommit: string;
  readonly lifecycle: CardWorktreeLifecycle;
  readonly reason: WorktreeUnavailableReason | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type EnsureCardWorktreeResult =
  | { readonly status: "provisioned" | "reused"; readonly binding: CardWorktreeBinding }
  | { readonly status: "unavailable"; readonly reason: WorktreeUnavailableReason };

export interface ExplicitCardWorktreeCleanupInput {
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly requestedBy: "operator";
  readonly cardSettled: boolean;
  readonly liveAttemptCount: number;
}

export type CleanupCardWorktreeResult =
  | { readonly status: "removed"; readonly binding: CardWorktreeBinding }
  | {
      readonly status: "refused" | "failed";
      readonly reason: WorktreeUnavailableReason;
      readonly binding?: CardWorktreeBinding;
    };

export function isWorktreeUnavailableReason(value: string): value is WorktreeUnavailableReason {
  return WORKTREE_UNAVAILABLE_REASONS.includes(value as WorktreeUnavailableReason);
}

export function validateCardWorktreeBinding(input: unknown): CardWorktreeBinding {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("card worktree binding must be a plain object");
  }
  const value = input as Record<string, unknown>;
  const keys = [
    "bindingVersion", "bindingId", "boardId", "cardId", "repositoryRoot",
    "repositoryGitDir", "managedRoot", "worktreePath", "branch", "baselineBranch",
    "baselineCommit", "lifecycle", "reason", "createdAt", "updatedAt",
  ] as const;
  if (Object.keys(value).some((key) => !keys.includes(key as (typeof keys)[number]))) {
    throw new Error("card worktree binding has an unknown field");
  }
  if (keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error("card worktree binding is missing a field");
  }
  const string = (key: (typeof keys)[number]): string => {
    const entry = value[key];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`card worktree ${key} must be a non-empty string`);
    }
    return entry;
  };
  const bindingId = string("bindingId");
  const repositoryRoot = string("repositoryRoot");
  const repositoryGitDir = string("repositoryGitDir");
  const managedRoot = string("managedRoot");
  const worktreePath = string("worktreePath");
  const branch = string("branch");
  const baselineBranch = string("baselineBranch");
  const baselineCommit = string("baselineCommit");
  const lifecycle = string("lifecycle");
  const reason = value.reason;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (value.bindingVersion !== 1) throw new Error("card worktree bindingVersion must be 1");
  if (!/^kw-[a-z0-9]{12,32}$/u.test(bindingId)) throw new Error("card worktree bindingId is invalid");
  if ([repositoryRoot, repositoryGitDir, managedRoot, worktreePath].some((path) => !isAbsolute(path))) {
    throw new Error("card worktree paths must be absolute");
  }
  if (managedRoot !== resolve(repositoryRoot, MANAGED_WORKTREE_ROOT_RELATIVE)) {
    throw new Error("card worktree managedRoot is not owned by the repository");
  }
  if (worktreePath !== resolve(managedRoot, bindingId) || dirname(worktreePath) !== managedRoot) {
    throw new Error("card worktree path is not owned by the managed root");
  }
  if (branch !== `kitten/card/${bindingId}` || basename(worktreePath) !== bindingId) {
    throw new Error("card worktree branch identity is invalid");
  }
  if (!/^[0-9a-f]{40,64}$/u.test(baselineCommit)) {
    throw new Error("card worktree baselineCommit is invalid");
  }
  if (!["active", "unavailable", "cleanup_refused", "removed"].includes(lifecycle)) {
    throw new Error("card worktree lifecycle is invalid");
  }
  if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0) {
    throw new Error("card worktree createdAt is invalid");
  }
  if (!Number.isSafeInteger(updatedAt) || (updatedAt as number) < (createdAt as number)) {
    throw new Error("card worktree updatedAt is invalid");
  }
  if (
    reason !== null
    && (typeof reason !== "string" || !isWorktreeUnavailableReason(reason))
  ) {
    throw new Error("card worktree reason is invalid");
  }
  if ((lifecycle === "active" || lifecycle === "removed") !== (reason === null)) {
    throw new Error("card worktree lifecycle and reason disagree");
  }
  return {
    bindingVersion: 1,
    bindingId,
    boardId: string("boardId") as BoardId,
    cardId: string("cardId") as CardId,
    repositoryRoot,
    repositoryGitDir,
    managedRoot,
    worktreePath,
    branch,
    baselineBranch,
    baselineCommit,
    lifecycle: lifecycle as CardWorktreeLifecycle,
    reason: reason as WorktreeUnavailableReason | null,
    createdAt: createdAt as number,
    updatedAt: updatedAt as number,
  };
}

export function withBindingLifecycle(
  binding: CardWorktreeBinding,
  lifecycle: CardWorktreeLifecycle,
  reason: WorktreeUnavailableReason | null,
  updatedAt: number,
): CardWorktreeBinding {
  if ((lifecycle === "active" || lifecycle === "removed") !== (reason === null)) {
    throw new Error(`${lifecycle} worktree lifecycle has an invalid reason`);
  }
  return { ...binding, lifecycle, reason, updatedAt };
}
