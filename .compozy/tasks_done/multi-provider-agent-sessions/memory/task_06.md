# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Re-address the curated hand-off from "the not-focused agent" to a developer-chosen target session, across an N-session fleet.
- Curation, redaction, `composeHandoffBlocks`, and bundle assembly stay byte-for-byte unchanged (moat), guarded by a characterization test.

## Important Decisions
- **Hybrid targeting (not always-picker).** `begin` counts ready recipients (ready && != source):
  - 0 recipients -> `begin` returns false (fewer than two ready sessions).
  - exactly 1 recipient -> skip picker, assemble + open preview directly (keeps the two-agent hand-off ONE keystroke, the product's defining property in CLAUDE.md; preserves every existing 2-session handoff test).
  - >= 2 recipients (N>2 ready total) -> open the target picker; developer chooses; `chooseTarget` assembles + opens preview.
  This matches the shared-memory handoff note ("a picker only replaces 'the other agent' when N>2") and the task requirement ("MUST NOT open a picker when fewer than two ready sessions exist").
- Preview overlay already carried `sourceSessionId`/`targetSessionId` (landed in task_01), so subtask 6.1 is verify-only, locked by characterization test.
- `recorder.handoffInvoked()` fires once in `begin` when it proceeds (either path), so telemetry ordering (handoff_invoked -> handoff_sent) is unchanged for the 2-session telemetry integration test.
- Target picker reuses `matchSessionsCommand`/`SESSIONS_KEYMAP` navigation (up/down/enter=choose/esc; ignores `n`) and the lifted `SessionCard` from SessionsOverlay; candidates = `selectSessionList` filtered to ready && != source.

## Learnings
- All existing handoff tests use exactly 2 ready sessions -> hybrid keeps them green (single-recipient direct-preview path).
- `createFakeController` accepts a `store`; 3-session tests build `createAppStore({ seeds: FLEET })` + matching `runtimes` (see SessionsOverlay.test.tsx `fleetController`).

## Files / Surfaces
- src/store/appStore.ts - `HandoffTargetOverlay` slot + open/close.
- src/store/selectors.ts - `selectHandoffTarget`, fold into `selectHasOpenOverlay`.
- src/app/handoff.ts - `chooseTarget`, hybrid `begin`, `cancel` closes both overlays.
- src/ui/SessionsOverlay.tsx - export `SessionCard` for reuse.
- src/ui/HandoffTargetPicker.tsx (new) - picker component.
- src/ui/CockpitApp.tsx - mount picker.
- src/ui/keymap.ts - `HANDOFF_TARGET_HINT`.

## Errors / Corrections
- Fake `sendPrompt` records the call but does NOT echo a user turn into the store (the real controller does). A fake-controller hand-back test must apply the delivered turn to the target manually, or `begin` from the target sees 0 turns and never opens.

## Ready for Next Run
- task_06 complete + verified (typecheck clean; 550 pass/0 fail; SELF-CHECK OK; coverage 97.53% funcs / 98.99% lines, handoff.ts 100/100). Committed.
- New overlay slot `overlays.handoffTarget: { sourceSessionId } | null` exists and is folded into `selectHasOpenOverlay`; any new overlay-aware code must account for it.
- `HandoffFlow` gained `chooseTarget(targetSessionId)`; `begin` no longer uses `nextSessionId`. `recorder.handoffInvoked()` still fires once in `begin` (order handoff_invoked -> handoff_sent unchanged) - relevant to task_09 telemetry.
