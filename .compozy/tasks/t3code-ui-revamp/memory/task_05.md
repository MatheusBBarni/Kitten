# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Derive one deterministic, content-minimized supervision item per card from one
  `EventJournal.snapshot()` and expose it through the typed desktop bridge with
  the snapshot's exact revision.

## Important Decisions

- Treat card execution status as the lifecycle classification authority, with a
  valid active attention blocker taking precedence over every card status.
- Select attempts by descending generation, then descending creation time, then
  ascending attempt ID; select active attention by generation/update/create
  time with blocker ID as the stable tie-breaker.
- Keep repeated unchanged reads structurally identical by deriving
  `generatedAt` from snapshot timestamps instead of wall-clock query time.
- A ready-for-review item exposes evidence as available only when the latest
  persisted summary matches the card and selected succeeded attempt identities.

## Learnings

- Task 01 already added the frozen supervision types, validator, and envelope,
  but the RPC schema and host/bridge query are not registered.
- The authoritative snapshot already contains attempts, inspector activity,
  attention blockers, and latest evidence summaries, so Task 05 needs no
  persistence table or per-board read.
- Focused Task 05 coverage passes the deterministic empty, priority override,
  durable selection, tie-break, uniqueness/count, privacy, refresh, real
  journal, Electrobun registration, and 10,000-card performance cases.
- The 10,000-card fixture passes the TechSpec's p95-under-50-ms assertion; the
  last full coverage run reported the fixture test at 23.10 ms.
- The repository `verify` gate still exits 1 only after 251 tests pass because
  inherited files remain below the per-file 80% coverage floor. Task 05's
  `boardRpc.ts` is 100% function/line covered and `electrobunWindow.ts` is
  85.71% function / 82.76% line covered.
- The packaged native lifecycle harness is explicitly owned by Task 17 and is
  not present yet; Task 05's backend build succeeds without it.

## Files / Surfaces

- Touched: `packages/desktop/src/host/boardRpc.ts`,
  `packages/desktop/src/host/boardRpc.test.ts`,
  `packages/desktop/src/shared/rpc.ts`, `packages/desktop/src/main.ts`,
  `packages/desktop/src/host/electrobunWindow.ts`,
  `packages/desktop/src/host/electrobunWindow.test.ts`,
  `packages/desktop/src/renderer/client.ts`,
  `packages/desktop/src/renderer/main.tsx`,
  `packages/desktop/test/desktopShell.test.ts`, and
  `packages/desktop/test/workflowBoard.integration.test.ts`.

## Errors / Corrections

- Preserve the uncommitted Task 01-04 changes already present in shared RPC,
  persistence, review-evidence, queue, recovery, and review-disposition files.
- RTK's `bun` wrapper does not accept the documented `--cwd` placement in this
  environment; run the same package scripts from `packages/desktop`.
- Do not mark Task 05 complete or create its automatic commit while the
  repository-defined coverage gate exits non-zero.

## Ready for Next Run

- The Task 05 implementation and focused tests are present and green.
- Re-run `rtk bun run verify` from `packages/desktop` after inherited per-file
  coverage failures are repaired. If it exits 0, repeat self-review, update the
  Task 05 checkboxes/status, and create the authorized local commit.
