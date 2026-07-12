# TechSpec: Claude Code-Style TUI Reskin

## Executive Summary

This reskin is delivered almost entirely within Kitten's existing UI and config layers - no new packages, no new store architecture.
The look-and-feel (warm accent, rounded borders, chevron prompt, new chrome colors) is added as keys on the existing `CockpitPalette` constants in `src/ui/theme.ts` (ADR-004), because the settings-modal palette registry it would otherwise build on (settings-modal ADR-005) is not implemented.
The welcome banner is a single prop-driven component rendered in two places: a transient boot root mounted directly into the renderer during the ACP handshake (ADR-003), and the conversation empty-state once the cockpit mounts.
Auto-quiet is backed by a new fail-soft runtime state file, keeping `config.json` read-only (ADR-005).
The dual-agent status bar is rebuilt from `StatusStrip` around a typed, hide-when-absent slot contract (ADR-006): it renders the signals Kitten owns today (focus, run-state, model-when-present, git branch, cwd) plus an honest hand-off affordance, and exposes `null`-returning selectors that the pending `agent-usage-gauge` and `model-effort-selector` features fill later with no layout reflow.
Git branch, the one net-new data source this spec owns, is read off the render path at boot and refreshed at focus/turn boundaries (ADR-007).

**Primary technical trade-off:** the boot banner uses a second, transient render root in `src/index.ts` rather than refactoring the controller lifecycle to mount the cockpit early - buying a contained, low-risk change and an untouched readiness gate at the cost of a banner that cannot show live per-agent detail (the store does not exist yet) and a render-root swap to manage.

## System Architecture

### Component Overview

| Component | Location | Responsibility |
| --- | --- | --- |
| Palette extension | `src/ui/theme.ts` | New keys on `CockpitPalette` (warm accent, banner tones, context thresholds); light/dark parity preserved |
| `WelcomeBanner` | `src/ui/WelcomeBanner.tsx` (new) | Prop-driven banner: mascot, greeting, model/account/cwd summary, hand-off on-ramp; full and quiet variants |
| Boot banner root | `src/index.ts` (+ small helper) | Transient render of `WelcomeBanner` (agents "connecting...") during handshake, swapped for the cockpit when ready |
| App state module | `src/config/appState.ts` (new) | Fail-soft read/write of `$XDG_STATE_HOME/kitten/state.json` (`firstRunSeenAt`) |
| Config setting | `src/config/configLoader.ts` | Optional `welcomeBanner: "auto"\|"always"\|"off"` field (read-only loader unchanged) |
| `StatusBar` | `src/ui/StatusStrip.tsx` (rebuilt) | Per-agent lozenge (focus + run-state + model + context slots), shared branch/cwd, hand-off affordance, priority-collapse |
| Slot selectors | `src/store/selectors.ts` | `selectSessionModel`, `selectSessionContext` (return `null` today), `selectSessionBranch` |
| Branch reader | `src/config/gitBranch.ts` (new) + store field | Off-render-path branch read at boot + focus/turn boundaries |
| Hand-off result | `src/app/handoff.ts` | `begin()` returns a discriminated result so the affordance shows the reason |
| Prompt restyle | `src/ui/PromptEditor.tsx` | Chevron marker, spacing, accent through palette |

**Data flow.** Renderer boots -> transient `WelcomeBanner` paints (`connecting...`) -> controller resolves, readiness gate unchanged -> `renderCockpit` mounts the cockpit -> `StatusBar` subscribes to narrow per-session selectors -> branch reader writes branch into the store at boundaries -> model/context selectors return `null` until their owning features land, and the bar hides those slots.

## Implementation Design

### Core Interfaces

The status-bar slot contract - the primary type other components depend on. Each selector returns a typed value or `null` (hide-when-absent):

```ts
// src/store/selectors.ts (new selectors; model/context return null until their features land)
export interface ContextUsage { used: number; size: number; percent: number } // percent in [0,1]

export const selectSessionModel =
  (sessionId: SessionId): Selector<string | null> =>
  (state) => state.sessions[sessionId]?.model ?? null

export const selectSessionContext =
  (sessionId: SessionId): Selector<ContextUsage | null> =>
  (state) => state.sessions[sessionId]?.context ?? null

export const selectSessionBranch =
  (sessionId: SessionId): Selector<string | null> =>
  (state) => state.sessions[sessionId]?.branch ?? null
```

The hand-off result, so the affordance can explain itself instead of silently no-opping:

```ts
// src/app/handoff.ts
export type HandoffBlockedReason = "overlay-open" | "no-target" | "empty-source"
export type HandoffBeginResult = { ok: true } | { ok: false; reason: HandoffBlockedReason }
export interface HandoffFlow {
  begin(): HandoffBeginResult            // was: boolean
  confirm(edits: HandoffEdits): Promise<PromptResult | null>
  cancel(): void
}
```

The welcome banner contract and the app-state module:

```ts
// src/ui/WelcomeBanner.tsx
export interface WelcomeBannerProps {
  variant: "full" | "quiet"
  agents: { displayName: string; state: "connecting" | "ready" | "unavailable" }[]
  cwd: string
}
// src/config/appState.ts  (both fail soft: never throw, never block boot)
export function readFirstRunSeen(): boolean
export function markFirstRunSeen(): void
export function bannerVariant(pref: "auto" | "always" | "off", seen: boolean): "full" | "quiet" | "none"
```

### Data Models

- **Palette (new keys on `CockpitPalette`, `theme.ts`):** retuned `accent` (warm brand) plus a grouped `context: { ok; warn; critical }` and any banner-specific tones; run-state reuses the existing `status` tones. Both `DARK_PALETTE` and `LIGHT_PALETTE` gain the keys; `theme.test.tsx` invariants extended.
- **Store fields (`SessionState`):** `branch?: string` (owned here). `model?: string` and `context?: ContextUsage` are **referenced by the slot contract but written by the delegated features** (`model-effort-selector`, `agent-usage-gauge`); until then the selectors read `undefined` -> `null`.
- **Config (`configLoader.ts` schema):** optional `welcomeBanner: "auto" | "always" | "off"`, default `"auto"`.
- **Runtime state (`state.json`):** `{ firstRunSeenAt: string }`, validated by a small zod schema, reset on parse failure.

### API Endpoints

Not applicable - Kitten is a terminal application with no network API.
The equivalent contract is the internal selector + module surface defined in Core Interfaces.

## Integration Points

- **ACP events (delegated):** model/effort come from the dropped `config_option_update` (category `"model"` / `"thought_level"`), context% from the dropped `usage_update` (`used`/`size`), both at the `src/agent/acpTranslate.ts` drop sites. This spec does not wire them; it defines the store fields and selectors they will populate.
- **Git:** an async shell-out (`git rev-parse --abbrev-ref HEAD`) in each session `cwd`, off the render path (ADR-007); detached HEAD -> short SHA, non-repo/failure -> hidden.
- **Filesystem:** `$XDG_STATE_HOME/kitten/state.json` for the first-run marker; write failure is non-fatal.
- **Renderer:** the transient boot root mounts into the existing `createCliRenderer` instance before the React cockpit tree.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/ui/theme.ts` | modified | New palette keys + accent retune; low risk, guarded by tests | Extend palette + `theme.test.tsx` |
| `src/ui/StatusStrip.tsx` | modified (rebuild) | Chip -> lozenge with slots + affordance; **80-col test risk** | Rebuild + update `StatusStrip.test.tsx` budget |
| `src/index.ts` | modified | Transient boot root + swap; render-flow risk | Add `renderBootBanner` + dispose-before-`renderCockpit` |
| `src/app/handoff.ts` | modified | `begin()` return type change; one call site + tests | Discriminated result; update `CockpitApp.tsx` |
| `src/ui/CockpitApp.tsx` | modified | Consume hand-off result; mount idle banner | Wire empty-state banner + reason |
| `src/store/selectors.ts` | modified | Add `selectSessionModel/Context/Branch` | New curried selectors |
| `src/core/types.ts` | modified | `branch?` on `SessionState` (+ `model?`/`context?` shared) | Add optional fields |
| `src/config/configLoader.ts` | modified | Optional `welcomeBanner` field; loader stays read-only | Extend schema |
| `src/config/appState.ts` | new | First-run marker read/write | New fail-soft module |
| `src/config/gitBranch.ts` | new | Branch reader | New module + boundary hooks |
| `src/ui/WelcomeBanner.tsx` | new | Shared banner component | New component |
| `src/ui/PromptEditor.tsx` | modified | Chevron + spacing via palette | Restyle |

## Testing Approach

### Unit Tests
- **Palette:** extend `theme.test.tsx` - new keys present and distinct per mode, light/dark parity, `PaletteProbe` repaint on `theme_mode` flip.
- **App state:** `readFirstRunSeen`/`markFirstRunSeen` round-trip; parse failure resets; write failure returns without throwing; `bannerVariant` truth table across `auto/always/off` x seen.
- **Branch reader:** branch parsed; detached HEAD -> SHA; non-repo -> `null`; command failure -> `null`; never called on render.
- **Hand-off result:** `begin()` returns each `reason` for its condition (overlay open, no target, empty source) and `{ ok: true }` otherwise.
- **Selectors:** model/context return `null` with no field; branch reflects the store.

### Integration Tests
- **Boot banner:** with a delayed fake controller, the transient root paints `connecting...`, then swaps to the cockpit with no flash (via `testRender` + `captureCharFrame`).
- **StatusBar width:** both agents at their richest both-visible state fit exactly 80 columns; priority-collapse sheds branch -> context% -> effort as width narrows (resize harness).
- **Hand-off affordance:** the bar shows the key + direction when enabled and the reason when disabled, driven by store state via `fakeController`.
- **Banner variants:** first run -> full; with the marker set -> quiet; `welcomeBanner: "off"` -> none.
- **Regression:** existing `CockpitApp`/`StatusStrip`/hand-off/approval tests pass; `expectNoOverflow` holds.

## Development Sequencing

### Build Order
1. **Palette extension** (`theme.ts` + tests) - no dependencies.
2. **App state module + `welcomeBanner` config field** (`appState.ts`, `configLoader.ts`) - no dependencies.
3. **`WelcomeBanner` component** - depends on step 1 (palette).
4. **Prompt restyle** (`PromptEditor.tsx`) - depends on step 1.
5. **Boot banner transient root** (`index.ts`) - depends on steps 2 and 3 (variant decision + banner component).
6. **Idle-screen banner** wiring (empty-state in `CockpitApp`/`ConversationView`) - depends on steps 2 and 3.
7. **Branch reader + store field + `selectSessionBranch` + boundary hooks** (`gitBranch.ts`, `types.ts`, `selectors.ts`) - depends on the existing store only.
8. **Slot selectors** `selectSessionModel`/`selectSessionContext` (return `null`) + optional `model?`/`context?` fields - depends on step 7's field pattern.
9. **Hand-off discriminated result + derived affordance state** (`handoff.ts`, `CockpitApp.tsx`) - depends on the existing hand-off flow.
10. **StatusBar rebuild** (lozenges, run-state, slots, priority-collapse, hand-off affordance) + updated `StatusStrip.test` - depends on steps 1, 7, 8, 9.
11. **Phase 3 activation (delegated):** context% and model/effort light up as `agent-usage-gauge` and `model-effort-selector` populate their fields - depends on step 8's contract and those external packets.

### Technical Dependencies
- Phase 3 (step 11) is blocked on the `agent-usage-gauge` and `model-effort-selector` efforts; steps 1-10 have no external blockers.

## Monitoring and Observability

Kitten's telemetry is content-free, opt-in JSONL (`src/telemetry/recorder.ts`); it stays local.
- Reuse the existing `handoffInvoked` counter; add content-free counters for `bootBannerShown` vs `bootBannerQuiet` and a `handoffBlocked` counter keyed by reason (no content, just tallies).
- No new logs leave the machine; nothing is added to the render hot path.

## Technical Considerations

### Key Decisions
- **Transient boot root over lifecycle refactor (ADR-003):** contained change, untouched readiness gate; trade-off is a store-less boot banner and a render swap.
- **Extend palette, don't build the registry (ADR-004):** ships independently of settings-modal; trade-off is a later mechanical migration if ADR-005 lands.
- **State file + read-only config (ADR-005):** preserves the read-only config invariant; trade-off is Kitten's first app-written file.
- **Typed slot contract, delegated plumbing (ADR-006):** honest-now, additive-later, no reflow; trade-off is empty slots until features land.
- **Branch at boot + boundaries (ADR-007):** cheap and off-render-path; trade-off is a brief staleness window mid-turn.

### Known Risks
- **80-column overflow** as slots fill (medium likelihood). Mitigation: fixed slots + declared collapse order + the updated width test as the gate.
- **Boot-swap flicker** (low-medium). Mitigation: same renderer, matching layout, verified in an integration test.
- **Cross-terminal mascot rendering** (medium). Mitigation: deterministic ANSI-safe cell art with a one-line fallback; needs a quick prototype pass.
- **State-file environments** (low). Mitigation: fail soft to the full banner; never block boot.

## Architecture Decision Records

- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — Three-piece chrome scope with hide-when-absent honesty and an 80-column budget.
- [ADR-002: Chrome-First, Data-Additive Rollout](adrs/adr-002.md) — Three phases; never block on pending data features.
- [ADR-003: Boot Banner via a Transient Pre-Controller Render Root](adrs/adr-003.md) — Paint the banner during the handshake without touching the readiness gate.
- [ADR-004: Extend the Existing Palette Instead of Building the Theme Registry](adrs/adr-004.md) — Add accent/chrome keys to the palette constants; defer the ADR-005 registry.
- [ADR-005: First-Run Persistence via a Runtime State File plus a Read-Only Config Setting](adrs/adr-005.md) — App-written state file for first-run; user-authored `welcomeBanner` config field.
- [ADR-006: Status Bar - Typed Slot Contract, Delegated Data Plumbing, and Honest Hand-off Affordance](adrs/adr-006.md) — Hide-when-absent slots, delegated model/context plumbing, discriminated `begin()`.
- [ADR-007: Git Branch via Boot plus Turn-Boundary Refresh](adrs/adr-007.md) — Off-render-path branch read with focus/turn refresh.
