# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the ready conversation's zero-turn hint with the shared welcome banner, derive its variant from config plus first-run state, preserve not-ready/transcript behavior, and cover the state transitions with UI tests.

## Important Decisions

- Resolve `BannerVariant` once in `main()` from the same config and pre-marker first-run value used by the transient boot banner, then thread it through `renderCockpit`/`CockpitApp`; this prevents the first successful run from becoming quiet immediately after its marker is written.
- Let `ConversationView` derive the focused cwd and agent readiness labels from the existing controller context, while `CockpitApp` keeps the not-ready branch ahead of the conversation child.

## Learnings

- The idle banner must receive the pre-marker first-run decision from boot; reading the marker from the mounted view would quiet the first launch immediately because `main()` persists the marker just before mounting.
- Bun's enforced coverage threshold applies per file. After simplifying boot fallback closures, coverage passed with 96.83% functions / 98.40% lines overall and 100% functions/lines for the task's UI surfaces.

## Files / Surfaces

- Touched: `src/index.ts`, `src/ui/main.tsx`, `src/ui/ConversationView.tsx`, `src/ui/CockpitApp.tsx`, their canonical UI/integration tests, and task tracking.

## Errors / Corrections

- Pre-change UI tests confirmed the ready zero-turn state still rendered `EMPTY_TRANSCRIPT_HINT`; the new behavior tests failed on that exact output before production wiring was added.
- The first coverage run executed 781 tests but failed the per-file 80% function threshold because task_05's new boot path left two fallback closures in `src/index.ts` uncovered. Rewriting those fallbacks as direct branches/optional disposal removed artificial function-count debt without suppressing coverage.
- Final commands exit 0, but the repository gate still emits the pre-existing `act(...)`, `theme_mode` listener, and TreeSitter teardown warnings recorded in shared memory. Under `cy-final-verify`, this prevents a PASS verdict, task completion tracking, and the automatic commit.

## Ready for Next Run

- Functional implementation and tests are in place: targeted UI/integration tests pass; full suite reports 782 pass / 0 fail; self-check prints `SELF-CHECK OK`; host build compiles; coverage clears 80%.
- Formal completion remains pending until the repository-wide warning-free gate is restored. Do not mark `task_06.md` completed or commit this task while those warnings remain.
- The worktree also contains pre-existing uncommitted/untracked phase-1 dependency work (`WelcomeBanner`, boot-banner, prompt restyle) and unrelated Compozy files; preserve it and stage only understood task scope once the gate is clean.
