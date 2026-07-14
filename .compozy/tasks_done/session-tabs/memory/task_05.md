# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement controller-owned, per-SessionId close teardown that is explicit, idempotent, permission-safe, late-event-safe, and failure-retaining.

## Important Decisions

- Keep the close engine on `SessionController` in task 05; task 06 will expose the complete UI-facing conversation action surface.
- Model close results as a finite outcome contract and share the same in-flight promise for repeated teardown requests.
- Once close begins, the runtime stops accepting adapter events and permission requests even if teardown later becomes unavailable; retry remains a controller teardown operation.

## Learnings

- Controller callbacks need a runtime-instance guard, not only a global disposed guard; this also rejects late callbacks from replaced runtimes with the same SessionId.
- Permission teardown can preserve sibling FIFO by filtering the queue in place, resolving only matching owners, then rebuilding the single visible approval from the new head.
- A teardown-failed runtime must be excluded from `getSession`; otherwise its retained connection could still accept prompts while the workspace marks it unavailable.

## Files / Surfaces

- Core implementation/tests: `src/app/controller.ts`, `src/app/controller.test.ts`.
- SessionController contract forwarding/fakes: `src/index.ts`, `test/cockpitSession.test.ts`, `test/configPersistence.integration.test.ts`, `test/fakeController.ts`, `test/telemetry.integration.test.ts`.

## Errors / Corrections

- The first idempotence test asserted disposal synchronously after async cancellation. Corrected it to wait on the observable disposal-call condition while retaining the exact once assertions.

## Ready for Next Run

- Task 05 implementation and verification are complete. Task 06 can delegate its UI-safe close action directly to `SessionController.closeConversation` and reuse `CloseChoice` / `CloseConversationResult`.
- Fresh evidence: 1165 tests passed (one existing opt-in reload probe skipped), self-check passed, typecheck passed, and coverage reached 96.71% functions / 98.07% lines.
- Local implementation commit: `f3cddfe` (`refactor: add isolated per-conversation teardown`). Tracking files remain outside the automatic commit by workflow policy.
