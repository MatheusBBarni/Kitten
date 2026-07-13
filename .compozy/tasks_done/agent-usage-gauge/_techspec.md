# TechSpec: Agent Usage Gauge

## Executive Summary

The agent usage gauge surfaces each agent's context headroom, built from the ACP `usage_update` event Kitten currently discards at `src/agent/acpTranslate.ts:57`. The implementation threads a single new domain fact through the existing layered pipeline (ACP translate → pure reducer → reactive store → UI) and renders it in two already-mounted surfaces: a headroom segment on each `AgentStatusChip` in the status strip, and a target-headroom line in the `Ctrl+T` handoff preview. It adds no new screen, command, package, or directory - one new pure UI helper is the only new file.

The chosen approach keeps raw `{ used, size }` in `SessionState`, computes a rounded headroom percentage in a primitive curried selector (`number | null`), and formats the percent-plus-bar in a pure helper (ADR-003). The primary trade-off: a neutral, honest MVP (percent + bar, "unknown" for absent data, no "hand off now" verdict) ships quickly and protects trust, at the cost of being less directive than a color-coded gauge - thresholds and behavior telemetry are deferred to Phase 2 (ADR-002). The main risk is external: neither adapter is confirmed to emit `usage_update`, mitigated by a gated, content-free debug log validated against the running app before the gauge is relied upon.

## System Architecture

### Component Overview

The feature is a thin vertical slice across the existing layers. Each component reads the one below; no component gains a new dependency direction.

- **ACP translation (`src/agent/acpTranslate.ts`)** - lifts `usage_update` out of the dropped-variants group and builds a domain `usage` event via a content-free `translateUsage` (copies only `used`/`size`; drops `cost` and `_meta`). Boundary: ACP wire types stay here and never leak upward.
- **Domain types + reducer (`src/core/types.ts`, `src/core/sessionReducer.ts`)** - a new `DomainSessionEvent` arm `{ kind: "usage"; used; size }` and an optional `SessionState.usage` field. The reducer's `case "usage"` replaces that field and touches nothing else, mirroring `case "status"`. `undefined` is the honest "unknown."
- **Store + selector (`src/store/appStore.ts`, `src/store/selectors.ts`)** - `applyEvent` already routes any `DomainSessionEvent`; no store change. A new primitive curried selector `selectSessionHeadroom(id): number | null` derives the rounded remaining-context percentage.
- **Pure formatter (new `src/ui/headroom.ts`)** - `formatHeadroom(pct, cells)` produces the percent label + fixed-width bar, and the "unknown" marker for `null`. Pure and unit-tested.
- **UI surfaces (`src/ui/StatusStrip.tsx`, `src/ui/HandoffPreview.tsx`)** - the strip chip appends a memoized headroom span (percent + short bar); the handoff preview adds a target-headroom line after the redaction notice, reading `selectSessionHeadroom(targetSessionId)`.
- **Emission validation (wiring layer)** - a gated, content-free debug log emitted when a `usage` event is dispatched, used to confirm adapter emission before launch (ADR-002).

**Data flow:** `usage_update` (ACP) → `translateSessionUpdate` → `{ kind: "usage", used, size }` → `AgentConnection.emit`/`dispatch` → `controller` subscription `store.applyEvent(seed.id, event)` (`src/app/controller.ts:169`) → `sessionReducer` sets `SessionState.usage` → `selectSessionHeadroom` → `formatHeadroom` → status-strip span and handoff-preview line.

## Implementation Design

### Core Interfaces

The primary domain fact other components depend on:

```ts
// src/core/types.ts
export interface SessionUsage {
  /** Tokens currently in the agent's context window. */
  used: number
  /** Total context window size in tokens. Invariant: used <= size, size > 0. */
  size: number
}

// New arm on the DomainSessionEvent union (mirrors the `status` arm):
//   | { kind: "usage"; used: number; size: number }

// New field on SessionState (after `plan`):
//   usage?: SessionUsage   // undefined => agent has not reported usage ("unknown")
```

The derivation selector (mirrors `selectSessionStatus`, returns a primitive for re-render isolation):

```ts
// src/store/selectors.ts
export const selectSessionHeadroom =
  (sessionId: SessionId): Selector<number | null> =>
  (state) => {
    const usage = state.sessions[sessionId]?.usage
    if (!usage || usage.size <= 0) return null // honest "unknown"
    return Math.round(((usage.size - usage.used) / usage.size) * 100)
  }
```

The pure presentation helper (new module, unit-tested):

```ts
// src/ui/headroom.ts
export const HEADROOM_UNKNOWN = "—"
export interface HeadroomDisplay {
  label: string   // e.g. "38%" or HEADROOM_UNKNOWN
  filled: number  // filled bar cells (0..cells); 0 when unknown
  cells: number   // total bar width
}
/** pct is 0..100, or null for unknown. Never throws; clamps to [0, cells]. */
export function formatHeadroom(pct: number | null, cells?: number): HeadroomDisplay
```

Error/edge conventions: absent usage or `size <= 0` → `null` → `HEADROOM_UNKNOWN` (no bar). The translator never spreads the raw ACP object, so `_meta`/`cost` cannot leak (enforced by the existing completeness test). No exceptions are thrown on the render path.

### Data Models

- `SessionUsage` `{ used: number; size: number }` - the raw fact, stored on `SessionState.usage?`.
- `DomainSessionEvent` gains `{ kind: "usage"; used: number; size: number }`; `assertNever` in the reducer forces the matching `case`.
- No persistence, no schema, no serialization - state is in-memory per session and reset via `createSessionState`.

### API Endpoints

Not applicable - the feature has no network or HTTP surface. Its internal contracts are the translator, selector, and formatter signatures defined in Core Interfaces.

## Integration Points

- **ACP `usage_update` ingestion** - the only external boundary. The agent connection is already established; no new authentication or transport. `usage_update` carries `used`/`size` (required) and optional `cost`. Error/degradation handling: a malformed or `size <= 0` payload resolves to "unknown" rather than an error; `cost`/`_meta` are dropped in translation. Emission is optional and adapter-dependent (recently stabilized in ACP), so the design treats one-sided or absent data as normal and never blocks on it.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/core/types.ts` | modified | Add `SessionUsage`, event arm, optional state field. Low risk. | Add types |
| `src/core/sessionReducer.ts` | modified | New `case "usage"` (mirror `status`); `assertNever` forces it. Low risk. | Add reducer case |
| `src/agent/acpTranslate.ts` | modified | Surface `usage_update`; add content-free `translateUsage`. Medium risk: must not leak `_meta`/`cost` (completeness test guards this). | Change case + translator; import `UsageUpdate` |
| `src/store/selectors.ts` | new selector | `selectSessionHeadroom` primitive selector. Low risk. | Add selector |
| `src/ui/headroom.ts` | new | Pure percent+bar formatter. Low risk. | Create module |
| `src/ui/StatusStrip.tsx` | modified | Memoized headroom span (percent + short bar). Medium risk: the strip has an exact 80-column test budget. | Add span; budget columns; update strip test |
| `src/ui/HandoffPreview.tsx` | modified | Target-headroom line after the redaction notice. Low-medium risk: costs one guaranteed row against the height-bounded dialog. | Add line; verify row budget |
| wiring (`src/agent/agentConnection.ts` or `src/app/controller.ts`) | modified | Gated content-free debug log on usage dispatch. Low risk. | Add gated log |
| `src/store/appStore.ts` | unchanged | `applyEvent` already routes any event. None. | None |

## Testing Approach

### Unit Tests

- **Reducer** (`src/core/sessionReducer.test.ts`): fold a `usage` event and assert `state.usage` is set and `turns`/derived fields are untouched (mirror the existing "plan and status events" test); assert `createSessionState` leaves `usage` undefined; assert immutability.
- **ACP translate** (`src/agent/acpTranslate.test.ts`): construct a `usage_update` literal and assert it maps to `{ kind: "usage", used, size }`; **update the existing `it.each` that asserts `usage_update` → `null`** (remove `usage_update` from the unsurfaced set); extend the `_meta`/`rawInput` completeness test so `cost`/`_meta` do not survive `translateUsage`.
- **Selector** (`src/store/selectors.test.ts`): assert `selectSessionHeadroom` returns the rounded remaining percent for known usage, `null` for absent usage and for `size <= 0`, and that an untouched agent's slice stays referentially stable across the other agent's usage update (re-render isolation).
- **Formatter** (`src/ui/headroom.test.ts`, new): assert `formatHeadroom` for representative percents (0, 38, 100), clamping, fixed-width bar cell counts, and `null` → `HEADROOM_UNKNOWN` with zero filled cells.

### Integration Tests

- **Status strip** (`src/ui/StatusStrip.test.tsx`): render the strip via `testRender`, drive `store.applyEvent(id, { kind: "usage", used, size })` inside `actAsync`, and assert the chip frame text shows the percent + bar; assert the other agent (no usage) shows `HEADROOM_UNKNOWN`; **update the exact 80-column budget assertion** for the new segment width; verify `expectNoOverflow`.
- **Handoff preview** (`src/ui/HandoffPreview.test.tsx`): open the preview through the shell, seed the target agent's usage, and assert the target-headroom line renders (and shows "unknown" when the target has no usage); confirm the dialog still fits the 24/30-row test terminals and the send hint/action stays on screen.
- Test data + helpers: `createFakeController`/`readyRuntimes` (two ready agents), `actAsync`, `waitForFrame`, `captureCharFrame`, `destroyMounted` from `test/`.

## Development Sequencing

### Build Order

1. **Domain types** (`src/core/types.ts`) - add `SessionUsage`, the `{ kind: "usage"; used; size }` event arm, and optional `SessionState.usage`. No dependencies.
2. **Reducer** (`src/core/sessionReducer.ts`) - add `case "usage"` (mirror `status`); leave `usage` undefined in `createSessionState`. Depends on step 1 (the event arm and field).
3. **ACP translation** (`src/agent/acpTranslate.ts`) - import `UsageUpdate`, lift `usage_update` into a translating case, add content-free `translateUsage`. Depends on step 1 (the event arm).
4. **Selector** (`src/store/selectors.ts`) - add `selectSessionHeadroom(id): number | null`. Depends on step 1 (the `usage` field).
5. **Formatter** (`src/ui/headroom.ts`) - add `formatHeadroom` + `HEADROOM_UNKNOWN`. Depends on step 4 (consumes the `number | null` contract).
6. **Status-strip UI** (`src/ui/StatusStrip.tsx`) - add a third memoized selector and a headroom span. Depends on steps 4 and 5.
7. **Handoff-preview UI** (`src/ui/HandoffPreview.tsx`) - add the target-headroom line. Depends on steps 4 and 5.
8. **Emission-validation log** (wiring layer) - gated, content-free debug log on usage dispatch. Depends on step 3 (a usage event must exist to log).
9. **Tests** - reducer, translate (update the null assertion), selector, formatter, strip (fix 80-col budget), and handoff-preview frame tests. Depends on steps 1-7 (all behavior in place); the translate-test update pairs with step 3.

### Technical Dependencies

- **External**: at least one ACP adapter (Claude Code / Codex) must actually emit `usage_update`. This is validated, not assumed - step 8 confirms it against the running app before the gauge is relied upon (ADR-002). If neither emits, the gauge shows honest "unknown" and the gap is escalated to adapter owners.
- No infrastructure, package, or shared-component dependencies.

## Monitoring and Observability

- **Emission-validation log** (ADR-002): a structured, content-free line emitted when a `usage` event is dispatched, gated by the existing telemetry opt-in / an env flag. Fields: `{ evt: "usage_seen", provider, used, size }` - numbers only, no transcript content, consistent with the recorder's content-free discipline. Purpose: confirm both adapters emit, and expose which agent (if any) does not.
- **Phase 2 metric (deferred)**: correlate usage with hand-off events (headroom at hand-off time), added to the telemetry recorder as a bucketed numeric field on `handoffSent` or a `watch`-derived event - out of scope here, noted for continuity.
- No alerting thresholds in the MVP.

## Technical Considerations

### Key Decisions

- **Decision:** Raw `{used,size}` fact in state, primitive `selectSessionHeadroom` selector, pure `formatHeadroom` helper (ADR-003).
  - **Rationale:** Preserves per-agent re-render isolation by construction, keeps derived/presentation logic out of pure domain state, and makes both the selector and formatter unit-testable without rendering.
  - **Trade-offs:** One new UI helper module; the headroom formula lives in the selector.
  - **Alternatives rejected:** Raw-object selector with per-component math (duplication, drift); storing computed headroom in state (breaks the raw-fact boundary).
- **Decision:** Status strip shows percent + a short fixed-width bar; the handoff preview carries the fuller line.
  - **Rationale:** Glanceable side-by-side comparison where the user already looks, with the bar sized to fit the width budget.
  - **Trade-offs:** Consumes columns against the exact 80-column strip test; the bar yields first on very narrow terminals.
  - **Alternatives rejected:** Percent-only (less glanceable); single-glyph (imprecise).
- **Decision:** Drop `cost`; capture only `used`/`size`.
  - **Rationale:** YAGNI - cost is a Phase 3 concern; smaller surface and a provably non-leaking translator.
  - **Trade-offs:** A later additive types/reducer touch when cost is needed.
- **Decision:** Neutral presentation, no color verdict in the MVP (ADR-002).
  - **Rationale:** The reported window size may not equal the effective limit under compaction; a verdict would assert unearned precision.
  - **Trade-offs:** Less directive; thresholds deferred to Phase 2. Reuse existing palette tokens (fill vs `muted` track); no new palette key.

### Known Risks

- **Adapters may not emit `usage_update`** (likely for one side). Mitigation: the emission-validation log confirms before reliance; the gauge degrades to honest "unknown"; the focused agent's own headroom is useful even without a comparison.
- **Reported `size` may not reflect the effective limit** (auto-compaction, reserved output headroom). Mitigation: neutral MVP framing, no verdict; the formula is isolated in the selector for later refinement (e.g., used-vs-reserved) in Phase 2.
- **Status-strip width regression**: the new segment can break the 80-column budget. Mitigation: fixed-width bar, explicit column budgeting, and an updated strip test; the bar is the first element to yield on narrow widths.
- **Re-render leakage**: an object-returning selector would repaint the other agent. Mitigation: the selector returns a primitive `number | null`; a selector test asserts identity stability.

## Architecture Decision Records

- [ADR-001: Ambient per-agent headroom gauge over an on-demand `/usage` overlay](adrs/adr-001.md) - places context headroom as an always-on signal in the status strip and handoff preview, context-only and absence-aware.
- [ADR-002: Validation-gated honest MVP for the agent usage gauge](adrs/adr-002.md) - confirms usage emission, ships both surfaces with a neutral honest gauge, and defers thresholds and behavior telemetry to Phase 2.
- [ADR-003: Headroom derivation - raw usage fact in state, primitive selector, pure formatter](adrs/adr-003.md) - stores raw `{used,size}`, derives a rounded headroom percent in a primitive selector, and formats the percent+bar in a pure helper.
