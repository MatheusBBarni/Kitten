# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a local-only copy interaction for the sole config-backed install command, including accessible status and manual-selection fallback behavior.

## Important Decisions

- Keep the displayed command as the runtime source so the script copies the exact config-rendered text without duplicating or rewriting it.
- Use a native `button` for Enter/Space activation, keep the command keyboard-focusable, and move focus to the selected command only on fallback.
- Model outcomes as `copied`, `selected`, `invalid`, or `failed`; both unavailable and rejected Clipboard API calls use the same controlled selection fallback.

## Learnings

- Astro 7 processes a local TypeScript file referenced by a component `<script src>` tag as a bundled module, so no framework island or new dependency is needed.
- The focused copy-script suite reaches 100% function coverage and 98.90% line coverage; the complete site suite reaches 100% function coverage and 99.63% line coverage.

## Files / Surfaces

- `site/src/scripts/copy-command.ts`
- `site/src/scripts/copy-command.test.ts`
- `site/src/components/Install.astro`
- `site/test/landing-page.test.ts`

## Errors / Corrections

- ADR-004 supersedes the earlier PRD/ADR-001 aggregate-event intent for V1; this interaction must emit no telemetry.
- The in-app browser backend was unavailable, so keyboard/runtime confidence comes from the native-button rendered contract plus automated success and browser-default fallback binding tests rather than a manual live-browser smoke.

## Ready for Next Run

- Task 04 implementation and automated validation are complete. Task 06 can style the focusable command, copy button, and live status hooks without changing their behavior contract.
- Local implementation commit: `7372ce2` (`feat: add showcase layout and accessible install copy flow`).
