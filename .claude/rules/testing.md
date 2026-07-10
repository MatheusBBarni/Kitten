# Testing & Verification

Runtime is Bun; tests use Bun's built-in runner.
There is no separate lint step - the quality gates are `bun run typecheck` and `bun test`.

## Rules

- **Colocate tests.**
  `foo.ts` gets `foo.test.ts` (or `.test.tsx` for UI) right beside it under `src/`.
  Cross-cutting and integration tests live under `test/`.

- **New code brings its own tests.**
  Favor the pure core (`src/core/`) for the densest coverage: it is deterministic with no I/O, so it tests directly.

- **Drive injectable seams, do not mock internals.**
  The boot path, controller, connections, renderer, transport, and frame scheduler all take factory/override options.
  Use those seams so a test never spawns a real agent or touches the real terminal; reach for a fake connection or in-memory renderer, not a patched private.

- **Verification gate before finishing or committing.**
  Run both and read the actual output:

  ```bash
  bun run typecheck && bun test
  ```

  For a change to boot or the view tree, also run `bun run selfcheck` (prints `SELF-CHECK OK`).
  Scope the verification to the claim: a single failing test is checked with `bun test <file>` or `--test-name-pattern`, but "done" requires the full gate.

- **Cite real output.**
  Claim a pass only from output produced after the last change in the current session, never from "should pass."

## Commands

```bash
bun test                                   # whole suite
bun test src/core/sessionReducer.test.ts   # one file
bun test --test-name-pattern "redacts"     # by test name
bun test --coverage                        # threshold 0.8 enforced
```
