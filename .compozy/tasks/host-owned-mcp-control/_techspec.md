# TechSpec: Host-Owned MCP Child Control

## Executive Summary

Implement the approved MVP by extending Kitten’s existing generated MCP child mode with one `agent_run` tool. The tool uses the current session-generation-bound local capability route, delegates all child lifecycle authority to the existing controller and delegation registry, and exposes only atomic bounded `start` plus explicit owner-scoped `poll`.

The primary trade-off is deliberate: one shared private bridge reduces duplicated authority and preserves provider neutrality, but requires generalizing the current ask-user-specific child mode and route handler. The design avoids a second orchestration model, new persistence, new UI, wait semantics, mutable child controls, and any provider-native delegation dependency.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/agent/kittenMcp.ts` | Starts the generated stdio MCP server and registers the bundled tools. | MCP SDK and stdio only; no session identity or controller access. |
| `src/agent/askUserMcp.ts` | Retains strict `ask_user` schema, normalization, and serialization as one registered bundled tool. | MCP wire contract; no store or controller imports. |
| `src/agent/agentRunMcp.ts` | Defines strict `agent_run` schemas, result serialization, and local forwarding. | MCP wire contract; no runtime ownership. |
| `src/app/kittenMcpBridge.ts` | Owns private endpoint routes, opaque capabilities, framed local requests, limits, and route invalidation. | Authenticates a route before invoking application controls. |
| `src/app/controller.ts` | Exposes route-authorized start and poll operations while retaining runtime ownership and existing lifecycle publication. | Only layer that touches agent runtimes and session creation. |
| `src/core/orchestration.ts` and `src/store/appStore.ts` | Continue to own protocol-free child identity, lifecycle projection, and atomic session/workspace registration. | Keep core unchanged; remove the UI-only selected-parent precondition from the shared store registration primitive without admitting MCP types or credentials. |
| Existing workspace views | Continue to render child lineage, status, and attention without a new result surface. | UI consumes selectors and `ControllerActions` only. |

### Data Flow

1. Controller registers one generated Kitten MCP declaration for a live session generation after all user-configured MCP declarations.
2. The bundled child process serves both `ask_user` and `agent_run` over MCP stdio; its environment carries only a private endpoint and opaque capability.
3. `agent_run` validates a discriminated request and sends one bounded JSONL frame to the local bridge.
4. The bridge resolves the capability to `{ parentId, parentGeneration }`; no public request field can select either value.
5. Controller preflights and starts a valid child batch through the existing normal-session path, or reads owner-scoped snapshots from the existing delegation projection.
6. Existing controller lifecycle publication updates the store and workspace; the bridge serializes only stable child IDs, lifecycle status, and optional terminal timestamp back to the tool caller.

### PRD Traceability

| PRD goal or user story | Technical component(s) |
| --- | --- |
| Bounded agent-initiated launch | `agentRunMcp` start schema, `KittenMcpBridge` route control, controller batch service. |
| Visible child conversations and attribution | Existing `AppStore.addDelegatedSession`, delegation reducer, workspace selectors, and views. |
| Direct recovery for `needs_input` | Existing controller status mapping and normal child conversation UI; no MCP `respond` operation in V1. |
| Provider-consistent child control | One generated bundled MCP server composed after user servers for every supported provider session. |
| Repeat-use measurement without content collection | Allowlisted local telemetry for operation outcome, batch-size bucket, status, and duration only. |

## Implementation Design

### Core Interfaces

`src/app/controller.ts` exposes this internal, route-authorized seam to the bridge. It is not part of `ControllerActions`, so neither UI components nor MCP wire code gain direct runtime access.

```ts
export interface AgentRunRoute {
  readonly parentId: SessionId
  readonly parentGeneration: number
}
export interface AgentRunTask {
  readonly task: string
  readonly desiredOutcome: string
}
export interface AgentRunSnapshot {
  readonly childId: SessionId
  readonly status: DelegatedChildStatus
  readonly terminalAt?: number
}
export interface AgentRunControl {
  start(route: AgentRunRoute, tasks: readonly AgentRunTask[]): Promise<readonly AgentRunSnapshot[]>
  poll(route: AgentRunRoute, childIds: readonly SessionId[]): readonly AgentRunSnapshot[]
}
```

The transport DTO has no task text, parent identity, generation, transcript, or interaction payload in responses.

```go
type AgentRunSnapshot struct {
    ChildID    string  `json:"child_id"`
    Status     string  `json:"status"`
    TerminalAt *int64  `json:"terminal_at,omitempty"`
}
```

### Data Models

| Model | Fields | Rules |
| --- | --- | --- |
| `AgentRunRequest` | `operation`, plus `tasks` or `child_ids` | Strict discriminated union; unknown fields rejected. |
| `AgentRunTask` | `task`, `desired_outcome` | Both non-empty and byte-bounded; duplicate entries rejected within one batch. |
| `AgentRunRoute` | `parentId`, `parentGeneration` | Created only by capability resolution; never accepted from MCP input. |
| `AgentRunSnapshot` | `child_id`, `status`, optional `terminal_at` | Contains no task text, provider detail, transcript, or interaction data. |
| `AgentRunFrame` | `kind: "agent_run"`, `callId`, `capability`, `request` | Bounded JSONL frame in the existing private local transport. |
| `AgentRunResult` | `operation`, `children` | Preserves requested order; start returns accepted children and poll returns requested owned children. |

Define `MAX_AGENT_RUN_CHILDREN = 4`. Reuse the bridge’s frame-size discipline, introduce bounded task/outcome text constants beside the new schema, and reject an empty or duplicate `child_ids` list. The maximum is per `start` request; a separate per-route in-flight operation guard returns `busy` when an overlapping start could race capacity or ownership checks.

### API Endpoints

`agent_run` is an MCP tool, not an HTTP endpoint. Its published input is a single strict operation union.

| Tool / operation | Request | Success | Failure |
| --- | --- | --- | --- |
| `agent_run.start` | `{ operation: "start", tasks: [{ task, desired_outcome }] }` with 1–4 entries | Ordered child snapshots with stable `child_id` values. | `invalid_request`, `unavailable`, or `busy`; no child is registered when preflight fails. |
| `agent_run.poll` | `{ operation: "poll", child_ids: [id, ...] }` with one or more unique IDs | Ordered current snapshots for the exact requested children. | The entire request fails closed if any ID is unknown, stale, duplicated, or not owned by the route parent. |

The result status vocabulary is exactly `starting`, `running`, `needs_input`, `finished`, `failed`, or `cancelled`. A terminal timestamp is present only for existing terminal snapshots. `needs_input` remains actionable through the normal Kitten child conversation; V1 does not serialize an interaction ID or accept a response operation.

### Controller Behavior

Refactor the current UI-facing `startDelegatedChild` flow into two layers:

- The UI adapter retains its selected-visible-parent guard and calls the shared launch primitive for one child.
- `AgentRunControl.start` receives the bridge-derived route, validates parent runtime readiness, current generation, open parent state, flat-parent eligibility, batch size, and every task before registering any child.

After successful preflight, register every accepted child as a normal background conversation before asynchronous startup. The shared store registration primitive must no longer require or force the parent to be `selectedVisibleId`; it preserves the user’s current visible selection. The UI adapter alone retains its selected-parent guard. Start accepted children concurrently. Startup failure terminalizes only the failed child through the existing controller publication helper; it does not erase accepted siblings or hide their status. `poll` reads the current store projection only after every requested identity matches the route’s parent and generation.

## Integration Points

| Boundary | Integration | Error and lifecycle behavior |
| --- | --- | --- |
| MCP stdio child mode | Compose `ask_user` and `agent_run` in one generated Kitten MCP server. | Preserve protocol-only stdout and generic tool errors. |
| Private local IPC | Extend the authenticated frame union from `ask` to `ask | agent_run`. | Reject malformed, oversized, unauthorized, duplicate, or over-limit frames before control invocation. |
| Session lifecycle | Register one route per session generation and invalidate it on replacement, close, restore, bridge failure, and dispose. | Stale or closed routes return `unavailable`; no authority is restored after restart. |
| User MCP configuration | Continue appending exactly one generated Kitten declaration after resolved user declarations. | Existing user order and degraded unavailable user servers remain unchanged. |
| Delegation registry | Consume existing child snapshots and lifecycle transitions. | No MCP types, capability values, or caller-selected parent identity enter core or store. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/agent/askUserMcp.ts` | Modified | Factor tool registration and shared child-mode constants without changing the public `ask_user` contract. Medium regression risk. | Preserve current schemas and extend same-binary tests. |
| `src/agent/kittenMcp.ts` | New | Composes the two bundled tool registrars into one stdio server. Low risk. | Add no dependencies; keep stdout protocol-only. |
| `src/agent/agentRunMcp.ts` | New | Defines the narrow public control contract and local forwarding. High input-validation risk. | Add strict Zod schemas, byte limits, generic serialization, and unit tests. |
| `src/app/askUserBridge.ts` → `kittenMcpBridge.ts` | Modified / renamed | Generalizes authenticated route and frame handling for two tool families. High authorization risk. | Keep capability lifecycle, socket bounds, and existing question behavior intact. |
| `src/app/controller.ts` | Modified | Adds route-authorized internal launch/poll and factors shared UI launch behavior. High lifecycle risk. | Preserve controller-only runtime ownership and generation fencing. |
| `src/core/` | Unchanged | Existing delegation projection already satisfies lifecycle and visibility requirements. | Do not import MCP types or add a second state model. |
| `src/store/appStore.ts` | Modified | `addDelegatedSession` currently embeds the UI’s selected-parent policy, which prevents a valid route-authorized background-parent launch. | Remove only that focus requirement and preserve the current visible selection; add store regression coverage and keep MCP types and credentials out. |
| `src/index.ts` | Modified | Runs the generalized bundled child mode behind the generated internal flag. Medium boot risk. | Preserve current internal flag compatibility while migrating composition. |
| Existing workspace views | Unchanged | Existing lineage/status/attention presentation meets MVP requirements. | Add no dashboard or MCP-specific view. |
| `src/telemetry/recorder.ts` | Modified | Adds allowlisted operation outcomes and bounded batch-size/duration measurement. Privacy risk. | Prohibit task text, IDs, paths, prompts, transcripts, and capabilities. |

## Testing Approach

### Unit Tests

- Add `src/agent/agentRunMcp.test.ts` for strict start/poll schemas, unknown-key rejection, byte and four-child limits, duplicate task and child-ID rejection, result serialization, and generic error mapping.
- Preserve `askUserMcp.test.ts` behavior and add composition tests proving both bundled tools register with their original contracts.
- Extend the generalized bridge test suite for frame discrimination, capability-only route derivation, stale and closing route rejection, per-route operation concurrency, and no controller callback after rejected input.
- Extend controller tests for full-batch preflight, no registration on invalid batches, parallel accepted startup, visible individual startup failure, owner/generation poll checks, and exact existing `needs_input` mapping.
- Retain pure delegation reducer tests for illegal transitions, self-parenting, generation mismatch, terminal immutability, and cleanup eligibility.

### Integration Tests

- Extend the same-binary MCP integration to list both `ask_user` and `agent_run`, call `agent_run` through real stdio and authenticated local IPC, and keep stdout protocol-only.
- Drive a fake bridge/control implementation through malformed, oversized, stale, cross-parent, and duplicate-ID cases; assert no child registration or information disclosure.
- Extend fake-ACP orchestration integration with a four-child start, owner-scoped poll, concurrent sibling lifecycle updates, `needs_input`, visible terminal failure, and parent replacement route invalidation.
- Run two provider sessions concurrently and assert each receives its own generated capability, can poll only its own children, and preserves configured user MCP order before the generated Kitten declaration.

## Development Sequencing

### Build Order

1. Factor the existing bundled child mode into a composition point that can register multiple tools while preserving `ask_user` behavior and internal flag compatibility — no dependencies.
2. Add `agentRunMcp` schemas, bounded request/response serialization, and unit tests — depends on step 1.
3. Generalize the local bridge to accept a discriminated `agent_run` frame and invoke an injected `AgentRunControl` — depends on steps 1 and 2.
4. Remove the selected-parent precondition from the shared store registration primitive while preserving the active visible selection; retain that policy in the UI adapter — depends on step 1.
5. Refactor controller child launch into UI and route-authorized internal paths; implement atomic preflight, four-child parallel startup, and owner-scoped polling — depends on steps 3 and 4.
6. Compose the generated server and route control in controller fresh, restored, dynamic, close, replacement, and disposal lifecycles — depends on steps 3 and 5.
7. Add controller, bridge, store, and pure lifecycle regression coverage for all rejection and terminal-state cases — depends on steps 2 through 6.
8. Extend real-stdio and fake-ACP integration coverage across both providers and user-MCP ordering — depends on step 7.
9. Add content-free telemetry events and verify allowed fields only — depends on steps 5 and 7.

### Technical Dependencies

- The existing host-owned orchestration registry and bundled ask-user MCP bridge must remain available; this work consumes both established seams.
- The direct exact `@modelcontextprotocol/sdk` dependency already supports the current same-binary MCP child mode; V1 adds no new runtime dependency.
- The existing fake ACP transport, private local socket factory, and controller injection seams provide all required automated integration infrastructure.
- Role-profile policy and managed worktree isolation remain intentionally separate follow-up work and do not block implementation of independent child tasks.

## Monitoring and Observability

- Add opt-in local counters for `agent_run` operation requested, accepted, rejected, and bridge unavailable outcomes using fixed enums only.
- Record bounded batch-size buckets, lifecycle outcome categories, and coarse duration buckets; never record task text, desired outcome, child ID, parent ID, capability, endpoint, path, provider command, prompt, or transcript.
- Treat an accepted child with no visible lifecycle transition, a route-to-wrong-parent attempt, duplicate terminal publication, or unexpected non-generic bridge error as a test/invariant failure rather than an analytics fallback.
- There is no remote alerting service in V1. Dogfood review of local opt-in aggregates and explicit error reports is the operational feedback loop.

## Technical Considerations

### Key Decisions

- **One generated bundled server:** extend the current internal child mode instead of creating a second bridge or MCP declaration.
- **Route-derived authority:** parent session and generation come only from the authenticated capability route.
- **Atomic preflight, detached execution:** validate all entries before registration, then launch accepted siblings concurrently and surface individual runtime failures normally.
- **Bounded explicit polling:** limit starts to four children and require unique owned IDs for every poll.
- **Selection-neutral store registration:** remove only the shared registration primitive’s UI focus policy so an authenticated background parent can launch visible children; preserve selection and keep the UI guard at the UI adapter.
- **No new lifecycle primitive:** defer `wait`, cancellation, steering, response forwarding, profiles, worktrees, persistence, and scheduling until later specifications define their contracts.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Generalizing the question bridge regresses existing clarification behavior | Medium | Preserve its public schema, route lifecycle, and real-stdio integration tests while composing both tools. |
| A stale or cross-parent request exposes state | Medium | Resolve route before control, require all poll IDs to match parent and generation, and return generic failure with no partial result. |
| Batch startup creates confusing partial outcomes | Medium | Separate all-or-nothing preflight from visible per-child runtime terminalization and test both paths. |
| Provider lifecycle events arrive after replacement | Medium | Reuse existing generation-fenced controller publication and invalidate routes on every lifecycle exit. |
| Parallel work overwhelms the host | Low | Enforce four-child batch limit, per-route in-flight operation guard, bounded frames, and local content-free observation. |
| Route-authorized launch changes visible focus | Medium | Keep selection handling in the UI adapter and assert store registration preserves the active visible session. |
| Unnecessary platform expansion delays the MVP | Medium | Keep UI expansion, core changes, persistence, role policy, and worktree isolation out of this task. |

## Architecture Decision Records

- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — Defines the product’s narrow V1 control surface.
- [ADR-002: Validate supervised parallel progress before autonomous orchestration](adrs/adr-002.md) — Keeps human-visible recovery and repeat use central to the MVP.
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — Reuses one route-bound bridge for four-child atomic-preflight start and explicit owner-scoped poll.
