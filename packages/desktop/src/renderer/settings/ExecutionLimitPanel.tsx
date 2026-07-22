import { useState, type FormEvent } from "react";

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
    <section className="settings-panel" aria-labelledby="execution-limit-title">
      <h2 id="execution-limit-title">Automatic execution limit</h2>
      <p>At most this many cards may run automatically across all boards. Active now: {activeCount}.</p>
      <form className="settings-form" onSubmit={submit} aria-busy={busy}>
        <div className="field">
          <label htmlFor="automatic-execution-limit">Automatically active cards</label>
          <input
            id="automatic-execution-limit"
            inputMode="numeric"
            value={value}
            disabled={busy}
            aria-invalid={error !== null}
            aria-describedby={error === null ? "execution-limit-help" : "execution-limit-help execution-limit-error"}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
          <small id="execution-limit-help">Fresh installations start at 1.</small>
          {error !== null ? <span id="execution-limit-error" className="field-error" role="alert">{error}</span> : null}
        </div>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Saving execution limit…" : "Save execution limit"}
        </button>
      </form>
    </section>
  );
}
