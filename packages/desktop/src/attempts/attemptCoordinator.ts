import type {
  AttemptGeneration,
  AttemptId,
} from "@kitten/engine";
import { createSkillSnapshot } from "../catalog/skillCatalog.ts";
import type { SkillCatalog, SkillSnapshot } from "../catalog/contracts.ts";
import type {
  EventJournal,
  PersistenceSnapshot,
  ProjectionChange,
} from "../persistence/eventJournal.ts";
import type { CardWorktreeService } from "../worktrees/cardWorktreeService.ts";
import type { BoardProjection, CardId, CardProjection, StageProjection } from "../workflow/workflowTypes.ts";
import {
  deepFreeze,
  type AttemptProjection,
  type AttemptStartupFailure,
  type CertifiedDirectAcpProfile,
  type RepositoryReadinessEvidence,
  type RunContext,
} from "./contracts.ts";
import type { DirectAcpAttemptStarter, FreshDirectAcpSession } from "./directAcpAttempt.ts";
import { safeClose } from "./directAcpAttempt.ts";
import { validateRunnable, type RunnableFailure, type RunnableValidationInput } from "./runnableValidator.ts";
import type { GlobalAttemptScheduler, SchedulerReservation } from "./scheduler.ts";

export type StartAttemptResult =
  | { readonly status: "rejected"; readonly reason: RunnableFailure }
  | {
      readonly status: "started";
      readonly attempt: AttemptProjection;
      readonly context: RunContext;
      readonly sessionId: string;
    }
  | {
      readonly status: "failed";
      readonly attempt: AttemptProjection | null;
      readonly failure: AttemptStartupFailure;
    };

export interface DesktopAttemptCoordinator {
  start(cardId: CardId): Promise<StartAttemptResult>;
  release(attemptId: AttemptId): Promise<boolean>;
}

export interface CreateAttemptCoordinatorOptions {
  readonly journal: EventJournal;
  readonly scheduler: GlobalAttemptScheduler;
  readonly worktrees: CardWorktreeService;
  readonly directAcp: DirectAcpAttemptStarter;
  readonly getCatalog: (boardId: BoardProjection["boardId"]) => SkillCatalog;
  readonly resolveProfile: (card: CardProjection) => CertifiedDirectAcpProfile | null;
  readonly verifyRepository: (board: BoardProjection) => RepositoryReadinessEvidence;
  readonly now?: () => number;
  readonly createAttemptId?: () => string;
  readonly createEventId?: (operation: "created" | "started" | "startup_failed") => string;
}

interface ResolvedAdmission {
  readonly snapshot: PersistenceSnapshot;
  readonly board: BoardProjection | null;
  readonly card: CardProjection | null;
  readonly stage: StageProjection | null;
  readonly repository: RepositoryReadinessEvidence | null;
  readonly skill: SkillSnapshot | null;
  readonly skillSource: "stage" | "override";
  readonly profile: CertifiedDirectAcpProfile | null;
}

interface ActiveAttempt {
  readonly reservation: SchedulerReservation;
  readonly session: FreshDirectAcpSession;
}

function defaultAttemptId(): string {
  return `attempt:${crypto.randomUUID()}`;
}

function defaultEventId(operation: string): string {
  return `attempt:${operation}:${crypto.randomUUID()}`;
}

export function createAttemptCoordinator(options: CreateAttemptCoordinatorOptions): DesktopAttemptCoordinator {
  const now = options.now ?? Date.now;
  const createAttemptId = options.createAttemptId ?? defaultAttemptId;
  const createEventId = options.createEventId ?? defaultEventId;
  const active = new Map<AttemptId, ActiveAttempt>();

  const resolveAdmission = (cardId: CardId): ResolvedAdmission => {
    const snapshot = options.journal.snapshot();
    const card = snapshot.cards.find((candidate) => candidate.cardId === cardId) ?? null;
    const board = card === null
      ? null
      : snapshot.boards.find((candidate) => candidate.boardId === card.boardId) ?? null;
    const stage = card === null
      ? null
      : snapshot.stages.find((candidate) => candidate.stageId === card.stageId) ?? null;
    const repository = board === null ? null : options.verifyRepository(board);
    const skillSource = card?.skillOverrideId === null || card?.skillOverrideId === undefined ? "stage" : "override";
    const skillId = card?.skillOverrideId ?? stage?.defaultSkillId ?? null;
    let skill: SkillSnapshot | null = null;
    if (board !== null && skillId !== null) {
      try {
        skill = createSkillSnapshot(options.getCatalog(board.boardId), skillId);
      } catch {
        skill = null;
      }
    }
    return {
      snapshot,
      board,
      card,
      stage,
      repository,
      skill,
      skillSource,
      profile: card === null ? null : options.resolveProfile(card),
    };
  };

  const validate = (
    resolved: ResolvedAdmission,
    worktree: RunnableValidationInput["worktree"],
  ) => validateRunnable({
    board: resolved.board,
    card: resolved.card,
    stage: resolved.stage,
    repository: resolved.repository,
    effectiveSkill: resolved.skill,
    skillSource: resolved.skillSource,
    profile: resolved.profile,
    worktree,
    scheduler: options.scheduler.inspect(resolved.card?.cardId ?? ("missing" as CardId)),
  });

  return {
    async start(cardId) {
      const beforeWorktree = resolveAdmission(cardId);
      const initial = validate(beforeWorktree, null);
      if (!initial.runnable && initial.reason.code !== "worktree_unavailable") {
        return { status: "rejected", reason: initial.reason };
      }
      if (beforeWorktree.board === null || beforeWorktree.card === null) {
        return { status: "rejected", reason: initial.runnable
          ? { code: "card_not_found", message: "The card no longer exists on this board." }
          : initial.reason };
      }

      const ensured = await options.worktrees.ensure({
        boardId: beforeWorktree.board.boardId,
        cardId,
      });
      const resolved = resolveAdmission(cardId);
      const admission = validate(resolved, ensured);
      if (!admission.runnable) return { status: "rejected", reason: admission.reason };
      const { board, card, stage, repository, skill, profile } = resolved;
      if (board === null || card === null || stage === null || repository === null || skill === null || profile === null) {
        throw new Error("Runnable admission lost a required resolved value");
      }
      if (ensured.status === "unavailable") throw new Error("Runnable admission accepted an unavailable worktree");

      const reserved = options.scheduler.reserve(card.cardId);
      if (reserved.status !== "reserved") {
        const retry = validate(resolved, ensured);
        if (!retry.runnable) return { status: "rejected", reason: retry.reason };
        throw new Error("Scheduler rejected a runnable reservation without a reason");
      }

      const attemptIdValue = createAttemptId();
      const attemptId = attemptIdValue.trim().length === 0 ? null : attemptIdValue as AttemptId;
      const previousGeneration = resolved.snapshot.attempts
        .filter((attempt) => attempt.cardId === card.cardId)
        .reduce((maximum, attempt) => Math.max(maximum, Number(attempt.generation)), 0);
      const nextGeneration = previousGeneration + 1;
      const generation = Number.isSafeInteger(nextGeneration) && nextGeneration >= 0
        ? nextGeneration as AttemptGeneration
        : null;
      if (attemptId === null || generation === null) {
        options.scheduler.release(reserved.reservation);
        throw new Error("Attempt identity factory returned an invalid identity");
      }
      const createdAt = Math.max(0, now());
      const context = createRunContext({
        attemptId,
        generation,
        capturedAt: createdAt,
        board,
        card,
        stage,
        skill,
        profile,
        repository,
        worktree: ensured.binding,
      });
      const startingAttempt: AttemptProjection = {
        attemptId,
        boardId: board.boardId,
        cardId: card.cardId,
        generation,
        state: "starting",
        sessionId: null,
        failure: null,
        createdAt,
        startedAt: null,
        terminalAt: null,
      };
      const runningCard: CardProjection = {
        ...card,
        executionStatus: "running",
        version: card.version + 1,
        updatedAt: Math.max(card.updatedAt, createdAt),
      };
      try {
        appendLifecycle(options.journal, {
          eventId: createEventId("created"),
          operation: "created",
          board,
          cardId: card.cardId,
          attemptId,
          attemptSequence: 0,
          occurredAt: createdAt,
          changes: [
            { entity: "card", operation: "upsert", value: runningCard },
            { entity: "attempt", operation: "upsert", value: startingAttempt },
            { entity: "run_context", operation: "insert", value: context },
          ],
          expectedCardVersion: card.version,
        });
      } catch (error) {
        options.scheduler.release(reserved.reservation);
        return {
          status: "failed",
          attempt: null,
          failure: {
            code: "startup_commit_failed",
            message: legibleError(error, "Attempt creation could not be committed"),
            occurredAt: Math.max(createdAt, now()),
          },
        };
      }

      const started = await options.directAcp.start({
        attemptId,
        generation,
        cwd: context.worktree.worktreePath,
        model: context.profile.model,
        effort: context.profile.effort,
        skillContent: context.skill.content,
        profile,
      });
      if (started.status === "failed") {
        const failure: AttemptStartupFailure = { ...started.failure, occurredAt: Math.max(createdAt, now()) };
        let failedAttempt: AttemptProjection;
        try {
          failedAttempt = persistStartupFailure(
            options.journal,
            createEventId("startup_failed"),
            board,
            startingAttempt,
            runningCard,
            failure,
          );
        } finally {
          options.scheduler.release(reserved.reservation);
        }
        return { status: "failed", attempt: failedAttempt, failure };
      }

      const startedAt = Math.max(createdAt, now());
      const runningAttempt: AttemptProjection = {
        ...startingAttempt,
        state: "running",
        sessionId: started.session.sessionId,
        startedAt,
      };
      try {
        appendLifecycle(options.journal, {
          eventId: createEventId("started"),
          operation: "started",
          board,
          cardId: card.cardId,
          attemptId,
          attemptSequence: 1,
          occurredAt: startedAt,
          changes: [{ entity: "attempt", operation: "upsert", value: runningAttempt }],
        });
      } catch (error) {
        await safeClose(started.session.connection);
        const failure: AttemptStartupFailure = {
          code: "startup_commit_failed",
          message: legibleError(error, "Fresh Direct ACP session could not be committed"),
          occurredAt: Math.max(startedAt, now()),
        };
        let failedAttempt: AttemptProjection;
        try {
          failedAttempt = persistStartupFailure(
            options.journal,
            createEventId("startup_failed"),
            board,
            startingAttempt,
            runningCard,
            failure,
          );
        } finally {
          options.scheduler.release(reserved.reservation);
        }
        return { status: "failed", attempt: failedAttempt, failure };
      }
      active.set(attemptId, { reservation: reserved.reservation, session: started.session });
      return { status: "started", attempt: runningAttempt, context, sessionId: started.session.sessionId };
    },

    async release(attemptId) {
      const value = active.get(attemptId);
      if (value === undefined) return false;
      active.delete(attemptId);
      await safeClose(value.session.connection);
      return options.scheduler.release(value.reservation);
    },
  };
}

function createRunContext(input: {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly capturedAt: number;
  readonly board: BoardProjection;
  readonly card: CardProjection;
  readonly stage: StageProjection;
  readonly skill: SkillSnapshot;
  readonly profile: CertifiedDirectAcpProfile;
  readonly repository: RepositoryReadinessEvidence;
  readonly worktree: RunContext["worktree"];
}): RunContext {
  if (!input.profile.readiness.ready) throw new Error("Cannot capture an unready profile in a Run Context");
  return deepFreeze({
    schemaVersion: 1,
    attemptId: input.attemptId,
    generation: input.generation,
    capturedAt: input.capturedAt,
    card: {
      cardId: input.card.cardId,
      title: input.card.title,
      description: input.card.description,
      version: input.card.version,
    },
    stage: { stageId: input.stage.stageId, label: input.stage.label },
    workflow: { boardId: input.board.boardId, version: input.board.workflowVersion },
    skill: input.skill,
    profile: {
      profileId: input.profile.profileId,
      provider: input.profile.provider,
      model: input.card.model,
      effort: input.card.effort,
      protocolVersion: input.profile.readiness.protocolVersion,
      recipeId: input.profile.certification.recipeId,
      adapterVersion: input.profile.certification.adapterVersion,
      readinessCheckedAt: input.profile.certification.checkedAt,
    },
    repository: input.repository,
    worktree: input.worktree,
  });
}

function appendLifecycle(journal: EventJournal, input: {
  readonly eventId: string;
  readonly operation: "created" | "started" | "startup_failed";
  readonly board: BoardProjection;
  readonly cardId: CardId;
  readonly attemptId: AttemptId;
  readonly attemptSequence: number;
  readonly occurredAt: number;
  readonly changes: readonly ProjectionChange[];
  readonly expectedCardVersion?: number;
}): void {
  journal.append({
    eventId: input.eventId,
    boardId: input.board.boardId,
    cardId: input.cardId,
    attemptId: input.attemptId,
    attemptSequence: input.attemptSequence,
    actor: "system",
    kind: "attempt_lifecycle_committed",
    occurredAt: input.occurredAt,
    payload: { operation: input.operation, changes: input.changes },
  }, input.expectedCardVersion === undefined ? undefined : {
    preconditions: [
      { entity: "board", id: input.board.boardId, expectedVersion: input.board.workflowVersion },
      { entity: "card", id: input.cardId, expectedVersion: input.expectedCardVersion },
    ],
  });
}

function persistStartupFailure(
  journal: EventJournal,
  eventId: string,
  board: BoardProjection,
  startingAttempt: AttemptProjection,
  runningCard: CardProjection,
  failure: AttemptStartupFailure,
): AttemptProjection {
  const attempt: AttemptProjection = {
    ...startingAttempt,
    state: "failed",
    failure,
    terminalAt: failure.occurredAt,
  };
  const card: CardProjection = {
    ...runningCard,
    executionStatus: "failed",
    version: runningCard.version + 1,
    updatedAt: Math.max(runningCard.updatedAt, failure.occurredAt),
  };
  appendLifecycle(journal, {
    eventId,
    operation: "startup_failed",
    board,
    cardId: startingAttempt.cardId,
    attemptId: startingAttempt.attemptId,
    attemptSequence: 1,
    occurredAt: failure.occurredAt,
    changes: [
      { entity: "card", operation: "upsert", value: card },
      { entity: "attempt", operation: "upsert", value: attempt },
    ],
  });
  return attempt;
}

function legibleError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
