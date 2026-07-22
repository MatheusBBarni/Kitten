import type { FormEvent } from "react";
import { Alert, Button, Label, TextArea, TextField } from "@heroui/react";
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
  const missingActiveAttempt = running && (attemptId === null || generation === null);
  const disabled = busy || blocked || missingActiveAttempt;
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => {
                        if (!busy) onRemoveQueuedFollowUp(queued.queueId);
                      }}
                    >
                      Remove draft
                    </Button>
                  ) : null}
                  {queued.state === "awaiting_confirmation" ? (
                    <Button
                      type="button"
                      size="sm"
                      isDisabled={busy || blocked}
                      onPress={() => {
                        if (!busy && !blocked) onConfirmQueuedFollowUp(queued.queueId);
                      }}
                    >
                      Send confirmed follow-up
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <form onSubmit={submit} aria-busy={busy}>
        <TextField
          className="field"
          value={draft}
          onChange={onDraftChange}
        >
          <Label>Message</Label>
          <TextArea
            id="card-composer-draft"
            rows={4}
            variant="secondary"
            aria-describedby={["composer-help", feedbackId].filter(Boolean).join(" ") || undefined}
          />
        </TextField>
        {blocked ? (
          <Alert id="composer-help" status="warning">
            <Alert.Content>
              <Alert.Description>Answer the active question before sending this message. Your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : missingActiveAttempt ? (
          <Alert id="composer-help" status="warning">
            <Alert.Content>
              <Alert.Description>Reconnect the desktop host before queuing a follow-up. Your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <p id="composer-help" className="composer-help">
            {unavailable
              ? "History is unavailable, but you can still start a new run. Your draft is saved."
              : running
              ? "Queued messages wait for the active turn to settle and require confirmation before dispatch."
              : "This message starts a fresh run in the task's current stage."}
          </p>
        )}
        <Button type="submit" isDisabled={disabled || draft.trim().length === 0} isPending={busy}>
          {running ? "Queue follow-up" : "Start run"}
        </Button>
      </form>
    </section>
  );
}
