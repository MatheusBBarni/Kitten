# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace inherited delegated-child authority with an app-owned, exact, production-empty explore attestation path and typed launch/availability results.

## Important Decisions

- Production attestation receives no runtime evidence and therefore denies; tests inject a complete accepted capability through the controller seam.
- The accepted child recipe is freshly copied from the certified identity and the child runtime uses an explicit `explore` MCP scope containing only its pre-provisioned generation bridge.
- Authoritative attestation precedes child-id allocation; atomic store admission precedes bridge registration and connection creation.
- Startup and prompt failures remove the child/runtime/bridge projection instead of retaining an unavailable delegated child.

## Learnings

- `removeDelegationChild` intentionally accepts only terminal children. Failure cleanup must publish a generation-matching terminal state before removal.
- A parent replacement can dispose a connection while its `newSession` promise is still pending; stale startup cleanup must not dispose the same connection a second time.

## Files / Surfaces

- `src/config/exploreCapability.ts` and colocated tests: closed exact evidence verifier.
- `src/app/actions.ts`, `src/app/controller.ts`, `src/app/controller.test.ts`: typed action surface, launch order, MCP isolation, and cleanup.
- `src/core/explorePolicy.ts`: closed bridge denial reason.
- `src/config/configLoader.test.ts`: strict rejection of user-authored explore authority.
- `src/ui/DelegationDialog.tsx`, `test/fakeController.ts`: route the existing UI/test facade through the typed launch action.
- `test/orchestration.integration.test.ts`, `test/sessionRestore.integration.test.ts`, `test/telemetry.integration.test.ts`: successful delegated fixtures now opt into explicit reviewed fake evidence.

## Errors / Corrections

- Initial bridge/start cleanup called `removeDelegationChild` while the child was still `starting`, leaving its reservation behind; corrected to terminalize then remove.
- Initial stale-generation cleanup could dispose an already torn-down connection twice; corrected stale branches to dispose only while the runtime still owns that connection.

## Ready for Next Run

- Implementation and self-review are complete. Targeted explore verifier coverage is 100% functions/lines (repository coverage in that run: 80.00% functions, 82.59% lines).
- Fresh final gates passed: `rtk bun run typecheck && rtk bun test` (2300 pass, 4 credential-gated skips, 0 fail), `rtk bun run selfcheck` (`SELF-CHECK OK`), and `rtk bun run build` (darwin-arm64 artifact and checksum written).
- Task tracking is complete. The scoped implementation and tests were committed locally as `3830a83` (`feat: attest explore child launches`); tracking and workflow-memory files remain outside the automatic commit as required.
