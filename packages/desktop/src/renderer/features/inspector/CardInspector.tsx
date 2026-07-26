import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Chip } from "@heroui/react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type {
  CardInspectorProjection,
  InspectorReviewEvidenceSummary,
} from "../../../attempts/inspectorProjection.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type {
  CardInspectorEnvelope,
  ReviewEvidenceManifest,
  ReviewEvidencePrecondition,
} from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import { AttentionBlockerPanel } from "./AttentionBlockerPanel.tsx";
import { AttemptTimeline } from "./AttemptTimeline.tsx";
import { PersistentComposer } from "./PersistentComposer.tsx";
import { ReviewPanel } from "./ReviewPanel.tsx";
import { TaskEditModal } from "./TaskEditModal.tsx";
import type { CardEditInput } from "../board/boardInteractions.ts";
import {
  ArrowLeftIcon,
  EditIcon,
  SettingsIcon,
  SpinnerIcon,
  XIcon,
} from "../../components/Icons.tsx";
import { useInspectorCommands, type InspectorFeedback } from "./useInspectorCommands.ts";
import {
  createDraftKey,
  useDesktopViewStore,
  type DraftSource,
} from "../../state/desktopViewStore.ts";
import {
  desktopQueryKeys,
  reviewManifestQueryOptions,
} from "../../query/desktopQueries.ts";

function currentProjectionCard(fallback: CardProjection, projection: CardInspectorProjection | null): CardProjection {
  return projection?.card ?? fallback;
}

function executionStatusLabel(status: CardProjection["executionStatus"]): string {
  switch (status) {
    case "needs_attention":
      return "Attention required";
    case "ready_for_review":
      return "Ready for review";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "idle":
      return "Idle";
  }
}

function executionStatusTone(status: CardProjection["executionStatus"]): string {
  if (status === "needs_attention") {
    return "border-[var(--kitten-status-attention-border)] bg-[var(--kitten-status-attention-surface)] text-[var(--kitten-status-attention)]";
  }
  if (status === "ready_for_review") {
    return "border-[var(--kitten-status-review-border)] bg-[var(--kitten-status-review-surface)] text-[var(--kitten-status-review)]";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-[var(--kitten-status-failure-border)] bg-[var(--kitten-status-failure-surface)] text-[var(--kitten-status-failure)]";
  }
  if (status === "running") {
    return "border-[var(--kitten-status-running-border)] bg-[var(--kitten-status-running-surface)] text-[var(--kitten-status-running)]";
  }
  if (status === "completed") {
    return "border-[var(--kitten-status-success-border)] bg-[var(--kitten-status-success-surface)] text-[var(--kitten-status-success)]";
  }
  return "";
}

function currentReviewPrecondition(
  card: CardProjection,
  evidence: InspectorReviewEvidenceSummary | null,
  manifest: ReviewEvidenceManifest | null,
): ReviewEvidencePrecondition | null {
  if (
    evidence === null
    || manifest === null
    || card.executionStatus !== "ready_for_review"
    || manifest.availability.status !== "available"
    || manifest.boardId !== card.boardId
    || manifest.cardId !== card.cardId
    || manifest.evidenceId !== evidence.evidenceId
    || manifest.evidenceDigest !== evidence.evidenceDigest
    || manifest.attemptId !== evidence.attemptId
    || manifest.generation !== evidence.generation
    || manifest.worktreeBindingId !== evidence.worktreeBindingId
  ) {
    return null;
  }
  return {
    evidenceId: manifest.evidenceId,
    evidenceDigest: manifest.evidenceDigest,
    attemptId: manifest.attemptId,
    generation: manifest.generation,
    worktreeBindingId: manifest.worktreeBindingId,
  };
}

export function CardInspector({
  client,
  card,
  repositoryKey,
  presentation = "desktop",
  draftSource = "composer",
  isOpen = true,
  taskBusy = false,
  onOpenChange = () => {},
  onSaveTask,
  onOpenReview = () => {},
  requestChangesSeed = "Please address these review findings:",
}: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly repositoryKey: string;
  readonly presentation?: "desktop" | "narrow";
  readonly draftSource?: DraftSource;
  readonly isOpen?: boolean;
  readonly taskBusy?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onSaveTask?: (input: CardEditInput, onSaved: () => void) => void;
  readonly onOpenReview?: (manifest: ReviewEvidenceManifest) => void;
  readonly requestChangesSeed?: string;
}) {
  const [projection, setProjection] = useState<CardInspectorProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<InspectorFeedback | null>(null);
  const [editing, setEditing] = useState(false);
  const [activeDraftSource, setActiveDraftSource] = useState<DraftSource>(() => {
    const active = useDesktopViewStore.getState().activeDraftNamespace;
    return active?.boardId === card.boardId && active.cardId === card.cardId
      ? active.source
      : draftSource;
  });
  const historyRef = useRef<HTMLDivElement>(null);
  const historyMetricsRef = useRef<{
    readonly height: number;
    readonly top: number;
    readonly nearEnd: boolean;
  } | null>(null);
  const followAfterSubmitRef = useRef(false);
  const seededRequestChangesKeyRef = useRef<string | null>(null);
  const bindingRef = useRef<ReturnType<typeof bindCardInspectorRenderer> | null>(null);
  const queryClient = useQueryClient();
  const draftNamespace = useMemo(() => ({
    projectKey: repositoryKey,
    boardId: card.boardId,
    cardId: card.cardId,
    source: activeDraftSource,
  }), [activeDraftSource, card.boardId, card.cardId, repositoryKey]);
  const draftKey = createDraftKey(draftNamespace);
  const draft = useDesktopViewStore((state) => state.drafts[draftKey] ?? "");
  const ensureDraft = useDesktopViewStore((state) => state.ensureDraft);
  const setStoredDraft = useDesktopViewStore((state) => state.setDraft);
  const selectedAttemptId = useDesktopViewStore((state) => state.selectedAttemptId);
  const selectedReview = useDesktopViewStore((state) => state.selectedReview);
  const selectAttempt = useDesktopViewStore((state) => state.selectAttempt);
  const selectReview = useDesktopViewStore((state) => state.selectReview);
  const selectDraftNamespace = useDesktopViewStore((state) => state.selectDraftNamespace);
  const enterSettings = useDesktopViewStore((state) => state.enterSettings);
  const reconcileAttemptReferences = useDesktopViewStore((state) => state.reconcileAttemptReferences);

  const acceptEnvelope = useCallback((envelope: CardInspectorEnvelope) => {
    if (envelope.result.status === "ok") {
      setProjection(envelope.result.projection);
      setUnavailable(false);
      reconcileAttemptReferences({
        cardId: envelope.result.projection.cardId,
        attemptIds: envelope.result.projection.attemptStates.map(({ attemptId }) => attemptId),
        latestAttemptId: envelope.result.projection.attemptStates.at(-1)?.attemptId ?? null,
      });
    } else {
      setUnavailable(true);
      setFeedback({
        tone: "error",
        message: "The card inspector is unavailable. Your unsent draft is saved; wait for the desktop host to reconnect.",
      });
    }
  }, [reconcileAttemptReferences]);

  useEffect(() => {
    ensureDraft(draftNamespace);
    selectDraftNamespace(draftNamespace);
  }, [draftNamespace, ensureDraft, selectDraftNamespace]);

  useEffect(() => {
    if (
      activeDraftSource === "request_changes"
      && seededRequestChangesKeyRef.current !== draftKey
    ) {
      seededRequestChangesKeyRef.current = draftKey;
      if (draft.length === 0) setStoredDraft(draftNamespace, requestChangesSeed);
    }
  }, [activeDraftSource, draft, draftKey, draftNamespace, requestChangesSeed, setStoredDraft]);

  useEffect(() => {
    const binding = bindCardInspectorRenderer(client, card.cardId, acceptEnvelope);
    bindingRef.current = binding;
    return () => {
      bindingRef.current = null;
      binding.dispose();
    };
  }, [acceptEnvelope, card.cardId, client]);

  const projectedCard = currentProjectionCard(card, projection);
  const latestAttempt = projection?.attemptStates.at(-1) ?? null;
  const queue = latestAttempt === null
    ? null
    : projection?.followUpQueues.find(({ attemptId }) => attemptId === latestAttempt.attemptId) ?? null;
  const blocker = projection?.attentionBlockers.find(({ active }) => active) ?? null;
  const manifestQueries = useQueries({
    queries: (projection?.reviewEvidence ?? []).map((evidence) => (
      reviewManifestQueryOptions(client, projection!.cardId, evidence.evidenceId)
    )),
  });
  const reviewManifests = manifestQueries.flatMap(({ data }) => (
    data?.result.status === "ok" ? [data.result.projection] : []
  ));
  const exactReviewSelection = selectedReview === null
    ? null
    : projection?.reviewEvidence.find(({ evidenceId }) => evidenceId === selectedReview.evidenceId) ?? null;
  const reviewSelection = exactReviewSelection
    ?? (selectedReview === null
      ? null
      : [...(projection?.reviewEvidence ?? [])]
          .filter(({ attemptId }) => attemptId === selectedReview.attemptId)
          .sort((left, right) => (
            Number(left.generation) - Number(right.generation)
            || left.createdAt - right.createdAt
          ))
          .at(-1) ?? null);
  const refreshedReviewSelection = reviewSelection === null
    ? null
    : [...(projection?.reviewEvidence ?? [])]
        .filter(({ attemptId }) => attemptId === reviewSelection.attemptId)
        .sort((left, right) => (
          Number(left.generation) - Number(right.generation)
          || left.createdAt - right.createdAt
        ))
        .at(-1) ?? reviewSelection;

  useEffect(() => {
    if (
      selectedReview !== null
      && refreshedReviewSelection !== null
      && selectedReview.evidenceId !== refreshedReviewSelection.evidenceId
    ) {
      selectReview({
        evidenceId: refreshedReviewSelection.evidenceId,
        attemptId: refreshedReviewSelection.attemptId,
        fileId: selectedReview.fileId,
      });
    }
  }, [
    refreshedReviewSelection?.evidenceId,
    selectReview,
    selectedReview?.evidenceId,
    selectedReview?.fileId,
  ]);

  const selectedReviewManifest = refreshedReviewSelection === null
    ? null
    : reviewManifests.find(({ evidenceId }) => evidenceId === refreshedReviewSelection.evidenceId) ?? null;
  const latestManifest = [...reviewManifests].sort((left, right) => (
    Number(left.generation) - Number(right.generation)
    || left.createdAt - right.createdAt
  )).at(-1) ?? null;
  const dispositionManifest = reviewSelection === null ? latestManifest : selectedReviewManifest;
  const dispositionEvidence = dispositionManifest === null
    ? null
    : projection?.reviewEvidence.find(({ evidenceId }) => evidenceId === dispositionManifest.evidenceId)
      ?? refreshedReviewSelection;
  const reviewEvidence = currentReviewPrecondition(
    projectedCard,
    dispositionEvidence,
    dispositionManifest,
  );
  const latestDelivery = queue?.drafts.at(-1) ?? null;
  const deliveryState = latestDelivery?.state === "removed"
    ? null
    : latestDelivery?.state ?? null;
  const feedbackId = `inspector-feedback-${projectedCard.cardId}`;
  const reloadReview = useCallback(async () => {
    await (bindingRef.current?.refresh() ?? Promise.resolve());
    await queryClient.invalidateQueries({ queryKey: desktopQueryKeys.reviewManifests });
  }, [queryClient]);

  const commands = useInspectorCommands({
    client,
    card: projectedCard,
    attempt: latestAttempt === null || projectedCard.executionStatus !== "running"
      ? null
      : { attemptId: latestAttempt.attemptId, generation: latestAttempt.generation },
    queueVersion: queue?.version ?? 0,
    blocker,
    reviewEvidence,
    refresh: () => bindingRef.current?.refresh() ?? Promise.resolve(),
    onFeedback: setFeedback,
    onDraftConsumed: () => {
      followAfterSubmitRef.current = true;
      setStoredDraft(draftNamespace, "");
      if (activeDraftSource === "request_changes") setActiveDraftSource("composer");
    },
    onReviewRejected: () => {
      void reloadReview();
    },
  });

  const status = executionStatusLabel(projectedCard.executionStatus);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history === null) return;
    const previous = historyMetricsRef.current;
    const follow = previous === null || previous.nearEnd || followAfterSubmitRef.current;
    if (follow) {
      history.scrollTop = history.scrollHeight;
    } else {
      history.scrollTop = previous.top;
    }
    historyMetricsRef.current = {
      height: history.scrollHeight,
      top: history.scrollTop,
      nearEnd: history.scrollHeight - history.scrollTop - history.clientHeight <= 48,
    };
    followAfterSubmitRef.current = false;
  }, [projection?.revision]);

  useEffect(() => {
    if (
      latestDelivery?.state === "interrupted"
      && draft.length === 0
    ) {
      setStoredDraft(draftNamespace, latestDelivery.text);
    }
  }, [draft, draftNamespace, latestDelivery, setStoredDraft]);

  const composerMode = activeDraftSource === "request_changes"
    ? "request_changes" as const
    : projectedCard.executionStatus === "running"
      ? "active_direction" as const
      : "initial" as const;

  if (!isOpen) return null;

  return (
    <>
      <aside
        id="card-workbench"
        aria-labelledby="card-inspector-title"
        data-workbench-presentation={presentation}
        className={`grid h-dvh min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-l border-[var(--kitten-border-subtle)] bg-[var(--kitten-surface-workbench)] text-foreground ${
          presentation === "narrow" ? "col-start-1 w-full border-l-0" : ""
        }`}
      >
        <header className="grid gap-3 border-b border-[var(--kitten-border-subtle)] bg-[var(--kitten-surface-raised)] px-4 py-3">
          {presentation === "narrow" ? (
            <Button
              id="workbench-back-trigger"
              variant="ghost"
              size="sm"
              className="w-fit"
              onPress={() => onOpenChange(false)}
            >
              <ArrowLeftIcon />Back to board
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Selected card workbench</p>
              <h2 id="card-inspector-title" className="m-0 break-words text-base font-semibold leading-6">
                {projectedCard.title}
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onSaveTask === undefined ? null : (
                <Button variant="secondary" size="sm" onPress={() => setEditing(true)} isDisabled={taskBusy}>
                  <EditIcon />Edit task
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onPress={() => enterSettings(
                  document.activeElement instanceof HTMLElement && document.activeElement.id.length > 0
                    ? document.activeElement.id
                    : null,
                )}
              >
                <SettingsIcon />Settings <kbd>⌘,</kbd>
              </Button>
              {presentation === "desktop" ? (
                <Button
                  id="workbench-close-trigger"
                  variant="ghost"
                  size="sm"
                  onPress={() => onOpenChange(false)}
                >
                  <XIcon />Close workbench
                </Button>
              ) : null}
            </div>
          </div>
          <dl className="inspector-status">
            <div><dt>Stage</dt><dd>{projection?.attempts.at(-1)?.context.stage.label ?? "Current board stage"}</dd></div>
            <div><dt>Status</dt><dd><Chip size="sm" variant="soft" className={executionStatusTone(projectedCard.executionStatus)}>{projectedCard.executionStatus === "running" ? (
              <span className="inline-flex items-center gap-1"><SpinnerIcon className="animate-spin motion-reduce:animate-none" />Running</span>
            ) : status}</Chip></dd></div>
            <div><dt>Provider</dt><dd>{projectedCard.provider}</dd></div>
            <div><dt>Model</dt><dd>{projectedCard.model}</dd></div>
          </dl>
          {projectedCard.description.trim().length === 0 ? null : (
            <p className="m-0 text-sm text-muted">{projectedCard.description}</p>
          )}
        </header>

        <div className="task-drawer-body">
              <div
                className="inspector-history-scroll"
                ref={historyRef}
                onScroll={(event) => {
                  const history = event.currentTarget;
                  historyMetricsRef.current = {
                    height: history.scrollHeight,
                    top: history.scrollTop,
                    nearEnd: history.scrollHeight - history.scrollTop - history.clientHeight <= 48,
                  };
                }}
              >
                {feedback === null ? null : (
                  <Alert id={feedbackId} status={feedback.tone === "error" ? "danger" : "success"} className="mb-3" role={feedback.tone === "error" ? "alert" : "status"}>
                    <Alert.Content><Alert.Description>{feedback.message}</Alert.Description></Alert.Content>
                  </Alert>
                )}

                {blocker === null ? null : (
                  <AttentionBlockerPanel
                    key={blocker.blockerId}
                    blocker={blocker}
                    busy={commands.busy}
                    onOutcome={commands.answerAttention}
                    onValidationError={(message) => setFeedback({ tone: "error", message })}
                  />
                )}

                {refreshedReviewSelection === null ? null : (
                  <div className="mb-4">
                    <ReviewPanel
                      client={client}
                      card={projectedCard}
                      evidence={refreshedReviewSelection}
                      busy={commands.busy}
                      onApprove={() => commands.approveReview()}
                      onRequestChanges={(manifest) => {
                        selectReview({
                          evidenceId: manifest.evidenceId,
                          attemptId: manifest.attemptId,
                          fileId: selectedReview?.fileId ?? null,
                        });
                        setActiveDraftSource("request_changes");
                        setFeedback({
                          tone: "status",
                          message: "Change-request draft prepared. Nothing was sent.",
                        });
                      }}
                      onClose={() => selectReview(null)}
                      onReload={reloadReview}
                      selectedFileId={selectedReview?.fileId ?? null}
                      onSelectedFileChange={(fileId) => {
                        selectReview({
                          evidenceId: refreshedReviewSelection.evidenceId,
                          attemptId: refreshedReviewSelection.attemptId,
                          fileId,
                        });
                      }}
                    />
                  </div>
                )}

                {projection === null ? (
                  <section className="attempt-timeline" aria-labelledby="work-history-title">
                    <h3 id="work-history-title">Work history</h3>
                    <Alert status={unavailable ? "danger" : "default"} aria-busy={!unavailable}>
                      <Alert.Content>
                        <Alert.Description>
                          {unavailable ? "History is unavailable until the desktop host reconnects." : "Loading durable card history…"}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  </section>
                ) : (
                  <AttemptTimeline
                    projection={projection}
                    selectedAttemptId={selectedAttemptId}
                    onSelectedAttemptChange={selectAttempt}
                    reviewManifests={reviewManifests}
                    onOpenReview={(manifest) => {
                      selectReview({
                        evidenceId: manifest.evidenceId,
                        attemptId: manifest.attemptId,
                        fileId: null,
                      });
                      onOpenReview(manifest);
                    }}
                  />
                )}
              </div>

              <PersistentComposer
                key={activeDraftSource}
                status={projectedCard.executionStatus}
                attemptId={latestAttempt?.attemptId ?? null}
                generation={latestAttempt?.generation ?? null}
                draft={draft}
                blockerActive={blocker !== null}
                busy={commands.busy}
                unavailable={unavailable}
                feedbackId={feedback === null ? undefined : feedbackId}
                mode={composerMode}
                deliveryState={deliveryState}
                requestChangesAvailable={reviewEvidence !== null}
                onDraftChange={(nextDraft) => setStoredDraft(draftNamespace, nextDraft)}
                onStartAttempt={commands.startAttempt}
                onSendDirection={commands.sendDirection}
                onRequestChanges={commands.requestChanges}
                onRetryInterrupted={commands.retryInterrupted}
              />
        </div>
      </aside>

      {onSaveTask === undefined ? null : (
        <TaskEditModal
          card={projectedCard}
          isOpen={editing}
          busy={taskBusy}
          onOpenChange={setEditing}
          onSave={(input) => onSaveTask(input, () => setEditing(false))}
        />
      )}
    </>
  );
}
