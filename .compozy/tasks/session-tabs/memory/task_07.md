# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add capability-gated Ctrl+H/Ctrl+L adjacent-tab navigation while preserving modal ownership, legacy input, Sessions/attention fallback, and integrated-shell PTY bytes.

## Important Decisions

- Follow ADR-005 and the TechSpec literally: capability starts `unknown`, renderer-boundary observation alone promotes it to `kittyConfirmed`, and dispatch additionally requires the current event source to be `kitty`.
- Keep matching, dispatch metadata, and conditional help centralized in `src/ui/keymap.ts`; do not add component-local global keyboard listeners.

## Learnings

- Current OpenTUI documents `useKittyKeyboard: { disambiguate: true, alternateKeys: true }` and `KeyEvent.source` as `"raw" | "kitty"`.

## Files / Surfaces

- Renderer bootstrap and observation: `src/index.ts`.
- Ephemeral capability state and selector: `src/store/appStore.ts`, `src/store/selectors.ts`.
- Canonical matching/help plus global precedence and hints: `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx`, `src/ui/StatusStrip.tsx`.
- Unit and integration coverage: store, keymap, cockpit, status-strip, encoder, bootstrap, and runtime test files.

## Errors / Corrections

- Initial focused tests exposed stale `/help` assertions after the fallback hint contract changed; updated those assertions to the canonical unknown-capability hint without weakening production behavior.
- Typecheck caught test callbacks returning the EventEmitter boolean result; changed them to block callbacks that discard the return value.

## Ready for Next Run

- Implementation and self-review are complete. Fresh verification passed: typecheck; 1,194 tests passed with one intentional opt-in skip and zero failures; coverage 96.64% functions and 98.06% lines; self-check; compiled build.
- Keep the capability ephemeral and require both persistent confirmation and the current Kitty event source. The first Kitty event promotes capability but does not navigate; later qualifying events do.
- Workspace has pre-existing tracking edits for tasks 01-06 and untracked workflow-memory files that must be preserved. Commit only task_07 implementation and test files.
