import type { EventJournal } from "../persistence/eventJournal.ts";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import {
  type CardWorktreeBinding,
  type CleanupCardWorktreeResult,
  type EnsureCardWorktreeResult,
  type ExplicitCardWorktreeCleanupInput,
  withBindingLifecycle,
} from "./contracts.ts";
import {
  readCardWorktreeBinding,
  recordCardWorktreeBinding,
} from "./cardWorktreeProjection.ts";
import { createCardGitWorktrees, type CardGitWorktrees } from "./gitWorktree.ts";

export interface EnsureCardWorktreeInput {
  readonly boardId: BoardId;
  readonly cardId: CardId;
}

export interface CardWorktreeService {
  ensure(input: EnsureCardWorktreeInput): Promise<EnsureCardWorktreeResult>;
  cleanupExplicit(input: ExplicitCardWorktreeCleanupInput): Promise<CleanupCardWorktreeResult>;
}

export interface CreateCardWorktreeServiceOptions {
  readonly gitWorktrees?: CardGitWorktrees;
  readonly now?: () => number;
  readonly createEventId?: () => string;
}

function createEventId(): string {
  return `worktree:${crypto.randomUUID()}`;
}

/** Desktop-owned lifecycle. Review and recovery consumers receive no implicit cleanup hook. */
export function createCardWorktreeService(
  journal: EventJournal,
  options: CreateCardWorktreeServiceOptions = {},
): CardWorktreeService {
  const gitWorktrees = options.gitWorktrees ?? createCardGitWorktrees();
  const now = options.now ?? Date.now;
  const nextEventId = options.createEventId ?? createEventId;

  const persist = (binding: CardWorktreeBinding, actor: "operator" | "system" = "system"): void => {
    recordCardWorktreeBinding(journal, {
      eventId: nextEventId(),
      binding,
      actor,
    });
  };

  return {
    async ensure(input) {
      const snapshot = journal.snapshot();
      const board = snapshot.boards.find(({ boardId }) => boardId === input.boardId);
      const card = snapshot.cards.find(({ cardId }) => cardId === input.cardId);
      if (board === undefined || card === undefined || card.boardId !== input.boardId) {
        return { status: "unavailable", reason: "unverified" };
      }

      const existing = readCardWorktreeBinding(snapshot, input.cardId);
      if (existing !== null) {
        if (existing.boardId !== input.boardId) {
          return { status: "unavailable", reason: "repository_mismatch" };
        }
        if (existing.lifecycle === "removed") {
          return { status: "unavailable", reason: "removed" };
        }
        const reconciled = await gitWorktrees.reconcile(existing, board.repositoryPath);
        const updatedAt = monotonicNow(existing, now());
        if (reconciled.status === "unavailable") {
          const unavailableBinding = withBindingLifecycle(
            existing,
            "unavailable",
            reconciled.reason,
            updatedAt,
          );
          try {
            persist(unavailableBinding);
          } catch {
            return { status: "unavailable", reason: "unverified" };
          }
          return { status: "unavailable", reason: reconciled.reason };
        }
        const active = withBindingLifecycle(
          reconciled.binding,
          "active",
          null,
          updatedAt,
        );
        try {
          persist(active);
        } catch {
          return { status: "unavailable", reason: "unverified" };
        }
        return { status: "reused", binding: active };
      }

      const createdAt = Math.max(0, now());
      const provisioned = await gitWorktrees.provision({
        boardId: input.boardId,
        cardId: input.cardId,
        trustedRepositoryPath: board.repositoryPath,
        createdAt,
      });
      if (provisioned.status === "unavailable") return provisioned;
      try {
        persist(provisioned.binding);
      } catch {
        await gitWorktrees.rollbackProvision(provisioned.binding);
        return { status: "unavailable", reason: "unverified" };
      }
      return { status: "provisioned", binding: provisioned.binding };
    },

    async cleanupExplicit(input) {
      const snapshot = journal.snapshot();
      const board = snapshot.boards.find(({ boardId }) => boardId === input.boardId);
      const card = snapshot.cards.find(({ cardId }) => cardId === input.cardId);
      const binding = readCardWorktreeBinding(snapshot, input.cardId);
      if (board === undefined || card === undefined || card.boardId !== input.boardId) {
        return { status: "refused", reason: "unverified" };
      }
      if (binding === null) return { status: "refused", reason: "missing" };
      if (binding.boardId !== input.boardId) {
        return { status: "refused", reason: "repository_mismatch", binding };
      }
      if (binding.lifecycle === "removed") {
        return { status: "refused", reason: "removed", binding };
      }
      const cardIsLive = card.executionStatus === "running" || card.executionStatus === "needs_attention";
      if (
        input.requestedBy !== "operator"
        || !input.cardSettled
        || !Number.isSafeInteger(input.liveAttemptCount)
        || input.liveAttemptCount !== 0
        || cardIsLive
      ) {
        const refused = withBindingLifecycle(
          binding,
          "cleanup_refused",
          "live",
          monotonicNow(binding, now()),
        );
        try {
          persist(refused, "operator");
        } catch {
          return { status: "failed", reason: "unverified", binding };
        }
        return { status: "refused", reason: "live", binding: refused };
      }

      const removed = await gitWorktrees.removeExplicit(binding, board.repositoryPath);
      if (removed.status !== "removed") {
        const lifecycle = removed.status === "refused" ? "cleanup_refused" : "unavailable";
        const refused = withBindingLifecycle(
          binding,
          lifecycle,
          removed.reason,
          monotonicNow(binding, now()),
        );
        try {
          persist(refused, "operator");
        } catch {
          return { status: "failed", reason: "unverified", binding };
        }
        return { status: removed.status, reason: removed.reason, binding: refused };
      }

      const removedBinding = withBindingLifecycle(
        binding,
        "removed",
        null,
        monotonicNow(binding, now()),
      );
      try {
        persist(removedBinding, "operator");
      } catch {
        return { status: "failed", reason: "unverified", binding };
      }
      return { status: "removed", binding: removedBinding };
    },
  };
}

function monotonicNow(binding: CardWorktreeBinding, candidate: number): number {
  return Math.max(binding.createdAt, binding.updatedAt, candidate);
}
