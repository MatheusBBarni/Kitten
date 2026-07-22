import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, Drawer } from "@heroui/react";
import type { CardInspectorProjection } from "../../../attempts/inspectorProjection.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { CardInspectorEnvelope } from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import { AttentionBlockerPanel } from "./AttentionBlockerPanel.tsx";
import { AttemptTimeline } from "./AttemptTimeline.tsx";
import { PersistentComposer } from "./PersistentComposer.tsx";
import { TaskEditModal } from "./TaskEditModal.tsx";
import type { CardEditInput } from "../board/boardInteractions.ts";
import { EditIcon } from "../../components/Icons.tsx";
import { useInspectorCommands, type InspectorFeedback } from "./useInspectorCommands.ts";

export interface DraftStore {
  read(cardId: string): string;
  write(cardId: string, draft: string): void;
}

const browserDraftStore: DraftStore = {
  read(cardId) {
    try {
      return typeof window === "undefined" ? "" : window.localStorage.getItem(`kitten:inspector-draft:${cardId}`) ?? "";
    } catch {
      return "";
    }
  },
  write(cardId, draft) {
    try {
      if (typeof window === "undefined") return;
      if (draft.length === 0) window.localStorage.removeItem(`kitten:inspector-draft:${cardId}`);
      else window.localStorage.setItem(`kitten:inspector-draft:${cardId}`, draft);
    } catch {
      // The in-memory draft remains safe when browser storage is unavailable.
    }
  },
};

function currentProjectionCard(fallback: CardProjection, projection: CardInspectorProjection | null): CardProjection {
  return projection?.card ?? fallback;
}

export function CardInspector({
  client,
  card,
  draftStore = browserDraftStore,
  isOpen = true,
  taskBusy = false,
  onOpenChange = () => {},
  onSaveTask,
}: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly draftStore?: DraftStore;
  readonly isOpen?: boolean;
  readonly taskBusy?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onSaveTask?: (input: CardEditInput, onSaved: () => void) => void;
}) {
  const [projection, setProjection] = useState<CardInspectorProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<InspectorFeedback | null>(null);
  const [draft, setDraft] = useState(() => draftStore.read(card.cardId));
  const [editing, setEditing] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const bindingRef = useRef<ReturnType<typeof bindCardInspectorRenderer> | null>(null);

  const acceptEnvelope = useCallback((envelope: CardInspectorEnvelope) => {
    const scrollTop = historyRef.current?.scrollTop ?? 0;
    if (envelope.result.status === "ok") {
      setProjection(envelope.result.projection);
      setUnavailable(false);
    } else {
      setUnavailable(true);
      setFeedback({
        tone: "error",
        message: "The card inspector is unavailable. Your unsent draft is saved; wait for the desktop host to reconnect.",
      });
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (historyRef.current !== null) historyRef.current.scrollTop = scrollTop;
      });
    }
  }, []);

  useEffect(() => {
    const binding = bindCardInspectorRenderer(client, card.cardId, acceptEnvelope);
    bindingRef.current = binding;
    return () => {
      bindingRef.current = null;
      binding.dispose();
    };
  }, [acceptEnvelope, card.cardId, client]);

  useEffect(() => {
    draftStore.write(card.cardId, draft);
  }, [card.cardId, draft, draftStore]);

  const projectedCard = currentProjectionCard(card, projection);
  const latestAttempt = projection?.attemptStates.at(-1) ?? null;
  const queue = latestAttempt === null
    ? null
    : projection?.followUpQueues.find(({ attemptId }) => attemptId === latestAttempt.attemptId) ?? null;
  const blocker = projection?.attentionBlockers.find(({ active }) => active) ?? null;
  const feedbackId = `inspector-feedback-${projectedCard.cardId}`;

  const commands = useInspectorCommands({
    client,
    card: projectedCard,
    attempt: latestAttempt === null
      ? null
      : { attemptId: latestAttempt.attemptId, generation: latestAttempt.generation },
    queue,
    blocker,
    refresh: () => bindingRef.current?.refresh() ?? Promise.resolve(),
    onFeedback: setFeedback,
    onDraftConsumed: () => setDraft(""),
  });

  const status = projectedCard.executionStatus.replaceAll("_", " ");

  return (
    <>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={!editing}>
        <Drawer.Content placement="right">
          <Drawer.Dialog className="h-full max-h-dvh w-screen max-w-none sm:w-[min(56rem,72vw)] sm:max-w-[calc(100vw-1rem)]" aria-labelledby="card-inspector-title">
            <Drawer.CloseTrigger />
            <Drawer.Header className="task-drawer-header">
              <div className="task-drawer-heading-row">
                <div className="task-drawer-heading">
                  <p className="eyebrow">Task details</p>
                  <Drawer.Heading id="card-inspector-title">{projectedCard.title}</Drawer.Heading>
                </div>
                {onSaveTask === undefined ? null : (
                  <Button variant="secondary" size="sm" onPress={() => setEditing(true)} isDisabled={taskBusy}>
                    <EditIcon />Edit task
                  </Button>
                )}
              </div>
              <dl className="inspector-status">
                <div><dt>Stage</dt><dd>{projection?.attempts.at(-1)?.context.stage.label ?? "Current board stage"}</dd></div>
                <div><dt>Status</dt><dd><Chip size="sm" variant="soft">{status}</Chip></dd></div>
                <div><dt>Provider</dt><dd>{projectedCard.provider}</dd></div>
                <div><dt>Model</dt><dd>{projectedCard.model}</dd></div>
              </dl>
              {projectedCard.description.trim().length === 0 ? null : (
                <p className="m-0 text-sm text-muted">{projectedCard.description}</p>
              )}
            </Drawer.Header>

            <Drawer.Body className="task-drawer-body">
              <div className="inspector-history-scroll" ref={historyRef}>
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
                ) : <AttemptTimeline projection={projection} />}
              </div>

              <PersistentComposer
                status={projectedCard.executionStatus}
                attemptId={latestAttempt?.attemptId ?? null}
                generation={latestAttempt?.generation ?? null}
                queue={queue}
                draft={draft}
                blockerActive={blocker !== null}
                busy={commands.busy}
                unavailable={unavailable}
                feedbackId={feedback === null ? undefined : feedbackId}
                onDraftChange={setDraft}
                onStartAttempt={commands.startAttempt}
                onQueueFollowUp={commands.queueFollowUp}
                onRemoveQueuedFollowUp={commands.removeQueuedFollowUp}
                onConfirmQueuedFollowUp={commands.confirmQueuedFollowUp}
              />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>

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
