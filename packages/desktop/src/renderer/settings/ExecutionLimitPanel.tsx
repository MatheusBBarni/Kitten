import { useState, type FormEvent } from "react";
import { Button, Card, Description, FieldError, Input, Label, TextField } from "@heroui/react";

interface ExecutionLimitPanelProps {
  readonly limit: number;
  readonly activeCount: number;
  readonly busy: boolean;
  readonly onSave: (limit: number) => void;
}

export type ExecutionLimitParseResult =
  | { readonly valid: true; readonly value: number }
  | { readonly valid: false; readonly message: string };

export function parseExecutionLimit(value: string): ExecutionLimitParseResult {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    return { valid: false, message: "Enter a positive whole number. The value was not changed." };
  }
  return { valid: true, value: Number(value) };
}

export function ExecutionLimitPanel({ limit, activeCount, busy, onSave }: ExecutionLimitPanelProps) {
  const [value, setValue] = useState(String(limit));
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseExecutionLimit(value);
    if (!parsed.valid) {
      setError(parsed.message);
      return;
    }
    setError(null);
    onSave(parsed.value);
  }

  return (
    <Card className="settings-panel" aria-labelledby="execution-limit-title">
      <Card.Header><div><Card.Title id="execution-limit-title">Automatic execution limit</Card.Title><Card.Description>At most this many cards may run automatically across all boards. Active now: {activeCount}.</Card.Description></div></Card.Header>
      <Card.Content>
      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <TextField className="field" isDisabled={busy} isInvalid={error !== null}>
          <Label>Automatically active cards</Label>
          <Input
            id="automatic-execution-limit"
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            aria-describedby={error === null ? "execution-limit-help" : "execution-limit-help execution-limit-error"}
            variant="secondary"
          />
          <Description id="execution-limit-help">Fresh installations start at 1.</Description>
          {error !== null ? <FieldError id="execution-limit-error">{error}</FieldError> : null}
        </TextField>
        <Button type="submit" isDisabled={busy} isPending={busy}>Save execution limit</Button>
      </form>
      </Card.Content>
    </Card>
  );
}
