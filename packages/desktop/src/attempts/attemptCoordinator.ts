import type {
  ActivityEventId,
  ActivitySequence,
  AttemptGeneration,
  AttemptId,
  DirectAcpAttemptState,
} from "@kitten/engine";
import { isDirectAcpTerminalState, toActivitySequence, toOpaqueId } from "@kitten/engine";
import { createSkillSnapshot } from "../catalog/skillCatalog.ts";
import type { SkillCatalog, SkillSnapshot } from "../catalog/contracts.ts";
import type {
  EventJournal,
  PersistenceSnapshot,
  PromptSubmissionRecord,
  ProjectionChange,
  ReviewDispositionProjection,
} from "../persistence/eventJournal.ts";
import { ProjectionVersionConflictError } from "../persistence/eventJournal.ts";
import type {
  ContractError,
  SubmitCardPromptInput,
  SubmitCardPromptResult,
} from "../shared/rpc.ts";
import {
  reviewEvidenceContractError,
  type ReviewEvidenceService,
  type ReviewEvidenceUnavailableReason,
} from "../host/reviewEvidence.ts";
import { evidenceBoundReviewPreconditions } from "../host/reviewDisposition.ts";
import {
  recordWorkflowMeasurementSafely,
  silentLifecycleDiagnostics,
  type LifecycleDiagnostics,
  type WorkflowMeasurementSink,
} from "../host/lifecycleDiagnostics.ts";
import type { CardWorktreeService } from "../worktrees/cardWorktreeService.ts";
import { readCardWorktreeBinding } from "../worktrees/cardWorktreeProjection.ts";
import type { WorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import {
  workflowIds,
  type BoardProjection,
  type CardId,
  type CardProjection,
  type MutationId,
  type StageProjection,
} from "../workflow/workflowTypes.ts";
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
  createFollowUpQueue,
  enqueueFollowUp,
  followUpQueueFence,
  interruptFollowUpDispatch,
  markFollowUpDispatched,
  markFollowUpDispatching,
  queuedFollowUpHead,
  type FollowUpQueueId,
  type FollowUpQueueOperation,
  type FollowUpQueueProjection,
} from "./followUpQueue.ts";
import { createHash } from "node:crypto";
import {
  bucketBytes,
  bucketCount,
} from "../host/workflowMeasurement.ts";

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
    }
  | {
      readonly status: "submission_rejected";
      readonly error: ContractError;
    };

export type SuccessfulAttemptCompletionResult =
  | {
      readonly status: "advanced";
      readonly revision: number;
    }
  | {
      readonly status: "ready_for_review";
      readonly revision: number;
      readonly cardVersion: number;
      readonly evidenceId: string;
      readonly evidenceDigest: string;
    }
  | {
      readonly status: "non_reviewable";
      readonly reason: ReviewEvidenceUnavailableReason;
      readonly error: ContractError;
    };

export async function completeSuccessfulAttempt(options: {
  readonly journal: EventJournal;
  readonly workflowCommands: WorkflowCommandHandler;
  readonly reviewEvidence: Pick<ReviewEvidenceService, "capture">;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly createMutationId?: () => MutationId;
  readonly measurement?: WorkflowMeasurementSink;
}): Promise<SuccessfulAttemptCompletionResult> {
  const snapshot = options.journal.snapshot();
  const attempt = snapshot.attempts.find((candidate) => (
    candidate.attemptId === options.attemptId
    && candidate.generation === options.generation
  ));
  if (attempt === undefined || attempt.state !== "succeeded") {
    return {
      status: "non_reviewable",
      reason: "stale_attempt",
      error: reviewEvidenceContractError("stale_attempt"),
    };
  }
  const card = snapshot.cards.find((candidate) => (
    candidate.cardId === attempt.cardId && candidate.boardId === attempt.boardId
  ));
  const board = snapshot.boards.find(({ boardId }) => boardId === attempt.boardId);
  if (card === undefined || board === undefined || card.executionStatus !== "running") {
    return {
      status: "non_reviewable",
      reason: "stale_card",
      error: reviewEvidenceContractError("stale_card"),
    };
  }

  const hasSuccessor = snapshot.edges.some((edge) => (
    edge.boardId === board.boardId && edge.sourceStageId === card.stageId
  ));
  if (hasSuccessor) {
    const result = options.workflowCommands.execute({
      kind: "record_agent_success",
      mutationId: options.createMutationId?.()
        ?? workflowIds.mutation(`agent-success:${crypto.randomUUID()}`),
      boardId: board.boardId,
      expectedWorkflowVersion: board.workflowVersion,
      cardId: card.cardId,
      expectedCardVersion: card.version,
    });
    if (result.status === "committed") {
      return { status: "advanced", revision: result.delta.revision };
    }
    if (result.status === "idempotent") {
      return { status: "advanced", revision: options.journal.snapshot().revision };
    }
    return {
      status: "non_reviewable",
      reason: "stale_card",
      error: {
        code: "stale_projection",
        recoveryHint: "refresh_projection",
        expectedVersion: card.version,
        actualVersion: options.journal.snapshot().cards.find(
          ({ cardId }) => cardId === card.cardId,
        )?.version,
      },
    };
  }

  const context = snapshot.runContexts.find((candidate) => (
    candidate.attemptId === attempt.attemptId
    && candidate.generation === attempt.generation
    && candidate.card.cardId === card.cardId
    && candidate.workflow.boardId === board.boardId
  ));
  if (context === undefined) {
    return {
      status: "non_reviewable",
      reason: "incomplete",
      error: reviewEvidenceContractError("incomplete"),
    };
  }
  const captured = await options.reviewEvidence.capture({
    boardId: board.boardId,
    expectedWorkflowVersion: board.workflowVersion,
    cardId: card.cardId,
    attemptId: attempt.attemptId,
    generation: attempt.generation,
    expectedCardVersion: card.version,
    worktreeBindingId: context.worktree.bindingId,
  });
  if (captured.status === "unavailable") {
    recordWorkflowMeasurementSafely(options.measurement, {
      schemaVersion: 1,
      name: "evidence_capture",
      outcome: "unavailable",
      fileCountBucket: "0",
      byteCountBucket: "0",
      reason: reviewEvidenceContractError(captured.reason).code,
    });
    return {
      status: "non_reviewable",
      reason: captured.reason,
      error: reviewEvidenceContractError(captured.reason),
    };
  }
  recordWorkflowMeasurementSafely(options.measurement, {
    schemaVersion: 1,
    name: "evidence_capture",
    outcome: "available",
    fileCountBucket: bucketCount(captured.evidence.fileCount),
    byteCountBucket: bucketBytes(captured.evidence.totalPatchBytes),
    reason: "none",
  });
  return {
    status: "ready_for_review",
    revision: captured.delta.revision,
    cardVersion: captured.cardVersion,
    evidenceId: captured.evidence.evidenceId,
    evidenceDigest: captured.evidence.evidenceDigest,
  };
}

export interface DesktopAttemptCoordinator {
  start(
    cardId: CardId,
    initialPrompt?: string,
    submission?: StartSubmissionAdmission,
  ): Promise<StartAttemptResult>;
  submitCardPrompt(input: SubmitCardPromptInput): Promise<SubmitCardPromptResult>;
  stop(input: StopAttemptInput): Promise<StopAttemptResult>;
  release(attemptId: AttemptId): Promise<boolean>;
}

export interface StopAttemptInput {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
}

export type StopAttemptResult =
  | { readonly status: "ok" }
  | { readonly status: "rejected"; readonly reason: { readonly code: string; readonly message: string } };

interface StartSubmissionAdmission {
  readonly eventId: string;
  readonly record: PromptSubmissionRecord;
  readonly requestChanges?: {
    readonly input: SubmitCardPromptInput & {
      readonly source: "request_changes";
      readonly evidence: NonNullable<SubmitCardPromptInput["evidence"]>;
    };
  };
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
  readonly reviewEvidence?: Pick<ReviewEvidenceService, "revalidate">;
  readonly diagnostics?: LifecycleDiagnostics;
  readonly measurement?: WorkflowMeasurementSink;
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
  readonly profile: CertifiedDirectAcpProfile | null;
}

interface ActiveAttempt {
  readonly reservation: SchedulerReservation;
  readonly session: FreshDirectAcpSession;
  unsubscribeActivity: () => void;
  turnState: "active" | "settled" | "dispatching";
  revokeAskUser: () => void;
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
  const diagnostics = options.diagnostics ?? silentLifecycleDiagnostics;
  const active = new Map<AttemptId, ActiveAttempt>();
  const inFlightSubmissions = new Map<string, {
    readonly requestFingerprint: string;
    readonly result: Promise<SubmitCardPromptResult>;
  }>();

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
    const skillId = card?.skillOverrideId ?? null;
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
      profile: card === null ? null : options.resolveProfile(card),
    };
  };

  const validate = (
    resolved: ResolvedAdmission,
    worktree: RunnableValidationInput["worktree"],
    allowReadyForReview = false,
  ) => validateRunnable({
    board: resolved.board,
    card: (
      allowReadyForReview
      && resolved.card?.executionStatus === "ready_for_review"
    )
      ? { ...resolved.card, executionStatus: "idle" }
      : resolved.card,
    stage: resolved.stage,
    repository: resolved.repository,
    effectiveSkill: resolved.skill,
    profile: resolved.profile,
    worktree,
    scheduler: options.scheduler.inspect(resolved.card?.cardId ?? ("missing" as CardId)),
  });

  return {
    async start(cardId, initialPrompt, submission) {
      const requestChanges = submission?.requestChanges;
      const beforeWorktree = resolveAdmission(cardId);
      if (requestChanges !== undefined) {
        const guarded = evidenceBoundReviewPreconditions(
          options.journal,
          requestChanges.input,
        );
        if (guarded.status === "rejected") {
          return { status: "submission_rejected", error: guarded.error };
        }
      }
      const requestChangesBinding = requestChanges === undefined
        ? null
        : readCardWorktreeBinding(beforeWorktree.snapshot, cardId);
      const initialWorktree = requestChanges === undefined
        ? null
        : requestChangesBinding === null
          ? { status: "unavailable" as const, reason: "unverified" as const }
          : { status: "reused" as const, binding: requestChangesBinding };
      const initial = validate(
        beforeWorktree,
        initialWorktree,
        requestChanges !== undefined,
      );
      if (
        !initial.runnable
        && (
          requestChanges !== undefined
          || initial.reason.code !== "worktree_unavailable"
        )
      ) {
        return { status: "rejected", reason: initial.reason };
      }
      if (beforeWorktree.board === null || beforeWorktree.card === null) {
        return { status: "rejected", reason: initial.runnable
          ? { code: "card_not_found", message: "The card no longer exists on this board." }
          : initial.reason };
      }

      const ensured = requestChanges === undefined
        ? await options.worktrees.ensure({
            boardId: beforeWorktree.board.boardId,
            cardId,
          })
        : initialWorktree!;
      const resolved = resolveAdmission(cardId);
      const admission = validate(resolved, ensured, requestChanges !== undefined);
      if (!admission.runnable) return { status: "rejected", reason: admission.reason };
      const { board, card, stage, repository, skill, profile } = resolved;
      if (board === null || card === null || stage === null || repository === null || skill === null || profile === null) {
        throw new Error("Runnable admission lost a required resolved value");
      }
      if (ensured.status === "unavailable") throw new Error("Runnable admission accepted an unavailable worktree");

      const reserved = options.scheduler.reserve(card.cardId);
      if (reserved.status !== "reserved") {
        const retry = validate(
          resolved,
          ensured,
          requestChanges !== undefined,
        );
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
      if (requestChanges !== undefined) {
        if (options.reviewEvidence === undefined) {
          options.scheduler.release(reserved.reservation);
          return {
            status: "submission_rejected",
            error: reviewEvidenceContractError("missing"),
          };
        }
        const currentEvidence = await options.reviewEvidence.revalidate({
          boardId: requestChanges.input.boardId,
          cardId: requestChanges.input.cardId,
          expectedCardVersion: requestChanges.input.expectedCardVersion,
          evidence: requestChanges.input.evidence,
        });
        if (currentEvidence.status === "unavailable") {
          options.scheduler.release(reserved.reservation);
          return {
            status: "submission_rejected",
            error: reviewEvidenceContractError(currentEvidence.reason),
          };
        }
        if (
          currentEvidence.evidenceId !== requestChanges.input.evidence.evidenceId
          || currentEvidence.evidenceDigest !== requestChanges.input.evidence.evidenceDigest
        ) {
          options.scheduler.release(reserved.reservation);
          return {
            status: "submission_rejected",
            error: reviewEvidenceContractError("stale"),
          };
        }
      }
      const admissionChanges: readonly ProjectionChange[] = [
        { entity: "card", operation: "upsert", value: runningCard },
        { entity: "attempt", operation: "upsert", value: startingAttempt },
        { entity: "run_context", operation: "insert", value: context },
      ];
      try {
        const committedSubmission = submission === undefined ? undefined : {
          ...submission.record,
          cardVersion: runningCard.version,
          attemptId,
          generation,
        };
        if (
          requestChanges !== undefined
          && committedSubmission !== undefined
        ) {
          appendRequestChangesAdmission(options.journal, {
            eventId: submission!.eventId,
            board,
            card,
            occurredAt: createdAt,
            input: requestChanges.input,
            submission: committedSubmission,
            changes: admissionChanges,
          });
        } else {
          appendLifecycle(options.journal, {
            eventId: submission?.eventId ?? createEventId("created"),
            operation: "created",
            board,
            cardId: card.cardId,
            attemptId,
            attemptSequence: 0,
            occurredAt: createdAt,
            changes: admissionChanges,
            expectedCardVersion: card.version,
            ...(committedSubmission === undefined
              ? {}
              : { submission: committedSubmission }),
          });
        }
      } catch (error) {
        options.scheduler.release(reserved.reservation);
        if (error instanceof RequestChangesAdmissionError) {
          return { status: "submission_rejected", error: error.contractError };
        }
        if (
          requestChanges !== undefined
          && error instanceof ProjectionVersionConflictError
        ) {
          return {
            status: "submission_rejected",
            error: {
              code: "stale_projection",
              recoveryHint: "refresh_projection",
              expectedVersion: error.expectedVersion,
              actualVersion: error.actualVersion,
            },
          };
        }
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
      if (requestChanges !== undefined) {
        diagnostics.record({
          name: "review_disposition_recorded",
          boardId: card.boardId,
          cardId: card.cardId,
          outcome: "changes_requested",
        });
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
        ...(askUserRoute === undefined ? {} : {
          askUserRoute: { capability: askUserRoute.capability, endpoint: askUserRoute.endpoint },
        }),
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
      const prompt = initialPrompt;
      if (prompt !== undefined && prompt.trim().length > 0) {
        void dispatchInitialPrompt({
          journal: options.journal,
          activityIngestor: options.activityIngestor,
          scheduler: options.scheduler,
          active,
          attemptId,
          generation,
          session: started.session,
          prompt,
          now,
          measurement: options.measurement,
        });
      }
      return { status: "started", attempt: runningAttempt, context, sessionId: started.session.sessionId };
    },

    async submitCardPrompt(input) {
      const requestFingerprint = promptSubmissionFingerprint(input);
      const inFlight = inFlightSubmissions.get(input.commandId);
      if (inFlight !== undefined) {
        return inFlight.requestFingerprint === requestFingerprint
          ? inFlight.result
          : rejectedSubmission("invalid_prompt", "edit_prompt");
      }
      const operation = (async (): Promise<SubmitCardPromptResult> => {
        const existing = readPromptSubmission(options.journal, input.commandId);
        if (existing !== null) {
          return existing.requestFingerprint === requestFingerprint
            ? promptSubmissionResult(existing)
            : rejectedSubmission("invalid_prompt", "edit_prompt");
        }
        if (
          input.commandId.trim().length === 0
          || input.content.trim().length === 0
        ) {
          return rejectedSubmission("invalid_prompt", "edit_prompt");
        }
        if (
          input.source !== "request_changes"
          && input.evidence !== undefined
        ) {
          return rejectedSubmission("invalid_prompt", "edit_prompt");
        }

        const snapshot = options.journal.snapshot();
        const card = snapshot.cards.find((candidate) => candidate.cardId === input.cardId);
        if (card === undefined || card.boardId !== input.boardId) {
          return rejectedSubmission("stale_projection", "refresh_projection");
        }
        if (card.version !== input.expectedCardVersion) {
          return rejectedSubmission("stale_projection", "refresh_projection", {
            expectedVersion: input.expectedCardVersion,
            actualVersion: card.version,
          });
        }
        if (input.source === "request_changes") {
          if (
            input.evidence === undefined
            || input.activeAttempt !== undefined
            || options.reviewEvidence === undefined
          ) {
            return input.evidence === undefined || options.reviewEvidence === undefined
              ? rejectedSubmission("evidence_missing", "reload_evidence")
              : rejectedSubmission("stale_projection", "refresh_projection");
          }
          const requestChangesInput = {
            ...input,
            source: "request_changes" as const,
            evidence: input.evidence,
          };
          const guarded = evidenceBoundReviewPreconditions(
            options.journal,
            requestChangesInput,
          );
          if (guarded.status === "rejected") {
            return { status: "rejected", error: guarded.error };
          }
          const result = await this.start(card.cardId, input.content, {
            eventId: promptSubmissionEventId(input.commandId),
            record: {
              commandId: input.commandId,
              requestFingerprint,
              outcome: "admitted",
              cardVersion: card.version + 1,
              attemptId: "pending",
              generation: 0 as AttemptGeneration,
            },
            requestChanges: { input: requestChangesInput },
          });
          const committed = readPromptSubmission(options.journal, input.commandId);
          if (committed !== null) return promptSubmissionResult(committed);
          if (result.status === "submission_rejected") {
            return { status: "rejected", error: result.error };
          }
          if (result.status === "rejected") {
            return mapRunnableFailure(result.reason.code);
          }
          return rejectedSubmission("invalid_prompt", "none");
        }

        const attempt = latestActiveAttempt(snapshot, card.cardId);
        if (attempt !== null) {
        if (input.source === "initial") {
          return rejectedSubmission("attempt_active", "wait_for_attempt");
        }
        if (
          input.activeAttempt === undefined
          || input.activeAttempt.attemptId !== attempt.attemptId
          || input.activeAttempt.generation !== attempt.generation
        ) {
          return rejectedSubmission("stale_projection", "refresh_projection");
        }
        if (
          attempt.state === "needs_attention"
          || options.hasActiveAttention?.(attempt.attemptId) === true
        ) {
          return rejectedSubmission("blocker_active", "resolve_blocker");
        }
        const live = active.get(attempt.attemptId);
        if (live === undefined) {
          return rejectedSubmission("attempt_active", "wait_for_attempt");
        }
        const current = snapshot.followUpQueues.find(
          (queue) => queue.attemptId === attempt.attemptId,
        ) ?? null;
        if (current?.drafts.some((draft) => draft.state === "interrupted") === true) {
          return rejectedSubmission("submission_interrupted", "retry_submission");
        }
        const queueId = input.commandId as FollowUpQueueId;
        try {
          const occurredAt = Math.max(0, now());
          const projection = current === null
            ? createFollowUpQueue({
                boardId: card.boardId,
                cardId: card.cardId,
                attemptId: attempt.attemptId,
                generation: attempt.generation,
                queueId,
                text: input.content,
                occurredAt,
              })
            : enqueueFollowUp(current, {
                queueId,
                text: input.content,
                occurredAt,
              }, followUpQueueFence(current));
          const record: PromptSubmissionRecord = {
            commandId: input.commandId,
            requestFingerprint,
            outcome: "queued",
            cardVersion: card.version,
            attemptId: attempt.attemptId,
            generation: attempt.generation,
          };
          appendPromptSubmission(
            options.journal,
            promptSubmissionEventId(input.commandId),
            record,
            card,
            projection,
            current?.version ?? 0,
          );
          recordAcceptedDirection(options, live, {
            attemptId: attempt.attemptId,
            generation: attempt.generation,
          }, input.content, now);
          return promptSubmissionResult(record);
        } catch (error) {
          if (error instanceof ProjectionVersionConflictError) {
            return rejectedSubmission("stale_projection", "refresh_projection");
          }
          return rejectedSubmission("invalid_prompt", "edit_prompt");
        }
        }

        if (input.activeAttempt !== undefined) {
          return rejectedSubmission("stale_projection", "refresh_projection");
        }
        if (card.executionStatus === "ready_for_review" || card.executionStatus === "completed") {
          return rejectedSubmission("invalid_prompt", "none");
        }

        const result = await this.start(card.cardId, input.content, {
          eventId: promptSubmissionEventId(input.commandId),
          record: {
            commandId: input.commandId,
            requestFingerprint,
            outcome: "admitted",
            cardVersion: card.version + 1,
            attemptId: "pending",
            generation: 0 as AttemptGeneration,
          },
        });
        const committed = readPromptSubmission(options.journal, input.commandId);
        if (committed !== null) return promptSubmissionResult(committed);
        if (result.status === "rejected") {
          return mapRunnableFailure(result.reason.code);
        }
        if (result.status === "submission_rejected") {
          return { status: "rejected", error: result.error };
        }
        return rejectedSubmission("invalid_prompt", "none");
      })();
      inFlightSubmissions.set(input.commandId, { requestFingerprint, result: operation });
      try {
        return await operation;
      } finally {
        if (inFlightSubmissions.get(input.commandId)?.result === operation) {
          inFlightSubmissions.delete(input.commandId);
        }
      }
    },

    async release(attemptId) {
      return releaseActive(active, options.scheduler, attemptId);
    },

    async stop(input) {
      const attempt = options.journal.snapshot().attempts.find(({ attemptId }) => attemptId === input.attemptId);
      if (attempt === undefined) {
        return { status: "rejected", reason: { code: "unknown_attempt", message: "The active run no longer exists." } };
      }
      if (attempt.generation !== input.generation) {
        return { status: "rejected", reason: { code: "stale_generation", message: "The active run changed before it could be stopped." } };
      }
      if (isDirectAcpTerminalState(attempt.state)) {
        return { status: "rejected", reason: { code: "attempt_terminal", message: "The run has already finished." } };
      }
      const live = active.get(input.attemptId);
      if (live === undefined || live.session.connection.cancel === undefined) {
        return { status: "rejected", reason: { code: "cancellation_unavailable", message: "This provider cannot stop the active run." } };
      }
      try {
        await live.session.connection.cancel({ sessionId: live.session.sessionId });
        live.revokeAskUser();
        return { status: "ok" };
      } catch {
        return { status: "rejected", reason: { code: "cancellation_failed", message: "The provider did not stop the active run." } };
      }
    },
  };
}

async function dispatchInitialPrompt(input: {
  readonly journal: EventJournal;
  readonly activityIngestor?: AttemptActivityIngestor;
  readonly scheduler: GlobalAttemptScheduler;
  readonly active: Map<AttemptId, ActiveAttempt>;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly session: FreshDirectAcpSession;
  readonly prompt: string;
  readonly now: () => number;
  readonly measurement?: WorkflowMeasurementSink;
}): Promise<void> {
  if (input.activityIngestor !== undefined) {
    const initialMessage = await input.activityIngestor.ingest({
      eventId: activityEventId("initial-prompt"),
      attemptId: input.attemptId,
      generation: input.generation,
      sequence: activitySequence(2),
      occurredAt: Math.max(0, input.now()),
      activity: {
        kind: "user_message",
        messageId: `initial:${input.attemptId}:${input.generation}`,
        text: input.prompt,
      },
    }, { attemptId: input.attemptId, generation: input.generation });
    if (initialMessage.status !== "committed") {
      await commitPromptTerminal(input, "failed");
      await releaseActive(input.active, input.scheduler, input.attemptId);
      return;
    }
  }

  const turn = await promptTurn(input, input.prompt);
  if (turn.terminal !== "succeeded") {
    await commitPromptTerminal(input, turn.terminal);
    await releaseActive(input.active, input.scheduler, input.attemptId);
    return;
  }
  await dispatchAcceptedDirections(input);
}

/**
 * ACP permits one prompt at a time. Directions are accepted immediately, rendered
 * in the durable history, and then dispatched automatically at the next settled
 * turn. The internal projection is deliberately not exposed as a confirmation UI.
 */
async function dispatchAcceptedDirections(
  input: Parameters<typeof dispatchInitialPrompt>[0],
): Promise<void> {
  while (input.active.has(input.attemptId)) {
    const current = input.journal.snapshot().followUpQueues.find((queue) => queue.attemptId === input.attemptId);
    if (current === undefined) {
      await commitPromptTerminal(input, "succeeded");
      await releaseActive(input.active, input.scheduler, input.attemptId);
      return;
    }
    const liveAttempt = input.active.get(input.attemptId);
    if (liveAttempt?.turnState === "dispatching") return;

    try {
      const head = queuedFollowUpHead(current);
      if (head === null) {
        await commitPromptTerminal(input, "succeeded");
        await releaseActive(input.active, input.scheduler, input.attemptId);
        return;
      }
      const dispatching = markFollowUpDispatching(
        current,
        head.queueId,
        Math.max(0, input.now()),
        followUpQueueFence(current),
      );
      appendFollowUpQueue(
        input.journal,
        activityEventId("direction-dispatch"),
        "dispatching",
        dispatching,
        current.version,
      );
      const live = input.active.get(input.attemptId);
      if (live === undefined) return;
      live.turnState = "dispatching";

      const turn = await promptTurn(input, head.text);
      const latest = input.journal.snapshot().followUpQueues.find((queue) => queue.attemptId === input.attemptId);
      if (latest === undefined) {
        await commitPromptTerminal(input, "failed");
        await releaseActive(input.active, input.scheduler, input.attemptId);
        return;
      }
      if (turn.delivery === "ambiguous") {
        const interrupted = interruptFollowUpDispatch(
          latest,
          head.queueId,
          Math.max(0, input.now()),
          followUpQueueFence(latest),
        );
        appendFollowUpQueue(
          input.journal,
          activityEventId("direction-interrupted"),
          "interrupted",
          interrupted,
          latest.version,
        );
        recordWorkflowMeasurementSafely(input.measurement, {
          schemaVersion: 1,
          name: "safe_boundary_dispatch",
          outcome: "interrupted",
        });
        await commitPromptTerminal(input, "interrupted");
        await releaseActive(input.active, input.scheduler, input.attemptId);
        return;
      }
      const dispatched = markFollowUpDispatched(
        latest,
        head.queueId,
        Math.max(0, input.now()),
        followUpQueueFence(latest),
      );
      appendFollowUpQueue(input.journal, activityEventId("direction-dispatched"), "dispatched", dispatched, latest.version);
      recordWorkflowMeasurementSafely(input.measurement, {
        schemaVersion: 1,
        name: "safe_boundary_dispatch",
        outcome: "dispatched",
      });
      live.turnState = "settled";
      if (turn.terminal !== "succeeded") {
        await commitPromptTerminal(input, turn.terminal);
        await releaseActive(input.active, input.scheduler, input.attemptId);
        return;
      }
    } catch {
      recordWorkflowMeasurementSafely(input.measurement, {
        schemaVersion: 1,
        name: "safe_boundary_dispatch",
        outcome: "failed",
      });
      await commitPromptTerminal(input, "failed");
      await releaseActive(input.active, input.scheduler, input.attemptId);
      return;
    }
  }
}

async function promptTurn(
  input: Parameters<typeof dispatchInitialPrompt>[0],
  prompt: string,
): Promise<{
  readonly terminal: DirectAcpAttemptState;
  readonly delivery: "acknowledged" | "ambiguous";
}> {
  try {
    const result = await input.session.connection.prompt({
      sessionId: input.session.sessionId,
      prompt,
    });
    return {
      terminal: result.stopReason === "cancelled"
        ? "cancelled"
        : result.stopReason === "refusal"
          ? "failed"
          : "succeeded",
      delivery: "acknowledged",
    };
  } catch {
    return { terminal: "interrupted", delivery: "ambiguous" };
  }
}

async function commitPromptTerminal(
  input: Parameters<typeof dispatchInitialPrompt>[0],
  terminal: DirectAcpAttemptState,
): Promise<void> {
  if (input.activityIngestor === undefined) return;
  const nextSequence = input.journal.snapshot().attemptInspectors
    .find(({ attemptId }) => attemptId === input.attemptId)?.nextSequence ?? activitySequence(2);
  await input.activityIngestor.ingest({
    eventId: activityEventId(`terminal-${terminal}`),
    attemptId: input.attemptId,
    generation: input.generation,
    sequence: nextSequence,
    occurredAt: Math.max(0, input.now()),
    activity: { kind: "attempt_state", state: terminal },
  }, { attemptId: input.attemptId, generation: input.generation });
}

function activityEventId(kind: string): ActivityEventId {
  return toOpaqueId<ActivityEventId>(`attempt:${kind}:${crypto.randomUUID()}`)!;
}

function activitySequence(value: number): ActivitySequence {
  return toActivitySequence(value)!;
}

function promptSubmissionEventId(commandId: string): string {
  return `prompt-submission:${createHash("sha256").update(commandId).digest("hex")}`;
}

function promptSubmissionFingerprint(input: SubmitCardPromptInput): string {
  return createHash("sha256").update(JSON.stringify({
    commandId: input.commandId,
    boardId: input.boardId,
    cardId: input.cardId,
    expectedCardVersion: input.expectedCardVersion,
    content: input.content,
    source: input.source,
    activeAttempt: input.activeAttempt ?? null,
    evidence: input.evidence ?? null,
  })).digest("hex");
}

function readPromptSubmission(
  journal: EventJournal,
  commandId: string,
): PromptSubmissionRecord | null {
  const event = journal.eventById(promptSubmissionEventId(commandId));
  if (event?.kind !== "prompt_submission_committed") return null;
  return event.payload.submission.commandId === commandId
    ? event.payload.submission
    : null;
}

function promptSubmissionResult(record: PromptSubmissionRecord): SubmitCardPromptResult {
  return {
    status: "ok",
    outcome: record.outcome,
    cardVersion: record.cardVersion,
    attemptId: record.attemptId as AttemptId,
    generation: record.generation,
  };
}

function rejectedSubmission(
  code: ContractError["code"],
  recoveryHint: ContractError["recoveryHint"],
  versions: Pick<ContractError, "expectedVersion" | "actualVersion"> = {},
): SubmitCardPromptResult {
  return {
    status: "rejected",
    error: { code, recoveryHint, ...versions },
  };
}

function mapRunnableFailure(code: RunnableFailure["code"]): SubmitCardPromptResult {
  switch (code) {
    case "board_not_found":
    case "card_not_found":
      return rejectedSubmission("stale_projection", "refresh_projection");
    case "card_not_idle":
    case "card_already_active":
    case "capacity_exhausted":
      return rejectedSubmission("attempt_active", "wait_for_attempt");
    default:
      return rejectedSubmission("invalid_prompt", "none");
  }
}

function latestActiveAttempt(
  snapshot: PersistenceSnapshot,
  cardId: CardId,
): AttemptProjection | null {
  return snapshot.attempts
    .filter((attempt) => (
      attempt.cardId === cardId
      && (
        attempt.state === "starting"
        || attempt.state === "running"
        || attempt.state === "needs_attention"
      )
    ))
    .sort((left, right) => Number(right.generation) - Number(left.generation))[0] ?? null;
}

function appendPromptSubmission(
  journal: EventJournal,
  eventId: string,
  submission: PromptSubmissionRecord,
  card: CardProjection,
  queue: FollowUpQueueProjection,
  expectedQueueVersion: number,
): void {
  journal.append({
    eventId,
    boardId: card.boardId,
    cardId: card.cardId,
    actor: "operator",
    kind: "prompt_submission_committed",
    occurredAt: queue.updatedAt,
    payload: {
      submission,
      changes: [{ entity: "follow_up_queue", operation: "upsert", value: queue }],
    },
  }, {
    preconditions: [
      { entity: "card", id: card.cardId, expectedVersion: card.version },
      {
        entity: "follow_up_queue",
        id: queue.attemptId,
        expectedVersion: expectedQueueVersion,
      },
    ],
  });
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
    actor: operation === "dispatching" || operation === "dispatched" || operation === "interrupted"
      ? "system"
      : "operator",
    kind: "follow_up_queue_committed",
    occurredAt: queue.updatedAt,
    payload: { operation, queue },
  }, {
    preconditions: [{ entity: "follow_up_queue", id: queue.attemptId, expectedVersion }],
  });
}

interface AttemptIdentity {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
}

function recordAcceptedDirection(
  options: CreateAttemptCoordinatorOptions,
  active: ActiveAttempt,
  input: AttemptIdentity,
  text: string,
  now: () => number,
): void {
  const inspector = options.journal.snapshot().attemptInspectors
    .find(({ attemptId }) => attemptId === input.attemptId);
  if (options.activityIngestor === undefined || inspector === undefined) return;
  // ACP owns the sequence counter for streamed events. Reserving this slot keeps
  // the immediate host-persisted direction in that same monotonic sequence.
  active.session.connection.reserveActivitySequence?.();
  void options.activityIngestor.ingest({
    eventId: activityEventId("direction"),
    attemptId: input.attemptId,
    generation: input.generation,
    sequence: inspector.nextSequence,
    occurredAt: Math.max(0, now()),
    activity: {
      kind: "user_message",
      messageId: `direction:${input.attemptId}:${input.generation}:${crypto.randomUUID()}`,
      text,
    },
  }, { attemptId: input.attemptId, generation: input.generation });
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

class RequestChangesAdmissionError extends Error {
  constructor(readonly contractError: ContractError) {
    super(`Request changes admission rejected: ${contractError.code}`);
    this.name = "RequestChangesAdmissionError";
  }
}

function appendRequestChangesAdmission(
  journal: EventJournal,
  input: {
    readonly eventId: string;
    readonly board: BoardProjection;
    readonly card: CardProjection;
    readonly occurredAt: number;
    readonly input: SubmitCardPromptInput & {
      readonly source: "request_changes";
      readonly evidence: NonNullable<SubmitCardPromptInput["evidence"]>;
    };
    readonly submission: PromptSubmissionRecord;
    readonly changes: readonly ProjectionChange[];
  },
): void {
  journal.immediate((transaction) => {
    const guarded = evidenceBoundReviewPreconditions(journal, input.input);
    if (guarded.status === "rejected") {
      throw new RequestChangesAdmissionError(guarded.error);
    }
    const disposition: ReviewDispositionProjection = {
      reviewId: input.input.commandId,
      boardId: input.input.boardId,
      cardId: input.input.cardId,
      evidenceId: input.input.evidence.evidenceId,
      evidenceDigest: input.input.evidence.evidenceDigest,
      attemptId: input.input.evidence.attemptId,
      generation: input.input.evidence.generation,
      worktreeBindingId: input.input.evidence.worktreeBindingId,
      disposition: "changes_requested",
      reviewer: "operator",
      reviewedCardVersion: guarded.value.card.version,
      occurredAt: input.occurredAt,
    };
    transaction.append({
      eventId: input.eventId,
      boardId: input.board.boardId,
      cardId: input.card.cardId,
      actor: "operator",
      kind: "prompt_submission_committed",
      occurredAt: input.occurredAt,
      payload: {
        submission: input.submission,
        changes: [
          { entity: "review_disposition", operation: "insert", value: disposition },
          ...input.changes,
        ],
      },
    }, {
      preconditions: [
        {
          entity: "board",
          id: input.board.boardId,
          expectedVersion: input.board.workflowVersion,
        },
        {
          entity: "card",
          id: input.card.cardId,
          expectedVersion: input.input.expectedCardVersion,
        },
      ],
    });
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
  readonly submission?: PromptSubmissionRecord;
}): void {
  if (input.submission !== undefined) {
    if (input.operation !== "created") {
      throw new Error("Only attempt creation may commit prompt admission");
    }
    journal.append({
      eventId: input.eventId,
      boardId: input.board.boardId,
      cardId: input.cardId,
      actor: "operator",
      kind: "prompt_submission_committed",
      occurredAt: input.occurredAt,
      payload: {
        submission: input.submission,
        changes: input.changes,
      },
    }, {
      preconditions: [
        { entity: "board", id: input.board.boardId, expectedVersion: input.board.workflowVersion },
        { entity: "card", id: input.cardId, expectedVersion: input.expectedCardVersion! },
      ],
    });
    return;
  }
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
