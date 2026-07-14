# Technical Specification: Harness Delivery for Fresh Conversations

## Executive Summary

This feature adds a controller-owned, generation-scoped delivery machine that attaches the rendered #18 harness to the first visible task of a genuinely fresh ACP session. The controller owns freshness, retry safety, and recovery status; the adapter owns only certified provider-specific encoding. The store and UI receive a derived, content-free failure notice, while transcripts, handoffs, prompt history, and normal persistence continue to receive only the user's original blocks.

The design adds a small pure helper in `src/app/`, an exact runtime-profile capability registry in the existing config area, an opaque prompt envelope at the adapter boundary, a V3 content-free persisted checkpoint, and a recovery notice that reuses existing fresh-session actions. The primary trade-off is intentional: Kitten fails closed for an unknown or changed runtime profile instead of offering a universal tagged-text fallback that cannot prove the required hidden-content boundary.

The installed `@agentclientprotocol/sdk` 1.2.1 completes `prompt()` only at terminal turn response and exposes no portable hidden host-instruction field. Current ACP draft materials describe an earlier prompt-acceptance response, but V1 must not depend on that draft behavior. Therefore `delivered` means terminal prompt request resolution, not provider consumption of the harness.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| #18 harness contract | Produces deterministic `{ version, text }` guidance | Protocol-free input to this feature |
| `src/app/harnessDelivery.ts` | Calculates generation-scoped transitions and fixed failure categories | Pure, protocol-free controller helper |
| `src/app/controller.ts` | Creates delivery state from new/load/fallback/replacement facts and serializes first-turn dispatch | Sole lifecycle authority |
| `src/config/harnessCapability.ts` | Resolves exact certified recipe profiles and their encoding contract | Config/capability policy, unsupported by default |
| `src/app/actions.ts` | Keeps UI calls and visible user-turn recording unchanged while delegating delivery-aware dispatch | UI-to-controller seam |
| `src/agent/agentConnection.ts` | Converts an opaque envelope to the selected profile's ACP request | ACP-only boundary |
| Store and `ConversationView` | Renders a fixed, content-free recovery notice and invokes existing fresh-session recovery | No harness text or ACP types |
| Persistence writer and record schema | Saves and restores the content-free delivery checkpoint | No prompt or harness content |

Fresh paths create a `pending` state. A successful load creates `not_required`; a failed load that creates a fresh replacement creates `pending`; replacement increments generation and discards the old state. The first visible task moves `pending` to `in_flight` atomically, then travels to the adapter as an envelope that separates user blocks from the optional harness. A terminal prompt resolution moves to `delivered`; every post-invocation error, cancellation, close, or disposal moves to a fixed terminal failure. The UI receives only that failure category and keeps the original task available for the existing fresh-session route.

## Implementation Design

### Core Interfaces

The following Go-shaped data model is included to satisfy the workflow template. It is descriptive only; the production implementation uses the TypeScript equivalent immediately below.

```go
type HarnessDeliveryCheckpoint struct {
    Version         string
    Generation      int
    State           HarnessDeliveryState
    FailureCategory *HarnessFailureCategory
}
```

```ts
export type HarnessDeliveryState =
  | "not_required" | "pending" | "in_flight" | "delivered" | "failed"

export interface HarnessPromptEnvelope {
  readonly userBlocks: readonly PromptBlock[]
  readonly harness?: { readonly version: string; readonly text: string }
  readonly profileId?: HarnessProfileId
}
```

```ts
export interface HarnessDeliveryCheckpoint {
  readonly version: string
  readonly generation: number
  readonly state: HarnessDeliveryState
  readonly failureCategory?: HarnessFailureCategory
}
```

`harnessDelivery.ts` exposes pure `beginFresh`, `beginLoaded`, `beginDispatch`, `completeDispatch`, `failBeforeDispatch`, and `failIndeterminate` transitions. Each transition accepts the expected generation; mismatches are no-ops, preventing late work from a closed or replaced connection from mutating the current runtime.

The controller calls the helper before `actions.sendPrompt` records a visible user turn. If delivery is unsupported or already terminally failed, the controller returns a fixed failure result without recording or sending the user blocks. If delivery is pending, the controller resolves the capability profile and sends a `HarnessPromptEnvelope`; normal follow-up prompts carry only `userBlocks`.

### Data Models

| Model | Fields | Storage and validation |
| --- | --- | --- |
| `HarnessDeliveryRuntime` | live ACP session ID, generation, state, version, failure category | Controller-private; never persisted wholesale |
| `HarnessDeliveryCheckpoint` | version, generation, state, optional fixed failure category | New V3 persisted record field; strict enum validation; no IDs or content |
| `HarnessCapabilityProfile` | stable profile ID, exact recipe identity, adapter-version evidence, encoder kind, certification state | Static config registry; default deny on mismatch |
| `HarnessPromptEnvelope` | original `PromptBlock[]`, optional rendered harness, profile ID | Controller-to-adapter only; not stored in core, UI, or persistence |
| `HarnessDeliveryNotice` | fixed state, fixed failure category, recovery action | Protocol-free store/UI projection; no text from harness, task, or raw error |

Migrate the persisted run record from V2 to V3. V2 records deserialize into a missing checkpoint. A successfully loaded provider session becomes `not_required`; a fresh replacement begins `pending`; an explicit V3 unresolved or failed checkpoint produces recovery state. No migration synthesizes or replays a harness into a loaded provider conversation.

### API Endpoints

Kitten adds no HTTP or public RPC endpoints. The only external protocol interaction remains the existing ACP session operations behind `AgentConnection`.

The adapter-facing change is an internal TypeScript API: replace raw first-turn block dispatch with `HarnessPromptEnvelope`. Only an exact certified profile may turn its optional harness field into provider-specific ACP input. `PromptBlock[]` remains the visible-content model used by UI, core, store, handoff, and persistence.

## Integration Points

| Integration | Contract | Failure behavior |
| --- | --- | --- |
| #18 harness contract | Supplies a reviewed version and rendered text before first dispatch | Rendering failure becomes fixed delivery failure; do not send the visible task |
| Controller lifecycle | Supplies new, load, fallback, replacement, close, and generation facts | Generation mismatch terminalizes the old runtime only |
| ACP adapter | Accepts the opaque envelope only for a certified profile | Unknown/mismatched profile fails before dispatch |
| Runtime profile configuration | Certifies Claude Code, Codex, Cursor, and future profiles by exact recipe/version evidence | Default deny until a new profile has contract evidence |
| Persistence | Stores V3 checkpoint alongside existing content-safe run fields | Invalid checkpoint is rejected; unresolved state shows recovery rather than replay |
| Handoff | Uses the same delivery-aware dispatch while preserving previewed blocks | Hidden harness is never included in the handoff bundle |
| Conversation recovery UI | Uses existing fresh-session action and restoration-style presentation | Shows fixed content-free notice; normal success remains silent |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- |
| `src/app/harnessDelivery.ts` | new | Pure state transitions; medium correctness risk around stale generations | Add focused unit tests |
| `src/app/controller.ts` | modified | Routes lifecycle facts and first-turn delivery; high lifecycle risk | Integrate generation checks and cleanup settlement |
| `src/app/actions.ts` | modified | Preserves original-block recording while using delivery-aware dispatch | Keep UI surface and transcript contract unchanged |
| `src/config/harnessCapability.ts` | new | Exact profile certification registry; medium release-gating risk | Model on existing narrow capability gates |
| `src/agent/agentConnection.ts` | modified | Converts envelope only under a certified profile; high boundary risk | Keep ACP types and provider encoding here |
| `src/core/types.ts` and store projection | modified | Adds content-free notice only; medium leakage risk | Reject arbitrary strings and never carry harness data |
| `src/persistence/runRecord.ts` and writer | modified | Introduces strict V3 checkpoint migration; medium restore risk | Validate fixed enum-only payloads |
| `src/ui/ConversationView.tsx` | modified | Renders accessible recovery state; low visual risk | Reuse existing fresh-session action pattern |
| `test/mockAgent.ts` and contract suites | modified | Captures envelope-to-wire behavior and lifecycle matrix | Add deterministic and credentialed profile evidence |

### PRD Requirement Mapping

| PRD requirement | Technical owner |
| --- | --- |
| Predictable fresh-conversation start | Controller lifecycle state, certified profile registry, adapter envelope |
| Continuity protection | `not_required` loaded state and V3 checkpoint migration |
| Safe recovery | Terminal failure category, content-free notice, existing fresh-session action |
| Clean visible record | Original-block recording, envelope boundary, persistence and handoff assertions |
| Silent success and handoff parity | No success notice; handoff continues through existing reviewed dispatch path |

## Testing Approach

### Unit Tests

- Test every `HarnessDeliveryState` transition, including new, successful load, fresh fallback, replacement, first dispatch, terminal resolution, pre-dispatch failure, indeterminate failure, and stale generation no-op.
- Test V2-to-V3 checkpoint migration, strict enum parsing, rejected arbitrary values, and the guarantee that serialized output contains no harness or user content.
- Test exact capability matching for certified Claude Code, Codex, and Cursor recipes. Unknown recipe, version mismatch, missing evidence, and future providers must deny delivery.
- Test envelope construction preserves original `PromptBlock[]` identity and emits no harness after `delivered` or `not_required`.

### Integration Tests

- Extend the fake ACP agent to assert raw prompt requests separately from visible transcript turns.
- Cover normal fresh start, configured initial task, successful load, failed-load fallback, start-new, per-pane replacement, handoff-first dispatch, follow-up prompt, and sibling-session isolation.
- Script pre-dispatch failure, rejected/throwing prompt, partial update before failure, cancellation, transport close, and controller teardown. Assert exactly one terminal result, no automatic resubmit after possible dispatch, and a safe recovery notice.
- Assert transcript, prompt history, handoff bundle, persisted visible content, telemetry, and diagnostics never include synthetic harness text.
- Add opt-in credentialed contract tests for Claude Code, Codex, and Cursor. Each uses synthetic content, records only fixed results, and must pass before its registry entry is enabled. Every new provider requires the same test and a new explicit profile entry.

## Development Sequencing

### Build Order

1. Land #18's protocol-free versioned harness contract and deterministic renderer — no dependencies.
2. Add `HarnessDeliveryState`, pure transition helper, fixed failure categories, and unit tests — depends on step 1.
3. Add the exact capability registry and certification fixtures for Claude Code, Codex, Cursor, and future provider entries — depends on step 1.
4. Add the adapter envelope and profile-specific encoder paths, with raw-wire contract tests — depends on steps 2 and 3.
5. Integrate controller lifecycle routing, first-turn dispatch, generation guards, V3 checkpoint migration, and cleanup settlement — depends on steps 2, 3, and 4.
6. Project fixed recovery state to the store and `ConversationView`, retaining the original task through the existing fresh-session action — depends on step 5.
7. Add full lifecycle, content-boundary, handoff, sibling-isolation, and credentialed contract coverage — depends on steps 2 through 6.

### Technical Dependencies

- #18 must expose a protocol-free rendered harness with a stable version.
- The installed ACP SDK remains the V1 contract. A future SDK/protocol acceptance acknowledgement requires a separate compatibility ADR before changing `delivered` semantics.
- Credentialed profile contracts require deliberately configured, isolated test credentials and must never run by default in ordinary unit suites.
- The persisted run-record migration must preserve existing V2 restore behavior before V3 checkpoints are enabled.

## Monitoring and Observability

Record only opt-in, content-free counters and fixed fields:

- Harness version, lifecycle path, generation-relative state, profile ID, and fixed failure category.
- Counts of pending, delivered, unsupported, pre-dispatch failure, and indeterminate failure outcomes by profile.
- Counts of recovery actions offered and completed without recording task text or provider output.

Never log or persist rendered harness text, user blocks, agent output, paths, environment values, adapter command lines, raw errors, ACP session IDs, or request payloads. Emit no routine success notification; actionable notice state is sufficient for the UI. A release gate reviews any profile with nonzero indeterminate failures before broadening eligibility.

## Technical Considerations

### Key Decisions

- **Generation-scoped controller authority:** avoids stale delivery truth surviving replacement; ADR-003.
- **V3 content-free checkpoint:** preserves restart safety without payload retention; ADR-003.
- **Exact certified profiles:** supports Claude Code, Codex, Cursor, and future providers only after contract evidence; ADR-004.
- **No universal composite fallback:** avoids presenting hidden host content as portable user text; ADR-004.
- **Terminal prompt resolution defines delivery:** matches the installed SDK; do not consume draft ACP acceptance semantics.
- **New versions apply to fresh generations only:** preserves loaded provider conversation history and avoids mid-turn mutation.

### Known Risks

- **Profile drift:** adapter or recipe upgrades can invalidate a certified encoding. Mitigate with exact matching and release-gating contract tests.
- **Ambiguous first dispatch:** no ACP acceptance acknowledgement exists in the installed SDK. Mitigate by terminalizing after possible invocation and prohibiting automatic replay.
- **Late asynchronous work:** close, cancellation, or replacement may race a first turn. Mitigate with generation checks before and after every await.
- **Migration ambiguity:** old records do not have checkpoints. Mitigate by preserving successful loads as continuations and treating only explicit unresolved V3 state as recovery-required.
- **Content leakage:** multiple artifacts record visible user work. Mitigate with envelope isolation plus negative assertions across transcript, persistence, handoff, telemetry, and diagnostics.

## Architecture Decision Records

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — Establishes lifecycle authority and fail-closed delivery semantics.
- [ADR-002: Keep baseline guidance silent by default and recovery-oriented on failure](adrs/adr-002.md) — Defines the normal and degraded user experiences.
- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — Chooses the state identity, V3 checkpoint, and version behavior.
- [ADR-004: Gate harness encoding through exact certified runtime profiles](adrs/adr-004.md) — Requires explicit Claude Code, Codex, Cursor, and future-provider certification.
