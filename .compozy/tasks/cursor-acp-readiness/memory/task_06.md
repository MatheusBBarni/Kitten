# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Certify one exact local macOS Cursor `agent acp` runtime only after deterministic gates and reviewed native evidence; otherwise preserve the empty compiled registry and report the task blocked.

## Important Decisions

- The production registry remains unchanged because no PATH-resolved `agent` executable exists on this machine, so no exact semantic-version candidate or native lifecycle evidence can be produced.
- Native execution was not attempted after the missing-executable result. This preserves the task's rule that installation/version discovery alone cannot authorize certification and avoids broadening into runtime discovery or alternate command paths.
- Task tracking stays pending and no automatic commit is created because the external certification prerequisite is absent.

## Learnings

- Focused deterministic coverage passed with 166 tests passing, one opt-in native test skipped, and zero failures.
- The first full `rtk bun run typecheck && rtk bun test` attempt exposed one unrelated Markdown render-timing failure; the exact test and full Markdown file both passed in isolation, and a fresh full rerun passed with 2,570 tests passing, four credentialed tests skipped, and zero failures.
- `rtk bun run test:coverage` passed its enforced 80% threshold with 2,570 tests passing and zero failures. `rtk bun run selfcheck && rtk bun run build:local` passed with `SELF-CHECK OK` and a darwin-arm64 artifact.
- `rtk which agent && rtk agent --version` stopped at `which agent` with exit code 1 and no output. No version probe, Cursor process spawn, authentication, or ACP session occurred.

## Files / Surfaces

- Reviewed without code changes: `src/config/configLoader.ts`, `src/config/configLoader.test.ts`, `src/config/readiness.ts`, `src/config/readiness.test.ts`, and `test/cursorAcp.contract.test.ts`.
- Updated only this task-local workflow memory file. The compiled Cursor profile registry remains the intentional empty list.

## Errors / Corrections

- The non-isolated Markdown failure was treated as a prerequisite-gate failure and investigated without changing unrelated Markdown code. Its fresh isolated and repository-wide reruns passed.
- External blocker: the required local Cursor `agent` executable is unavailable on PATH. Per Task 06, this blocks native certification and forbids adding or guessing a compiled profile.

## Ready for Next Run

- Install or expose the reviewed Cursor CLI `agent` executable on PATH and authenticate it through Cursor's native flow.
- Re-run the complete deterministic prerequisite gates, observe the exact `agent --version` semantic version, then run the opt-in contract with that exact candidate.
- Add one literal `cursor-certified` profile only after a human reviews successful evidence whose closed config result is `accepted`; otherwise keep the registry empty.
