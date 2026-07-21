# Technical Specification: Statusline Context Headroom Field

## Executive Summary

Implement **CONTEXT** as one additional item in Kitten's existing declarative statusline pipeline. The change extends the pure field allowlist and renderer, supplies the existing focused-session headroom to custom footer and preview contexts, and lists the new identifier in the product-owned **/statusline** proposal instruction. The existing configuration persists the literal identifier in the layout; it does not persist a resolved percentage.

The primary trade-off is shared validity hardening versus the smallest possible field-only diff. This specification hardens the existing headroom selector to return **null** for malformed or out-of-range values, then keeps the renderer defensively omission-first. That gives legacy and custom status consumers one honest definition of headroom while changing legacy behavior only for invalid input. No new state, ACP event, configuration key, telemetry event, or context-management subsystem is justified.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| ACP translation and session reducer | Preserve the existing in-memory per-session usage event path | No change; CONTEXT consumes the existing result only. |
| **selectSessionHeadroom** | Convert one session's usage counters to a valid remaining percentage or null | The sole shared validity boundary for live headroom. |
| **src/core/statusline.ts** | Own the closed layout vocabulary, strict proposal parsing, availability omission, and grapheme-budget rendering | Add CONTEXT and its contextHeadroom read-model value; retain no I/O or UI dependencies. |
| **src/app/statuslineFlow.ts** | Tell the agent which field identifiers can be proposed | Add only the identifier; never inject resolved session data. |
| **CustomStatusline** | Render the current focused session's saved layout | Read focused-session headroom and pass it to the canonical context. |
| **StatuslineOverlay** preview | Render a pending layout for its captured target session | Read captured-session headroom and pass it to the same canonical context. |
| Existing config and store paths | Persist and reactively apply a layout | No new shape; store only the CONTEXT identifier in line. |

### Data Flow

1. The existing ACP usage update becomes a per-session in-memory usage value through the current adapter and reducer path.
2. **selectSessionHeadroom(sessionId)** validates that value and returns a rounded integer from 0 through 100, or null.
3. The custom footer reads the selector for the current focused session; the preview reads it for the dialog's captured target session.
4. Both callers provide **contextHeadroom** to the existing StatuslineContext.
5. **renderStatusline** resolves CONTEXT to **ctx <remaining>%** only for a valid value, otherwise omits it and lets the established separator and width rules apply.
6. A confirmed layout persists CONTEXT as a field identifier only; each future render recomputes the current value from session state.

## Implementation Design

### Core Interfaces

The repository is TypeScript, so the primary implementation contract is a TypeScript read model rather than a new service or package.

```ts
export interface StatuslineContext {
  readonly cwd?: string | null
  readonly branch?: string | null
  readonly provider?: string | null
  readonly model?: string | null
  readonly effort?: string | null
  readonly helpText?: string | null
  readonly contextHeadroom?: number | null
}

export type StatuslineSimpleKind =
  | "FOLDER" | "FULL_PATH" | "BRANCH" | "PROVIDER"
  | "MODEL" | "EFFORT" | "HELP_TEXT" | "CONTEXT"
```

CONTEXT remains a simple layout item. Its pure formatting rule is fixed: a valid integer percentage renders as **ctx <percentage>%**; null, non-finite, and out-of-range input render nothing. Valid 0% and 100% remain visible values.

### Data Models

No new persisted entity is introduced.

| Model | Change | Invariant |
| --- | --- | --- |
| Existing session usage | No shape change | Remains in-memory and per-session. |
| **selectSessionHeadroom** result | Tighten to number-or-null for every invalid raw input | Null means unavailable or invalid; a valid result is an integer in [0, 100]. |
| **StatuslineContext** | Add optional contextHeadroom | Read-only rendering input, never persisted. |
| **StatuslineLayout.line** | Accept literal CONTEXT | Layout persists the identifier only, never a rendered percentage or raw counters. |

### API Endpoints

No HTTP or external API endpoint changes are required. The existing agent proposal contract remains a local product instruction and strict fenced-JSON response parser; it adds CONTEXT to the allowed field vocabulary only.

## Integration Points

| Integration | Required behavior | Error and privacy boundary |
| --- | --- | --- |
| Existing ACP usage event path | Consume the existing used and size result without changing translation or event routing | Do not add metadata, cost, raw content, or retries for CONTEXT. |
| Existing statusline proposal flow | Include literal CONTEXT in the instruction and parse it through the existing strict normalizer | Do not include a resolved percentage or raw usage in the instruction. |
| Existing config writer and watcher | Persist and reload layouts through the existing statusline preference path | Persist only the field identifier; no migration or new preference key. |
| Existing preview and footer views | Use the canonical renderer with the caller's documented session ownership | Preview uses captured target; footer uses current focus. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| **src/core/statusline.ts** | modified | Add one field, one context property, and omission-safe formatting; risk is contract drift | Extend allowlist, item resolution, direct parser, renderer, and width tests. |
| **src/store/selectors.ts** | modified | Tighten raw usage validity; risk is changing invalid legacy display to unknown | Return null unless counters and rounded percentage are valid; retain 0% and 100%. |
| **src/app/statuslineFlow.ts** | modified | Expand the agent-visible field vocabulary; risk is leaking runtime data | Add CONTEXT identifier only and assert no resolved values enter the instruction. |
| **src/ui/StatusStrip.tsx** | modified | Supply focused-session headroom to custom layouts; risk is wrong ownership or legacy regression | Use the focused session selector only; retain the null-layout legacy branch. |
| **src/ui/StatuslineOverlay.tsx** | modified | Supply captured-target headroom to preview; risk is preview/runtime mismatch | Use overlay target context and the canonical renderer. |
| Statusline tests | modified | Cover the new cross-layer contract | Add focused unit, view, preview, and legacy-regression cases. |
| Configuration, store, and ACP event shapes | unchanged | Existing generic layout and usage paths already carry required state | Do not add fields, storage, or events. |

### PRD Traceability

| PRD requirement | Technical component(s) |
| --- | --- |
| Selectable CONTEXT field | Pure allowlist, proposal instruction, strict normalizer, and generic persisted layout line. |
| Focused-session headroom cue | Shared selector, custom footer context, and captured-session preview context. |
| Honest absent-data behavior | Selector validity contract plus pure renderer omission behavior. |
| Predictable preview and narrow layout | Shared canonical renderer and existing grapheme-budget rule. |
| Legacy-footer continuity | Existing null-layout branch remains unchanged and receives regression coverage. |
| No new telemetry or resolved-value retention | Reuse current in-memory usage and identifier-only layout persistence. |

## Testing Approach

### Unit Tests

- Extend **src/core/statusline.test.ts** to accept CONTEXT in validation and proposal parsing; render **ctx 38%**; omit the item and adjacent separator for null, NaN, infinity, and out-of-range values; and prove trailing-field removal under a narrow budget.
- Extend selector coverage for missing usage, zero or negative capacity, non-finite counters, negative remaining percentage, above-100 percentage, valid 0%, valid 38%, and valid 100%.
- Extend **src/app/statuslineFlow.test.ts** to prove the instruction names CONTEXT but contains no resolved usage count or percentage, and that a literal CONTEXT proposal parses.

### Integration Tests

- Extend **src/ui/StatusStrip.test.tsx** to render a custom CONTEXT layout for the focused session, update correctly after focus changes between sessions with different usage, omit unknown or invalid values without duplicate separators, drop trailing CONTEXT at narrow width, and retain the exact legacy footer when no custom layout exists.
- Extend **src/ui/StatuslineOverlay.test.tsx** or its owning cockpit integration suite to show **ctx 38%** for a captured target, omit unknown preview values, confirm the saved layout contains literal CONTEXT only, and match preview and saved footer rendering for equivalent session context.
- Run the repository typecheck and full test suite after the focused tests. No new external environment or integration service is required.

## Development Sequencing

### Build Order

1. Harden **selectSessionHeadroom** validity and its direct tests — no dependencies.
2. Extend the pure statusline allowlist, context type, formatter, parser, and renderer tests — depends on step 1's number-or-null validity contract.
3. Add CONTEXT to the proposal instruction and its flow tests — depends on step 2's accepted identifier contract.
4. Supply headroom to captured-target preview context and focused-footer context — depends on steps 1 and 2, and preserves their documented ownership models.
5. Extend cross-layer preview, focus-switch, unavailable-state, narrow-width, persistence, and legacy-footer coverage — depends on steps 1 through 4.
6. Run typecheck and the full test suite — depends on steps 1 through 5.

### Technical Dependencies

- The existing session usage event, reducer, selector, declarative statusline, and configuration paths must remain available; no new dependency, package, service, schema migration, or infrastructure is needed.
- The implementation must land without overlapping or absorbing unrelated active changes in the worktree.

## Monitoring and Observability

V1 introduces no monitoring, telemetry event, logging field, alert, or persisted diagnostic. The feature reuses an in-memory, content-free projection and is evaluated through focused regression coverage plus the PRD's moderated usability scenarios. If later product evidence requires operational measurement, it must be designed as a separate privacy-reviewed initiative.

## Technical Considerations

### Key Decisions

- **Selector-owned validity:** The existing headroom selector becomes the shared validity boundary so every consumer treats malformed usage consistently. The trade-off is a small behavior change for invalid legacy values, which become unknown rather than out-of-range output.
- **Identifier-only persistence:** The generic layout stores CONTEXT, not a resolved percentage. This preserves current-state truthfulness and avoids stale-data retention.
- **Dual but explicit session ownership:** Preview uses its captured overlay target, and the saved footer uses current focus. The trade-off is that a user can see different sessions in the two surfaces while the dialog is open; this matches each surface's existing ownership model.
- **Layered tests:** Direct contract tests isolate validation and formatting, while view and flow tests prove ownership, persistence, preview, and legacy compatibility. This costs more tests than an end-to-end-only approach but localizes regressions.

### Known Risks

- **Malformed provider counters:** Likelihood low, impact misleading user output. The shared selector returns null for non-finite, invalid-capacity, or out-of-range results; the renderer remains defensive.
- **Preview/footer mismatch:** Likelihood medium if contexts diverge. Both surfaces use the same StatuslineContext field and canonical renderer, with explicit owner-specific selector tests.
- **Regression in fixed legacy footer:** Likelihood low, impact high for users without custom layouts. Keep the layout-null branch unchanged and test it explicitly.
- **Scope creep into policy:** Likelihood medium. Do not add freshness labels, thresholds, warnings, handoff actions, new telemetry, or persistence outside the identifier-only layout.

## Architecture Decision Records

- [ADR-001: Keep CONTEXT as a local, optional, field-only headroom indicator](adrs/adr-001.md) — Constrain V1 to a bounded local display and defer policy or automation.
- [ADR-002: Make CONTEXT a voluntary, omission-first handoff-awareness cue](adrs/adr-002.md) — Optimize for long-running-session clarity and omit absent values.
- [ADR-003: Extend the existing statusline contract with a selector-validated CONTEXT field](adrs/adr-003.md) — Reuse the pure statusline pipeline, harden shared validity, and persist only the identifier.
