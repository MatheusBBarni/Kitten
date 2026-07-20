# TechSpec: Statusline Item Colors

## Executive Summary

Implement per-item foreground colors by extending Kitten's existing pure
statusline model, not by adding a separate theme or rendering path. The core
normalizer will accept known CSS names and opaque `#RRGGBB`, produce canonical
uppercase hex, and carry an optional color from an item through persisted
configuration, agent proposals, preview, and the active footer. Legacy simple
items remain valid and uncolored items retain the active theme's normal text.

The primary trade-off is a small maintained CSS-name table and broader
statusline test coverage in exchange for one deterministic acceptance boundary.
That boundary prevents invalid or renderer-specific color values from reaching
the preview, persisted configuration, watcher reload, or active footer.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary and data flow |
| --- | --- | --- |
| `src/core/statusline.ts` | Defines item, layout, canonical color, and segment contracts; normalizes unknown input; renders width-bounded segments. | Owns all accepted layout/color semantics. Produces UI-agnostic segments. |
| `src/config/configLoader.ts` and `src/config/configWriter.ts` | Validates, loads, merges, and atomically persists the user statusline preference. | Reuses the core normalizer; only canonical layouts enter resolved config or disk. |
| `src/app/statuslineFlow.ts` | Gives the selected agent the product-owned proposal grammar and turns its response into a validated layout. | Sends field identifiers and colors only; never resolves runtime values or accepts executable content. |
| `src/index.ts` | Applies explicit acknowledgement/confirmation writes and watcher reloads. | Persists before updating store state; reload projects a resolved preference without write-back. |
| `src/ui/statuslineSegments.tsx` | Renders shared statusline segments with field and separator foreground policy. | Consumes core segments and theme colors; contains no layout validation. |
| `src/ui/StatusStrip.tsx` and `src/ui/StatuslineOverlay.tsx` | Supply current session context and width budget to the shared renderer. | Must render identical segment semantics in active footer and preview. |

Data flow:

1. Saved JSON or an agent proposal enters `normalizeStatuslineLayout`.
2. The normalizer returns a layout whose explicit colors are canonical or a
   closed invalid result.
3. Confirmation persists that layout; later boot and watcher reloads validate
   the same representation.
4. Core rendering produces text, optional field color, and explicit separator
   data within the existing width budget.
5. The shared UI helper renders field text with explicit color or theme text
   and renders separators with theme-muted foreground.

## Implementation Design

### Core Interfaces

Kitten is a TypeScript codebase, so the primary core contract uses the
repository-native TypeScript interface rather than an inapplicable Go type.

```ts
export type StatuslineColor = `#${string}`
export type StatuslineItem =
  | StatuslineSimpleKind
  | { readonly kind: StatuslineSimpleKind; readonly color: StatuslineColor }
  | { readonly kind: "ELLIPSIS_BRANCH"; readonly maxChars: number; readonly color?: StatuslineColor }

export interface StatuslineSegment {
  readonly kind: StatuslineItemKind
  readonly text: string
  readonly color?: StatuslineColor
  readonly separatorBefore: string
}
```

`StatuslineColor` is a canonical runtime value, not a compile-time validator.
Only the core normalizer may create it from untrusted data. Simple legacy
strings remain valid. A structured simple field must have exactly `kind` and
`color`; a structured `ELLIPSIS_BRANCH` may have `kind`, `maxChars`, and
optional `color` only.

The shared presentation helper accepts `readonly StatuslineSegment[]`,
`palette.text`, and `palette.muted`. It emits a field span for each segment and
a separator span only when `separatorBefore` is non-empty. It must not compute
widths, reinterpret colors, or concatenate terminal control sequences.

### Data Models

| Model | Shape | Invariants |
| --- | --- | --- |
| Legacy simple item | `"FOLDER"` | Remains valid and has no explicit color. |
| Structured simple item | `{ kind, color }` | `kind` is a supported simple field; `color` is canonical uppercase `#RRGGBB`. |
| Structured ellipsis item | `{ kind: "ELLIPSIS_BRANCH", maxChars, color? }` | Existing 4–80 grapheme rule remains; optional color is canonical when present. |
| `StatuslineLayout` | `{ separator, line }` | Separator, duplicate-kind, printable, and one-line rules are unchanged. |
| `StatuslineSegment` | `{ kind, text, color?, separatorBefore }` | Color applies only to `text`; separators remain presentation-owned and muted. |
| Persisted statusline delta | disclosure plus paired `separator` and `line` | Writes preserve unrelated user settings and contain only canonical layouts. |

The core holds a static, maintained map of accepted CSS names to uppercase
six-digit RGB values. It accepts only exact opaque `#RRGGBB` hex and known
names. It rejects unknown names, malformed/short/long hex, alpha/RGBA,
`transparent`, control characters, ANSI escapes, arrays, and extra keys.

### API Endpoints

Not applicable. This feature adds no network, HTTP, MCP, or external-service
API. The existing internal statusline proposal grammar is the only relevant
input contract and remains a single fenced JSON response.

## Integration Points

| Integration point | Change | Failure handling |
| --- | --- | --- |
| Proposal instruction and parser | Teach the product-owned grammar about colored structured items and validate with the core normalizer. | Invalid or extra proposal content returns the existing invalid-response path. |
| User config loader and writer | Accept and round-trip canonical colors in the paired statusline delta. | Invalid file content remains a hard configuration error; writes remain atomic and preserve unrelated settings. |
| Confirmation and watcher lifecycle | Confirmed layouts persist before store application; reload receives resolved canonical layout. | Failed persistence leaves active state unchanged; watcher reload does not write back. |
| Active footer | Render width-bounded core segments with the shared helper. | Missing field values remain omitted; legacy `layout: null` keeps its existing footer unchanged. |
| Preview and config diff | Render the same segments and show canonical layout values. | Cancel and recovery paths keep existing no-write semantics. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/statusline.ts` | modified | Extends closed item and segment contracts; risk is weakening strict validation or legacy compatibility. | Add canonical color normalizer, structured-item forms, color-carrying segments, and focused tests. |
| `src/core/statusline.test.ts` | modified | Core contract expands across accepted and rejected values. | Cover names, hex, canonicalization, invalid values, duplicates, widths, and legacy layouts. |
| `src/config/configLoader.ts` | modified | Persisted schema must retain strict paired-layout behavior. | Reuse normalizer and assert canonical load/reload behavior. |
| `src/config/configWriter.ts` and config tests | modified | User settings must persist a canonical nested layout without unrelated loss. | Add atomic round-trip and malformed/symlink regression coverage. |
| `src/app/statuslineFlow.ts` and tests | modified | Agent grammar must precisely describe color forms. | Update instruction and fenced-proposal acceptance/rejection cases. |
| `src/ui/statuslineSegments.tsx` | new | Shared presentation avoids preview/footer color drift. | Render field and separator spans without owning validation or width logic. |
| `src/ui/StatusStrip.tsx` and tests | modified | Active footer moves from flattened text to segment rendering. | Preserve width, shell hint, null-layout, and no-overflow behavior. |
| `src/ui/StatuslineOverlay.tsx` and tests | modified | Preview must match active footer and canonical config diff. | Use shared helper and verify preview/save/cancel/recovery behavior. |
| `src/index.ts` and integration tests | modified | Confirmation and watcher reload carry expanded layouts. | Verify persist-before-apply, reload, and no-write-before-confirm contracts. |

## Testing Approach

### Unit Tests

- Core normalization accepts known names and exact opaque hex, canonicalizes
  deterministically, and rejects unknown names, malformed hex, alpha,
  transparency, control content, ANSI, arrays, and extra item keys.
- Legacy simple strings, existing `ELLIPSIS_BRANCH` values, duplicate-kind
  detection, separator constraints, unavailable-field omission, grapheme
  ellipsis, width truncation, and `statuslineText()` remain unchanged.
- Structured simple and ellipsis items carry their optional canonical color to
  `StatuslineSegment` without changing text or width behavior.
- Configuration tests cover strict loading, writer round trip, merge behavior,
  atomic persistence, and watcher-resolved canonical layouts.
- Proposal-flow tests cover the exact colored grammar, one-fenced-block rule,
  invalid responses, and no resolved session values in agent input.

### Integration Tests

- Mounted preview and active footer render the same explicit field colors,
  theme text for uncolored fields, and muted separators.
- 64- and 80-column resize cases remain one line with no overflow; shell hint,
  legacy null layout, and missing session values retain existing behavior.
- The exact preview diff contains canonical colors. Save persists and activates
  only after confirmation; Cancel, invalid proposal, and failed persistence do
  not modify the active layout.
- Boot seeding and external config watcher reload expose the same canonical
  colors without creating a write-back loop.
- After focused coverage, run `bun run typecheck && bun test && bun run
  selfcheck && bun run build` as the required full regression gate.

## Development Sequencing

### Build Order

1. Extend `src/core/statusline.ts` with canonical color input, structured item
   forms, and color-bearing segments; no dependencies.
2. Extend core unit coverage for valid, invalid, legacy, and width behavior;
   depends on step 1.
3. Extend config loader/writer, proposal grammar, and their focused tests to
   reuse the normalized layout; depends on steps 1 and 2.
4. Add the shared `src/ui/statuslineSegments.tsx` presentation helper and its
   focused tests; depends on step 1.
5. Replace flattened custom statusline rendering in footer and preview with the
   shared helper, retaining existing budgets and config diff; depends on steps
   3 and 4.
6. Extend controller/boot/watcher and mounted integration coverage for
   confirmation, reload, cancellation, and constrained width; depends on steps
   3 and 5.
7. Run focused suites, then the full typecheck, test, self-check, and build
   gate; depends on steps 2, 3, 4, 5, and 6.

### Technical Dependencies

- Existing TypeScript, Bun, OpenTUI, React, Zod, config writer, statusline
  flow, and test-renderer seams are sufficient; add no dependency.
- The maintained CSS-name table is a source-controlled core constant, not an
  external service or runtime parser.
- No migration, feature flag, database, endpoint, remote telemetry, or
  infrastructure change is required.

## Monitoring and Observability

No new telemetry, remote logging, or alert is introduced. Existing opt-in,
content-free telemetry remains unchanged. Release confidence comes from the
layered automated checks and the PRD's voluntary 60-day feedback review. The
feature must not log raw color proposals, user prompts, config paths, or
session-derived field values.

## Technical Considerations

### Key Decisions

| Decision | Rationale | Trade-off | Rejected alternative |
| --- | --- | --- | --- |
| Item-local optional color | Keeps the preference with the field across order, proposal, persistence, and rendering. | Extends the closed item union. | Separate color map. |
| Pure-core canonicalization | Gives config and agent proposals one deterministic fail-closed acceptance boundary. | Maintains a static CSS-name table. | UI-library parsing or loose raw strings. |
| Shared segment presentation | Keeps preview and active footer visually identical while preserving core text/width behavior. | Adds one small UI helper. | Separate UI lookups or terminal control strings. |
| Existing confirmation lifecycle | Preserves preview-before-save, atomic persistence, and watcher reload semantics. | Requires cross-layer regression coverage. | Immediate or UI-only application. |

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A permissive parser accepts an unsupported color form | Medium | Keep a closed name table and exact opaque hex rule in the sole core normalizer. |
| Preview and active footer diverge | Medium | Use the same segment contract and shared presentation helper; cover both mounted surfaces. |
| Legacy layouts or constrained terminals regress | Medium | Preserve simple strings and existing width algorithms; test null layouts, missing values, and 64/80 columns. |
| Persisted config and proposal grammar drift | Low | Route both through the same normalizer and assert canonical round trips. |
| Explicit colors reduce readability after an environment change | Medium | Preserve uncolored theme defaults, show current preview, and avoid unsupported automatic contrast behavior. |

## Architecture Decision Records

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md)
  — sets the product boundary: canonical foreground-only colors and no general
  theming system.
- [ADR-002: Position statusline colors as a personal scanability experiment](adrs/adr-002.md)
  — defines the solo-user hypothesis and voluntary-feedback expansion gate.
- [ADR-003: Carry canonical colors through the pure statusline model](adrs/adr-003.md)
  — selects item-local core normalization, shared color-bearing segments, and
  fail-closed reuse across proposal, persistence, and rendering.
