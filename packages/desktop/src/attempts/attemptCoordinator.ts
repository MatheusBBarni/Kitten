import type {
  AttemptGeneration,
  AttemptId,
} from "@kitten/engine";
import { isDirectAcpTerminalState } from "@kitten/engine";
import { createSkillSnapshot } from "../catalog/skillCatalog.ts";
import type { SkillCatalog, SkillSnapshot } from "../catalog/contracts.ts";
import type {
  EventJournal,
  PersistenceSnapshot,
  ProjectionChange,
} from "../persistence/eventJournal.ts";
import { ProjectionVersionConflictError } from "../persistence/eventJournal.ts";
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
import type { AttemptActivityIngestor } from "./activityIngestor.ts";
import type { AttemptAskUserBridge, AttemptAskUserRoute } from "../attention/attemptAskUserBridge.ts";
import {
  awaitingConfirmationHead,
  confirmFollowUpHead,
  createFollowUpQueue,
  enqueueFollowUp,
  FollowUpQueueTransitionError,
  markFollowUpDispatched,
  removeFollowUp,
  settleFollowUpTurn,
  type FollowUpQueueId,
  type FollowUpQueueOperation,
  type FollowUpQueueProjection,
  type FollowUpTurnState,
} from "./followUpQueue.ts";

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
  queueFollowUp(input: QueueFollowUpInput): FollowUpQueueResult;
  removeQueuedFollowUp(input: RemoveQueuedFollowUpInput): FollowUpQueueResult;
  settleTurn(input: SettleFollowUpTurnInput): FollowUpQueueResult;
  confirmQueuedFollowUp(input: ConfirmQueuedFollowUpInput): Promise<FollowUpQueueResult>;
}

export interface FollowUpFence {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly expectedQueueVersion: number;
}

export interface QueueFollowUpInput extends FollowUpFence {
  readonly text: string;
  readonly queueId?: FollowUpQueueId;
}

export interface RemoveQueuedFollowUpInput extends FollowUpFence {
  readonly queueId: FollowUpQueueId;
}

export interface ConfirmQueuedFollowUpInput extends FollowUpFence {
  readonly queueId: FollowUpQueueId;
}

export interface SettleFollowUpTurnInput {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
}

export type FollowUpRejectionCode =
  | "unknown_attempt"
  | "stale_attempt"
  | "stale_generation"
  | "stale_version"
  | "stale_head"
  | "attempt_terminal"
  | "invalid_state"
  | "blocker_active"
  | "dispatch_failed";

export type FollowUpQueueResult =
  | { readonly status: "ok"; readonly projection: FollowUpQueueProjection | null }
  | { readonly status: "rejected"; readonly reason: { readonly code: FollowUpRejectionCode; readonly message: string } };

export interface ContentFreeFollowUpTelemetry {
  record(name: "follow_up_created" | "follow_up_removed" | "follow_up_confirmed" | "follow_up_dispatched" | "follow_up_rejected", attributes: {
    readonly attemptId: AttemptId;
    readonly generation: AttemptGeneration;
    readonly outcome: string;
  }): void;
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
  readonly activityIngestor?: AttemptActivityIngestor;
  readonly hasActiveAttention?: (attemptId: AttemptId) => boolean;
  readonly telemetry?: ContentFreeFollowUpTelemetry;
  readonly createQueueId?: () => string;
  readonly createFollowUpEventId?: (operation: FollowUpQueueOperation) => string;
  readonly askUserBridge?: Pick<AttemptAskUserBridge, "register" | "revoke">;
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
  unsubscribeActivity: () => void;
  turnState: FollowUpTurnState;
  revokeAskUser: () => void;
}

function defaultAttemptId(): string {
  return `attempt:${crypto.randomUUID()}`;
}

function defaultEventId(operation: string): string {
  return `attempt:${operation}:${crypto.randomUUID()}`;
}

function defaultQueueId(): string {
  return `follow-up:${crypto.randomUUID()}`;
}

export function createAttemptCoordinator(options: CreateAttemptCoordinatorOptions): DesktopAttemptCoordinator {
  const now = options.now ?? Date.now;
  const createAttemptId = options.createAttemptId ?? defaultAttemptId;
  const createEventId = options.createEventId ?? defaultEventId;
  const createQueueId = options.createQueueId ?? defaultQueueId;
  const createFollowUpEventId = options.createFollowUpEventId ?? defaultEventId;
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

      let askUserRoute: AttemptAskUserRoute | undefined;
      try {
        askUserRoute = options.askUserBridge?.register({ attemptId, generation });
      } catch (error) {
        const failure: AttemptStartupFailure = {
          code: "connection_failed",
          message: legibleError(error, "Attempt ask_user route registration failed"),
          occurredAt: Math.max(createdAt, now()),
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

      const started = await options.directAcp.start({
        attemptId,
        generation,
        cwd: context.worktree.worktreePath,
        model: context.profile.model,
        effort: context.profile.effort,
        skillContent: context.skill.content,
        profile,
        ...(askUserRoute === undefined ? {} : { askUserRoute: { capability: askUserRoute.capability } }),
      });
      if (started.status === "failed") {
        const failure: AttemptStartupFailure = { ...started.failure, occurredAt: Math.max(createdAt, now()) };
        let failedAttempt: AttemptProjection;
        try {
          if (askUserRoute !== undefined) options.askUserBridge?.revoke(askUserRoute);
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
        if (askUserRoute !== undefined) options.askUserBridge?.revoke(askUserRoute);
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
      const activeAttempt: ActiveAttempt = {
        reservation: reserved.reservation,
        session: started.session,
        unsubscribeActivity: () => {},
        turnState: "active",
        revokeAskUser: () => {
          if (askUserRoute !== undefined) options.askUserBridge?.revoke(askUserRoute);
        },
      };
      active.set(attemptId, activeAttempt);
      if (options.activityIngestor !== undefined) {
        activeAttempt.unsubscribeActivity = started.session.connection.subscribeActivity(async (input) => {
          const result = await options.activityIngestor!.ingest(input, { attemptId, generation });
          if (
            result.status === "committed"
            && result.inspector.terminalOutcome !== null
          ) {
            await releaseActive(active, options.scheduler, attemptId);
          }
        });
      }
      return { status: "started", attempt: runningAttempt, context, sessionId: started.session.sessionId };
    },

    queueFollowUp(input) {
      const resolved = resolveFollowUpFence(options.journal, active, input);
      if (resolved.status === "rejected") return rejectedFollowUp(options, input, resolved.code, resolved.message);
      if (input.text.trim().length === 0) {
        return rejectedFollowUp(options, input, "invalid_state", "Follow-up text must be non-empty");
      }
      const queueIdValue = input.queueId ?? createQueueId() as FollowUpQueueId;
      if (queueIdValue.trim().length === 0) {
        return rejectedFollowUp(options, input, "invalid_state", "Follow-up queue identity is invalid");
      }
      try {
        const projection = resolved.queue === null
          ? createFollowUpQueue({
              boardId: resolved.attempt.boardId,
              cardId: resolved.attempt.cardId,
              attemptId: input.attemptId,
              generation: input.generation,
              turnState: resolved.active.turnState === "settled" ? "settled" : "active",
              queueId: queueIdValue,
              text: input.text,
              occurredAt: Math.max(0, now()),
            })
          : enqueueFollowUp(resolved.queue, {
              queueId: queueIdValue,
              text: input.text,
              occurredAt: Math.max(0, now()),
            });
        appendFollowUpQueue(options.journal, createFollowUpEventId("created"), "created", projection, input.expectedQueueVersion);
        recordFollowUp(options, "follow_up_created", input, "committed");
        return { status: "ok", projection };
      } catch (error) {
        return mapFollowUpError(options, input, error);
      }
    },

    removeQueuedFollowUp(input) {
      const resolved = resolveFollowUpFence(options.journal, active, input);
      if (resolved.status === "rejected") return rejectedFollowUp(options, input, resolved.code, resolved.message);
      if (resolved.queue === null) return rejectedFollowUp(options, input, "stale_head", "The follow-up queue is empty");
      try {
        const projection = removeFollowUp(resolved.queue, input.queueId, Math.max(0, now()));
        appendFollowUpQueue(options.journal, createFollowUpEventId("removed"), "removed", projection, input.expectedQueueVersion);
        recordFollowUp(options, "follow_up_removed", input, "committed");
        return { status: "ok", projection };
      } catch (error) {
        return mapFollowUpError(options, input, error);
      }
    },

    settleTurn(input) {
      const current = options.journal.snapshot().followUpQueues.find((queue) => queue.attemptId === input.attemptId) ?? null;
      const attempt = options.journal.snapshot().attempts.find((candidate) => candidate.attemptId === input.attemptId);
      const activeAttempt = active.get(input.attemptId);
      if (attempt === undefined || activeAttempt === undefined) {
        return rejectedFollowUp(options, input, "unknown_attempt", "Attempt is not active in this desktop host");
      }
      if (attempt.generation !== input.generation) {
        return rejectedFollowUp(options, input, "stale_generation", "Attempt generation is stale");
      }
      if (isDirectAcpTerminalState(attempt.state)) {
        return rejectedFollowUp(options, input, "attempt_terminal", "A terminal attempt cannot expose a follow-up head");
      }
      activeAttempt.turnState = "settled";
      if (current === null || current.turnState === "settled") return { status: "ok", projection: current };
      try {
        const projection = settleFollowUpTurn(current, Math.max(0, now()));
        appendFollowUpQueue(options.journal, createFollowUpEventId("head_ready"), "head_ready", projection, current.version);
        return { status: "ok", projection };
      } catch (error) {
        return mapFollowUpError(options, { ...input, expectedQueueVersion: current.version }, error);
      }
    },

    async confirmQueuedFollowUp(input) {
      const resolved = resolveFollowUpFence(options.journal, active, input);
      if (resolved.status === "rejected") return rejectedFollowUp(options, input, resolved.code, resolved.message);
      if (resolved.attempt.state === "needs_attention" || options.hasActiveAttention?.(input.attemptId) === true) {
        return rejectedFollowUp(options, input, "blocker_active", "Resolve the active Attention Blocker before dispatching a follow-up");
      }
      if (resolved.queue === null) return rejectedFollowUp(options, input, "stale_head", "The follow-up queue is empty");
      const head = awaitingConfirmationHead(resolved.queue);
      if (head?.queueId !== input.queueId) {
        return rejectedFollowUp(options, input, "stale_head", "The expected queue head is no longer awaiting confirmation");
      }
      let confirmed: FollowUpQueueProjection;
      try {
        confirmed = confirmFollowUpHead(resolved.queue, input.queueId, Math.max(0, now()));
        appendFollowUpQueue(options.journal, createFollowUpEventId("confirmed"), "confirmed", confirmed, input.expectedQueueVersion);
        resolved.active.turnState = "dispatching";
        recordFollowUp(options, "follow_up_confirmed", input, "committed");
      } catch (error) {
        return mapFollowUpError(options, input, error);
      }

      try {
        await resolved.active.session.connection.prompt({
          sessionId: resolved.active.session.sessionId,
          prompt: head.text,
        });
      } catch {
        return rejectedFollowUp(options, input, "dispatch_failed", "The confirmed follow-up could not be dispatched");
      }

      try {
        const latest = options.journal.snapshot().followUpQueues.find((queue) => queue.attemptId === input.attemptId);
        if (latest === undefined) throw new Error("Confirmed follow-up projection disappeared before dispatch commit");
        const projection = markFollowUpDispatched(latest, input.queueId, Math.max(0, now()));
        appendFollowUpQueue(options.journal, createFollowUpEventId("dispatched"), "dispatched", projection, latest.version);
        resolved.active.turnState = "settled";
        recordFollowUp(options, "follow_up_dispatched", input, "committed");
        return { status: "ok", projection };
      } catch (error) {
        return mapFollowUpError(options, input, error);
      }
    },

    async release(attemptId) {
      return releaseActive(active, options.scheduler, attemptId);
    },
  };
}

type ResolvedFollowUpFence =
  | {
      readonly status: "ok";
      readonly attempt: AttemptProjection;
      readonly active: ActiveAttempt;
      readonly queue: FollowUpQueueProjection | null;
    }
  | { readonly status: "rejected"; readonly code: FollowUpRejectionCode; readonly message: string };

function resolveFollowUpFence(
  journal: EventJournal,
  active: Map<AttemptId, ActiveAttempt>,
  input: FollowUpFence,
): ResolvedFollowUpFence {
  const snapshot = journal.snapshot();
  const attempt = snapshot.attempts.find((candidate) => candidate.attemptId === input.attemptId);
  if (attempt === undefined) return { status: "rejected", code: "unknown_attempt", message: "Attempt does not exist" };
  if (attempt.generation !== input.generation) {
    return { status: "rejected", code: "stale_generation", message: "Attempt generation is stale" };
  }
  if (isDirectAcpTerminalState(attempt.state)) {
    return { status: "rejected", code: "attempt_terminal", message: `Attempt is terminal (${attempt.state})` };
  }
  if (attempt.state !== "running" && attempt.state !== "needs_attention") {
    return { status: "rejected", code: "invalid_state", message: `Attempt is not dispatchable (${attempt.state})` };
  }
  const live = active.get(input.attemptId);
  if (live === undefined) {
    return { status: "rejected", code: "stale_attempt", message: "Attempt is not owned by this live desktop host" };
  }
  const queue = snapshot.followUpQueues.find((candidate) => candidate.attemptId === input.attemptId) ?? null;
  const actualVersion = queue?.version ?? 0;
  if (!Number.isSafeInteger(input.expectedQueueVersion) || input.expectedQueueVersion < 0 || actualVersion !== input.expectedQueueVersion) {
    return {
      status: "rejected",
      code: "stale_version",
      message: `Follow-up queue version is stale: expected ${input.expectedQueueVersion}, actual ${actualVersion}`,
    };
  }
  return { status: "ok", attempt, active: live, queue };
}

function appendFollowUpQueue(
  journal: EventJournal,
  eventId: string,
  operation: FollowUpQueueOperation,
  queue: FollowUpQueueProjection,
  expectedVersion: number,
): void {
  journal.append({
    eventId,
    boardId: queue.boardId,
    cardId: queue.cardId,
    actor: operation === "head_ready" || operation === "dispatched" ? "system" : "operator",
    kind: "follow_up_queue_committed",
    occurredAt: queue.updatedAt,
    payload: { operation, queue },
  }, {
    preconditions: [{ entity: "follow_up_queue", id: queue.attemptId, expectedVersion }],
  });
}

function mapFollowUpError(
  options: CreateAttemptCoordinatorOptions,
  input: FollowUpFence,
  error: unknown,
): FollowUpQueueResult {
  if (error instanceof ProjectionVersionConflictError) {
    return rejectedFollowUp(options, input, "stale_version", error.message);
  }
  if (error instanceof FollowUpQueueTransitionError) {
    const code: FollowUpRejectionCode = error.reason === "stale_head" || error.reason === "queue_not_found"
      ? "stale_head"
      : "invalid_state";
    return rejectedFollowUp(options, input, code, error.message);
  }
  return rejectedFollowUp(options, input, "invalid_state", legibleError(error, "Follow-up queue mutation failed"));
}

function rejectedFollowUp(
  options: CreateAttemptCoordinatorOptions,
  input: Pick<FollowUpFence, "attemptId" | "generation">,
  code: FollowUpRejectionCode,
  message: string,
): FollowUpQueueResult {
  recordFollowUp(options, "follow_up_rejected", input, code);
  return { status: "rejected", reason: { code, message } };
}

function recordFollowUp(
  options: CreateAttemptCoordinatorOptions,
  name: Parameters<ContentFreeFollowUpTelemetry["record"]>[0],
  input: Pick<FollowUpFence, "attemptId" | "generation">,
  outcome: string,
): void {
  options.telemetry?.record(name, {
    attemptId: input.attemptId,
    generation: input.generation,
    outcome,
  });
}

async function releaseActive(
  active: Map<AttemptId, ActiveAttempt>,
  scheduler: GlobalAttemptScheduler,
  attemptId: AttemptId,
): Promise<boolean> {
  const value = active.get(attemptId);
  if (value === undefined) return false;
  active.delete(attemptId);
  value.revokeAskUser();
  value.unsubscribeActivity();
  await safeClose(value.session.connection);
  return scheduler.release(value.reservation);
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
