# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Bring the existing `SlashMenu` implementation into the task_06 TechSpec contract, including cockpit shortcuts, flattened highlighting, exact-row activation, an absolute prompt-anchored layout, and render coverage.

## Important Decisions

- Preserve `PromptEditor` as the behavior owner; `SlashMenu` stays a stateless leaf and uses `onMouseDown` only to expose its supplied `onSelect(row)` activation callback.
- Use the TechSpec row discriminants and fields exactly: `source: "cockpit"` with `label`/`shortcut`, or `source: "agent"` with `label`/optional `hint`.

## Learnings

- The repository already contained a tracked `SlashMenu`, but it used a stale `"kitten"`/`name`/`description` contract, omitted shortcut rendering and absolute positioning, and discarded `onSelect`.
- Current OpenTUI React rows expose pointer activation with `onMouseDown`; the test renderer provides `mockMouse.click(x, y)` for real event-path coverage.
- Isolated coordinate hit-testing did not target the absolutely positioned row reliably; the activation test drives the highlighted OpenTUI renderable's public `processMouseEvent` seam instead.

## Files / Surfaces

- `src/ui/SlashMenu.tsx`
- `src/ui/SlashMenu.test.tsx`
- `src/ui/PromptEditor.tsx` (dependent mapping required to consume the corrected row contract)

## Errors / Corrections

- The first focused run proved the stale implementation rendered `/undefined`, omitted cockpit shortcuts, and never called `onSelect`; the production row contract and activation path were corrected.
- Enabling test-renderer mouse input did not resolve absolute hit-grid targeting, so the test was changed only after confirming the production handler contract and now dispatches a real `MouseEvent` to the rendered highlighted row.

## Ready for Next Run

- Task implementation and self-review are complete.
- Focused evidence: `SlashMenu.test.tsx` 4/4, `PromptEditor.test.tsx` 18/18, and `SlashMenu.tsx` 100% function/line coverage.
- Final gate: typecheck passed; full suite 1293 pass, 1 intentional ACP probe skip, 0 fail; self-check printed `SELF-CHECK OK`; compiled build wrote `dist/kitten-darwin-arm64` and `dist/SHA256SUMS`.
- Local source commit: `20e7469 feat: complete SlashMenu presentation contract` (not pushed); workflow-memory and task-tracking files remain intentionally uncommitted.
