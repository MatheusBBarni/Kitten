import { useCallback, useEffect, useRef, useState } from "react";
import type { AttentionOutcome } from "../../../attention/contracts.ts";
import type { FollowUpQueueId } from "../../../attempts/followUpQueue.ts";
import type { CardInspectorProjection } from "../../../attempts/inspectorProjection.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { CardInspectorEnvelope } from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { bindCardInspectorRenderer } from "../../client.ts";
import { AttentionBlockerPanel } from "./AttentionBlockerPanel.tsx";
import { AttemptTimeline } from "./AttemptTimeline.tsx";
import { PersistentComposer } from "./PersistentComposer.tsx";
import { answerAttentionThroughRpc } from "./inspectorCommands.ts";

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

interface Feedback {
  readonly tone: "status" | "error";
  readonly message: string;
}

function commandId(kind: string): string {
  return `inspector:${kind}:${crypto.randomUUID()}`;
}

function currentProjectionCard(fallback: CardProjection, projection: CardInspectorProjection | null): CardProjection {
  return projection?.card ?? fallback;
}

export function CardInspector({
  client,
  card,
  draftStore = browserDraftStore,
}: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly draftStore?: DraftStore;
}) {
  const [projection, setProjection] = useState<CardInspectorProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [draft, setDraft] = useState(() => draftStore.read(card.cardId));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
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

  const runOnce = useCallback(async (key: string, action: () => Promise<boolean>) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusy(true);
    try {
      const committed = await action();
      if (committed) await bindingRef.current?.refresh();
    } catch {
      setFeedback({
        tone: "error",
        message: "The desktop host did not finish this inspector action. Review the refreshed card and try again.",
      });
    } finally {
      inFlight.current.delete(key);
      setBusy(inFlight.current.size > 0);
    }
  }, []);

  const projectedCard = currentProjectionCard(card, projection);
  const latestAttempt = projection?.attemptStates.at(-1) ?? null;
  const queue = latestAttempt === null
    ? null
    : projection?.followUpQueues.find(({ attemptId }) => attemptId === latestAttempt.attemptId) ?? null;
  const blocker = projection?.attentionBlockers.find(({ active }) => active) ?? null;
  const feedbackId = `inspector-feedback-${projectedCard.cardId}`;

  function showInspectorResult(result: { readonly status: string; readonly conflict?: { readonly message: string }; readonly reason?: { readonly message: string } }, success: string): boolean {
    if (result.status === "ok") {
      setFeedback({ tone: "status", message: success });
      return true;
    }
    setFeedback({
      tone: "error",
      message: result.conflict?.message ?? result.reason?.message ?? "The inspector command was rejected. Review the refreshed card and try again.",
    });
    return false;
  }

  function startAttempt(initialPrompt: string) {
    void runOnce("start", async () => {
      const response = await client.startAttempt(commandId("start"), {
        cardId: projectedCard.cardId,
        expectedCardVersion: projectedCard.version,
        initialPrompt,
      });
      const committed = showInspectorResult(response.result, "Run Attempt started with the saved initial prompt.");
      if (committed) setDraft("");
      return committed;
    });
  }

  function queueFollowUp(text: string) {
    if (latestAttempt === null) return;
    void runOnce("queue", async () => {
      const response = await client.queueFollowUp(commandId("queue"), {
        attemptId: latestAttempt.attemptId,
        generation: latestAttempt.generation,
        expectedQueueVersion: queue?.version ?? 0,
        text,
      });
      const committed = showInspectorResult(response.result, "Follow-up queued. It will require confirmation after the active turn settles.");
      if (committed) setDraft("");
      return committed;
    });
  }

  function removeQueuedFollowUp(queueId: FollowUpQueueId) {
    if (latestAttempt === null || queue === null) return;
    void runOnce(`remove:${queueId}`, async () => {
      const response = await client.removeQueuedFollowUp(commandId("remove"), {
        attemptId: latestAttempt.attemptId,
        generation: latestAttempt.generation,
        expectedQueueVersion: queue.version,
        queueId,
      });
      return showInspectorResult(response.result, "Queued follow-up removed.");
    });
  }

  function confirmQueuedFollowUp(queueId: FollowUpQueueId) {
    if (latestAttempt === null || queue === null || blocker !== null) return;
    void runOnce(`confirm:${queueId}`, async () => {
      const response = await client.confirmQueuedFollowUp(commandId("confirm"), {
        attemptId: latestAttempt.attemptId,
        generation: latestAttempt.generation,
        expectedQueueVersion: queue.version,
        queueId,
      });
      return showInspectorResult(response.result, "Confirmed follow-up dispatched once.");
    });
  }

  function answerAttention(outcome: AttentionOutcome) {
    if (blocker === null) return;
    void runOnce(`attention:${blocker.blockerId}`, async () => {
      const response = await answerAttentionThroughRpc(client, commandId("attention"), blocker, outcome);
      return showInspectorResult(response.result, "Attention outcome recorded for the blocked attempt.");
    });
  }

  return (
    <aside className="card-inspector" aria-labelledby="card-inspector-title">
      <header className="inspector-header">
        <div>
          <p className="eyebrow">Selected card</p>
          <h2 id="card-inspector-title">{projectedCard.title}</h2>
        </div>
        <dl className="inspector-status">
          <div><dt>Workflow Stage</dt><dd>{projection?.attempts.at(-1)?.context.stage.label ?? "Current board stage"}</dd></div>
          <div><dt>Execution Status</dt><dd>{projectedCard.executionStatus.replaceAll("_", " ")}</dd></div>
        </dl>
      </header>

      {feedback === null ? null : (
        <p id={feedbackId} className={feedback.tone === "error" ? "notice notice-error" : "notice"} role={feedback.tone === "error" ? "alert" : "status"}>
          {feedback.message}
        </p>
      )}

      {blocker === null ? null : (
        <AttentionBlockerPanel
          key={blocker.blockerId}
          blocker={blocker}
          busy={busy}
          onOutcome={answerAttention}
          onValidationError={(message) => setFeedback({ tone: "error", message })}
        />
      )}

      <div className="inspector-history-scroll" ref={historyRef}>
        {projection === null ? (
          <section className="attempt-timeline" aria-labelledby="work-history-title">
            <h3 id="work-history-title">Orchestrated Work History</h3>
            <p className={unavailable ? "notice notice-error" : "notice"} aria-busy={!unavailable}>
              {unavailable ? "History is unavailable until the desktop host reconnects." : "Loading durable card history…"}
            </p>
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
        busy={busy}
        unavailable={unavailable}
        feedbackId={feedback === null ? undefined : feedbackId}
        onDraftChange={setDraft}
        onStartAttempt={startAttempt}
        onQueueFollowUp={queueFollowUp}
        onRemoveQueuedFollowUp={removeQueuedFollowUp}
        onConfirmQueuedFollowUp={confirmQueuedFollowUp}
      />
    </aside>
  );
}
