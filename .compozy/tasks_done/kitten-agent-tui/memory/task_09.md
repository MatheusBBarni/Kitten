# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Render the focused agent's transcript: user/agent messages via `<markdown>`, tool-call rows (kind/title/status, in-place updates), and `edit` diffs via `<diff>`. Narrow store subscription (ADR-004), flicker-free streaming, clean copy.

## Important Decisions
- `<markdown>` is mounted with `streaming` permanently true. Spiked and confirmed on @opentui/core 0.4.3: `streaming={false}` at mount paints nothing, and flipping true->false blanks multi-block content. Promoted to shared Open Risks.
- Diff keeps the component-default line-number gutter instead of `showLineNumbers={false}`. Spike showed the gutter (numbers AND the `+`/`-` signs) is non-selectable either way, so copy is clean both ways - but turning it off also drops the `+`/`-` signs, leaving added/removed distinguishable only by background color. Legibility wins.
- Tool-call status colors added to `CockpitPalette.tool` rather than hard-coded, per the repo's no-inline-color rule.
- Both user and agent messages render through `<markdown>`; only the role label and fg color differ. Keeps one copy-clean text path.
- Transcript uses `<scrollbox stickyScroll stickyStart="bottom" horizontalScrollbarOptions={{visible:false}}>`. The hidden hbar is load-bearing, not cosmetic - see shared Open Risks.
- `SyntaxStyle` lives in `theme.ts`, built lazily per theme mode from a palette-derived token theme. Two reasons: `SyntaxStyle.create()` registers no token styles (code would be one flat color), and building one at module scope fires a native allocation on `import "src/index.ts"`, which that module documents as side-effect-free.
- `EMPTY_TRANSCRIPT_HINT` moved from `CockpitApp` to `ConversationView` so the empty-state string has one owner.

## Learnings
- `testRender` exposes no `rerender`. Drive updates by pushing `store.applyEvent(...)` inside `actAsync`, which is also the honest path (exercises the real selector subscription).
- Selected text is read via `createMockMouse(renderer).drag(...)` then `renderer.getSelection()?.getSelectedText()`. A drag that *starts* on a non-selectable cell (box border, diff gutter) yields no selection at all.
- Fenced code blocks inside `<markdown>` need more than the default 20 render passes (async tree-sitter highlight); pass `{ maxPasses: 60 }` to `waitForFrame` or assert on surrounding prose.
- `SyntaxStyle.create()` survives `renderer.destroy()`, so one module-level instance is safe across tests.

## Files / Surfaces
- new: `src/ui/ConversationView.tsx`, `src/ui/MessageView.tsx`, `src/ui/ToolCallRow.tsx`, `src/ui/ConversationView.test.tsx` (+ snapshot)
- changed: `src/ui/theme.ts` (+`tool`/`userMessage` palette, `syntaxStyleFor`/`useSyntaxStyle`), `src/ui/theme.test.tsx`, `src/ui/main.tsx` (mounts the view), `src/ui/CockpitApp.tsx` + `CockpitApp.test.tsx` (hint moved), `test/index.smoke.test.ts` (+ native-allocation-on-import guard)

## Errors / Corrections
- Task requirement says "and agent thoughts", but the domain model has no thought turn and `translateSessionUpdate` drops `agent_thought_chunk` in V1. Rendered nothing for thoughts rather than expanding task_02's types/reducer/translator. Recorded as a follow-up, not silently absorbed.
- First cut used `<scrollbox scrollX={false} stickyStart="bottom">`, which silently ate the transcript's first line. Four tests failed on it and I initially misread them as test bugs; bisecting against plain `<text>` children proved it was the scrollbox, not my components.
- First cut also put `SyntaxStyle.create()` at module scope in `MessageView.tsx`, quietly breaking `src/index.ts`'s no-side-effects-on-import contract. Guard test added and proven to go red on reintroduction.

## Ready for Next Run
- `ConversationView` takes no props and reads focus itself; task_10 just needs a sibling slot under it in `CockpitApp`.
