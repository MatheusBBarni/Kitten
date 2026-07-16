# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make delegated launch a pre-registration managed-worktree transaction and expose explicit terminal non-live cleanup through controller actions.

## Important Decisions

- Use the existing managed-worktree provisioner as the injected controller boundary; its verified cleanup operation is the only controller-visible owned rollback seam for a freshly provisioned binding that cannot be registered.
- Preserve registered child/runtime/store identity after ACP or initial-prompt failure so the verified binding remains reviewable.
- Allocate the child connection generation only at the post-provision registration commit point so provisioning failure leaves no controller bookkeeping residue.
- Keep `closeConversation` unchanged; explicit managed cleanup is a separate fail-soft action and publishes only bounded binding availability/reason state.

## Learnings

- `startDelegatedChild` currently delegates to `startExploreChild`; the transactional ordering therefore belongs in the shared authoritative explore launch path.
- Current launch seeds delegated children with the parent cwd and removes admission/runtime state after startup or prompt failure.
- The telemetry integration fixture also launches through the authoritative delegated path, so it must inject a verified managed-worktree service rather than relying on a parent-cwd fallback.

## Files / Surfaces

- Touched implementation/test surfaces: `src/app/controller.ts`, `src/app/actions.ts`, `src/app/controller.test.ts`, `test/fakeController.ts`, and `test/telemetry.integration.test.ts`.

## Errors / Corrections

- The installed workflow skills resolve under `.agents/skills`, not `~/.codex/skills`.
- The first full coverage run found the telemetry integration fixture's obsolete parent-cwd assumption; injecting a verified binding restored its existing privacy and lifecycle assertions.

## Ready for Next Run

- Fresh final evidence: `rtk env -u FORCE_COLOR bun run typecheck && rtk env -u FORCE_COLOR bun test` passed with 2,348 pass, 4 intentional skips, 0 failures, 8,946 expectations, and no warnings.
- `rtk env -u FORCE_COLOR bun run selfcheck` ended with `SELF-CHECK OK` and no warnings.
- Isolated coverage passed all 2,352 tests; focused coverage reports `src/app/controller.ts` at 94.11% lines and `src/app/actions.ts` at 87.41% lines.
