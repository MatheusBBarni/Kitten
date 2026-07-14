# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Extend every controller-owned long-lived Cursor lifecycle with profile-aware lightweight preflight and bounded local readiness telemetry, while preserving sibling availability and generic adapter ownership of ACP authentication.

## Important Decisions

- Automatic commit remains gated on the repository's full fresh verification pipeline and a scoped self-review; unrelated existing workflow/config changes must remain untouched.
- Controller runtimes retain `ResolvedAgentConfig`; only Cursor invokes the reusable lightweight preflight, so Claude Code and Codex preserve their established single-connection startup behavior.
- Readiness telemetry uses one `provider_readiness` event with only the closed `ProviderKind` and `ProviderReadinessOutcome` dimensions beyond the recorder's standard timestamp/run reference.

## Learnings

- The production certified Cursor profile list intentionally remains empty until task_08; controller tests therefore inject the preflight verdict while asserting the exact resolved config object reaches both preflight and connection construction.
- `TabTelemetry.tabCreated` already accepted `ProviderKind` from prior Session Tabs work; task_04 only needed regression coverage proving Cursor flows through it.

## Files / Surfaces

- `src/app/controller.ts`, `src/app/controller.test.ts`
- `src/config/readiness.ts`
- `src/telemetry/recorder.ts`, `src/telemetry/recorder.test.ts`
- `test/index.integration.test.tsx`, `test/telemetry.integration.test.ts`

## Errors / Corrections

- Initial normalization rewrote non-Cursor rejected-handshake messages and broke an existing contract test; normalization is now Cursor-only while other providers retain their prior raw adapter reason.

## Ready for Next Run

- Implementation, self-review, and task tracking are complete.
- Fresh final gates passed: `bun run typecheck`; `bun test` with 1,701 passed, 2 credentialed/opt-in skipped, and 0 failed; `bun run selfcheck` with `SELF-CHECK OK`; and the compiled host build with a checksum artifact.
- The coverage run passed the same 1,701 tests at 97.29% functions and 98.16% lines.
- Scoped implementation commit created as `dd60cc8` (`feat: extend Cursor runtime orchestration and telemetry`); tracking-only files remain outside it.
