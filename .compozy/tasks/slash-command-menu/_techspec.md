# TechSpec: Slash-Command Menu (`/`)

## Executive Summary

The slash menu is delivered as one small vertical slice plus one UI component.
The focused agent's advertised commands are surfaced through the existing `config_options` pipeline pattern (translate in the adapter -> domain event -> reducer -> `SessionState.commands` -> selector), keeping every ACP type inside `src/agent/`.
The menu itself is non-modal React state local to `PromptEditor` (which owns the textarea buffer needed for token detection), and it invokes Kitten actions through a `runCockpitCommand` dispatcher extracted from `CockpitFrame`'s existing key switch, so chords and the menu share one dispatch path.

The primary trade-off: the menu is the codebase's first non-modal overlay and it overloads the editor's Enter/Esc keys with menu-armed meaning, which is more delicate than reusing the tested modal-overlay machinery.
We accept that because a modal that blurs the editor cannot support "type `/` then keep typing to filter," which is the interaction the product requires (ADR-001, ADR-004).
The modal approach is retained as a documented fallback.

## System Architecture

### Component Overview

**Command domain slice (`src/core`, `src/store`).**
A protocol-free `AvailableCommand` type, a `{ kind: "commands" }` domain event, a wholesale-replace reducer case writing `SessionState.commands`, and `selectSessionCommands(sessionId)`.
Reactive by construction: an agent that changes its command set mid-session emits another `available_commands_update`, which flows straight through to a re-render.

**ACP translation (`src/agent/acpTranslate.ts`).**
Replaces the current `available_commands_update -> null` no-op with a `translateCommand` mapping that flattens `input.hint` and drops `_meta`.

**SlashMenu (`src/ui/SlashMenu.tsx`, new).**
Presentational only: given grouped rows, a highlighted index, and an `onSelect`, it renders an absolutely-positioned box anchored above the textarea. No state, no store access.

**PromptEditor integration (`src/ui/PromptEditor.tsx`).**
Holds menu state (open/filter/highlight), detects the `/` token in `onContentChange`, captures nav keys in `onKeyDown` while armed, and on selection either calls `onRunCommand` (cockpit) or `textarea.insertText` (agent). Reads `selectSessionCommands(focusedSessionId)`.

**Cockpit dispatcher (`src/ui/CockpitApp.tsx`).**
`CockpitFrame.onKey`'s switch is extracted into `runCockpitCommand(command)`, called by both the key handler and the menu (via an `onRunCommand` prop).

**Menu keymap + footer (`src/ui/keymap.ts`).**
A `MENU_KEYMAP` + `matchMenuCommand` for the menu's own navigation keys, and an extended `KEYMAP_HINT` (rendered by the existing `StatusStrip`) teaching `^T hand-off` and `/ menu`.

**Data flow.**
`available_commands_update` -> `acpTranslate` -> `{ kind: "commands" }` -> `store.applyEvent` -> reducer -> `SessionState.commands` -> `selectSessionCommands` -> `PromptEditor`.
User types `/` -> `onContentChange` arms the menu -> cockpit rows (from `COCKPIT_KEYMAP`) + agent rows (from the selector), filtered by the token -> `onKeyDown` navigates -> Enter dispatches via `onRunCommand` or inserts text.

## Implementation Design

### Core Interfaces

Domain command type and the reactive read (`src/core/types.ts`, `src/store/selectors.ts`):

```ts
// src/core/types.ts - protocol-free
export interface AvailableCommand {
  name: string
  description: string
  hint?: string
}
// DomainSessionEvent gains:  | { kind: "commands"; commands: AvailableCommand[] }
// SessionState gains:        commands: AvailableCommand[]

// src/store/selectors.ts
export const selectSessionCommands =
  (sessionId: SessionId): Selector<AvailableCommand[]> =>
  (state) => state.sessions[sessionId]!.commands
```

Shared dispatcher and the editor's new contract (`src/ui/CockpitApp.tsx`, `src/ui/PromptEditor.tsx`):

```ts
// CockpitFrame - one dispatch path for chords and the menu
function runCockpitCommand(command: CockpitCommand): void {
  switch (command) {
    case "switch-focus": controller.actions.switchFocus(); return
    case "hand-off":     setHelpOpen(false); handoff.begin(); return
    case "sessions":     setHelpOpen(false); controller.store.openSessions(); return
    case "toggle-help":  setHelpOpen((o) => !o); return
    case "close-help":   setHelpOpen(false); return
  }
}
// <PromptEditor onRunCommand={runCockpitCommand} />
```

Menu row model and the presentational component (`src/ui/SlashMenu.tsx`):

```ts
export type MenuRow =
  | { source: "cockpit"; command: CockpitCommand; label: string; shortcut: string }
  | { source: "agent"; name: string; label: string; hint?: string }

export interface SlashMenuProps {
  groups: { source: string; rows: MenuRow[] }[]
  highlightedIndex: number
  onSelect: (row: MenuRow) => void
}
```

### Data Models

`AvailableCommand` (above) is the only new domain entity - one per advertised command, replaced wholesale per `available_commands_update`.
`MenuRow` and the local menu state (`{ open: boolean; filter: string; index: number }`) are view-only, never stored.
Cockpit rows derive from `COCKPIT_KEYMAP` (each binding's `description` -> `label`, `keys` -> `shortcut`), filtered to the menu-relevant commands (`switch-focus`, `hand-off`, `sessions`, `toggle-help`).

### API Endpoints

Not applicable - Kitten is a terminal app with no HTTP surface.
The analogous "API" is the ACP translation seam (below) and the reused `ControllerActions`; agent commands are invoked by the user sending slash-prefixed prompt text through the existing `sendPrompt`, so no new outbound ACP call and no new action are introduced.

## Integration Points

**ACP `available_commands_update`.**
A server-push session notification the focused agent sends after `session/new`; no capability negotiation, and the list may change mid-session.
The adapter already receives it and discards it; this feature translates it.
Command invocation stays in-band (slash-prefixed prompt text via `sendPrompt`), so there is no new request/response and no ACP type leaves `src/agent/`.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --------- | ----------- | -------------------- | --------------- |
| `src/core/types.ts` | modified | Add `AvailableCommand`, the `commands` event, `SessionState.commands`. Low risk. | Add type + event + field |
| `src/core/sessionReducer.ts` | modified | Add `commands` replace case + initializer; `assertNever` enforces it. Low. | Add case + `commands: []` |
| `src/agent/acpTranslate.ts` | modified | Translate `available_commands_update`, drop `_meta`. Low-med (completeness test). | Add case + `translateCommand` |
| `src/agent/acpTranslate.test.ts` | modified | Remove the null-table entry (line ~141); add positive + reducer round-trip + completeness coverage. Low. | Update tests |
| `src/store/selectors.ts` (+ test) | modified | Add `selectSessionCommands` + identity test. Low. | Add selector + test |
| `src/ui/keymap.ts` (+ test) | modified | Add `MENU_KEYMAP`/`MenuCommand`/`matchMenuCommand`; extend `KEYMAP_HINT`. Low. | Add keymap + hint + test |
| `src/ui/PromptEditor.tsx` | modified | Menu state, token detection, key capture, insert, new `onRunCommand` prop. Med - highest-traffic surface, key overload. | Integrate menu |
| `src/ui/SlashMenu.tsx` | new | Presentational non-modal overlay. Med - first non-modal overlay. | New file |
| `src/ui/CockpitApp.tsx` | modified | Extract `runCockpitCommand`; pass `onRunCommand`. Low-med. | Refactor `onKey` |
| `src/ui/StatusStrip.tsx` | unchanged | Renders the extended `KEYMAP_HINT` automatically. None. | None |

## Testing Approach

### Unit Tests

- **Translate** (`acpTranslate.test.ts`): `available_commands_update` maps `name`/`description`/`input.hint`; `_meta` is dropped (extend `collectKeys`/`FORBIDDEN_ACP_KEYS`); remove the null-table entry.
- **Reducer** (`sessionReducer.test.ts`): a `commands` event wholesale-replaces; a fresh session starts `commands: []`.
- **Selector** (`selectors.test.ts`): `selectSessionCommands` returns the list and preserves reference identity across unrelated updates (the `Object.is` property).
- **Keymap** (`keymap.test.ts`): `MENU_KEYMAP` command list + uniqueness; `KEYMAP_HINT` contains the hand-off and `/`.

### Integration Tests

Driven by `testRender` + `mockInput` + `createFakeController` (real store), per the existing `PromptEditor.test.tsx` harness:

- **Open**: typing `/` at a token start arms the menu; cockpit group shows first (hand-off on top), agent group below (seed the focused session's `commands`).
- **Filter**: `/rev` narrows to and highlights `/review`.
- **Select cockpit**: Enter on hand-off calls `onRunCommand("hand-off")` (assert `handoff.begin` fired; no `sendPrompt`).
- **Select agent**: Enter on `/review` replaces the token with `"/review "`, places the cursor after it, closes the menu, and records **no** `sendPrompt`.
- **Dismiss**: Esc disarms without clearing text; a subsequent Enter submits normally.
- **Trigger edge cases**: `/usr/bin` and `https://` never arm (or disarm on no-match); a `/` mid-word after non-whitespace never arms.
- **Render-count guard**: the transcript view does not re-render on menu keystrokes (menu state stays local to `PromptEditor`).

## Development Sequencing

### Build Order

1. **Command domain slice** - `AvailableCommand` type, `commands` event, `SessionState.commands`, reducer case, initializer. No dependencies.
2. **ACP translation** - `translateCommand` + the `available_commands_update` case; update `acpTranslate.test.ts`. Depends on step 1.
3. **Selector** - `selectSessionCommands` + selector test. Depends on step 1.
4. **Keymap + footer** - `MENU_KEYMAP`, `MenuCommand`, `matchMenuCommand`, extended `KEYMAP_HINT`, keymap test. No dependencies.
5. **Dispatcher extraction** - refactor `CockpitFrame.onKey` into `runCockpitCommand`, add `onRunCommand` plumbing to `PromptEditor`. No new dependencies (behavior-preserving refactor).
6. **SlashMenu component** - presentational `SlashMenu.tsx`. Depends on step 4 (`MenuRow`/keymap types).
7. **PromptEditor integration** - token detection, key capture, menu state, selection handlers. Depends on steps 3, 4, 5, 6.
8. **Interaction + edge-case + render-count tests**. Depends on step 7.

### Technical Dependencies

None external. The ACP SDK is already pinned and already delivers `available_commands_update`. The Ctrl+S merge risk is cleared (ADR-002), so no cross-task coordination is required.

## Monitoring and Observability

All content-free, opt-in counters (per Kitten's telemetry rule), feeding the PRD KPIs:

- Action invocation counter tagged `source: menu | chord` (menu-driven action share).
- Agent-command insertion counter (agent-command adoption; baseline 0).
- Distinct-commands-per-session counter (command breadth).
- Hand-off event counter keyed to the session's launch ordinal (first-session hand-off rate).

No prompt or command content is ever logged.

## Technical Considerations

### Key Decisions

- **Command data as a `config_options`-style slice** (ADR-003). Rationale: reuses a proven, tested reactive pipeline and keeps ACP out of core. Trade-off: five small edits across the slice. Rejected: on-demand fetch (breaks push semantics + layering), storing raw ACP objects (leaks `_meta`, fails the completeness test).
- **Non-modal editor-local menu + shared dispatcher** (ADR-004). Rationale: token detection needs the textarea buffer; one dispatch path prevents drift. Trade-off: first non-modal overlay, Enter/Esc overload. Rejected: lifting into `CockpitFrame` (cross-component plumbing), modal overlay (blurs the editor - kept as fallback).
- **Reuse `COCKPIT_KEYMAP` for cockpit rows.** Rationale: honors the single-source-of-truth-for-bindings rule; the row label and shortcut come straight from each binding. Trade-off: none material.
- **Footer via `KEYMAP_HINT`.** Rationale: the status strip is a single compact line; extending the existing hint needs no new component or layout change.

### Known Risks

- **Key-capture ordering (Enter = accept vs. submit).** Likelihood medium. Mitigation: keys are intercepted only while the menu is visibly armed ("the render is the signal"); covered by interaction tests; modal fallback in reserve.
- **Trigger edge cases** on paths/URLs/code. Likelihood medium. Mitigation: token-begin guard + no-match disarm; dedicated edge-case tests.
- **Completeness test regression.** Likelihood low. Mitigation: update `acpTranslate.test.ts` in the same change as the translation.
- **`/handoff` labeling with >2 sessions.** Likelihood low. `handoff.begin()` already handles direct-vs-picker internally, so the entry stays a thin trigger; the row label is the open question below.

## Architecture Decision Records

- [ADR-001: `/` command menu - V1 scope, trigger model, and state ownership](adrs/adr-001.md) - non-modal editor-local palette, token-begin trigger guard, command data as reactive state.
- [ADR-002: Bundle the slash-menu V1 into a single release](adrs/adr-002.md) - ship command surface, palette, and footer together; merge risk cleared.
- [ADR-003: Surface agent commands as a `config_options`-style domain slice](adrs/adr-003.md) - protocol-free `AvailableCommand`, wholesale-replace reducer, `selectSessionCommands`.
- [ADR-004: Non-modal editor-local menu with a shared cockpit-command dispatcher](adrs/adr-004.md) - menu state in `PromptEditor`, `runCockpitCommand` extracted from `CockpitFrame`.
