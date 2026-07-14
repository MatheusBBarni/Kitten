## Executive Summary

This specification implements the PRD's **Per-provider personal preferences**, **Intentional default restoration**, and **Transparent partial results** through existing Kitten layers. A strict top-level `providerDefaults` configuration map remains user-authored, while a controller-owned action applies the selected session's provider default only after the explicit `/model` tab flow. The action applies model first, then resolves effort from the agent-confirmed refreshed option set.

The primary technical trade-off is sequential confirmed application instead of an artificial transaction. This preserves Kitten's truthfulness when a model changes available effort options: a failed effort yields a reducer-owned partial result showing the provider-confirmed model and effort, rather than rollback or silent substitution.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/config/configLoader.ts` | Parse and validate optional provider defaults, merge them into `AppConfig`. | Reads user configuration; never applies live agent settings. |
| `src/config/configWatcher.ts` and `src/index.ts` | Deliver a newly valid default snapshot to the controller after an external edit. | No live session mutation on reload. |
| `src/app/controller.ts` and `src/app/actions.ts` | Own the defaults snapshot and expose ordered default application through `ControllerActions`. | Only app layer that coordinates session selection and agent actions. |
| `src/agent/agentConnection.ts` | Execute existing per-option agent configuration requests. | ACP remains confined to `src/agent`. |
| `src/core/types.ts` and `src/core/sessionReducer.ts` | Represent and reduce the protocol-free terminal default-application result. | Core remains pure; reducer remains the sole session-state writer. |
| `src/store/selectors.ts` | Expose a narrow selector for the result. | Does not coordinate defaults or call agents. |
| `src/ui/ModelSelect.tsx` | Trigger one controller action after an explicit tab selection and render the result. | Presentation only; never calls a connection. |
| `src/ui/StatusStrip.tsx` | Render the same confirmed outcome in existing status feedback. | Reads selectors only. |

Data flow for an explicit provider tab is:

`config.json` → validated `AppConfig.providerDefaults` → controller snapshot → `/model` tab selection → `applyProviderDefaults(sessionId)` → existing confirmed agent option action → reducer result event → picker and status strip.

Opening `/model`, passive focus changes, startup, and configuration reloads do not enter this flow.

## Implementation Design

### Core Interfaces

The production contract is TypeScript because Kitten is a Bun/TypeScript application. No Go source is introduced; the Go-shaped notation below documents the same transport-free contract for the workflow template.

```ts
export interface ProviderModelDefault {
  model?: string
  effort?: string
}

export type DefaultApplyResult =
  | { kind: "none" }
  | { kind: "applied"; model: string; effort?: string }
  | { kind: "partial"; model: string; unavailable: "effort" }
  | { kind: "unavailable"; unavailable: "model" | "session" }

applyProviderDefaults(sessionId: SessionId): Promise<DefaultApplyResult>
```

```go
// Documentation-only structural equivalent; Kitten implementation remains TypeScript.
type ProviderModelDefault struct {
    Model string
    Effort string
}

type DefaultApplyResult struct {
    Kind string
}
```

`applyProviderDefaults` never throws into the UI. It returns `none` when the selected provider has no saved values, `unavailable` when a model or live session cannot be used, `partial` when the model confirms but effort cannot, and `applied` only when every requested configured value confirms. The action reads fresh `configOptions` after the model change before considering effort.

### Data Models

| Model | Location | Fields and rules |
| --- | --- | --- |
| `ProviderModelDefault` | Config types | Optional `model` and `effort` strings. A default can intentionally specify either value, but all supplied values are non-empty strings. |
| `providerDefaults` | `AppConfig` and user schema | `Partial<Record<ProviderKind, ProviderModelDefault>>`; defaults to an empty object and accepts only known provider keys. It is separate from spawn recipes. |
| `DefaultApplyResult` | Core domain types | Terminal result of the last explicit default attempt for one session. It contains no ACP types and no requested value that the provider did not confirm. |
| `SessionState.defaultApplyResult` | Reducer-owned session state | `DefaultApplyResult | null`, replaced only by a `default_apply_result` event; it does not modify `configOptions`. |

Configuration validation remains strict. Unknown top-level keys, unknown provider keys, empty strings, or unexpected fields in a default are configuration errors. `defaultAppConfig()` initializes `providerDefaults` to `{}`. The configuration writer is intentionally out of scope.

### Default Application Algorithm

1. Resolve the requested live session and its provider from the controller's session registry.
2. Read that provider's entry from the controller-owned defaults snapshot.
3. If no entry exists, reduce `none` and return without an agent request.
4. If a configured model is not among the session's current model options, reduce `unavailable` for `model` and return without changing the session.
5. If the configured model is available, invoke the existing `setSessionConfigOption` action and require a confirmed result.
6. After a confirmed model response, reread the session's refreshed options. If a configured effort is available, invoke the same existing action for that effort.
7. Reduce `applied` only after every configured value is confirmed. If effort is unavailable or rejects after a confirmed model, reduce `partial` and retain the post-model agent-confirmed state.
8. Route any not-ready session or transport failure through existing action error handling, reduce the appropriate unavailable result, and do not throw into React.

The result's displayed model and effort are always taken from the session's confirmed options. In particular, a provider may change the confirmed effort while confirming a model; that refreshed effort is authoritative and must not be replaced with the prior effort value.

### API Endpoints

Not applicable. Kitten is a local terminal application with no HTTP endpoint for this feature. The only external interaction remains the existing ACP option-setting request behind `AgentConnection`.

## Integration Points

| Boundary | Integration | Error behavior |
| --- | --- | --- |
| User configuration | Existing loader and watcher provide strict, validated defaults. | Keep the last valid in-memory snapshot when an external edit is malformed. |
| ACP provider adapter | Existing option-setting action sends model or effort and receives the full confirmed option set. | Preserve confirmed state and return a terminal unavailable or partial result. |
| Boot watcher | `index.ts` forwards fresh defaults to the controller without selecting or mutating a session. | Ignore invalid or unchanged reloads using current watcher behavior. |
| Opt-in telemetry | Existing local, content-free telemetry may record a bounded terminal outcome counter. | Record no model IDs, effort values, prompts, code, or agent output. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/config/configLoader.ts` | modified | Add strict provider-default parsing and merge behavior; malformed preferences must remain a boot-blocking error. | Extend schema, defaults, loader tests, and README example. |
| `src/core/types.ts` | modified | Add default preference/result types and a session-state field without ACP leakage. | Add protocol-free unions and category guards. |
| `src/core/sessionReducer.ts` | modified | Reduce one result event while preserving structural sharing and existing options. | Add event case and focused reducer tests. |
| `src/app/actions.ts` / `src/app/controller.ts` | modified | Coordinate default snapshot, model-first sequence, terminal results, and safe error handling. | Add `applyProviderDefaults` and watcher update seam. |
| `src/index.ts` | modified | Forward valid reloaded defaults without affecting current sessions. | Update watcher callback and boot integration coverage. |
| `src/ui/ModelSelect.tsx` | modified | Trigger one action only after a different explicit tab/session selection. | Preserve modal input ownership and manual selection behavior. |
| `src/store/selectors.ts` / `src/ui/StatusStrip.tsx` | modified | Show one shared result through narrow selectors. | Add labels without replacing confirmed model or effort display. |
| `test/fakeController.ts` | modified | Support default-application action assertions. | Extend fake action surface. |

## Testing Approach

### Unit Tests

- `src/config/configLoader.test.ts`: valid model-only, effort-only, and pair defaults; defaults merge correctly; strict rejection of unknown providers, keys, wrong types, and empty values.
- `src/core/sessionReducer.test.ts`: `default_apply_result` replaces only the new session field, preserves `configOptions`, and preserves unrelated session identities.
- `src/store/selectors.test.ts`: the default-result selector remains stable across unrelated session updates.
- `src/app/controller.test.ts`: no-default, unavailable-model, confirmed model, confirmed model-plus-effort, rejected effort, not-ready session, transport failure, and duplicate sessions sharing one provider default.
- `src/config/configWatcher.test.ts`: valid external edits replace the controller snapshot; invalid intermediate writes retain the previous valid snapshot.

### Integration and Rendered UI Tests

- `test/cockpitSession.test.ts`: a watcher update does not issue an option request or change a live session before an explicit `/model` tab selection.
- `src/ui/ModelSelect.test.tsx`: a different tab triggers defaults without the mid-conversation confirmation; calls are model then refreshed effort; manual selections remain unchanged until the next explicit tab selection.
- `src/ui/StatusStrip.test.tsx` and `src/ui/CockpitApp.test.tsx`: full, partial, and unavailable labels render in the existing surfaces and preserve narrow-width behavior.
- `test/fakeController.ts`: fake actions expose deterministic default outcomes and call order for rendered tests.

After implementation, run `bun run typecheck && bun test`. Because the feature affects the boot watcher and view tree, also run `bun run selfcheck`. New tests must use injected connections and the in-memory terminal renderer; they must not spawn real agents or touch the user's configuration.

## Development Sequencing

### Build Order

1. Define protocol-free default preference, result, state, and event types in core — no dependencies.
2. Extend strict config parsing, default construction, merge behavior, and loader tests — depends on step 1.
3. Add reducer handling and narrow selector coverage for default results — depends on step 1.
4. Add the controller defaults snapshot, watcher update seam, and ordered `applyProviderDefaults` action — depends on steps 1, 2, and 3.
5. Forward valid watcher default updates from boot without mutating live sessions — depends on steps 2 and 4.
6. Trigger the controller action from the existing explicit `/model` tab flow — depends on step 4.
7. Render shared terminal outcomes in `ModelSelect` and `StatusStrip` — depends on steps 3 and 6.
8. Extend controller, watcher, fake-controller, rendered UI, and boot integration tests — depends on steps 2 through 7.
9. Add documentation and optional content-free outcome telemetry after functional behavior is covered — depends on steps 4 through 8.
10. Run the full verification gate and inspect the actual output — depends on steps 1 through 9.

### Technical Dependencies

- Existing ACP adapters must continue to advertise model and effort options through the established session configuration surface.
- No new package, service, storage backend, or network endpoint is required.
- The feature depends on current configuration watcher behavior for safe external-edit detection; invalid configuration remains a hard error at load time and does not replace a prior valid runtime snapshot.

## Monitoring and Observability

- Reuse opt-in local telemetry only for content-free terminal outcome counters: `applied`, `partial`, `unavailable`, and `none`.
- Do not record configured or confirmed model names, effort values, provider commands, prompts, code, transcripts, or agent output.
- Reuse existing user-visible error reporting for agent failures; the picker and status strip remain the primary user-visible explanation of the terminal result.
- No alerting or external reporting is introduced because telemetry stays local and opt-in.

## Technical Considerations

### Key Decisions

| Decision | Rationale | Trade-off | Rejected alternative |
| --- | --- | --- | --- |
| Top-level `providerDefaults` map | Separates declarative preferences from provider process recipes. | Adds a new config section. | Embedding preferences in provider recipes. |
| Controller-owned `applyProviderDefaults` action | Keeps UI presentation-only and concentrates ordered, safe agent interaction. | Adds a controller action and snapshot. | Sequencing raw calls in `ModelSelect`. |
| Model then refreshed effort | The agent-confirmed model can change available effort options. | A pair can end as a visible partial result. | Cached effort, optimistic rollback, or silent fallback. |
| Reducer-owned session result | Existing picker and status strip need one shared, truthful outcome. | Adds a small session-state field and selector. | Overlay-local result state. |

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Provider model change refreshes the current effort | High | Treat post-model confirmed options as authoritative and render a partial result if saved effort cannot apply. |
| Rapid tab changes overlap default attempts | Medium | Keep actions serialized per selected session and associate every result with the targeted session. |
| External edit is temporarily malformed | Medium | Preserve the last valid controller snapshot; do not update it until the watcher confirms a valid replacement. |
| New result state causes broad UI rerenders | Low | Expose it through a narrow selector and retain reducer structural sharing. |
| Config key is mistaken for an agent control | Low | Keep the map top-level, strict, documented, and limited to model and effort. |

## Architecture Decision Records

- [ADR-001: Apply per-provider defaults on intentional model-session selection](adrs/adr-001.md) — establishes the user-facing automatic behavior and confirmed-state rule.
- [ADR-002: Restore configured defaults on each intentional provider selection](adrs/adr-002.md) — establishes temporary manual overrides and partial-result behavior.
- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — keeps preferences separate from spawn recipes and orchestration outside the UI.
- [ADR-004: Sequence defaults from agent-confirmed model state](adrs/adr-004.md) — resolves effort only from refreshed model-confirmed options and stores a shared terminal result.
