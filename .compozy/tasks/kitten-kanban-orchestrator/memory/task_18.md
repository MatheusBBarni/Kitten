# Task Memory: task_18.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add honest atomic startup interruption recovery, explicit version-fenced human review completion, content-free lifecycle diagnostics, and the final layered desktop/TUI acceptance gates.

## Important Decisions

- Preserve the existing immutable-journal pattern: recovery and review each append authoritative events whose projection changes commit in the same SQLite transaction.
- Recover every non-terminal attempt in one `appendBatch` transaction, append a terminal inspector entry, move the card to `failed` without changing its Workflow Stage, cancel only its active blocker, and retain Run Context, transcript, queue, and worktree evidence.
- Persist explicit operator approval as a replayable review-disposition projection and version-fenced card completion. Review IDs are globally idempotent and cannot be reused for a different board/card identity.
- Keep recovery/review diagnostics as closed typed metadata; review diagnostics intentionally omit caller-supplied review IDs as well as prompt, transcript, Skill, path, and credential content.
- Keep the relocated Cockpit gate explicit while retaining the pre-existing exact TUI typecheck and coverage CI commands required by the compatibility contract.
- Treat all pre-existing dirty desktop/settings/renderer changes as earlier-task state; Task 18 edits and staging must remain narrowly attributable.

## Learnings

- Projection immutability belongs to the journal, not derived projection tables: `review_dispositions` must remain clearable so a journal replay can rebuild it.
- A recovery event consumes the exact next attempt activity sequence so the appended interruption evidence remains ordered and replayable.
- Fresh Task 18 verification passes 140 desktop tests with 97.62% function and 96.34% line coverage; the relocated Cockpit compatibility run passes 3,045 tests with 5 credentialed skips, headless self-check, and native build.

## Files / Surfaces

- Persistence: `eventJournal.ts`, `eventJournal.test.ts`, `migrations.ts`, and `projectionRebuilder.ts`.
- Host/RPC: `recovery.ts`, `reviewDisposition.ts`, `desktopCoordinator.ts`, `lifecycleDiagnostics.ts`, `desktopRpc.ts`, `electrobunWindow.ts`, `main.ts`, renderer client/bootstrap, and shared RPC contracts.
- Acceptance: recovery/review unit and integration tests, desktop smoke, desktop layered package scripts, root Cockpit compatibility script, and CI gates.

## Errors / Corrections

- The first Cockpit verification exposed that replacing the exact legacy TUI CI commands broke `ciWorkflow.test.ts`; restored those commands and added Task 18 gates alongside them. The focused CI contract and full compatibility rerun then passed.
- Removed attempted update/delete guards from the review projection table after self-review identified that they would block `rebuildProjections`.

## Ready for Next Run

- Task 18 implementation, self-review, tracking, and fresh verification are complete. The narrow local implementation commit is `7a89dfa0d62edd6f4f5e0bba746a3db671d4ac36`; unrelated earlier-task changes remain unstaged.
