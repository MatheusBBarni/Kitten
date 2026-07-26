import type { FormEvent, KeyboardEvent } from "react";
import { Alert, Button, Label, TextArea, TextField } from "@heroui/react";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { ExecutionStatus } from "../../../workflow/workflowTypes.ts";

export type ComposerLifecycleStatus = ExecutionStatus | "interrupted";

interface PersistentComposerProps {
  readonly status: ComposerLifecycleStatus;
  readonly attemptId: AttemptId | null;
  readonly generation: AttemptGeneration | null;
  readonly draft: string;
  readonly blockerActive: boolean;
  readonly busy: boolean;
  readonly unavailable?: boolean;
  readonly feedbackId?: string;
  readonly onDraftChange: (draft: string) => void;
  readonly onStartAttempt: (initialPrompt: string) => void;
  readonly onSendDirection: (text: string) => void;
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
  onDraftChange,
  onStartAttempt,
  onSendDirection,
}: PersistentComposerProps) {
  const running = status === "running";
  const blocked = blockerActive || status === "needs_attention";
  const missingActiveAttempt = running && (attemptId === null || generation === null);
  const disabled = busy || blocked || missingActiveAttempt;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || text.length === 0) return;
    if (running) {
      if (attemptId === null || generation === null) return;
      onSendDirection(text);
      return;
    }
    onStartAttempt(text);
  }

  function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <section className="persistent-composer" aria-labelledby="composer-title">
      <header>
        <p className="eyebrow">Persistent composer</p>
        <h3 id="composer-title">{running ? "Steer active task" : "Start a new Run Attempt"}</h3>
      </header>

      <form onSubmit={submit} aria-busy={busy}>
        <TextField
          className="field"
          value={draft}
          onChange={onDraftChange}
        >
          <Label>Message</Label>
          <TextArea
            id="card-composer-draft"
            autoFocus={!blocked}
            rows={4}
            variant="secondary"
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
        ) : (
          <p id="composer-help" className="composer-help">
            {unavailable
              ? "History is unavailable, but you can still start a new run. Your draft is saved."
              : running
              ? "Press Enter to send a direction. It is delivered at the next safe turn boundary; use Shift+Enter for a new line."
              : "This message starts a fresh run in the task's current stage."}
          </p>
        )}
        <Button type="submit" isDisabled={disabled || draft.trim().length === 0} isPending={busy}>
          {running ? "Send message" : "Start run"}
        </Button>
      </form>
    </section>
  );
}
