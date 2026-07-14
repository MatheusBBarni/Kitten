# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the pure statusline contract, strict shared normalizer/parser, context mapping, deterministic renderer, presets, and direct coverage required by task_01.

## Important Decisions

- Keep the implementation isolated to new core files because `src/core/types.ts` already has unrelated user changes and the TechSpec makes the TypeScript statusline model authoritative in `src/core/statusline.ts`.
- Proposal replies accept exactly the PRD-documented outer `statusline` object; persisted layout normalization operates on its inner `separator` and `line` pair.
- Rendered segments carry `separatorBefore`, and `statuslineText` joins them, so preview/footer consumers cannot independently reinterpret separator omission.

## Learnings

- RTK exports both `NO_COLOR` and `FORCE_COLOR`; warning-free repository verification uses `rtk env -u NO_COLOR ...`.
- Runtime context values need the same terminal-control fail-closed treatment as separators, while zero-width joiners must remain allowed inside printable emoji graphemes.

## Files / Surfaces

- Added `src/core/statusline.ts` and `src/core/statusline.test.ts`; no existing source file was modified.

## Errors / Corrections

- Pre-change baseline: `src/core/statusline.ts` is absent; the task is not yet implemented.
- The initial fence matcher spanned multiple blocks and classified them as malformed JSON; tightened it to reject embedded fences at the sole-block contract boundary.
- A blanket Unicode-format rejection broke joined emoji graphemes; narrowed value hardening to terminal/line/bidi controls while preserving zero-width joiners inside printable emoji.

## Ready for Next Run

- Core layout/parser/renderer contract is implemented and ready for config, store, flow, and UI consumers.
- Focused coverage: 100% functions and 97.66% lines. Full gate: 1,805 pass, 0 fail, 3 expected credentialed skips; self-check and build pass.
