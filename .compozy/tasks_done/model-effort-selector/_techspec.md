# TechSpec: Kitten - In-App Model & Reasoning-Effort Selector

## Executive Summary

This feature adds an in-app overlay that changes a pane's model and reasoning effort on the live ACP session, carries a chosen model/effort into the hand-off, and warns before a mid-conversation switch.
It is additive and greenfield on data Kitten already receives and discards: the pinned SDK (`@agentclientprotocol/sdk@1.2.1`) exposes `ClientSideConnection.setSessionConfigOption`, `newSession` already returns `configOptions` that Kitten drops (`agentConnection.ts:176-180`), and `config_option_update` is already translated-then-dropped (`acpTranslate.ts:55`).
The design follows Kitten's existing layering: the ACP adapter translates config options into a Kitten-owned domain event, the reducer applies it to `SessionState`, narrow selectors expose it, and a new overlay mirrors `ApprovalPrompt`/`HandoffPreview`.

Two decisions define the approach.
The domain models the whole config surface as a generic option channel keyed by opaque category id (ADR-003), while the UI renders only `model` and `thought_level` behind a fail-closed allowlist (ADR-004).
The primary technical trade-off is confirmed-state-only rendering: the UI is driven entirely from the agent's returned full option set, never the optimistically requested value, which costs a slightly less "instant" feel and an `unverified` state on flaky adapters in exchange for never misreporting which model is live - the honesty the hand-off's fidelity promise depends on.

## System Architecture

### Component Overview

**Agent Adapter Layer** (`src/agent`, modified)
- `AgentConnection` gains `setSessionConfigOption(sessionId, configId, value)`, which calls `requireConnection().setSessionConfigOption(...)` and returns the refreshed option set (`agentConnection.ts:78-87`, `299-302`).
- `newSession` captures `result.configOptions` instead of discarding it (`agentConnection.ts:176-180`).
- `translateSessionUpdate` translates `config_option_update` into the new domain event instead of returning `null` (`acpTranslate.ts:55`); `current_mode_update` stays dropped.
- The ACP SDK is still imported nowhere above this layer.

**Domain Core** (`src/core`, modified, pure)
- `SessionState` gains `configOptions: ConfigOption[]` (`types.ts:118-129`), defaulted to `[]` in `createSessionState` (`sessionReducer.ts:26-36`).
- A new `DomainSessionEvent` member `{ kind: "config_options"; options: ConfigOption[] }` (`types.ts:135-140`), applied by the reducer as a wholesale replace (`sessionReducer.ts:39-64`).
- A `VISIBLE_CATEGORIES` constant (`model`, `thought_level`) and a pure `visibleConfigOptions(options)` filter.

**Reactive Store** (`src/store`, modified)
- A new `modelSelect` overlay slot in `OverlayState` with `openModelSelect`/`closeModelSelect` actions, mirroring the approval and hand-off slots (`appStore.ts:52-55`, `176-197`).
- Curried selectors `selectAgentConfigOptions`, `selectAgentModel`, `selectAgentEffort` mirroring `selectAgentStatus` (`selectors.ts:39-42`); the new slot is OR'd into `selectHasOpenOverlay` (`selectors.ts:81-82`).

**Controller / Actions** (`src/app`, modified)
- A `setSessionConfigOption(configId, value, agentId?)` action mirroring `sendPrompt`/`cancel` (`actions.ts:70-113`), resolving the live session via `getSession` (`controller.ts:120-124`).
- `startAgent` seeds captured `configOptions` into the store via `applyEvent` (`controller.ts:127-153`).

**UI Shell** (`src/ui`, modified + new)
- `ModelSelect.tsx` (new): a single combined overlay listing model and effort, an inline confirm step for mid-conversation switches, driven by confirmed state.
- `keymap.ts`: a new `model-select` command and binding, plus a `MODEL_KEYMAP`/matcher mirroring the approval/hand-off keymaps.
- `CockpitApp.tsx`: dispatch the command (`77-110`) and mount `<ModelSelect />` (`153-158`).
- `StatusStrip.tsx`: the per-agent chip shows current model and effort (`69-89`).
- `HandoffPreview.tsx`: a target model/effort control feeding the hand-off confirm (`121-127`, `208-220`).

**Hand-off** (`src/app/handoff.ts`, `src/core/bundleAssembler.ts`, modified)
- `HandoffEdits` gains `targetConfig: { configId: string; value: string }[]` (`handoff.ts:64-71`); `confirm` applies each to the target via `setSessionConfigOption` before `sendPrompt` (`handoff.ts:186-208`); `begin` seeds the target's advertised options into the preview overlay (`handoff.ts:164-184`).

**Telemetry** (`src/telemetry`, modified)
- New content-free counters `model_switched`, `effort_switched`, `switch_confirmed`, `switch_unverified`, `effort_linked_handoff`, `effort_change_kept` on the recorder (`recorder.ts:35-43`, `78-94`, `159-173`).

**Data flow (a switch):** keybinding → `CockpitApp` dispatch → `openModelSelect(focusedAgentId)` → overlay reads `selectAgentConfigOptions(agentId)` → user picks → (established conversation? inline confirm) → `actions.setSessionConfigOption(configId, value)` → adapter `setSessionConfigOption` → returned `configOptions` → `store.applyEvent({ kind: "config_options", options })` → reducer replace → status strip and overlay render the confirmed value.

## Implementation Design

### Core Interfaces

The Kitten-owned domain type and event (no ACP types leak; ADR-003):

```typescript
interface ConfigSelectOption { value: string; name: string }

interface ConfigOption {
  id: string           // opaque ACP config id, echoed back on change
  category: string     // "model" | "thought_level" | ... , kept opaque
  label: string
  currentValue: string
  options: ConfigSelectOption[]
}

// added to the DomainSessionEvent union in src/core/types.ts:
//   | { kind: "config_options"; options: ConfigOption[] }
```

The adapter boundary method (translates SDK `SetSessionConfigOptionResponse.configOptions` into `ConfigOption[]`):

```typescript
interface AgentConnection {
  // ...existing members...
  setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<ConfigOption[]>   // the full refreshed set (source of confirmed state)
}
```

The controller action the UI calls (mirrors `sendPrompt`/`cancel`):

```typescript
interface ControllerActions {
  // ...existing members...
  setSessionConfigOption(
    configId: string,
    value: string,
    agentId?: AgentId,          // defaults to the focused agent
  ): Promise<void>
}
```

### Data Models

- `SessionState.configOptions: ConfigOption[]` (default `[]`).
- `visibleConfigOptions(options)` returns only categories in `VISIBLE_CATEGORIES = ["model", "thought_level"]`; everything else (including `mode`/`bypassPermissions`) is filtered before any rendering (ADR-004).
- Confirmed vs unverified is derived, not stored: after a switch, if the call errors or the returned `currentValue` differs from the requested value, the overlay marks that option `unverified` and keeps showing the last confirmed value.
- `HandoffEdits` gains `targetConfig: { configId: string; value: string }[]`, carrying the chosen target model/effort; `HandoffPreviewOverlay` (`appStore.ts:42-46`) carries a snapshot of the target agent's `visibleConfigOptions` so the preview can render the control.

### API Endpoints

Not applicable.
Kitten is a local terminal application with no HTTP surface; its external boundary is the ACP `setSessionConfigOption` call over stdio (see Integration Points).

## Integration Points

**ACP `setSessionConfigOption` over stdio** (Claude Code, Codex)
- **Purpose:** change model and reasoning effort on the live session and read back the confirmed state.
- **Transport:** the existing `ClientSideConnection` per agent; `setSessionConfigOption` returns the full refreshed `configOptions`, and `config_option_update` notifications carry agent-initiated changes.
- **Confirmed state:** both the response and the notification feed the same `config_options` domain event; the UI never renders a requested value that the agent has not returned.
- **Capability discovery:** `newSession`'s `configOptions` seeds initial state; an agent that advertises no visible categories yields no picker for that pane.
- **Out of scope:** `current_mode_update` and the `mode`/`model_config` categories remain unhandled.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/core/types.ts` | modified | Add `ConfigOption`, `SessionState.configOptions`, `config_options` event. Low risk. | Add types; keep unions exhaustive |
| `src/core/sessionReducer.ts` | modified | Default `configOptions: []`; wholesale-replace case. Low. | Add case + `assertNever` coverage |
| `src/agent/agentConnection.ts` | modified | Add `setSessionConfigOption`; capture `newSession.configOptions`; seed via `applyEvent`. Medium (ACP surface). | Implement + mock-agent test |
| `src/agent/acpTranslate.ts` | modified | Translate `config_option_update` → `config_options`. Medium. | Add case; keep others dropped |
| `src/store/appStore.ts` | modified | New `modelSelect` overlay slot + actions. Low. | Mirror approval slot |
| `src/store/selectors.ts` | modified | `selectAgentConfigOptions`/`Model`/`Effort`; OR slot into `selectHasOpenOverlay`. Low but must-not-miss. | Add selectors + OR |
| `src/app/actions.ts`, `src/app/controller.ts` | modified | `setSessionConfigOption` action; seed on `startAgent`. Low. | Mirror `sendPrompt` |
| `src/ui/ModelSelect.tsx` | new | Combined overlay + inline confirm + confirmed-state read. Medium (new UI). | Build from `HandoffPreview` pattern |
| `src/ui/keymap.ts` | modified | New command/binding + overlay keymap. Low (Ctrl+M unusable, equals Enter). | Pick a safe chord |
| `src/ui/CockpitApp.tsx` | modified | Dispatch + mount overlay. Low. | Add case + mount |
| `src/ui/StatusStrip.tsx` | modified | Show model/effort in the chip. Low. | Add selectors to chip |
| `src/ui/HandoffPreview.tsx` | modified | Target model/effort control. Medium. | Add control feeding `confirm` |
| `src/app/handoff.ts` | modified | `HandoffEdits.targetConfig`; apply on `confirm`; seed on `begin`. Medium. | Wire target config |
| `src/telemetry/recorder.ts`, `src/core/telemetryHeuristics.ts` | modified | New content-free counters + kept-change heuristic. Low-medium. | Add counters |

## Testing Approach

### Unit Tests

- **Reducer** (`sessionReducer.test.ts` pattern): `config_options` replaces the stored set; `createSessionState` defaults `configOptions: []`.
- **Translator** (`acpTranslate.test.ts` pattern): `config_option_update` → `config_options` event; `current_mode_update` and other dropped variants still return `null`.
- **Allowlist**: `visibleConfigOptions` returns only `model`/`thought_level`; a `mode`/`bypassPermissions` option is filtered out even when advertised.
- **Confirmed state**: requested value ≠ returned `currentValue` yields `unverified`; matching value clears it.
- **Selectors** (`selectors.test.ts` pattern): `selectAgentModel`/`selectAgentEffort` read the current values; `selectHasOpenOverlay` is true when `modelSelect` is open.
- **Telemetry** (`recorder.test.ts` pattern, in-memory sink): switch counters recorded content-free; `effort_change_kept` heuristic fires only when the change survives the next turn.

### Integration Tests

- **Adapter round-trip** (`agentConnection.test.ts` pattern): extend `test/mockAgent.ts` to return `configOptions` from `newSession`, answer `setSessionConfigOption` with a refreshed set, and emit a `config_option_update`; assert the resulting `config_options` events and confirmed state.
- **Store-level**: dispatch a `config_options` event and assert the status chip and selectors reflect it.
- **UI snapshot** (`ApprovalPrompt.test.tsx`/`HandoffPreview.test.tsx` pattern via `testRender(<CockpitApp controller={createFakeController()} />)`): open the selector, pick a model, refresh effort, take the inline-confirm path on an established session, and confirm it is skipped on a fresh session; render `HandoffPreview` with the target control.

## Development Sequencing

### Build Order

1. **Domain types + reducer** - add `ConfigOption`, `SessionState.configOptions`, the `config_options` event, the reducer case, and the `createSessionState` default. No dependencies. Test-first.
2. **ACP translation** - translate `config_option_update` → `config_options`. Depends on step 1.
3. **Adapter method + capture** - add `AgentConnection.setSessionConfigOption`, capture `newSession.configOptions`, and seed via `applyEvent`. Depends on steps 1-2; verified with the mock agent.
4. **Store slot + selectors + allowlist** - add the `modelSelect` slot and actions, the config selectors, `visibleConfigOptions`, and OR the slot into `selectHasOpenOverlay`. Depends on step 1.
5. **Controller action** - add `setSessionConfigOption` and seed `configOptions` in `startAgent`. Depends on steps 3-4.
6. **ModelSelect overlay + keymap + dispatch** - build the combined overlay with the inline confirm step, add the command/binding, and dispatch and mount it in `CockpitApp`. Depends on steps 4-5.
7. **StatusStrip display** - show current model/effort in the chip. Depends on step 4.
8. **Effort-tagged hand-off** - add `HandoffEdits.targetConfig`, apply it on `confirm`, seed target options on `begin`, and add the preview control. Depends on steps 3, 5, and 6 (reuses the overlay control) and the existing hand-off flow.
9. **Telemetry counters + heuristic** - add the switch counters, the effort-linked-hand-off correlation, and the kept-change heuristic. Depends on steps 4, 5, and 8.

### Technical Dependencies

- Pinned `@agentclientprotocol/sdk@1.2.1` (`setSessionConfigOption`) and the pinned adapters. A live-handshake confirmation that both adapters advertise `model` and `thought_level` is owed before step 3; the design degrades to "no picker" if absent.
- The in-process mock agent (`test/mockAgent.ts`) must be extended to serve `configOptions`, answer `setSessionConfigOption`, and emit `config_option_update` before steps 3, 6, and 8 can be integration-tested.
- Commands: `bun run typecheck` (`tsc --noEmit`), `bun test`, `bun run build`.

## Monitoring and Observability

- **Metrics (opt-in, content-free, local JSONL):** `model_switched`, `effort_switched`, `switch_confirmed`, `switch_unverified`, `effort_linked_handoff`, `effort_change_kept`. These map directly to the PRD success metrics (confirmed-applied rate, kept effort-change rate, effort-linked hand-offs).
- **Debug log (flag-gated):** fields `agentId`, `configId`, `requestedValue`, `confirmedValue`, `durationMs` for diagnosing a switch that is acknowledged but not applied.
- **Alerting:** none; Kitten is a local tool. Metrics are read against the PRD thresholds.

## Technical Considerations

### Key Decisions

- **Generic config-option channel (ADR-003).** Rationale: faithful to the wire protocol and cheap for V2. Trade-off: one indirection mapping opaque categories to UI sections. Alternatives rejected: typed fields, separate keyed map.
- **Live switch + confirmed-state + category allowlist (ADR-004).** Rationale: honest state that protects the hand-off promise, and safe against `bypassPermissions`. Trade-off: an `unverified` state on flaky adapters, no picker when nothing is advertised. Alternatives rejected: optimistic UI, restart-based switching, rendering all categories.
- **Single combined overlay.** Rationale: fewest keystrokes; the agent returns the full refreshed set on a model change, so effort re-renders in place. Trade-off: a slightly denser overlay than a single-category list. Alternatives rejected: sequential two-step, two independent keybindings.
- **Inline confirm step for the mid-conversation warning.** Rationale: one component and one keyboard context; matches the confirm developers see elsewhere. Trade-off: the selector overlay carries a second state. Skipped on a fresh session. Alternative rejected: a separate confirm overlay.
- **No separate flow module for the selector (YAGNI).** Unlike hand-off, the selector needs no bundle assembly or redaction, so a store slot plus a controller action suffices; the hand-off reuses its existing flow with one added field.

### Known Risks

- **ack != applied** (medium): an agent acknowledges a switch it does not apply. Mitigation: confirmed-state rendering and the `unverified` fallback; tracked by `switch_confirmed`/`switch_unverified`.
- **Adapter advertises nothing** (medium): a pane offers no picker. Mitigation: `visibleConfigOptions` empty → no overlay content, shown plainly; a live-handshake check is owed before build.
- **Keybinding conflict** (low): `Ctrl+M` equals carriage return in a terminal and cannot be the selector chord. Mitigation: pick a free chord (for example `Ctrl+E`) and confirm it does not collide with `Ctrl+O`/`Ctrl+T`.
- **Mock-agent fidelity** (medium): the config-option surface must be modeled in `test/mockAgent.ts` or integration tests give false confidence. Mitigation: extend the mock first (a technical dependency above).
- **Kept-change heuristic accuracy** (medium): defining "kept through the next turn" is fuzzy. Mitigation: keep it content-free and directional; tune against early usage.

## Architecture Decision Records

- [ADR-001: V1 scope for the in-app model & reasoning-effort selector](adrs/adr-001.md) - Model and effort only, generic data with a narrow rendered surface, allowlist, verified state, effort composed with hand-off.
- [ADR-002: V1 rollout as a compose-complete MVP](adrs/adr-002.md) - Ship the selector and the effort-tagged hand-off together so the first release is differentiated and every KPI is measurable.
- [ADR-003: Generic config-option channel in the domain core](adrs/adr-003.md) - Model the whole config surface as an opaque-category option list on `SessionState`; the UI filters to model and effort.
- [ADR-004: Live in-place switching with confirmed-state UI and a category allowlist](adrs/adr-004.md) - Switch via `setSessionConfigOption`, render only agent-confirmed state, and allowlist the visible categories.
