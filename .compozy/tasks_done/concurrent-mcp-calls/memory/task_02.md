# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace singleton same-route socket admission with bounded authenticated membership so mixed `ask_user` and `agent_run` calls can overlap without weakening route authority or lifecycle teardown.

## Important Decisions

- Keep the existing four-pending-call reservation as the only concurrency gate; add no queue, replay, persistent connection, or shared capacity.
- Treat socket close/error as a per-owner event: cancel only matching clarification handles and discard only matching agent-run bridge entries; keep whole-route closure controller-driven.

## Learnings

- The pre-change regression test explicitly proves the defect by expecting the second authenticated same-route socket to receive `busy` with `connection_stream_limit`.
- Terminal callbacks must check live connection state after removing pending work; targeted cancellation resolves clarification promises, so a disconnected socket must not receive a late frame.

## Files / Surfaces

- `src/app/kittenMcpBridge.ts`: route socket membership, per-socket pending cleanup, live-socket terminal sends, typed busy projection, retired stream-limit reason.
- `src/app/kittenMcpBridge.test.ts`: mixed admission, saturation recovery, route switching, route lifetime, close/error isolation, and no-replay coverage.
- `test/askUserMcp.integration.test.ts`: real-child same-parent and two-parent mixed calls plus replacement/disposal rejection.
- `src/app/controller.ts` and `src/app/controller.test.ts`: removed the retired stream-limit telemetry reason mapping/case.

## Errors / Corrections

- The first mixed-call integration assertion expected the delegated child at `starting`, but the in-memory child advances to `running` before the start result is serialized; the fixture now asserts the observed controller contract.

## Ready for Next Run

- Implementation and self-review are complete. Focused bridge tests: 27 pass; real-child integration tests: 3 pass.
- Fresh gates after all source/test edits: typecheck exit 0, full test suite exit 0, enforced coverage command exit 0, self-check printed `SELF-CHECK OK`, and host build wrote `dist/kitten-darwin-arm64` plus `dist/SHA256SUMS`.
- No task-local finding met the promotion test for shared workflow memory.
