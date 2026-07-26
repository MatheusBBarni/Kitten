# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Expose immutable review manifests and bounded per-file diff chunks through the
  production Electrobun RPC boundary and typed renderer query bindings.
- Keep manifests summary-only, chunks at or below 64 KiB decoded UTF-8, cache
  identities collision-free, and all failure states content-minimized.

## Important Decisions

- Build on the uncommitted Task 01 contract, Task 04 evidence service, and Task
  05 supervision projection already present in the shared worktree; preserve
  their changes and keep Task 06 edits limited to RPC/query wiring and tests.
- Treat the current PRD, TechSpec API/RPC/query sections, and ADR-004 as
  consistent: the renderer supplies opaque identities only, while the host
  owns evidence reads and stable error mapping.
- Manifest requests carry both card and evidence identity. Chunk requests carry
  evidence, file, and offset only; the server owns the 64 KiB cap and rejects
  undeclared cap fields instead of accepting renderer-controlled limits.
- Projection commits invalidate only the manifest family. Immutable chunks use
  infinite staleness with a finite two-minute garbage-collection window; host
  unavailability invalidates the entire desktop/evidence family.

## Learnings

- The pre-change suite is green at 251 tests, but its package-boundary test
  explicitly asserts that `getReviewManifest` and `getReviewDiffChunk` are not
  registered yet. No Task 06 renderer query coverage exists.
- The Task 04 `ReviewEvidenceService` already returns deterministic manifests,
  UTF-8-safe bounded chunks, and explicit missing/incomplete/binary/invalid
  states. Task 06 must adapt those results without exposing host exceptions.
- `rtk bun --cwd packages/desktop run typecheck` prints Bun usage in this
  environment while returning a misleading zero status. Running from the
  package directory as `rtk bun run typecheck` executes the real compiler.

## Files / Surfaces

- `packages/desktop/src/shared/rpc.ts`
- `packages/desktop/src/host/desktopRpc.ts`
- `packages/desktop/src/host/desktopRpc.test.ts`
- `packages/desktop/src/host/electrobunWindow.ts`
- `packages/desktop/src/host/electrobunWindow.test.ts`
- `packages/desktop/src/main.ts`
- `packages/desktop/src/renderer/client.ts`
- `packages/desktop/src/renderer/main.tsx`
- `packages/desktop/src/renderer/query/desktopQueries.ts`
- `packages/desktop/src/renderer/query/desktopQueries.test.ts`
- Existing typed renderer-client fakes updated only to satisfy the newly
  required manifest/chunk methods.

## Errors / Corrections

- `rtk bun --cwd packages/desktop test <files>` invokes the package `test`
  script and therefore ran the full desktop suite; use direct focused Bun test
  invocation when narrow evidence is needed.
- The first real typecheck exposed the expected required-client breakage in
  existing fakes plus one branded `CardId` fixture. Those fakes now implement
  explicit unused evidence methods; production methods remain required.
- Self-review found that the existing plain-JSON validator did not forbid
  absolute or traversal-style file names inside otherwise valid manifest
  summaries. Review file paths now require normalized repository-relative
  segments, and the RPC contract tests cover the boundary.

## Verification Evidence

- `rtk bun run typecheck`: pass.
- Focused host, Electrobun bridge, renderer query, and desktop-shell tests:
  38 pass, 0 fail, 425 expectations.
- `rtk bun run test:acceptance`: pass across domain, SQLite, RPC, ACP,
  worktree, and smoke groups.
- `rtk bun run build`: pass; Electrobun completed the desktop build with only
  the existing local codesign/notarization warnings.
- `rtk bun run verify`: typecheck and all 262 tests pass. Coverage is 91.80%
  functions and 93.07% lines overall. Task 06 surfaces clear the 80% floor:
  `desktopRpc.ts` 100%/84.45%, `electrobunWindow.ts` 85.71%/83.33%,
  `desktopQueries.ts` 89.47%/88.07%, and both `rpc.ts` and `client.ts`
  100%/100%.
- The repository-defined gate still exits 1 because unrelated inherited files
  remain below the per-file floor, including `workflowApiServer.ts`,
  `main.ts`, `StageSetupModal.tsx`, `WorkflowBoardContainer.tsx`, and
  `useWorkflowBoardController.ts`.
- `rtk git diff --check`: pass.
- Native visual capture is not applicable to this backend-only RPC/query task;
  the planned packaged lifecycle/visual harness remains owned by Task 17.

## Ready for Next Run

- Implementation and task-scoped evidence are ready, but Task 06 must remain
  pending and uncommitted until the inherited repository-wide coverage gate is
  repaired or explicitly waived.
