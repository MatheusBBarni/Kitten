import type { FormEvent } from "react";
import { Button, Checkbox, Input, Label, Radio, RadioGroup, TextArea, TextField } from "@heroui/react";
import type {
  AttentionAnswer,
  AttentionBlockerProjection,
  AttentionOutcome,
} from "../../../attention/contracts.ts";

interface AttentionBlockerPanelProps {
  readonly blocker: AttentionBlockerProjection;
  readonly busy: boolean;
  readonly onOutcome: (outcome: AttentionOutcome) => void;
  readonly onValidationError?: (message: string) => void;
}

function fieldName(fieldId: string): string {
  return `attention:${fieldId}`;
}

function customName(fieldId: string): string {
  return `attention-custom:${fieldId}`;
}

export function attentionAnswersFromForm(
  blocker: AttentionBlockerProjection,
  formData: FormData,
): Readonly<Record<string, AttentionAnswer>> | null {
  const answers: Record<string, AttentionAnswer> = {};
  for (const field of blocker.form.fields) {
    const selectedOptionIds = field.mode === "text"
      ? []
      : formData.getAll(fieldName(field.id)).map(String).filter((value) => value.length > 0);
    const customText = String(formData.get(customName(field.id)) ?? "").trim();
    if (field.required && selectedOptionIds.length === 0 && customText.length === 0) return null;
    answers[field.id] = {
      selectedOptionIds,
      ...(customText.length === 0 ? {} : { customText }),
    };
  }
  return answers;
}

export function AttentionBlockerPanel({
  blocker,
  busy,
  onOutcome,
  onValidationError,
}: AttentionBlockerPanelProps) {
  const titleId = `attention-title-${blocker.blockerId}`;
  const descriptionId = `attention-description-${blocker.blockerId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const answers = attentionAnswersFromForm(blocker, new FormData(event.currentTarget));
    if (answers === null) {
      onValidationError?.("Answer every required field before submitting this Attention Blocker.");
      return;
    }
    onOutcome({ kind: "submitted", answers });
  }

  return (
    <section className="attention-blocker" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header aria-live="assertive">
        <p className="eyebrow">Attention required</p>
        <h3 id={titleId}>{blocker.form.title ?? "Answer the agent's question"}</h3>
        <p id={descriptionId}>{blocker.form.prompt}</p>
        {blocker.form.context === undefined ? null : <p>{blocker.form.context}</p>}
        <p className="event-state">
          Notification {blocker.notification.state}. Attempt {Number(blocker.generation)} remains blocked until this question settles.
        </p>
      </header>

      <form onSubmit={submit} aria-busy={busy}>
        {blocker.form.fields.map((field, fieldIndex) => (
          <fieldset key={field.id} aria-required={field.required}>
            <legend>{field.label}{field.required ? " (required)" : " (optional)"}</legend>
            {field.description === undefined ? null : <p>{field.description}</p>}
            {field.mode === "text" ? (
              <TextField className="field" isRequired={field.required} isDisabled={busy}>
                <Label>Answer</Label>
                <TextArea
                  name={customName(field.id)}
                  rows={4}
                  variant="secondary"
                  autoFocus={fieldIndex === 0}
                />
              </TextField>
            ) : (
              <>
                {field.mode === "single" ? (
                  <RadioGroup className="attention-options" name={fieldName(field.id)} isRequired={field.required && !field.allowsCustom} isDisabled={busy}>
                    {field.options.map((option, optionIndex) => (
                      <Radio key={option.id} value={option.id} autoFocus={fieldIndex === 0 && optionIndex === 0}>
                        <Radio.Content>
                          <Radio.Control><Radio.Indicator /></Radio.Control>
                          <span><strong>{option.label}</strong>{option.description === undefined ? null : <small>{option.description}</small>}</span>
                        </Radio.Content>
                      </Radio>
                    ))}
                  </RadioGroup>
                ) : (
                  <div className="attention-options">
                    {field.options.map((option, optionIndex) => (
                      <Checkbox
                        key={option.id}
                        name={fieldName(field.id)}
                        value={option.id}
                        autoFocus={fieldIndex === 0 && optionIndex === 0}
                        isDisabled={busy}
                      >
                        <Checkbox.Content>
                          <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                          <span><strong>{option.label}</strong>{option.description === undefined ? null : <small>{option.description}</small>}</span>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                  </div>
                )}
                {field.allowsCustom ? (
                  <TextField className="field" isRequired={field.required && field.options.length === 0} isDisabled={busy}>
                    <Label>Custom answer {field.required && field.options.length === 0 ? "(required)" : "(optional)"}</Label>
                    <Input
                      name={customName(field.id)}
                      variant="secondary"
                      autoFocus={fieldIndex === 0 && field.options.length === 0}
                    />
                  </TextField>
                ) : null}
              </>
            )}
          </fieldset>
        ))}

        <footer className="attention-actions">
          <Button type="button" variant="secondary" isDisabled={busy} onPress={() => onOutcome({ kind: "skipped" })}>
            Skip question
          </Button>
          <Button type="button" variant="secondary" isDisabled={busy} onPress={() => onOutcome({ kind: "cancelled" })}>
            Cancel question
          </Button>
          <Button type="submit" isDisabled={busy} isPending={busy}>Submit answer</Button>
        </footer>
      </form>
    </section>
  );
}
