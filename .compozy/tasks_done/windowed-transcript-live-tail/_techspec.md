## Executive Summary

Implement the PRD's bounded live-history experience as a pure transcript projection over the existing complete `SessionState.turns` array. The core module produces stable presentation rows, while `AppStore` holds per-session, non-persisted history depth and detached-reading state. `ConversationView` becomes the only renderer integration point: it renders projection rows, restores detached scroll position after a prepend, and leaves restoration-unavailable behavior untouched.

The feature is gated by a strict `transcriptWindowingEnabled` config boolean that defaults to `false`. History reveal and return-to-live use a focusable marker plus the canonical slash-command registry. The primary trade-off is adding a small projection and ephemeral-state surface to avoid the larger scope and privacy changes of generalized virtualization or transcript persistence. V1 bounds rendered rows and preserves stable references; it does not promise to make every existing reducer operation constant-time.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary and data flow |
| --- | --- | --- |
| `src/core/transcriptProjection.ts` | Convert authoritative turns plus window/protection input into presentation rows. | Pure, dependency-free; receives immutable turns and returns retained turn references plus at most one stable history marker. |
| `src/store/appStore.ts` | Own per-session `TranscriptWindowState` and projection actions. | Ephemeral only; applies actions with structural sharing and never writes `SessionState` by hand. |
| `src/store/selectors.ts` | Expose focused-session projection and per-session view state. | Narrow subscriptions prevent unrelated sessions from repainting the focused conversation. |
| `src/ui/ConversationView.tsx` | Render projection rows, marker controls, and scroll anchoring. | Owns `ScrollBoxRenderable` ref and layout-timed scroll restoration; does not decide projection policy. |
| `src/ui/keymap.ts` and `src/ui/CockpitApp.tsx` | Register and dispatch `/history` and `/latest`. | The same command definitions feed slash completion and help; no inline key dispatch. |
| `src/config/configLoader.ts` and `src/config/configWriter.ts` | Resolve and persist the default-off experiment preference. | Strict optional boolean merged to `false`; malformed values remain hard errors. |
| `src/telemetry/recorder.ts` | Record opt-in, local, content-free projection evidence. | Closed event and bucket shapes only; no transcript text, IDs, paths, or raw timestamps. |

### Data Flow

1. ACP events continue through the existing adapter, controller, store, and `sessionReducer`; no event semantics change.
2. `AppStore.applyEvent()` updates `SessionState.turns` through the reducer and reconciles the affected session's transient window state.
3. A narrow selector combines the authoritative turns, session status, relevant overlay state, the feature flag, and `TranscriptWindowState` into a `TranscriptProjection`.
4. `ConversationView` renders projection rows. If a history-reveal action prepends rows while the user is detached from the live tail, it captures `scrollTop` before the change and restores the offset after the renderer lays out the new rows.
5. Marker activation or `/history` increases revealed history for the focused session. `/latest` resets detached state and scrolls the focused scrollbox to its bottom.
6. When the feature is disabled, the selector returns the current complete-turn presentation so existing behavior is unchanged.

## Implementation Design

### Core Interfaces

Kitten is TypeScript, so the primary contract is expressed as a TypeScript discriminated union rather than a Go interface.

```ts
export type TranscriptProjectionRow =
  | { readonly kind: "turn"; readonly key: string; readonly turn: Turn }
  | { readonly kind: "history_marker"; readonly key: string; readonly hiddenTurnCount: number }

export interface TranscriptWindowState {
  readonly revealedTurnCount: number
  readonly detachedFromLive: boolean
  readonly scrollTop: number | null
}

export interface TranscriptProjection {
  readonly rows: readonly TranscriptProjectionRow[]
  readonly hiddenTurnCount: number
}
```

`projectTranscript()` accepts the complete immutable turn list, the window state, and an explicit protection input. It must return the same `Turn` object references for unchanged visible rows and a range-derived marker key that remains stable while tail updates do not change the hidden range.

The protection input must include the current streaming tail, pending/in-progress tool-call identities, and a mapped approval tool identity when present. Clarification and approval overlays remain their existing independent UI slots. Because a clarification has no transcript-turn identity, projection must not claim it owns a recoverable collapsed row; unavailable-restoration branches remain outside this feature.

### Data Models

| Model | Location | Fields and invariants |
| --- | --- | --- |
| `TranscriptWindowState` | `src/store/appStore.ts` | `revealedTurnCount >= 0`, `detachedFromLive`, and nullable `scrollTop`; keyed by `SessionId`; never persisted. |
| `TranscriptProjectionRow` | `src/core/transcriptProjection.ts` | Either a retained authoritative `Turn` or one `history_marker`; no copied transcript text. |
| `TranscriptProjection` | `src/core/transcriptProjection.ts` | Ordered rows plus hidden-turn count; disabled mode contains all turns and no marker. |
| `TranscriptProtection` | `src/core/transcriptProjection.ts` | Tail budget, active stream identity, pending/in-progress tool identities, and approval-owned tool identity. |
| `AppConfig.transcriptWindowingEnabled` | `src/core/types.ts` and config loader | Required resolved boolean; user delta is optional strict boolean; default `false`. |

Projection rules:

- Keep the most recent configured conversational tail, the active streaming message, all pending/in-progress tools, and an approval-owned tool visible.
- Collapse only unprotected older turns into one marker. A tool update to an older turn must re-evaluate marker count and visibility deterministically.
- `revealedTurnCount` expands history monotonically for its session; session removal and replacement discard the entry.
- Store `scrollTop` only as transient UI state. It is restored only after focus returns to the same live session and never enters a run record.

### API Endpoints

Not applicable. Kitten has no network API or external service boundary for this feature.

## Integration Points

| Integration | Change |
| --- | --- |
| Session reducer | Consume its existing immutable turn output only; do not change domain-event or persistence semantics. |
| App store lifecycle | Initialize, reconcile, and remove transient window entries with session add, replace, start, and remove operations. |
| Overlay state | Map approval tool identity into protection; leave modal rendering and clarification ownership unchanged. |
| OpenTUI ScrollBox | Use the existing conversation scrollbox and supported `scrollTop`, `scrollTo`, and `scrollBy` APIs; retain the horizontal-scrollbar workaround. |
| Command system | Add `/history` and `/latest` to `CockpitCommand`, `COCKPIT_COMMANDS`, help, PromptEditor discovery, and `runCockpitCommand`. |
| Config | Add `transcriptWindowingEnabled` to types, strict schema, defaults, merge, writer, fixtures, and config docs. |
| Telemetry | Extend the allowlist with fixed projection/reveal events and coarse buckets only when global telemetry is enabled. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/transcriptProjection.ts` | New | Pure projection policy; incorrect protection could hide live work. | Add types, unit tests, and deterministic marker-key rules. |
| `src/store/appStore.ts` | Modified | Adds transient state/actions; incorrect sharing could broaden renders. | Preserve sibling references and lifecycle cleanup. |
| `src/store/selectors.ts` | Modified | New projection selector controls conversation render scope. | Add referential-stability and focused-session tests. |
| `src/ui/ConversationView.tsx` | Modified | Renders marker/commands and restores anchors; scroll errors are user-visible. | Use scrollbox ref and real-renderer regression tests. |
| `src/ui/keymap.ts` / `src/ui/CockpitApp.tsx` | Modified | Makes history operations discoverable. | Add union, registry, dispatch, help, and command tests together. |
| `src/config/*` / `src/core/types.ts` | Modified | Default-off gate can break strict fixture completeness. | Update schema/default/merge/writer tests and every complete config fixture. |
| `src/telemetry/recorder.ts` | Modified | New metrics risk content leakage if shape is not closed. | Add allowlisted bucket types and no-content tests. |
| `src/persistence/*` | Unchanged | Transcript content remains intentionally absent. | Add regression assertion that no new window/transcript data is serialized. |

## Testing Approach

### Unit Tests

- Add `src/core/transcriptProjection.test.ts` for empty/full/disabled projections, stable marker keys, protected tail selection, history expansion, older tool updates, and frozen-turn reference reuse.
- Extend `src/store/selectors.test.ts` and `src/store/appStore.test.ts` for per-session state isolation, structural sharing, lifecycle reset, disabled-mode full projection, and focused-session subscription stability.
- Extend `src/config/configLoader.test.ts` and `src/config/configWriter.test.ts` for omitted/true/false/malformed `transcriptWindowingEnabled` values and persistence of the user delta.
- Extend `src/telemetry/recorder.test.ts` for fixed event shapes, enabled/disabled behavior, and rejection of content-bearing fields.

### Integration Tests

- Extend `src/ui/ConversationView.test.tsx` with a 1,000-turn fixture proving at most 120 rendered rows, all protected rows visible, stable visible-row keys through streaming deltas, and deterministic old-tool reconciliation.
- Use the real `ScrollBoxRenderable` test seam to prove manual detach plus stream does not jump to bottom; reveal earlier history preserves anchor; `/latest` returns to bottom; and focus switches restore independent history depth and scroll position.
- Extend `src/ui/keymap.test.ts` and `src/ui/PromptEditor.test.tsx` to prove `/history` and `/latest` are unique, listed in help, and dispatched from the shared command path.
- Keep restoration-unavailable tests as a regression boundary: the feature must not fabricate transcript history from persisted handoff context.

The documented fixture records visible-row count, hidden-row bucket, projection-duration bucket, and identity-reuse assertions. It does not treat manual testing or runtime telemetry as the sole proof of safety.

## Development Sequencing

### Build Order

1. Add `transcriptProjection.ts` types, projection contract, and core unit tests; no dependencies.
2. Add protected-tail, marker-key, expansion, and old-tool-update cases; depends on step 1.
3. Add per-session `TranscriptWindowState`, AppStore actions, lifecycle cleanup, and narrow selectors; depends on steps 1-2.
4. Add `transcriptWindowingEnabled` type, strict config schema/default/merge/writer coverage; depends on step 1 because selector input requires the resolved flag.
5. Integrate projection rows and scrollbox ref anchoring into `ConversationView`; depends on steps 1-4.
6. Add marker focus behavior, `/history`, `/latest`, and shared command dispatch; depends on steps 3 and 5.
7. Add content-free telemetry events and bucket tests; depends on steps 3-5.
8. Add 1,000-turn, streaming, old-tool, overlay, anchor, focus-switch, disabled-mode, and restoration-boundary regression tests; depends on steps 2-7.
9. Run typecheck, full tests, self-check, and build; depends on steps 1-8.

### Technical Dependencies

- Existing pinned OpenTUI ScrollBox APIs (`scrollTop`, `scrollTo`, `scrollBy`) must remain available; add no dependency or generic virtualization package.
- Existing config and telemetry contracts require updating complete `AppConfig` test fixtures and closed recorder unions.
- The current reducer's arbitrary-position tool upsert behavior is a required input to projection reconciliation, not a behavior to change.

## Monitoring and Observability

When global telemetry is enabled, add only these local JSONL event shapes:

| Event | Allowed fields | Purpose |
| --- | --- | --- |
| `transcript_projection_measured` | fixed visible-row bucket, hidden-row bucket, duration bucket, projection reason enum | Compare bounded presentation behavior across tail updates and history reveals. |
| `transcript_history_revealed` | fixed revealed-count bucket | Measure use of explicit history loading. |

Do not record transcript text, message/tool identifiers, file paths, prompt content, raw timestamps, or arbitrary labels. Disabled telemetry must remain a no-op with no sink. No alerting is added in V1 because telemetry is local and opt-in; the documented fixture remains the release gate.

## Technical Considerations

### Key Decisions

- **Pure projection, ephemeral store state**: isolates presentation from semantic session state and persistence. It trades a small selector/action surface for correct session switching and testable policy.
- **Strict default-off config**: uses Kitten's existing validated preference path instead of expanding Settings or adding an environment-only switch. It trades runtime convenience for lower V1 scope.
- **Marker plus canonical commands**: preserves keyboard discovery without adding global chords. It trades two command entries for source-of-truth documentation and test coverage.
- **Deterministic fixtures plus bucketed telemetry**: supplies reproducible safety evidence while respecting privacy. It trades richer diagnostics for a closed, content-free record shape.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Older tool updates make a collapsed range stale | Medium | Re-project from authoritative turns and assert deterministic count/visibility changes. |
| Prepending history changes visual position | Medium | Capture detached `scrollTop`, restore after layout, and cover it with real-renderer tests. |
| React keys churn during tail streaming | Medium | Use stable turn identity and range-derived marker identity; assert frozen-reference reuse. |
| Config rollout accidentally changes existing behavior | Low | Default false; disabled selector returns the complete current turn list; cover config and disabled-mode tests. |
| Telemetry captures more than coarse evidence | Low | Closed event types/buckets and recorder tests forbid arbitrary content fields. |
| Unavailable restoration appears to recover a transcript | Low | Preserve the existing unavailable branch and keep its handoff-context semantics separate. |

## Architecture Decision Records

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Defines the V1 scope and privacy boundary.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Defines counted-marker UX and evidence-based adoption.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Places pure projection in core and transient per-session state in the store.
- [ADR-004: Use strict config, canonical commands, and bounded evidence for the experiment](adrs/adr-004.md) — Gates V1 through config and standardizes discovery and observability.
