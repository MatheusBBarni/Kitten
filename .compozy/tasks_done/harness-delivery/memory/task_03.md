# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Route every genuinely fresh first visible task through controller-owned, generation-scoped harness delivery while preserving loaded and follow-up behavior.

## Important Decisions

- `actions.sendPrompt` will use a synchronous controller-supplied preparation seam: validation and the `pending -> in_flight` claim happen before the visible `user_message`, while the returned invocation owns terminal settlement.
- Eligible-delivery tests inject explicit certified capability. Production remains fail-closed because task_02 intentionally has no built-in credentialed profile evidence yet.
- Publish only a fixed per-session checkpoint projection in `AppStore`; rendered recovery state and durable serialization remain deferred.

## Learnings

- Every real-connection integration fixture that sends a fresh first prompt must inject both sides of certification: the controller capability decision and the adapter's exact matching test profile.
- Task-scoped coverage is above 80% for every touched production surface: actions 84.93% functions / 87.19% lines, controller 94.89% / 94.67%, harness delivery 100% / 100%, and app store 81.25% / 89.25%.
- The repository-wide test gate is still blocked by two inherited `test/releaseWorkflow.test.ts` assertions against the already-modified release workflow's npm token configuration; the harness delivery tests are green.

## Files / Surfaces

- Implemented: `src/app/controller.ts`, `src/app/actions.ts`, and `src/store/appStore.ts`.
- Added lifecycle, envelope, transcript, fallback, replacement, cancellation, close, disposal, configured-task, fresh-context, loaded-session, and handoff coverage in `src/app/controller.test.ts`.
- Updated certified real-adapter fixtures in `test/index.integration.test.tsx`, `test/sessionStatus.integration.test.tsx`, and `src/ui/HandoffPreview.test.tsx`.

## Errors / Corrections

- Corrected a replacement-generation test fixture from a two-provider record to `Record<ProviderKind, ...>` after fresh typechecking caught the missing Cursor key.
- Added explicit certification to integration fixtures after the repository suite correctly exposed that their fresh prompts were now failing closed.

## Ready for Next Run

- Implementation and task-scoped verification are complete. Do not mark task tracking complete or commit until the unrelated repository-wide release workflow failures are resolved and the full gate is clean.
