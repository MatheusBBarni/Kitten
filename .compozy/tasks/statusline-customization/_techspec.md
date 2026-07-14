# TechSpec: Conversational Statusline Customization (`/statusline`)

## Executive Summary

Implement `/statusline` as a modal flow over the focused agent's existing prompt path. The flow sends a product-owned instruction plus the developer request through the normal transcript, accepts only one fenced JSON statusline proposal, previews the normalized layout, and commits it only after an atomic config write succeeds. A confirmed layout updates the active footer immediately; without a saved layout, the existing status strip remains unchanged.

The primary trade-off is intentional transcript visibility. Reusing the focused agent avoids a new ACP integration, but statusline requests and responses become coding turns and malformed replies fall back to presets. The design offsets that cost with one strict schema, parser, and pure renderer shared by config loading, preview, and the custom footer.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/statusline.ts` | Own `StatuslineLayout`, normalization, strict proposal parsing, grapheme branch ellipsis, and deterministic segment rendering. | Pure; no React, filesystem, ACP, or agent access. |
| `src/config/configLoader.ts` | Validate and resolve the optional `statusline` user-config delta. | Strict config boundary. |
| `src/config/configWriter.ts` | Persist only explicit acknowledgement or confirmed layout patches; reject symlink targets. | Filesystem boundary. |
| `src/store/appStore.ts` + `selectors.ts` | Hold the reactive statusline preference and modal payload; expose narrow selectors. | Store is the only mutable state. |
| `src/app/statuslineFlow.ts` | Send the transcript request, capture the completed agent response, parse its single fenced block, and coordinate confirm/cancel/recovery. | App orchestration; uses `ControllerActions` and store only. |
| `src/ui/StatuslineOverlay.tsx` | Own the keyboard-modal disclosure, request, preview, failure, and preset views. | UI never reads connections or writes config. |
| `src/ui/StatusStrip.tsx` | Use the pure renderer only when a custom layout is present; retain the legacy strip otherwise. | Presentation and palette only. |

**Data flow.** `/statusline` in `COCKPIT_COMMANDS` reaches `CockpitFrame.runCockpitCommand`, which opens the store-owned overlay. Acknowledgement persists before the first request. `StatuslineFlow` sends the product prompt using `ControllerActions.sendPrompt`, then parses only the completed response turns emitted into the focused transcript. The overlay previews the normalized layout through `renderStatusline`. Confirm calls the controller's explicit statusline-save method; that method atomically persists first and updates the store only after success. The config watcher applies later external changes without writing them back.

## Implementation Design

### Core Interfaces

The workflow requires one Go structural contract; it mirrors the TypeScript data model below and is not repository source code.

```go
type StatuslineLayout struct {
    Separator string
    Line      []StatuslineItem
}

type StatuslineItem struct {
    Kind     string
    MaxChars int
}
```

The TypeScript model is authoritative for Kitten:

```ts
export type StatuslineItem =
  | "FOLDER" | "FULL_PATH" | "BRANCH" | "PROVIDER" | "MODEL" | "EFFORT" | "HELP_TEXT"
  | { kind: "ELLIPSIS_BRANCH"; maxChars: number }

export interface StatuslineLayout {
  separator: string
  line: readonly StatuslineItem[]
}

export interface StatuslinePreference {
  llmDisclosureAcknowledged: boolean
  layout: StatuslineLayout | null
}
```

The flow's pure acceptance contract is:

```ts
export type StatuslineProposalResult =
  | { kind: "proposal"; layout: StatuslineLayout }
  | { kind: "invalid-response"; reason: string }
  | { kind: "unavailable"; reason: string }

export function parseStatuslineProposalReply(text: string): StatuslineProposalResult
export function renderStatusline(
  layout: StatuslineLayout, context: StatuslineContext, columnBudget: number,
): readonly StatuslineSegment[]
```

### Data Models

`UserConfig.statusline` is optional. Its absence resolves to `{ llmDisclosureAcknowledged: false, layout: null }`, which selects legacy footer rendering. A persisted block contains `llmDisclosureAcknowledged`, `separator`, and `line`; `separator` and `line` must be present together when `layout` is present.

`StatuslineItem` permits each field at most once. `ELLIPSIS_BRANCH.maxChars` is an integer in the bounded range 4–80 and counts grapheme clusters through `Intl.Segmenter`. Separators reject control characters and are bounded to 16 grapheme clusters. The normalizer rejects unknown fields, duplicate field kinds, empty lines, invalid paired layout fields, and malformed JSON proposals.

`StatuslineContext` is derived only from the selected session and existing read models: `cwd`, optional `branch`, provider label, model label, effort label, and the existing key hint. It never performs Git or agent I/O. Missing values omit their item and adjacent separator. `renderStatusline` joins fitting items in declared order, then removes trailing items until its grapheme budget fits. It does not internally shorten any non-ellipsis field; existing UI overflow containment remains a final guard for terminal display-cell differences.

The modal payload is transient store state. It holds the selected session id, phase (`disclosure`, `request`, `waiting`, `preview`, `failure`, or `presets`), transient request text, normalized layout or failure reason, and preset selection. It is never persisted or telemetered.

The recovery path exposes exactly three product-owned layouts, each entering the same preview and Confirm/Cancel path: **Workspace** (`FOLDER`, `BRANCH`), **Agent** (`PROVIDER`, `MODEL`, `EFFORT`), and **Compact** (`FOLDER`, `{ kind: "ELLIPSIS_BRANCH", maxChars: 24 }`, `MODEL`). All use the default separator `" · "`. The flow offers them only after an unavailable or invalid proposal, or when the developer declines the first-request acknowledgement; it never substitutes one for a valid conversational request.

### API Endpoints

Not applicable. Kitten exposes no HTTP API. The relevant internal action surface is:

| Surface | Contract |
| --- | --- |
| `SessionController.acknowledgeStatuslineDisclosure()` | Atomically persist acknowledgement, then update the reactive preference; reject without sending on write failure. |
| `SessionController.confirmStatusline(layout)` | Atomically persist the complete statusline block, then update the active footer; leave the legacy/custom active layout unchanged on failure. |
| `StatuslineFlow.request(text, sessionId)` | Send the product-owned normal transcript prompt, collect post-request agent turns, and return only a strict parsed proposal, invalid-response, or unavailable result. |

## Integration Points

**Focused ACP agent.** The flow uses the existing `ControllerActions.sendPrompt` path against the selected ready session. It does not introduce an ACP wire type. The product prompt forbids resolved session values, requires one fenced `json` reply with no prose, and lists the allowed schema. Agent unavailability, refusal, cancellation, malformed output, or zero response routes to the overlay's recovery presets.

**User config and watcher.** Extend `AppConfig`, `UserConfig`, defaults, merge, atomic persistence, and reload handling. The controller session owns all config I/O; the view only requests acknowledgement or confirmation. A pre-existing symlink at the target config path is a hard write error. The watcher applies external statusline changes to the store and unchanged-value guards prevent a self-write reload from causing another write.

**OpenTUI width.** `StatuslineOverlay` and `StatusStrip` use the existing `useTerminalDimensions()` hook, which reacts to terminal resizing, to supply the renderer's current column budget. The layout remains one line with `wrapMode="none"` and `overflow: "hidden"` as containment. V1's pure budget is grapheme-based, not a full Unicode display-cell engine.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/core/statusline.ts` | New | Pure schema, parser, context builder, and renderer. High contract density, low I/O risk. | Add types, limits, normalization, fenced reply parser, and rendering tests. |
| `src/core/types.ts` | Modified | Add resolved statusline preference to `AppConfig`. | Keep absent preference explicitly legacy. |
| `src/config/configLoader.ts` | Modified | Strict nested statusline delta, defaults, and merge. | Validate paired layout fields and unknown keys. |
| `src/config/configWriter.ts` | Modified | Persist explicit nested statusline blocks and reject symlink targets. | Preserve unrelated root fields and private atomic-write behavior. |
| `src/config/configWatcher.ts` | Modified | Reload the new resolved preference. | Surface malformed external changes through the existing resilient watcher path. |
| `src/store/appStore.ts` + `selectors.ts` | Modified | Add preference state and statusline overlay slot/selectors. | Preserve immutable updates and narrow subscriptions. |
| `src/index.ts` | Modified | Seed, persist, and reload statusline separately from debounced theme changes. | Expose explicit controller methods; never persist preview edits. |
| `src/app/statuslineFlow.ts` | New | Orchestrate normal-transcript proposal and confirm/recovery states. | Parse only after terminal prompt result and no direct connection access from UI. |
| `src/ui/keymap.ts`, `CockpitApp.tsx` | Modified | Register and dispatch `/statusline`; mount modal. | Preserve global key and overlay precedence. |
| `src/ui/StatuslineOverlay.tsx` | New | Disclosure, request, preview/diff, failure, and preset experience. | Capture keyboard modally and show no raw value outside the transcript. |
| `src/ui/StatusStrip.tsx` | Modified | Render custom layout through pure renderer or preserve legacy branch. | Keep current 64/80-column no-overflow contract. |
| Existing tests and `test/fakeController.ts` | Modified | Cover new controller methods and agent response fixtures. | Keep fakes injected; never spawn a real agent. |

## Testing Approach

### Unit Tests

- `src/core/statusline.test.ts`: valid/invalid layouts, duplicate and control-character rejection, fenced JSON parsing, grapheme branch limits, absent-value omission, declared-order trailing omission, and legacy-null behavior.
- `src/config/configLoader.test.ts`, `configWriter.test.ts`, and `configWatcher.test.ts`: strict nested parsing, default/merge/round-trip, acknowledgement-only writes, full-layout writes, preservation of unrelated config, private atomic writes, and symlink rejection.
- `src/store/appStore.test.ts` and `selectors.test.ts`: reactive preference updates, transient overlay phases, confirmation-only commit, external-reload identity behavior, and no state mutation on Cancel.
- `src/app/statuslineFlow.test.ts`: exact prompt contract, transcript turn capture after prompt completion, sole fenced-block acceptance, malformed/refused/cancelled outcomes, and recovery presets.

### Integration Tests

- `src/ui/StatusStrip.test.tsx`: unchanged legacy output with no custom preference; custom ordering and missing-field omission at 80 and 64 columns; no wrapping or overflow sentinel.
- `src/ui/StatuslineOverlay.test.tsx` plus `src/ui/CockpitApp.test.tsx`: `/statusline` discovery and exact-command dispatch, acknowledgement success/decline, normal transcript request, preview/diff, Confirm versus Cancel, failure-to-presets, and approval/clarification keyboard precedence.
- `test/configPersistence.integration.test.ts` and `test/index.integration.test.tsx`: session boot seeds saved statusline, confirmation is visible immediately only after one successful write, external reload updates the footer, and an application-originated write does not loop.
- Gate the work with the selected full repository verification: focused tests, then `bun run typecheck && bun test && bun run selfcheck && bun run build`.

## Development Sequencing

### Build Order

1. Add `src/core/statusline.ts` with the normalized layout model, parser, context mapping, and renderer; no dependencies.
2. Extend config types, schema, defaults, merge, writer, and watcher for the preference; depends on step 1.
3. Extend app preferences, selectors, and `createCockpitSession` controller persistence/reload methods; depends on steps 1 and 2.
4. Add `StatuslineFlow` over the existing normal prompt path and transcript parser; depends on steps 1 and 3.
5. Register `/statusline`, add the store-owned overlay slot, and implement `StatuslineOverlay`; depends on steps 3 and 4.
6. Integrate the pure custom renderer into `StatusStrip` while retaining the legacy no-preference branch; depends on steps 1, 3, and 5.
7. Add unit and integration coverage, then run the full repository gate; depends on steps 1 through 6.

### Technical Dependencies

- No new package is required. Use the current OpenTUI React terminal-dimensions hook and existing modal, config, store, and controller seams.
- A ready focused agent is required for conversational proposals. Presets cover unavailable or invalid proposal paths.
- Existing dirty worktree changes in UI, prompt, boot, and task-report files are unrelated; implementation must rebase this design against their final state rather than overwrite them.

## Monitoring and Observability

No statusline-specific telemetry, request text, raw responses, layouts, paths, branches, or rendered segments may be recorded. The feature relies on user-visible overlay states for unavailable, malformed, and write-failure outcomes. Existing generic config-write failure handling may surface the failure without adding statusline content or new event dimensions.

## Technical Considerations

### Key Decisions

- **Structured layout plus one renderer.** The core owns validation, normalization, grapheme branch ellipsis, and declared-order omission so preview and footer agree. This adds a small domain module but avoids duplicated formatting.
- **Normal transcript with strict fenced JSON.** The chosen focused-agent path is visible and reuses existing ACP prompt handling. A strict sole-block parser rejects ambiguity rather than guessing.
- **Persist before immediate apply.** Confirmation writes first, then updates the store; an error leaves the visible line unchanged. Acknowledgement follows the same explicit-write rule.
- **Legacy compatibility by null layout.** No saved layout preserves current provider/model/effort/headroom/MCP/footer behavior. Custom mode is opt-in.
- **Grapheme, not display-cell, budgeting.** `Intl.Segmenter` produces predictable branch limits without adding a terminal-width dependency. OpenTUI's reactive terminal width supplies the budget; overflow containment handles display-cell differences.

### Known Risks

- **Normal transcript pollution** — accepted by user choice; prompt and response remain visible but are not persisted as statusline data.
- **Agent response does not follow the JSON contract** — reject, explain, and offer presets; do not heuristically repair prose.
- **External config target is a symlink** — reject before write and leave the last active preference intact.
- **Unicode display cells differ from grapheme count** — preserve a one-line overflow guard, test ASCII and representative Unicode, and defer a full display-cell engine until evidence requires it.
- **Concurrent workspace edits alter shared UI seams** — keep the implementation narrow, update against live code, and preserve unrelated changes.

## Architecture Decision Records

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — keep layouts bounded, previewable, and non-executable.
- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — apply confirmed changes immediately, disclose before first send, and reserve presets for recovery.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — model branch limits structurally, retain legacy defaults, and unify preview/footer rendering.
- [ADR-004: Use the focused agent transcript with a strict fenced proposal contract](adrs/adr-004.md) — reuse normal prompt delivery while accepting only one schema-valid JSON response.
