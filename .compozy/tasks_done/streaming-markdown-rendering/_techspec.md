# TechSpec: Elevated Markdown - The Trustworthy Hand-off Review Console

## Executive Summary

This spec elevates Markdown rendering by adding one owned rendering seam and pointing the product's second-most-important surface, the hand-off summary, through it.
A new shared `<Markdown>` leaf (`src/ui/Markdown.tsx`) mirrors the existing `ToolCallDiffBody` pattern: it owns `useSyntaxStyle()`/`usePalette()`, hard-pins `streaming` on (the OpenTUI 0.4.3 requirement), and is consumed by thin per-surface wrappers.
Registering the `markup.*` scopes in `theme.ts` lights up headings, emphasis, lists, quotes, and links everywhere Markdown already renders, at zero call-site cost.
The hand-off preview lifts its summary into React state so a read-mode rendered view and an edit-mode textarea share one source of truth without dropping edits, provenance is delivered through the already-structured referenced-files list rather than fragile inline links, and the compiled-binary highlighting bug (#807) is fixed by embedding the tree-sitter worker and assets and resolving them via `workerPath` at startup, guarded by a color-asserting self-check.

The primary technical trade-off is that Kitten stays on pre-1.0 OpenTUI and works within its limits - streaming permanently pinned, no strikethrough attribute, no task-list checkboxes or footnotes, worker-only parsing - rather than forking to gain full control.
In exchange the change stays small, contained behind one owned seam, and reversible, and it concentrates effort on the wedge surface instead of a rendering-engine rewrite.

## System Architecture

### Component Overview

- **`Markdown` (new, `src/ui/Markdown.tsx`)** - the single shared leaf. Calls `useSyntaxStyle()` and `usePalette()` in its own body, renders `<markdown content syntaxStyle streaming fg conceal>` with `streaming` fixed to `MARKDOWN_STREAMING`. The one place OpenTUI's Markdown API is named.
- **`theme.ts` (modified)** - `syntaxThemeFor` gains the `markup.*` entries; the per-mode `SyntaxStyle` cache and `theme_mode` reactivity are unchanged.
- **`MessageView` (modified)** - its `<markdown>` call site is replaced by `<Markdown>`; both user and agent turns route through it. No behavioral change beyond styling.
- **`HandoffPreview` (modified)** - the summary is lifted into React state (`summaryDraft`, seeded from `bundle.summary`). Read mode renders `<Markdown>`; edit mode renders the `<textarea>` bound to the same state; `send()` reads the state. The referenced-files rows gain a provenance affordance.
- **`scripts/build.ts` + app bootstrap (modified)** - `compileCommand()` embeds the worker and its assets; startup extracts them once and sets the OpenTUI `workerPath`/env seam before the renderer is created.
- **`selfCheck` + `build.integration.test.ts` (modified)** - the self-check renders known Markdown/diff content and asserts a highlighted span; the integration test runs it against the compiled binary.

**Data flow:** `HandoffBundle` (store) renders through `HandoffPreview`, which seeds `summaryDraft` from `bundle.summary`.
Read mode renders `<Markdown>` and edit mode renders the `<textarea>`, both bound to `summaryDraft`; `send()` reads `summaryDraft` and calls `flow.confirm`.
Terminal `theme_mode` events flow through `useSyntaxStyle`/`usePalette`, so `<Markdown>` recolors live on a dark/light flip.

## Implementation Design

### Core Interfaces

The shared leaf is the primary type other components depend on:

```ts
// src/ui/Markdown.tsx - the single shared Markdown renderer.
export interface MarkdownProps {
  /** Markdown source. Rendered with streaming permanently on (0.4.3 pin). */
  content: string
  /** Foreground for non-highlighted text. Defaults to the reading color. */
  fg?: string
}

export function Markdown({ content, fg }: MarkdownProps): ReactNode {
  const palette = usePalette()
  const syntaxStyle = useSyntaxStyle()
  return (
    <markdown content={content} syntaxStyle={syntaxStyle} streaming={MARKDOWN_STREAMING} conceal fg={fg ?? palette.text} />
  )
}
```

The theme gains `markup.*` entries (theme-aware, appended in `syntaxThemeFor`):

```ts
{ scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3",
          "markup.heading.4", "markup.heading.5", "markup.heading.6"],
  style: { foreground: palette.accent, bold: true } },
{ scope: ["markup.strong"], style: { foreground: palette.text, bold: true } },
{ scope: ["markup.italic"], style: { foreground: palette.text, italic: true } },
{ scope: ["markup.raw", "markup.raw.block"], style: { foreground: dark ? "#CE9178" : "#8A3B12" } },
{ scope: ["markup.quote"], style: { foreground: palette.muted, italic: true } },
{ scope: ["markup.list", "markup.list.checked", "markup.list.unchecked"], style: { foreground: palette.accent } },
{ scope: ["markup.link", "markup.link.label"], style: { foreground: palette.status.idle, underline: true } },
{ scope: ["markup.link.url"], style: { foreground: palette.muted } },
{ scope: ["markup.strikethrough"], style: { foreground: palette.muted, dim: true } }, // no strike attribute exists
```

The preview's summary state (one source of truth for read, edit, and send):

```ts
const [summaryDraft, setSummaryDraft] = useState(bundle.summary)
// read:  <Markdown content={summaryDraft} fg={palette.muted} />
// edit:  <textarea initialValue={summaryDraft} onInput={(v) => setSummaryDraft(v)} focused />
// send:  flow.confirm({ summary: summaryDraft, excludedFiles, excludedDiffs })
```

### Data Models

No schema or persisted-data changes.
The existing `HandoffBundle` (`summary`, `files: {path, reason}[]`, `pendingDiffs`, `redactionCount`) is reused as-is; provenance is derived from `bundle.files`.
The only new runtime state is the local `summaryDraft` and the on-disk extraction cache for the tree-sitter worker and assets in the compiled binary.
An optional new telemetry event (`preview_abandoned`) is flagged in Open Questions.

### API Endpoints

Not applicable - Kitten is a terminal application with no network API surface. Component contracts are covered under Core Interfaces.

## Integration Points

- **OpenTUI `MarkdownRenderable` (dependency, `@opentui/core` 0.4.3, pinned):** consumed only through `<Markdown>`; `syntaxStyle` required, `streaming` pinned on. Malformed Markdown must render legibly, verified by a degradation test.
- **Tree-sitter worker (bundled asset):** in the compiled binary, resolved via `workerPath` (or `OTUI_TREE_SITTER_WORKER_PATH`) pointing at an idempotently extracted cache dir, set before the renderer is created. Worker-construction failure degrades highlighting silently, so it must be caught by the self-check, not shipped.
- **Terminal OSC 8 (native, capability-gated):** file-row provenance links are emitted natively when `caps.hyperlinks` is set; Kitten performs no escape emission. Fallback is plain readable path text.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/ui/Markdown.tsx` | new | The shared leaf; low risk, small surface | Create, mirroring `ToolCallDiffBody` |
| `src/ui/theme.ts` | modified | Add `markup.*` scopes; low risk, additive | Extend `syntaxThemeFor`; add scope test |
| `src/ui/MessageView.tsx` | modified | Route through `<Markdown>`; low risk | Replace `<markdown>` call site |
| `src/ui/HandoffPreview.tsx` | modified | Lift summary to state; medium risk (send path must keep edits) | State refactor + read/edit swap + provenance rows |
| `scripts/build.ts` | modified | Embed worker/assets; high risk (recipe unproven) | Worker-embed + define/env; validate empirically |
| `src/app/selfCheck.ts` | modified | Assert highlighted span; medium risk | Strengthen to emit/assert span color |
| `test/build.integration.test.ts` | modified | Golden-frame highlight check on the binary | Extend to assert a highlighted span |

## Testing Approach

### Unit Tests

- **`theme.test.tsx`:** assert `markup.*` scopes are registered in both modes (`getStyle("markup.heading.1")` defined, `markup.strong` bold, `markup.italic` italic, `markup.link.url` present).
- **`Markdown.test.tsx`:** render a doc with heading/bold/list/quote/link/fenced-code; assert via `captureSpans` that structure spans carry the expected `fg`/attributes (bold via `attributes & 1`); assert multi-block content does not blank (streaming pin); assert `getSelectedText()` copies words only.
- **`HandoffPreview.test.tsx`:** read mode shows the rendered summary; editing updates the draft and `send()` carries the edited draft (not `bundle.summary`); the redaction notice stays visible in read mode; the files rows show the provenance affordance with a plain-text fallback; the `editing`/Escape key routing is preserved.

### Integration Tests

- **`ConversationView.test.tsx`:** the existing streaming/no-flicker test must still pass after the `<Markdown>` extraction (guards the shared leaf against regression).
- **`build.integration.test.ts`:** compile the binary, run the strengthened self-check that renders Markdown plus a diff containing a known token, and assert a highlighted (non-default `fg`) span - the regression gate for #807. Requires the self-check to expose span data.

## Development Sequencing

### Build Order

1. **`markup.*` theme scopes + unit test** - no dependencies. Immediately elevates the existing transcript.
2. **Shared `<Markdown>` leaf + `MessageView` migration + tests** - depends on step 1 (consumes the elevated theme; the transcript is the visible result).
3. **#807 worker embedding + startup extraction/`workerPath` wiring + strengthened self-check + build integration test** - depends on none of the UI steps (independent build-path fix); sequenced here to complete Phase 1 and to assert highlighting against the elevated theme; may proceed in parallel with steps 1-2.
4. **Hand-off summary: lift draft to state, read-mode `<Markdown>` + edit `<textarea>`, preserve send/redaction/key-routing, tests** - depends on steps 1 and 2 (needs the shared leaf and elevated theme).
5. **Provenance on the referenced-files rows: OSC 8 `file://` links with plain-text fallback, tests** - depends on step 4 (the console layout it extends).
6. **Polish: robust table options (`columnFitter`/`wrapMode`), graceful degradation on malformed/unsupported Markdown, extend clean-copy to tables/code, tests** - depends on step 2 (the shared leaf).

Steps 1-3 deliver PRD Phase 1 (Foundation); steps 4-5 deliver Phase 2 (Console); step 6 delivers Phase 3 (Polish).

### Technical Dependencies

- `@opentui/core`/`@opentui/react` 0.4.3 (pinned); the tree-sitter worker and language assets must be resolvable from the installed package for embedding.
- Empirical validation of the worker-embedding recipe (which assets, how embedded and located) during step 3.
- No external services or infrastructure.

## Monitoring and Observability

- **Reuse the existing opt-in, content-free telemetry recorder.** Continuous supporting signals: `reexplanation_detected` should fall and `bundle_edit_chars` should steady as the rendered summary earns trust; `handoff_sent`/`handoff_invoked` completion should hold or rise.
- **Optional new event `preview_abandoned`** (preview opened, then Escaped without sending) as a trust proxy - flagged in Open Questions.
- **The primary success measure (comprehension study) is offline**, not telemetry-derived.
- **CI quality gates:** the #807 golden-frame self-check (highlight parity), the `markup.*` scope test, and the streaming no-flicker test.

## Technical Considerations

### Key Decisions

- **Shared `<Markdown>` leaf mirroring ToolCallDiff (ADR-003).** Rationale: one enforcement point for the streaming pin and theme reactivity, and no drift between the transcript and the summary. Trade-off: a new component plus wrappers. Rejected: a single flexible component (streaming/style discipline leaks to call sites) and theme-only with a bespoke summary renderer (two divergent paths).
- **#807 fixed by embedding worker+assets and resolving via `workerPath` at startup (ADR-004).** Rationale: keeps the single-binary distribution and fixes the silent highlighting loss. Trade-off: net-new extraction and wiring plus a cache dir. Rejected: assets beside the binary (breaks single-file install) and doing nothing.
- **Provenance via the structured files list (ADR-005).** Rationale: first-class, stable provenance from existing data with no fragile substring matching. Trade-off: provenance sits beside the prose, not inline. Rejected: heuristic inline links and deferring provenance.
- **Summary draft lifted to React state.** Rationale: one source of truth so read/edit/send never drop edits. Trade-off: a small state refactor of `HandoffPreview`. Rejected: a hidden mounted textarea (two overlapping widgets) and commit-on-leave-edit (an unsaved-on-send edge).

### Known Risks

- **The #807 embedding recipe is unproven** (medium likelihood). Mitigation: spike within step 3, gate acceptance on the color-asserting self-check against the compiled binary.
- **Pre-1.0 OpenTUI limits** (streaming pinned, no strikethrough attribute, dropped checkboxes, no footnotes). Mitigation: scope to what the engine renders; degrade gracefully; revisit each `@opentui` bump alongside the streaming pin.
- **Provenance clickability depends on terminal OSC 8 and `file://` handling.** Mitigation: plain-text path fallback where unsupported.
- **`HandoffPreview` send-path regression** (dropping edits). Mitigation: the state lift plus an explicit test that `send()` carries the edited draft.

## Architecture Decision Records

- [ADR-001: V1 Scope - Elevate Markdown as Trustworthy Instrumentation for the Hand-off, Behind an Owned Seam](adrs/adr-001.md) - one owned seam, cheap theme everywhere, preview as center of gravity.
- [ADR-002: PRD Product Approach - Preview-Deep, Concentrate V1 on the Hand-off Review Console](adrs/adr-002.md) - minimal ambient, deep preview console, graded by a comprehension study.
- [ADR-003: Shared `<Markdown>` Renderer - One Owned Leaf Mirroring ToolCallDiff, With `markup.*` Theme Registration](adrs/adr-003.md) - a shared leaf plus theme registration, no drift, streaming pin enforced centrally.
- [ADR-004: #807 - Embed the Tree-sitter Worker and Assets in the Compiled Binary, Resolve via `workerPath` at Startup](adrs/adr-004.md) - keep the single binary, fix silent highlighting loss, guard with a color-asserting self-check.
- [ADR-005: Provenance via the Structured Referenced-Files List, Not Inline Prose Links](adrs/adr-005.md) - first-class provenance from existing structured data, no fragile matching.
