# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Preserve the empty compiled Cursor certification registry and make exact-profile/readiness behavior deterministic, bounded, content-free, and isolated from sibling providers.

## Important Decisions

- Production remains fail-closed with no certified Cursor literal; tests may inject reviewed-profile fixtures only.
- Cursor connection failures will collapse to the closed `authentication_required` or `handshake_failed` taxonomy without forwarding raw provider/runtime details. Existing non-Cursor readiness behavior remains unchanged.

## Learnings

- Pre-change baseline: `matchCertifiedCursorRuntimeProfile` accepted an injected profile whose observed and certified versions were both `not-semver`, violating the exact semantic-version boundary.
- Existing controller seams already preflight Cursor before construction and isolate ready Claude Code/Codex siblings; focused coverage needs to pin all bounded outcomes and content-free messages.
- Focused validation exposed that Cursor emitted `ready` immediately after `connect()`, before `session/new`; a later session-creation failure therefore could not emit `handshake_failed`.

## Files / Surfaces

- Touched: `src/config/configLoader.ts`, `src/config/configLoader.test.ts`, `src/config/readiness.ts`, `src/config/readiness.test.ts`, `src/app/controller.ts`, `src/app/controller.test.ts`, and task tracking/memory.

## Errors / Corrections

- The worktree contains unrelated ACP agent, site, and another Compozy packet changes; preserve them and stage only task-owned files.
- Corrected Cursor readiness emission to occur only after session establishment while retaining the established non-Cursor emission timing.

## Ready for Next Run

- Task implementation and self-review are complete. Fresh gates: focused suites 354 passed/0 failed; enforced coverage 2,556 passed/4 opt-in skips/0 failed; `rtk bun run typecheck && rtk bun test` passed with 2,556 tests and 0 failures.
- Production certification registry remains empty. Later tasks can consume only the closed readiness taxonomy and must not add a Cursor profile until reviewed native evidence exists.
