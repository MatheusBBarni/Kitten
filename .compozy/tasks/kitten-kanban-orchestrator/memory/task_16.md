# Task Memory: task_16.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the selected-card desktop supervision surface: durable chronological attempts, a lifecycle-persistent draft composer, confirmable FIFO follow-ups, and answer-first Attention Blockers over typed RPC projections.

## Important Decisions

- Keep renderer state disposable and card-scoped: every refresh queries the selected card through typed RPC and ignores late responses for a previous selection.
- Ordinary text has two explicit routes only: idle submission starts an attempt with the text as its initial prompt; active submission queues a follow-up. Attention blocks both routes until its terminal outcome is projected.
- Keep queue and blocker evidence alongside the existing attempt transcript projection rather than importing host coordinators or persistence into the renderer.

## Learnings

- The current card inspector projection contains only attempt transcripts; durable follow-up queues and Attention Blockers already exist as host projections but are not composed into the card query.
- Card selection currently discards `getCardInspector` and renders only an inspector-route placeholder, so the task has a concrete missing-surface baseline.

## Files / Surfaces

- Projection/RPC: `packages/desktop/src/attempts/inspectorProjection.ts`, `packages/desktop/src/attempts/activityIngestor.ts`, `packages/desktop/src/host/desktopRpc.ts`, `packages/desktop/src/shared/rpc.ts`, `packages/desktop/src/renderer/client.ts`, and Electrobun handler wiring.
- Renderer: `packages/desktop/src/renderer/features/inspector/*`, `WorkflowBoardContainer.tsx`, and `renderer/index.html`.
- Coverage: component tests plus `packages/desktop/test/cardInspectorRenderer.integration.test.ts` and the expanded attempt-inspector fixture.

## Errors / Corrections

- Bun's per-file function threshold initially exposed the new card-projection composition callbacks; the selected-card test now exercises multi-attempt queue/blocker filtering and ordering. Final desktop coverage is 95.71% lines and 97.12% functions.
- Live macOS accessibility inspection timed out for the unsigned Electrobun development bundle. Automated semantic render tests, typecheck, self-check, full tests, and both builds passed; no screenshot claim is recorded.

## Ready for Next Run

- Task 16 implementation and automated verification are complete, but the task remains pending because the required user-facing visual gate could not obtain trustworthy live-window evidence. Production coordinator composition remains owned by later shell/integration tasks; this renderer surface uses only typed RPC and fake-RPC coverage.
- Fresh verification: root typecheck, full tests, self-check, root build, desktop coverage, desktop Electrobun build, and `git diff --check` all exited zero.
- Do not commit Task 16 yet: its board-container, renderer-client, RPC, style, and Electrobun seams overlap the pre-existing uncommitted Task 15 surface, which is itself waiting for visual verification. After both visual gates pass, stage the two tasks according to their ownership instead of silently folding Task 15 into a Task 16 commit.
