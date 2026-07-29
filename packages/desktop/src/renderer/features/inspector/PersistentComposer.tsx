import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Alert, Button, Label, TextArea, TextField } from "@heroui/react";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { ExecutionStatus } from "../../../workflow/workflowTypes.ts";

export type ComposerLifecycleStatus = ExecutionStatus | "interrupted";
export type ComposerMode = "initial" | "active_direction" | "request_changes";
export type ComposerDeliveryState = "queued" | "dispatching" | "dispatched" | "interrupted";

interface PersistentComposerProps {
  readonly status: ComposerLifecycleStatus;
  readonly attemptId: AttemptId | null;
  readonly generation: AttemptGeneration | null;
  readonly draft: string;
  readonly blockerActive: boolean;
  readonly busy: boolean;
  readonly unavailable?: boolean;
  readonly feedbackId?: string;
  readonly mode?: ComposerMode;
  readonly deliveryState?: ComposerDeliveryState | null;
  readonly requestChangesAvailable?: boolean;
  readonly onDraftChange: (draft: string) => void;
  readonly onStartAttempt: (initialPrompt: string) => void;
  readonly onSendDirection: (text: string) => void;
  readonly onRequestChanges?: (text: string) => void;
  readonly onRetryInterrupted?: (text: string) => void;
}

function deliveryMessage(state: ComposerDeliveryState | null): string | null {
  if (state === "queued") return "Message accepted and queued for the next safe turn boundary.";
  if (state === "dispatching") return "Queued message is dispatching.";
  if (state === "dispatched") return "Queued message was dispatched.";
  if (state === "interrupted") return "Delivery was interrupted. Review the restored draft and retry explicitly.";
  return null;
}

export function PersistentComposer({
  status,
  attemptId,
  generation,
  draft,
  blockerActive,
  busy,
  unavailable = false,
  feedbackId,
  mode: requestedMode,
  deliveryState = null,
  requestChangesAvailable = false,
  onDraftChange,
  onStartAttempt,
  onSendDirection,
  onRequestChanges,
  onRetryInterrupted,
}: PersistentComposerProps) {
  const mode = requestedMode ?? (status === "running" ? "active_direction" : "initial");
  const running = mode === "active_direction";
  const blocked = blockerActive || status === "needs_attention";
  const missingActiveAttempt = running && (attemptId === null || generation === null);
  const reviewOnly = status === "ready_for_review" && mode !== "request_changes";
  const completed = status === "completed";
  const requestChangesBlocked = mode === "request_changes"
    && (status !== "ready_for_review" || !requestChangesAvailable);
  const disabled = busy || blocked || missingActiveAttempt || reviewOnly || completed || requestChangesBlocked;
  const submissionLocked = useRef(false);
  const submittedDraft = useRef<string | null>(null);
  const wasBusy = useRef(busy);

  useEffect(() => {
    if ((wasBusy.current && !busy) || (submittedDraft.current !== null && submittedDraft.current !== draft)) {
      submissionLocked.current = false;
      submittedDraft.current = null;
    }
    wasBusy.current = busy;
  }, [busy, draft]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || submissionLocked.current || text.length === 0) return;
    submissionLocked.current = true;
    submittedDraft.current = draft;
    if (deliveryState === "interrupted") {
      onRetryInterrupted?.(text);
      return;
    }
    if (mode === "active_direction") {
      if (attemptId === null || generation === null) return;
      onSendDirection(text);
      return;
    }
    if (mode === "request_changes") {
      onRequestChanges?.(text);
      return;
    }
    onStartAttempt(text);
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter"
      || event.shiftKey
      || event.repeat
      || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229
    ) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const title = mode === "request_changes"
    ? "Request changes"
    : running
      ? "Steer active task"
      : "Start a new Run Attempt";
  const actionLabel = deliveryState === "interrupted"
    ? mode === "request_changes" ? "Retry request" : "Retry message"
    : mode === "request_changes"
      ? "Send change request"
      : running
        ? "Send message"
        : "Start run";
  const delivery = deliveryMessage(deliveryState);

  return (
    <section className="persistent-composer" aria-labelledby="composer-title">
      <header>
        <p className="eyebrow">Persistent composer</p>
        <h3 id="composer-title">{title}</h3>
      </header>

      <form onSubmit={submit} aria-busy={busy}>
        <TextField className="field">
          <Label htmlFor="card-composer-draft">Message</Label>
          <TextArea
            id="card-composer-draft"
            autoFocus={!blocked}
            rows={4}
            variant="secondary"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={submitOnEnter}
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
              <Alert.Description>Reconnect the desktop host before sending a direction. Your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : reviewOnly ? (
          <Alert id="composer-help" status="warning">
            <Alert.Content>
              <Alert.Description>Open review and choose Request changes before sending feedback. Your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : completed ? (
          <Alert id="composer-help" status="warning">
            <Alert.Content>
              <Alert.Description>This task is complete. Reopen it through the workflow before sending another message. Your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : requestChangesBlocked ? (
          <Alert id="composer-help" status="warning">
            <Alert.Content>
              <Alert.Description>Current review evidence is required before requesting changes. Reload the review; your draft is saved.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <p id="composer-help" className="composer-help">
            {unavailable
              ? "History is unavailable, but you can still start a new run. Your draft is saved."
              : mode === "request_changes"
              ? "Edit the change request, then press Enter to submit it. Shift+Enter adds a new line."
              : running
              ? "Press Enter to send a direction. It is delivered at the next safe turn boundary; use Shift+Enter for a new line."
              : "This message starts a fresh run in the task's current stage."}
          </p>
        )}
        {delivery === null ? null : (
          <p className="m-0 text-sm" role="status" aria-live="polite">{delivery}</p>
        )}
        {running && deliveryState !== "interrupted" ? null : (
          <Button type="submit" isDisabled={disabled || draft.trim().length === 0} isPending={busy}>
            {actionLabel}
          </Button>
        )}
      </form>
    </section>
  );
}
