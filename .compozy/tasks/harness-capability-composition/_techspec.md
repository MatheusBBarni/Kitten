# Harness Capability Composition

## Executive Summary

This specification implements the PRD’s truthful fresh-session guidance by adding one pure TypeScript composition module in `src/core/`. The controller derives a closed, protocol-free capability context for its current fresh generation, passes the static composition blocks to the existing harness renderer, and sends the resulting envelope through the unchanged certified adapter path. V1 activates only the Kitten MCP bridge and child-control fragment; all other capability facts are represented as a closed vocabulary but select no fragment until their sources are independently certified.

The primary trade-off is deliberately narrow scope. Keeping composition pure and generation-scoped requires a small controller integration and removal of adapter-side bridge auto-injection, but it preserves the existing architecture: the core has no ACP or I/O, the controller owns lifecycle truth, and the adapter only encodes an explicitly supplied envelope. Composition metadata remains live-runtime and opt-in telemetry only, avoiding a persistence migration at the cost of losing restart-time diagnostics.

## System Architecture

### Component Overview

| Component | Location | Responsibility | Boundary |
| --- | --- | --- | --- |
| Capability composer | `src/core/harnessCapabilityComposition.ts` | Selects reviewed static blocks from a closed protocol-free context and returns content-free selection metadata. | Pure core; no ACP, controller, bridge, telemetry, or persistence imports. |
| Harness renderer | `src/core/harnessPrompt.ts` | Validates, orders, bounds, and renders the base contract plus blocks. | Remains unaware of capability facts and delivery. |
| Session controller | `src/app/controller.ts` | Derives current-generation facts, captures and revalidates a fresh-session context, invokes composition before first dispatch, and emits content-free telemetry. | Sole lifecycle owner; does not build prompt text inline. |
| Kitten MCP bridge | `src/app/kittenMcpBridge.ts` | Supplies the generation-bound declaration used to confirm the V1 bridge/child-control fact. | Endpoint and capability token never cross into core or telemetry. |
| Adapter envelope | `src/agent/agentConnection.ts` | Validates the exact certified runtime profile and encodes only harness guidance supplied in `HarnessPromptEnvelope`. | Removes automatic bridge-guidance injection. |
| Telemetry recorder | `src/telemetry/recorder.ts` | Records opt-in, closed, content-free composition outcomes. | No prompt, task, repository, path, secret, ACP, recipe, or raw-error fields. |
| Run persistence | `src/persistence/runWriter.ts` | Continues persisting delivery state only. | No composition-result schema change in V1. |

Fresh-session data flow:

```text
controller opens fresh ACP generation
  -> registers generation-bound bridge declaration
  -> captures protocol-free candidate context
  -> first visible prompt revalidates current generation facts
  -> core composer selects static blocks
  -> existing renderer creates bounded harness text
  -> adapter encodes supplied envelope for an exact certified profile
  -> controller records content-free optional telemetry
```

Loaded-session flow remains unchanged: its delivery state is `not_required`, it receives no newly composed harness, and the adapter must not add bridge guidance solely because a bridge server is attached.

### PRD Mapping

| PRD goal or story | Technical component(s) |
| --- | --- |
| Truthful fresh-session guidance | Closed context, pure composer, renderer integration, exact envelope path. |
| Valid base-only experience | Composer returns no blocks for unknown, absent, stale, or conflicting facts. |
| Silent healthy operation | No UI component changes; optional telemetry only, with existing content-free recovery behavior retained. |
| Stable conversation continuity | Controller generation fences; loaded delivery remains `not_required`; adapter no longer autonomously injects guidance. |
| One proven V1 bridge slice | Generation-bound bridge fact and one static catalog fragment for supervised `ask_user` and `agent_run`. |
| Staged capability growth | Closed capability vocabulary and catalog entries that stay inactive until a future source is confirmed. |

## Implementation Design

### Core Interfaces

The repository is TypeScript-first; these contracts use the project’s source language as selected during clarification. Each example remains below 20 lines.

```ts
export type CapabilityFact = "confirmed" | "absent" | "unknown"

export interface HarnessCapabilityContext {
  readonly version: HarnessPromptVersion
  readonly generation: number
  readonly bridgeChildControl: CapabilityFact
  readonly clarification: CapabilityFact
  readonly managedWorktree: CapabilityFact
  readonly steering: CapabilityFact
  readonly role: "ordinary" | "explore" | "unknown"
  readonly handoff: CapabilityFact
}
```

```ts
export interface HarnessComposition {
  readonly blocks: readonly HarnessBlock[]
  readonly version: HarnessPromptVersion
  readonly fragmentIds: readonly string[]
  readonly selectedCount: number
  readonly baseOnly: boolean
}

export function composeHarnessCapabilities(
  context: HarnessCapabilityContext,
): HarnessComposition
```

`HarnessCapabilityContext` contains no provider identity, ACP session ID, bridge declaration, endpoint, capability token, path, user content, repository content, environment value, or error. `generation` is a controller-supplied monotonic value used only to prevent stale runtime facts from crossing the controller boundary; core does not inspect runtime state.

V1 catalog behavior:

| Stable fragment ID | Activation predicate | Static guidance scope |
| --- | --- | --- |
| `capability.kitten-mcp.v1` | `bridgeChildControl === "confirmed"` | The session may use the exposed structured-question and supervised child-control operations according to their schemas; Kitten remains the host and supervisor. |
| Future clarification, role, worktree, steering, and handoff IDs | No V1 predicate activates them. | Reserved only after source-specific ADR and evidence exist. |

The catalog is a fixed internal array, not a plugin registry. It has one V1 block, returns blocks in stable ID order, and delegates all block validation, escaping, count, and token limits to `renderHarnessPrompt`.

### Data Models

`AgentRuntime` gains an optional in-memory composition snapshot for the current fresh generation:

| Field | Type | Lifetime | Notes |
| --- | --- | --- | --- |
| `harnessComposition` | `HarnessComposition \| null` | Current controller generation only | Replaced on fresh replacement and cleared on dispose; never persisted. |
| Candidate context | `HarnessCapabilityContext` | Local calculation only | Captured after fresh session setup and recalculated immediately before first dispatch. |
| Telemetry outcome | Closed record | One composition event | Contains only version, static IDs, selected count, and `baseOnly`. |

The controller derives `bridgeChildControl: "confirmed"` only when all of the following are true for the current generation:

1. The runtime is ready and is in a fresh-delivery state.
2. `bridgeGeneration` equals the current generation.
3. `bridgeMcpServer` exists for that generation.
4. Fresh `session/new` completed for that same generation.

Any failed registration, generation mismatch, replacement, disposal, missing declaration, or invalidated state becomes `"unknown"` or `"absent"` and produces base-only output. The controller recalculates immediately before first dispatch; after a harness is dispatched, no mutation or recomposition is allowed for that generation.

No persisted run-record fields change. Existing V3 harness-delivery checkpoints continue to include only version, generation, lifecycle state, and fixed failure category.

### API Endpoints

No HTTP or public API endpoints are introduced. The existing ACP prompt envelope remains the only transport surface:

| Internal surface | Change |
| --- | --- |
| `HarnessPromptEnvelope` | No shape change; its optional harness text comes from the composed renderer result. |
| `AgentConnection.prompt` | Continues to encode only the supplied envelope after exact profile validation. |
| Kitten MCP server | Keeps existing `ask_user` and `agent_run` schemas; composition does not add, grant, or alter tools. |

## Integration Points

| Boundary | Integration | Error and lifecycle behavior |
| --- | --- | --- |
| Certified harness profiles | The controller still resolves existing exact profile eligibility before dispatch. | Unsupported or incomplete profile evidence follows the existing fail-closed delivery path; composition never overrides it. |
| Kitten MCP bridge | Controller uses its generation-bound registration as the sole V1 capability source. | Registration failure, mismatch, or invalidation produces base-only composition and never exports private bridge values. |
| Adapter encoding | Remove server-name-driven `ASK_USER_MCP_HOST_GUIDANCE` injection; accept only explicit envelope guidance. | Exact recipe/profile matching and adapter failure behavior remain unchanged. |
| Opt-in telemetry | Add one closed composition outcome record after final selection. | Recorder failures are non-fatal and routed through existing error handling; no content is logged. |
| Persistence and restore | Deliberately unchanged. | Fresh fallback or replacement recomputes; successful load remains harness-free. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/harnessCapabilityComposition.ts` | new | Pure closed vocabulary and static V1 catalog; low runtime coupling, high boundary importance. | Add implementation and colocated matrix/golden tests. |
| `src/core/harnessPrompt.ts` | unchanged consumer | Continues validation and rendering; composition supplies its blocks. | Retain existing behavior; add only integration assertions if needed. |
| `src/app/controller.ts` | modified | Derives generation-valid context, stores ephemeral result, renders selected blocks at first dispatch, and records telemetry. | Add injectable composer/context seams and lifecycle tests. |
| `src/agent/agentConnection.ts` | modified | Stops automatic bridge-guidance injection while preserving envelope encoding and profile verification. | Update envelope and restored-session tests. |
| `src/app/kittenMcpBridge.ts` | unchanged source | Provides declaration/lifetime facts only. | Reuse current registration and invalidation behavior; verify its fact mapping. |
| `src/telemetry/recorder.ts` | modified | Adds an opt-in closed composition event. | Add field-boundary tests and preserve content-free rules. |
| `src/persistence/runWriter.ts` | unchanged | Delivery checkpoint remains lifecycle-only. | Add negative regression coverage proving composition is not persisted. |

## Testing Approach

### Unit Tests

Add `src/core/harnessCapabilityComposition.test.ts` beside the new module. Cover:

- V1 bridge confirmation selects exactly `capability.kitten-mcp.v1` with its fixed static text.
- Unknown, absent, stale, and conflicting facts select no blocks and set `baseOnly: true`.
- Every inactive future capability family remains block-free in V1.
- Equivalent contexts produce identical ordered IDs and blocks regardless of construction order.
- The result carries no dynamic values, bridge details, path, provider, user text, repository text, environment data, or raw error.
- Source-boundary assertions prove the core composer imports no ACP, app, bridge, config, telemetry, persistence, or UI module.

Extend `src/core/harnessPrompt.test.ts` only to demonstrate the composer’s V1 blocks retain existing validation, lexical order, escaping, 8-block limit, and 800-extension-token bound.

### Integration Tests

Add controller tests using its injectable seams and fake connections; no test spawns a real agent or terminal. Cover:

- A confirmed bridge on a fresh generation yields the composed envelope exactly once on the first visible prompt.
- A base-only fresh generation yields no optional block and remains a valid dispatch.
- Follow-up prompts send no harness; replacement and fresh fallback recompute for the new generation.
- A successful loaded session remains `not_required` and receives no composed harness even when a bridge declaration exists.
- Bridge invalidation or a stale generation before first dispatch recomputes to base-only rather than claiming the fragment.
- Exact certified profile eligibility remains the required delivery gate and is independent of the V1 bridge fact.
- The adapter encodes explicit envelope text but never autonomously adds bridge guidance, including on restored sessions.
- Telemetry contains only version, selected static IDs, count, and base-only status; persisted run records contain no composition result.

Keep existing bridge, `agent_run`, and `ask_user` integration coverage intact. Add or update their assertions only where they prove that the static V1 wording matches the existing exposed tool schemas and supervision limits.

## Development Sequencing

### Build Order

1. Add the pure TypeScript capability context, static V1 catalog, composer result, and exhaustive core matrix tests in `src/core/`; no dependencies.
2. Add controller-local context derivation and an injectable composer seam; depends on step 1’s types and pure behavior.
3. Capture/revalidate composition for fresh generations and pass selected blocks into the existing renderer at first dispatch; depends on steps 1 and 2.
4. Remove adapter-side automatic bridge guidance and update envelope handling tests; depends on step 3 so the catalog is the single wording owner.
5. Add the closed opt-in telemetry record and persistence-negative coverage; depends on steps 1 and 3 for the final result shape.
6. Add controller lifecycle, adapter, bridge, and end-to-end regression coverage; depends on steps 2 through 5.
7. Run the repository quality gate and inspect the scoped diff; depends on steps 1 through 6.

### Technical Dependencies

- The existing #18 harness renderer must continue to accept reviewed static blocks and enforce its current bounds.
- The existing #19 first-dispatch lifecycle and certified profile registry must remain authoritative for delivery eligibility and transport safety.
- The generated Kitten MCP bridge must remain bound to session ID and generation before it can certify the V1 fragment.
- No new package, external service, directory tree, persisted schema, or provider-native capability assumption is required.

## Monitoring and Observability

Emit one opt-in content-free composition outcome after final selection:

| Field | Allowed values |
| --- | --- |
| Contract version | Static supported version such as `v1`. |
| Fragment IDs | Static catalog IDs only. |
| Selected count | Bounded integer `0..8`. |
| Base-only | Boolean. |
| Outcome | Fixed success, rejected, or pre-dispatch failure code. |

Do not emit rendered harness text, user or repository content, task text, paths, bridge endpoint or capability token, ACP session ID, provider recipe, environment variables, telemetry exception text, or raw errors.

Track aggregate selected-fragment and base-only counts during opt-in rollout. Treat any render rejection, prohibited-field test failure, or false-capability incident as release-blocking. A high base-only rate is not an alert by itself because it is a valid state; it becomes a product investigation only when it diverges from the enabled capability population.

## Technical Considerations

### Key Decisions

- **Pure composer beside the renderer:** selected because it preserves core purity and creates a small deterministic unit-test surface. Extending the renderer or selecting text in the controller would merge incompatible responsibilities.
- **Generation-valid V1 bridge fact:** selected because a generated server declaration alone can survive lifecycle paths where optional guidance must not. The controller checks current fresh-generation evidence before first dispatch.
- **Catalog-owned bridge wording:** selected because adapter auto-injection can reach restored sessions and duplicate the fresh-only fragment. The adapter remains envelope-only.
- **Ephemeral, telemetry-only metadata:** selected because persisted fragment IDs would widen the V3 run record and make historical selection look authoritative after a restart.
- **Three-layer verification matrix:** selected because a pure pass cannot prove lifecycle timing, and controller coverage cannot prove the adapter stopped injecting guidance.

### Known Risks

- **Adapter regression on restored sessions:** Removing automatic bridge wording can alter existing behavior. Mitigate with explicit loaded-session and envelope tests that preserve bridge provisioning while prohibiting new hidden guidance.
- **Stale composition candidate:** A bridge can be invalidated before first dispatch. Mitigate by recomputing from the current generation immediately before rendering and defaulting to base-only.
- **Catalog expansion becomes a prompt platform:** Future features may attempt dynamic wording or unbounded registration. Mitigate with the closed context, fixed static catalog, renderer bounds, and an ADR plus test update for every new fragment.
- **Telemetry leaks hidden data:** A convenient diagnostic field can violate the content-free contract. Mitigate with a closed event type, negative assertions, and no dynamic string fields.
- **Certified profile drift:** A changed adapter recipe can fail the existing delivery gate. Mitigate by preserving exact-profile logic and treating this feature as independent from provider certification.

## Architecture Decision Records

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — establishes default-deny, fresh-generation snapshots and base-only fallback.
- [ADR-002: Make Truthful Capability Guidance a Silent Fresh-Run Default](adrs/adr-002.md) — sets silent healthy behavior, new-run activation, and the staged user rollout.
- [ADR-003: Compose Capabilities in Core and Make the Adapter Envelope-Only](adrs/adr-003.md) — selects a pure TypeScript composer and removes automatic adapter bridge guidance.
- [ADR-004: Keep Composition Metadata Ephemeral and Telemetry-Only](adrs/adr-004.md) — avoids persistence changes while enabling bounded opt-in diagnostics.
