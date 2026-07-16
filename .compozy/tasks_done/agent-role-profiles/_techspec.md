## Executive Summary

Implement the MVP as a closed `explore` policy path layered onto Kitten’s existing delegation architecture. A pure core module resolves the fixed policy and validates immutable launch snapshots; the controller obtains a provider-specific capability attestation, the store atomically reserves capacity while registering the child, and existing selectors and UI project the accepted policy or typed denial. The child receives a fresh, attested provider recipe and only the scoped built-in `ask_user` bridge.

The primary trade-off is availability for proof: V1 deliberately denies launches for every provider without current, versioned evidence of the required restrictions. This keeps the product promise truthful, but may leave the feature unavailable until at least one provider exposes a verified restricted launch contract.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
|---|---|---|
| `src/core/explorePolicy.ts` | Defines the closed `explore` policy, typed denial reasons, launch decision, and capacity validation. | Pure TypeScript; no ACP, I/O, React, or mutable state. |
| `src/core/types.ts` and `src/core/orchestration.ts` | Store immutable policy snapshots on children and apply reservation-aware delegation transitions. | Protocol-free domain state and reducer invariants. |
| `src/store/appStore.ts` | Commits registration, workspace insertion, policy snapshot, and reservation as one state transition. | Single mutable state owner; no provider or ACP decisions. |
| `src/config/configLoader.ts` plus closed verifier registry | Resolves provider recipes and yields versioned eligible or denied attestation results. | Strict config input and app-owned eligibility facts; no user safety override. |
| `src/app/controller.ts` | Runs the authoritative launch flow, creates a fresh child session, filters MCP servers, and cleans up failed/stale launches. | ACP/runtime orchestration only. |
| `src/ui/DelegationDialog.tsx`, selectors, and session views | Show availability, denial reason, active restrictions, and capacity state in existing focusable surfaces. | Presentation consumes selector projections only. |
| `src/telemetry/recorder.ts` | Emits fixed, opt-in, content-free policy outcome counters. | No prompt, task, path, identity, recipe, or raw error content. |

### Data Flow

1. The delegation dialog asks the controller for current `explore` availability; this is advisory and may become stale before launch.
2. On confirmation, the controller resolves the parent runtime and calls the closed capability verifier.
3. A missing or stale attestation returns a typed denial to the UI; no child connection, session, or reservation is created.
4. An accepted attestation becomes an immutable `ExplorePolicySnapshot`; the store invokes one reducer-backed registration transition that validates and reserves per-parent and global capacity before inserting the child.
5. The controller starts a fresh child using the attested recipe and a policy-filtered MCP server list containing only the scoped built-in question bridge.
6. Lifecycle publication remains generation-fenced. Startup failure, cancellation, terminal completion, or parent close removes the child and releases its reservation through existing delegation transitions.
7. Selectors derive role and restriction presentation from the immutable snapshot. Opt-in telemetry receives only fixed decision enums and counts.

## Implementation Design

### Core Interfaces

The following Go-shaped value contract is specification notation required by this workflow; production code uses the TypeScript counterpart below.

```go
type ExplorePolicySnapshot struct {
    Role               string
    Filesystem         string
    Shell              string
    ExternalMCP        bool
    AgentControl       bool
    AskUser            bool
    MaxDepth           int
    PerParentLimit     int
    GlobalLimit        int
    AttestationVersion string
}
```

```ts
export type ExploreLaunchDecision =
  | { readonly kind: "eligible"; readonly policy: ExplorePolicySnapshot }
  | { readonly kind: "denied"; readonly reason: ExploreDenialReason }

export interface ExploreCapabilityVerifier {
  readonly provider: ProviderKind
  attest(input: ResolvedProviderRecipe): ExploreLaunchDecision
}

export interface ExplorePolicySnapshot {
  readonly role: "explore"
  readonly restrictions: ExploreRestrictions
  readonly limits: ExploreCapacityLimits
  readonly attestationVersion: string
  readonly confirmed: ConfirmedAgentConfig
}
```

```ts
export interface ExploreLaunchRequest {
  readonly parentId: SessionId
  readonly task: string
  readonly desiredOutcome: string
}

export type ExploreLaunchResult =
  | { readonly kind: "started"; readonly childId: SessionId }
  | { readonly kind: "denied"; readonly reason: ExploreDenialReason }

export interface ControllerActions {
  startExploreChild(request: ExploreLaunchRequest): Promise<ExploreLaunchResult>
}
```

`ExploreDenialReason` is a closed enum covering unsupported provider, stale or missing attestation, parent not eligible, capacity exhausted, parent closing, and child startup failure. It contains no free-form provider output or user content.

### Data Models

| Model | Owner | Required fields | Lifecycle |
|---|---|---|---|
| `ExploreRestrictions` | Core policy | read-only filesystem, no shell, no external MCP, no agent control, built-in `ask_user` allowed, depth `0` | Fixed V1 value. |
| `ExploreCapacityLimits` | Core policy | finite per-parent and global limits | Validated before registration; no negative or unbounded value. |
| `ExplorePolicySnapshot` | Delegated child snapshot | role, restrictions, limits, attestation version, confirmed provider/model/effort display values | Created once at accepted registration; immutable; never restored. |
| `ExploreLaunchDecision` | Controller boundary | eligible snapshot or closed denial reason | Ephemeral; final decision is recomputed immediately before registration. |
| Delegation reservation | Existing delegation state | child in starting or non-terminal lifecycle counts toward limits | Created atomically with registration; removed on failure or terminal cleanup. |

Do not persist capability attestations, reservations, or child policy snapshots in session restore data. Do not add a role-profile configuration schema, database, or generic policy store for V1.

### API Endpoints

There are no HTTP endpoints. The implementation adds two internal surfaces:

| Surface | Input | Output | Contract |
|---|---|---|---|
| `ControllerActions.startExploreChild` | Parent id, task, desired outcome | Started child id or closed denial reason | Re-attests and atomically reserves; never starts an unrestricted fallback. |
| Explore availability selector | Parent id and current app state | Presentational availability and safe reason code | Advisory for the dialog only; launch revalidates authoritatively. |
| Future agent-control child-start handler | Authenticated parent identity and task request | Same `ExploreLaunchResult` | Delegates to the controller service; does not call store registration directly. |

## Integration Points

| Boundary | Integration design | Failure behavior |
|---|---|---|
| ACP provider process | Start a fresh child only from an accepted provider-specific attestation and pinned restricted recipe. | Missing, stale, or unknown proof returns `denied`; do not spawn. |
| Built-in MCP bridge | Pass the generation-scoped `ask_user` bridge to `explore` as its only MCP capability. | If the scoped bridge cannot be provisioned, deny launch rather than silently changing the approved role capability. |
| Global external MCP | Exclude all external server declarations from the `explore` child list. | No opt-out or inherited fallback. |
| Agent-control surface | Reuse the same controller policy/launch service after authenticated route resolution. | Direct invocation receives the same typed denial as UI launch. |
| Session restore | Retain normal restored conversations but initialize delegation and policy snapshots empty. | Never claim restored safety status. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/explorePolicy.ts` | new | Closed policy, denial, and capacity contracts; high invariant sensitivity. | Add pure module and exhaustive tests. |
| `src/core/types.ts` | modified | Adds immutable policy snapshot to delegated children. | Update domain types and test fixtures. |
| `src/core/orchestration.ts` | modified | Makes registration reservation-aware and releases capacity through lifecycle transitions. | Preserve no-op identity and generation invariants. |
| `src/store/appStore.ts` | modified | Commits policy snapshot, session, workspace, and reservation atomically. | Extend registration API without a second mutable owner. |
| `src/config/configLoader.ts` | modified | Supplies validated resolved provider input to closed verifier(s). | Preserve strict config errors and deny unknown proof. |
| `src/app/controller.ts` | modified | Owns attestation, fresh child launch, MCP filtering, cleanup, and typed result. | Keep ACP out of core and fence stale events. |
| `src/ui/DelegationDialog.tsx` | modified | Shows `explore` availability and specific denial copy. | Preserve component-local task draft and modal ownership. |
| `src/store/selectors.ts` and session views | modified | Project role/restriction details from child snapshot. | Keep selector caching and textual accessibility. |
| `src/telemetry/recorder.ts` | modified | Adds allowlisted policy decision metrics. | Enforce opt-in and content-free schema. |
| Future agent-control MCP handler | modified | Reuses controller launch service. | Block production enablement until same gate is proven. |

## Requirements Traceability

| PRD requirement | Technical component(s) | Verification evidence |
|---|---|---|
| Goal: clear safe availability or refusal before launch | Core decision, controller action, availability selector, delegation dialog | Unit eligibility matrix and dialog availability/denial tests. |
| Goal: no unverified child or broader fallback | Closed verifier, controller launch flow, policy-filtered MCP list | Controller integration denials prove no child process/session is created. |
| Goal: accessible active restrictions and capacity | Immutable child snapshot, selectors, session/delegation views | Selector and keyboard/textual UI tests. |
| Goal: identical promise across child-launch paths | Shared controller launch service and future agent-control handler | Integration tests call both surfaces and compare decisions. |
| Goal: opt-in content-free outcomes | Telemetry recorder schema | Recorder unit and integration schema tests. |
| Operator story: safe exploratory delegation | Accepted `ExplorePolicySnapshot` and fresh attested child launch | Accepted-launch integration test. |
| Operator story: supervise active restrictions | Snapshot selector projections | Active child view tests. |
| Operator story: understand unavailability | Closed `ExploreDenialReason` and dialog copy mapping | Denial copy and accessibility tests. |
| Operator story: predictable capacity | Reducer/store registration reservation | Concurrent and cleanup lifecycle tests. |
| Maintainer story: no entry-point drift | Shared controller policy service | UI and agent-control route integration tests. |
| Maintainer story: private policy insight | Fixed recorder event union | Content-rejection and disabled-recorder tests. |

## Testing Approach

### Unit Tests

- Add `src/core/explorePolicy.test.ts` for closed restriction values, attestation-version validation, typed denials, finite limit validation, and immutable snapshots.
- Extend `src/core/orchestration.test.ts` for per-parent/global atomic reservations, starting-child occupancy, terminal release, parent-close cleanup, duplicate events, and no-op identity preservation.
- Extend config tests for accepted known verifier inputs, unknown providers, stale evidence, invalid limits, and no user configuration override.
- Extend telemetry tests to reject all content-bearing fields and accept only fixed decision enums/counts.

### Integration Tests

- Extend controller/delegation integration tests with injected verifier and connection fakes to prove no process is started for denied decisions.
- Verify accepted launch creates a fresh child with only the scoped `ask_user` bridge and excludes global external MCP plus agent-control capability.
- Verify direct future agent-control handler use routes through the same policy service and receives identical denials.
- Verify concurrent requests cannot exceed either limit, startup failure releases the slot, and stale lifecycle publications cannot alter a replacement child.
- Add dialog/selector tests for textual availability, explicit denial, role snapshot rendering, keyboard flow, and no color-only safety signal.

Repository completion gate after implementation: `rtk bun run typecheck && rtk bun test`, then `rtk bun run selfcheck` and `rtk bun run build` because runtime boot and views change.

## Development Sequencing

### Build Order

1. Add core policy types, closed denial reasons, and pure resolver tests in `src/core/explorePolicy.ts` — no dependencies.
2. Extend delegated child types and reducer registration/reservation transitions — depends on step 1.
3. Extend store registration and cleanup methods to carry immutable snapshots atomically — depends on steps 1 and 2.
4. Add closed provider attestation and policy-filtered child launch flow in the controller/config boundary — depends on steps 1 through 3.
5. Extend built-in MCP selection and future agent-control launch routing to reuse the controller service — depends on step 4.
6. Add selector and delegation-dialog availability, denial, and active-policy presentation — depends on steps 2 through 5.
7. Add opt-in content-free telemetry decisions and complete cross-layer tests — depends on steps 1 through 6.
8. Run typecheck, full tests, self-check, build, and targeted terminal smoke evidence — depends on steps 1 through 7.

### Technical Dependencies

- The completed delegation registry remains the only lifecycle and ownership authority; do not implement a parallel child registry.
- A provider-specific restricted child recipe must exist and be testable before any provider becomes eligible. This is the principal implementation blocker.
- The planned agent-control surface must expose an authenticated child-start seam that delegates to the shared controller service before it can be production-enabled.
- Existing session restore must continue to omit live delegation ownership and effective policy snapshots.

## Monitoring and Observability

When telemetry is opted in, emit only fixed allowlisted events and counters:

| Event | Required fields | Forbidden fields |
|---|---|---|
| `explore_launch_eligible` | policy version, fixed provider kind, count | task, outcome, child id, recipe, model string, path |
| `explore_launch_denied` | closed denial reason, count | raw error, task, parent/child identity, provider config |
| `explore_capacity_denied` | scope enum, count | active child ids, task, path |
| `explore_start_failed` | fixed failure category, count | adapter output, raw error, task |
| `explore_terminal` | terminal status enum, count | transcript, outcome, identity |

Do not create remote transport, user-facing analytics, or alerting for V1. Tests must verify the disabled recorder remains a true no-op and that event schemas reject content-bearing additions.

## Technical Considerations

### Key Decisions

- **Core policy and immutable snapshot:** core resolves the fixed role; store records an accepted launch fact. This preserves layering and avoids UI/config drift.
- **Closed provider attestation:** only a versioned provider-specific verifier can make `explore` eligible. This sacrifices breadth for a truthful boundary.
- **Atomic reservation:** reducer/store registration reserves capacity before asynchronous child startup. This prevents race-driven excess children but requires robust cleanup.
- **Scoped built-in question bridge:** `ask_user` remains available under its existing generation-bound route; external MCP and agent-control tools are excluded.
- **Layered verification:** pure, controller, UI, and telemetry tests each own the invariant appropriate to their layer.

### Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No current provider can prove the required restriction set. | High | Keep all providers denied until a pinned, tested recipe and verifier exist; do not weaken the contract. |
| A startup failure leaks a capacity reservation. | Medium | Register before async startup, release through every terminal/failure path, and test idempotent cleanup. |
| Dialog availability becomes stale before confirmation. | Medium | Treat preview as advisory and re-attest plus reserve inside the authoritative launch action. |
| Global MCP configuration reaches an `explore` child. | Medium | Build its server list from accepted policy and test direct server-list assertions. |
| A stale lifecycle event mutates a replacement child. | Low | Reuse existing parent/child generation fencing and extend it to policy-bearing registration tests. |

## Architecture Decision Records

- [ADR-001: Fail Closed with an Attestable Fixed Explore Profile](adrs/adr-001.md) — Defines the original narrow, runtime-proven V1 safety boundary.
- [ADR-002: Make Verified Safe Delegation the Operator Product Contract](adrs/adr-002.md) — Commits the product to explicit safe availability and no unsafe fallback.
- [ADR-003: Resolve Explore Policy in Core and Snapshot It on Registration](adrs/adr-003.md) — Keeps policy pure and records the accepted fact immutably with the child.
- [ADR-004: Gate Explore Launches on Provider-Specific Capability Attestation](adrs/adr-004.md) — Limits eligibility to closed, current provider evidence and filters child MCP access.
- [ADR-005: Reserve Explore Capacity Atomically at Child Registration](adrs/adr-005.md) — Makes capacity a reducer/store invariant rather than a controller preflight.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — Assigns safety proof to pure, integration, UI, and telemetry test layers.
