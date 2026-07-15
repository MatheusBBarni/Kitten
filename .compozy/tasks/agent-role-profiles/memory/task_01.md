# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the pure fixed V1 `explore` policy, immutable accepted snapshot, closed denials, and exhaustive boundary tests without touching later reducer/controller/UI work.

## Important Decisions

- The public evaluator accepts untrusted evidence, maps invalid role/restrictions/display data to existing fail-closed denials, and never exposes validation detail.
- Accepted nested values are copied, normalized, and deeply frozen; caller-owned objects remain mutable and retain identity.
- Capacity is a positive safe-integer count; the core defines no defaults or storage.
- Policy evidence uses an exact top-level shape, so untyped malformed values and extra task/path/runtime fields fail closed without throwing.

## Learnings

- Targeted policy tests and boundary coverage pass with 24 tests and 100% line/function coverage.
- Repository self-check and compiled build pass independently.
- The full suite is currently nondeterministic outside this task: one run failed an existing config-writer merge test; the next cleared it but failed a Markdown frame wait and config-persistence integration test. All three failures passed immediately in isolation.
- The final post-change broad gate failed again at `Markdown > registers capabilities on a direct multi-block mount before code rendering`: OpenTUI timed out after 20 frame passes with only `DIRECT_HEADING` and `DIRECT_PROSE` visible. Fail-fast reproduced it under suite order after the same test passed alone.

## Files / Surfaces

- `src/core/explorePolicy.ts`
- `src/core/explorePolicy.test.ts`
- `test/explorePolicy.contract.test.ts`

## Errors / Corrections

- A pre-change probe sent the shell `test` builtin through `rtk`, which the proxy cannot execute; verified file absence through repository status/listing instead and made no artifact.
- Initial immutability test expected `Reflect.set` to throw; it correctly returned `false` for the frozen object. Updated the assertion to verify the return value and unchanged field.
- Targeted coverage initially exited nonzero because a runtime import of `PROVIDER_KINDS` pulled all of `core/types.ts` into the denominator. Replaced it with an exhaustive `ProviderKind`-checked local record and retained only a type import.
- Self-review corrected unknown confirmed providers from the generic `missing-attestation` denial to the specific closed `unsupported-provider` denial.

## Ready for Next Run

- Implementation and targeted verification are ready, but task tracking and automatic commit remain pending until `rtk bun run typecheck && rtk bun test` completes cleanly in one fresh broad run. The latest post-change broad run had 2,250 passing, 4 skipped, 1 failing, and 1 error before the chain stopped.
