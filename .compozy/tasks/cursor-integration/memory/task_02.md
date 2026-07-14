# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a Cursor-only certification and CLI-version preflight before readiness connection creation, plus safe recovery taxonomy and independent aggregate coverage.

## Important Decisions

- `preflightAgentReadiness` accepts only `ResolvedAgentConfig` and exposes no connection factory, so controller paths can validate Cursor without a disposable ACP handshake.
- Uncertified Cursor recipes fail before even checking the overridden command; certified profiles check the sealed command, then require exact trimmed SemVer output.
- Aggregate readiness resolves runtime metadata through `findAgentConfig`; tests inject a resolver because the production certification catalog intentionally remains empty until task 08.
- Adapter authentication output is recognized structurally by `reason: "authentication_required"`, preserving compatibility with the existing generic `{ ready: false, error }` shape until task 03 formalizes it.

## Learnings

- Bun 1.3 subprocess stdout is typed as a `ReadableStream`; the default version probe reads it with `new Response(process.stdout).text()` and awaits `process.exited` concurrently.
- Controller integration is explicitly owned by task 04; task 02 supplies the connection-free preflight seam and full disposable readiness composition only.
- Task-owned readiness coverage is 93.14% lines and 92% functions; the full coverage suite and the clean-environment `typecheck && test` gate completed after the final edits.

## Files / Surfaces

- Touched implementation surfaces: `src/config/readiness.ts` and `src/config/readiness.test.ts`.

## Errors / Corrections

- Initial parameterized aggregate tests needed an explicit optional-field type for TypeScript narrowing.

## Ready for Next Run

- Task 02 implementation and tracking are complete. Task 03 can formalize the adapter authentication discriminator; task 04 can inject and call `preflightAgentReadiness` before each long-lived connection path.
- Source and tests were committed locally as `ef4e8e4` (`feat(config): add Cursor readiness preflight`); task tracking and workflow memory remain outside the automatic commit by repository policy.
