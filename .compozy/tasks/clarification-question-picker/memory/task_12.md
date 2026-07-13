# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add assembled in-memory ACP-to-UI-to-ACP regression coverage for answered, cancelled, preempted, session-loss, background-attention, and no-clarification flows.

## Important Decisions

- Use only the real SDK in-memory transport, real AgentConnection/controller/store/cockpit, and a mock agent; do not enable or launch a provider recipe.
- Keep ACP wire values in `test/mockAgent.ts` and the adapter-facing integration fixture; assertions beyond the adapter use protocol-free controller/store/UI surfaces.
- Exercise background attention with injected notifier and telemetry sinks so the assembled test proves the OS-attempt seam and content-free lifecycle records without external effects.

## Learnings

- Pre-change baseline: `rtk bun test test/clarificationLifecycle.integration.test.tsx` exits 1 because the declared suite does not exist.
- The mounted clarification dialog intentionally occludes a suspended Sessions overlay; its shared selector projection remains current while clarification owns input, and the real overview repaints after settlement.
- Fresh verification passed: focused lifecycle suite 6/6; configured 80% coverage gate 1498 pass, 2 opt-in skips, 0 fail; typecheck, full suite, and self-check all exited 0.

## Files / Surfaces

- `test/mockAgent.ts`: capture scripted elicitation requests and expose one outcome-recording helper used by prompt scripts.
- `test/clarificationLifecycle.integration.test.tsx`: assembled answer, duplicate-cancel, preemption/resumption, restoration loss, background attention, and no-clarification regression flows.

## Errors / Corrections

- The first focused run failed before mounting because declared session cwd values are validated; replaced the nonexistent `/workspace/kitten` fixture path with `process.cwd()`.
- The assembled controller classifies the untouched production recipes as unsupported even though the injected test connection enables its wire handler; telemetry assertions preserve that fail-closed production result instead of expecting the fixture-only capability.
- A focused `--coverage` run cannot satisfy the repository-wide threshold because mounting Cockpit imports the full application graph; used the configured full `test:coverage` gate for the required project result.

## Ready for Next Run

- Complete and committed locally as `d046bb93ffe5195c2676bad376f2a3372993e3c0`; no push was performed.
