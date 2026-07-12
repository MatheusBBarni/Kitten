# Prompt History Navigation — Technical Specification

## Executive Summary

Implement prompt recall as a bounded, immutable `PromptHistoryState` inside every `SessionState`. A new pure core reducer owns 50-entry retention, adjacent-duplicate collapsing, recall position, and the clear-after-newest transition. `PromptEditor` remains the only composer owner: it records locally accepted submissions through `ControllerActions`, requests history navigation at a verified editor boundary, and renders the selected `History n/total` indicator.

The primary trade-off is a small expansion of the core event and action contracts in exchange for deterministic per-session lifecycle, focus-safe recall, and pure tests. The implementation deliberately does not persist or derive history from transcript turns. It uses the installed OpenTUI editor’s cursor-movement result instead of duplicating wrapped-line calculations.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/promptHistory.ts` | New pure state transitions, 50-entry cap, duplicate collapse, and selection result. | No I/O, React, OpenTUI, or ACP imports. |
| `src/core/types.ts` / `sessionReducer.ts` | Add the session-owned history slice and route its domain events. | Remains the sole state writer. |
| `src/store/appStore.ts` / `selectors.ts` | Apply history events and expose a narrow per-session history selector. | No history logic outside the reducer. |
| `src/app/actions.ts` | Record composer submissions, navigate recall, and report content-free outcomes. | UI-facing controller action surface. |
| `src/ui/PromptEditor.tsx` | Preserve editor/menu precedence, set recalled text, resize, and render the indicator. | Never mutates store state directly. |
| `src/telemetry/recorder.ts` | Add opt-in, content-free eligibility, recall, clear, and edited-resend events. | Never receives prompt-derived content. |

Data flow for a normal send is `PromptEditor → ControllerActions.recordPromptHistory → AppStore.applyEvent → sessionReducer → selector`. The existing `sendPrompt` then records the transcript turn and invokes the agent. For navigation, `PromptEditor → ControllerActions.navigatePromptHistory → AppStore.applyEvent → selector/result → PromptEditor.setText`.

The PRD’s iterating-developer and privacy stories map to the per-session core slice. The multiline-author story maps to editor movement gating. The visible-position story maps to the selector-driven indicator. The success-metric goal maps to opt-in recorder events.

## Implementation Design

### Core Interfaces

The production contract is TypeScript. The Go-shaped sketch below is included only as a language-neutral workflow reference; no Go code belongs in this TypeScript repository.

```go
// Non-production contract sketch.
type PromptHistoryState struct {
    Entries []string // chronological: oldest to newest
    Cursor  *int     // nil when not recalling
}
```

```ts
export interface PromptHistoryState {
  readonly entries: readonly string[]
  readonly cursor: number | null
}

export type PromptHistoryEvent =
  | { kind: "prompt_history"; action: "record"; text: string }
  | { kind: "prompt_history"; action: "previous" }
  | { kind: "prompt_history"; action: "next" }
```

`src/core/promptHistory.ts` exports `MAX_PROMPT_HISTORY = 50`, the pure transition function, and a selection helper. `ControllerActions.navigatePromptHistory(direction, sessionId?)` applies the matching domain event and returns `{ text: string | null; historyIndex: number | null; total: number }` from the updated state. `recordPromptHistory(text, sessionId?)` records only the plain composer submission before the asynchronous agent call.

### Data Models

`PromptHistoryState.entries` is ordered oldest to newest. `cursor` is an index into `entries` while browsing and `null` outside recall mode.

| Operation | State transition | Returned composer text |
| --- | --- | --- |
| Record nonblank text | Append unless it equals the newest entry; trim oldest entries beyond 50; set `cursor` to `null`. | None |
| Previous from `null` | Set `cursor` to newest index. | Newest entry |
| Previous from an entry | Decrement cursor, clamped at zero. | Selected entry |
| Next before newest | Increment cursor. | Selected entry |
| Next from newest | Set `cursor` to `null`. | Empty string |
| Next from `null` or no entries | No state change. | `null` |

`SessionState` receives `promptHistory: PromptHistoryState`; `createSessionState` initializes it to `{ entries: [], cursor: null }`. A `DomainSessionEvent` adds the three `prompt_history` variants above. Recreating sessions for a new or cleared run therefore starts with empty histories without separate cleanup logic.

### API Endpoints

This feature adds no network API endpoints or external protocol messages. Its only public integration surface is the internal `ControllerActions` contract:

- `recordPromptHistory(text, sessionId?)`: records a locally accepted composer submission and reports eligibility or edited-resend telemetry without exporting text.
- `navigatePromptHistory(direction, sessionId?)`: applies a pure navigation event and returns a selected text result for the focused textarea.

### PromptEditor Dispatch

`PromptEditor.onKeyDown` keeps its existing priority order:

1. An armed slash menu consumes Up and Down unchanged.
2. Only an unmodified Up or Down in the plain composer enters history dispatch.
3. Call `textarea.moveCursorUp()` or `textarea.moveCursorDown()`. If it returns `true`, call `preventDefault()` and retain editor movement.
4. If it returns `false`, call `preventDefault()` and request core history navigation. If the returned text is not `null`, call `textarea.setText(text)`, synchronize rows, and let the history selector repaint the indicator.

This uses the installed OpenTUI 0.4.3 `EditBufferRenderable` movement contract, including `moveCursorUp`, `moveCursorDown`, `logicalCursor`, and `visualCursor`. `setText` is intentional: recalled text replaces the full composer and does not preserve a hidden pre-browse draft through the editor undo stack.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/promptHistory.ts` | New | Pure state logic; low integration risk, high correctness importance. | Add reducer and exhaustive unit tests. |
| `src/core/types.ts` | Modified | Extends `SessionState` and domain event union. | Add history types and defaults. |
| `src/core/sessionReducer.ts` | Modified | Routes history events without weakening existing event handling. | Delegate to pure history reducer. |
| `src/store/appStore.ts`, `selectors.ts` | Modified | Applies events and exposes the focused session history. | Add narrow selector and preserve structural sharing. |
| `src/app/actions.ts` | Modified | Adds UI action methods and action telemetry slice. | Record before agent call; return navigation result. |
| `src/ui/PromptEditor.tsx` | Modified | Owns vertical-key interception and indicator rendering. | Preserve slash menu, modifier, and Escape behavior. |
| `src/ui/keymap.ts` | Modified | Documents recall without adding a conflicting global binding. | Add editor help copy for Up/Down behavior. |
| `src/telemetry/recorder.ts` | Modified | Adds content-free prompt-history metrics. | Extend event union, no-op recorder, active recorder, and tests. |
| `test/fakeController.ts` | Modified | UI double must satisfy the expanded actions contract. | Record new calls and drive real store events. |

## Testing Approach

### Unit Tests

- Add `src/core/promptHistory.test.ts` for empty history, chronological navigation, both endpoints, clear-after-newest, 50-entry eviction, adjacent duplicates, Unicode and multiline text, and immutable outputs.
- Extend `src/core/sessionReducer.test.ts` to verify prompt-history events modify only the target session slice and preserve unrelated state identity.
- Extend action tests to prove history is recorded before the agent promise settles, is scoped to the addressed session, and excludes non-composer action paths.
- Extend `src/telemetry/recorder.test.ts` with memory-sink assertions for opt-in gating and the absence of text, hashes, lengths, and entry contents in every new record.

### Integration Tests

- Extend `src/ui/PromptEditor.test.tsx` using its existing real-textarea renderer and fake controller.
- Cover latest-to-oldest and oldest-to-newest recall, clear after newest, `History 1/n` indicator visibility, per-session isolation after focus changes, and adjacent-duplicate behavior.
- Cover multiline and wrapped input: a successful editor movement must not select history; boundary movement must select it.
- Keep the existing slash-menu arrow test as the menu-precedence regression case and assert no new global keymap claim.

No external environment or agent subprocess is required for these tests.

## Development Sequencing

### Build Order

1. Add `src/core/promptHistory.ts` with the 50-entry state model, pure transitions, selection helper, and unit tests — no dependencies.
2. Extend `SessionState`, `DomainSessionEvent`, `createSessionState`, `sessionReducer`, store application, and selectors — depends on step 1.
3. Extend `ControllerActions`, concrete actions, and fake controller with record/navigation methods; add opt-in telemetry event contracts — depends on step 2.
4. Update `PromptEditor` to record accepted composer submissions, gate vertical keys with the OpenTUI movement result, replace recalled text, render the indicator, and update help copy — depends on steps 2 and 3.
5. Add reducer, action, telemetry, and real-editor regression coverage; run the project verification gate — depends on steps 1 through 4.

### Technical Dependencies

- The installed `@opentui/core` 0.4.3 editor methods and `KeyEvent.preventDefault()` contract.
- Existing immutable `AppStore` routing through `sessionReducer`.
- Existing opt-in local telemetry recorder and memory-sink test seam.
- No new package, directory, network service, persistence store, or ACP protocol change.

## Monitoring and Observability

Add these opt-in, local, content-free telemetry event types:

| Event | Emitted when | Allowed fields |
| --- | --- | --- |
| `prompt_history_eligible` | A session receives its second composer submission in the run. | Existing timestamp, anonymous run reference, agent session. |
| `prompt_history_recalled` | A boundary navigation selects a history entry. | Existing timestamp, anonymous run reference, agent session. |
| `prompt_history_cleared` | Down leaves the newest recalled entry. | Existing timestamp, anonymous run reference, agent session. |
| `prompt_history_edited_resend` | A recalled entry is changed before being submitted. | Existing timestamp, anonymous run reference, agent session. |

Do not emit prompt text, hashes, character counts, history index, capacity, or contents. Telemetry remains a no-op when disabled. There are no alert thresholds for V1; review the local aggregate after usability and adoption evidence is available.

## Technical Considerations

### Key Decisions

- **Core-owned state:** session state plus a pure reducer provides lifecycle-correct, testable recall. A component map and transcript derivation are rejected in ADR-003.
- **Movement-result gating:** OpenTUI’s boolean cursor movement outcome is the source of truth for multiline and wrapping boundaries. Coordinate heuristics and unconditional interception are rejected in ADR-004.
- **Local acceptance capture:** record a composer submission before the remote call settles so a failed agent call does not force retyping. Only the composer invokes this path.
- **Exact duplicate collapse:** compare only the new submission with the newest entry; do not deduplicate non-adjacent prompts or normalize text.
- **Privacy-first measurement:** content-free events reuse the opt-in recorder; any text-derived telemetry is forbidden by ADR-005.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| OpenTUI changes vertical-movement semantics | Low | Typecheck against the pinned package and retain editor interaction tests. |
| A new controller action bypasses composer-only capture | Medium | Keep explicit `recordPromptHistory` semantics and cover handoff/initial-task paths. |
| A recalled prompt unexpectedly replaces a draft | Medium | Enter history only after failed native movement; retain no draft snapshot by product decision. |
| A telemetry change carries prompt-derived data | Low | Restrict event unions and assert exact memory-sink record keys. |
| Expanded store state causes broad rerenders | Low | Expose a narrow history selector and preserve reducer structural sharing. |

## Architecture Decision Records

- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — sets the private, current-run product boundary and safe arrow precedence.
- [ADR-002: Make Prompt Recall Visible and Collapse Adjacent Duplicates](adrs/adr-002.md) — requires a compact indicator, concise history, and outcome-based validation.
- [ADR-003: Store Bounded Prompt History in Each Session Slice](adrs/adr-003.md) — makes 50-entry recall a pure, session-owned core state slice.
- [ADR-004: Gate Recall with OpenTUI Cursor-Movement Results](adrs/adr-004.md) — keeps native multiline movement and menu ownership ahead of history.
- [ADR-005: Measure Prompt Recall Through Opt-In Content-Free Telemetry](adrs/adr-005.md) — adds local behavioral counters without prompt-derived data.
