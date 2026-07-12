# Hand-off Safety

The hand-off forwards one agent's transcript, files, and diffs to a *different* agent process.
That path is the product, and it is security-sensitive: a credential in the source transcript would otherwise ride along into another agent's prompt.
These invariants are load-bearing - do not weaken them.

## Rules

- **Nothing is ever auto-sent.**
  Only an explicit `confirm` reaches an agent.
  `begin` merely opens the preview.
  There must be no code path from a keystroke to `sendPrompt` that skips the preview overlay.

- **The bundle arrives redacted.**
  The assembler redacts as it builds, so downstream code never holds an un-redacted bundle and never redacts a second time.
  Do not move redaction later or forward raw transcript text.

- **The redactor is biased to false negatives on purpose.**
  A missed secret is caught by the mandatory human preview; an over-eager redactor silently corrupts the bundle the receiving agent must work from.
  When editing `secretRedactor.ts`, keep patterns anchored to recognizable credential shapes and keep redaction line-oriented so a secret inside a diff does not corrupt the diff.
  Do not make matching aggressive to "be safe."

- **Direction is derived, not configured.**
  The target is always the session that is not focused, which is what makes hand-off and hand-back one flow.
  Do not add a target selector or a second send direction.

- **Curation drops by identity, never by index.**
  Files and diffs excluded in the preview are dropped by path / `toolCallId`, so a re-render cannot silently re-point an exclusion at a different row.

## Layer note

Assembly is pure core and the send goes through `ControllerActions`.
Nothing in `src/app/handoff.ts` may touch an `AgentConnection` or the ACP SDK - see `.claude/rules/layering.md`.
