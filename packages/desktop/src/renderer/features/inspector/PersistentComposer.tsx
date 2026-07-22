import type { FormEvent } from "react";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { FollowUpDraft, FollowUpQueueId, FollowUpQueueProjection } from "../../../attempts/followUpQueue.ts";
import type { ExecutionStatus } from "../../../workflow/workflowTypes.ts";

export type ComposerLifecycleStatus = ExecutionStatus | "interrupted";

interface PersistentComposerProps {
  readonly status: ComposerLifecycleStatus;
  readonly attemptId: AttemptId | null;
  readonly generation: AttemptGeneration | null;
  readonly queue: FollowUpQueueProjection | null;
  readonly draft: string;
  readonly blockerActive: boolean;
  readonly busy: boolean;
  readonly unavailable?: boolean;
  readonly feedbackId?: string;
  readonly onDraftChange: (draft: string) => void;
  readonly onStartAttempt: (initialPrompt: string) => void;
  readonly onQueueFollowUp: (text: string) => void;
  readonly onRemoveQueuedFollowUp: (queueId: FollowUpQueueId) => void;
  readonly onConfirmQueuedFollowUp: (queueId: FollowUpQueueId) => void;
}

function activeDrafts(queue: FollowUpQueueProjection | null): readonly FollowUpDraft[] {
  return queue?.drafts.filter(({ state }) => (
    state === "queued" || state === "awaiting_confirmation" || state === "confirmed"
  )) ?? [];
}

function queueStateLabel(state: FollowUpDraft["state"]): string {
  if (state === "awaiting_confirmation") return "Ready for confirmation";
  if (state === "confirmed") return "Dispatching confirmed follow-up";
  return "Queued behind the active turn";
}

export function PersistentComposer({
  status,
  attemptId,
  generation,
  queue,
  draft,
  blockerActive,
  busy,
  unavailable = false,
  feedbackId,
  onDraftChange,
  onStartAttempt,
  onQueueFollowUp,
  onRemoveQueuedFollowUp,
  onConfirmQueuedFollowUp,
}: PersistentComposerProps) {
  const running = status === "running";
  const blocked = blockerActive || status === "needs_attention";
  const disabled = busy || unavailable || blocked;
  const drafts = activeDrafts(queue);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || text.length === 0) return;
    if (running) {
      if (attemptId === null || generation === null) return;
      onQueueFollowUp(text);
      return;
    }
    onStartAttempt(text);
  }

  return (
    <section className="persistent-composer" aria-labelledby="composer-title">
      <header>
        <p className="eyebrow">Persistent composer</p>
        <h3 id="composer-title">{running ? "Queue a follow-up" : "Start a new Run Attempt"}</h3>
      </header>

      {drafts.length === 0 ? null : (
        <section className="follow-up-queue" aria-labelledby="follow-up-queue-title">
          <h4 id="follow-up-queue-title">Follow-up queue</h4>
          <ol>
            {drafts.map((queued, index) => (
              <li key={queued.queueId} className="queued-follow-up">
                <div>
                  <strong>Draft {index + 1}</strong>
                  <p className="transcript-text">{queued.text}</p>
                  <p className="event-state">{queueStateLabel(queued.state)}</p>
                </div>
                <div className="queue-actions">
                  {queued.state === "queued" || queued.state === "awaiting_confirmation" ? (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        if (!busy) onRemoveQueuedFollowUp(queued.queueId);
                      }}
                    >
                      Remove draft
                    </button>
                  ) : null}
                  {queued.state === "awaiting_confirmation" ? (
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || blocked}
                      onClick={() => {
                        if (!busy && !blocked) onConfirmQueuedFollowUp(queued.queueId);
                      }}
                    >
                      Send confirmed follow-up
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <form onSubmit={submit} aria-busy={busy}>
        <label className="field" htmlFor="card-composer-draft">
          <span>Message</span>
          <textarea
            id="card-composer-draft"
            rows={5}
            value={draft}
            aria-describedby={["composer-help", feedbackId].filter(Boolean).join(" ") || undefined}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            disabled={unavailable}
          />
        </label>
        <p id="composer-help" className={blocked ? "notice notice-warning" : "composer-help"}>
          {blocked
            ? "Answer the active Attention Blocker before submitting an ordinary message. This draft is saved."
            : running
              ? "This message will enter the FIFO queue. It will not cancel or steer the active turn and requires confirmation after settlement."
              : "This message becomes the initial prompt for a fresh Run Attempt in the card's current Workflow Stage."}
        </p>
        <button type="submit" className="button button-primary" disabled={disabled || draft.trim().length === 0}>
          {busy ? "Committing message…" : running ? "Queue follow-up" : "Start Run Attempt"}
        </button>
      </form>
    </section>
  );
}
