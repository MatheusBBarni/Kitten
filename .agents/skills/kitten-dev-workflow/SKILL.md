---
name: kitten-dev-workflow
description: The Kitten inner dev loop — running the whole test suite, a single test file or a test by name, typecheck, coverage, and the compiled build, plus the verification gate to run before finishing or committing. Use when editing Kitten source and you need to run or scope tests, typecheck, or build. Do not use for first-time clone-and-run setup (see kitten-setup).
---

# Kitten Dev Workflow

The edit/test/verify loop for working on Kitten. Runtime is Bun; tests use Bun's built-in runner. There is **no separate lint step** - the quality gates are `bun run typecheck` and `bun test`.

## Commands

```bash
bun test                                          # whole suite
bun test src/core/sessionReducer.test.ts          # one file
bun test --test-name-pattern "redacts"            # every test whose name matches, across the suite
bun run typecheck                                 # tsc --noEmit (strict; noUncheckedIndexedAccess)
bun test --coverage                               # coverage; threshold 0.8 is enforced (alias: bun run test:coverage)
bun run selfcheck                                 # headless boot check; prints SELF-CHECK OK
bun run build                                     # compile per-platform standalone binaries
bun run build:local                               # quick single-binary compile for the host only
```

## Test conventions

- Tests are **colocated** with the code they cover: `foo.ts` -> `foo.test.ts` (or `.test.tsx` for UI) right beside it under `src/`. Cross-cutting/integration tests live under `test/`.
- New code is expected to bring its own tests. The pure Domain Core (`src/core/`) is the easiest to test - it is deterministic and has no I/O.
- Every seam is injectable for tests: the boot path, controller, connections, renderer, and schedulers all take factory/transport overrides, so unit tests never spawn a real agent or touch the real terminal. Prefer driving those seams over mocking internals.

## Verification gate (before finishing or committing)

Run both and read the actual output before claiming done - a green typecheck does not prove tests pass, and vice versa:

```bash
bun run typecheck && bun test
```

For a change to boot or the view tree, also run `bun run selfcheck`. Cite the real output, not "should pass."

## Architecture invariants to protect

When editing, keep the layering intact (details in `CLAUDE.md` and the ADRs under `.compozy/tasks_done/kitten-agent-tui/adrs/`):

- **ACP lives only in `src/agent/`.** No ACP wire type may leak into the core, store, or UI - the adapter translates ACP into protocol-free domain events.
- **The core (`src/core/`) is pure** - no I/O, no ACP, no React. The `sessionReducer` is the single writer of session state.
- **The store (`src/store/`) is the one mutable state**, immutable with structural sharing; the UI subscribes to narrow selectors. Never write session state by hand - route through the reducer via `store.applyEvent`.
- **The UI reaches agents only through `ControllerActions`** (`src/app/actions.ts`) - never an `AgentConnection` directly.
- **Degrade, never crash.** Startup and every action degrade per-agent; a UI callback fired from a keypress must never reject into the React tree.
- **Hand-off never auto-sends and arrives redacted.** Only an explicit confirm reaches an agent, and the redactor is deliberately biased to false negatives (the human preview is the backstop) - do not make it aggressive.
- **Keybindings live only in `src/ui/keymap.ts`**, the single source of truth for both dispatch and the help panel.

## Dependency pinning

`bunfig.toml` sets `exact = true` and enforces a minimum-release-age supply-chain guard. `@opentui/*`, the ACP SDK, and their native cores are hard-pinned and allow-listed (they are pre-1.0 and fast-moving). Do not widen version ranges or bump these casually.
