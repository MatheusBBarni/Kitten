# TechSpec: Cursor ACP Readiness and Truthful Model Controls

## Executive Summary

This specification implements the PRD's supported first-task journey by extending Kitten's existing Cursor seams rather than adding a provider subsystem. Certification stays in the compiled exact-profile registry; preflight remains in configuration/readiness; the adapter owns ACP initialize, authentication, session creation, and configuration updates; the controller owns a new selected-session recheck; and the model selector projects the existing normalized runtime state before evaluating live options.

The primary trade-off is narrow support and explicit renewal work in exchange for a small, auditable trust boundary. V1 deliberately does not discover compatible profiles dynamically, synthesize controls from the direct Cursor CLI, restart the whole cockpit, or add a generic provider-restart framework. Every state remains evidence-led, per-session, and fail-closed.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
|---|---|---|
| `src/config/configLoader.ts` | Defines the built-in `agent acp` recipe, exact reviewed Cursor profiles, and strict profile matching. | Owns compiled profile data; never accepts a user-supplied certification override. |
| `src/config/readiness.ts` | Performs local preflight and maps exact-profile failures to bounded readiness causes. | Produces only preflight outcomes; does not start ACP. |
| `src/agent/agentConnection.ts` | Runs ACP initialize, validates the advertised Cursor login method, authenticates, creates sessions, and applies session config. | The only layer that imports ACP protocol types or calls ACP methods. |
| `src/core/types.ts` and `src/core/sessionReducer.ts` | Holds protocol-free `ConfigOption[]` and atomically reduces confirmed `config_options` domain events. | Pure core; no process, provider, or UI I/O. |
| `src/store/appStore.ts` and `src/store/selectors.ts` | Publishes immutable session availability and visible configuration slices. | The store remains the single mutable state owner. |
| `src/app/controller.ts` and `src/app/actions.ts` | Starts one configured session, contains failure normalization, exposes selected-session recheck, and routes confirmed option changes. | UI-facing orchestration only; catches action failures. |
| `src/ui/ModelSelect.tsx` and `src/ui/CockpitApp.tsx` | Renders either an unready Cursor recovery state, ready session controls, or ready-but-no-options state. | Uses selectors and `ControllerActions`, never an ACP connection. |
| `test/cursorAcp.contract.test.ts` | Records opt-in, content-free native evidence for the reviewed local Cursor runtime. | Disabled by default; never substitutes for deterministic tests. |

### Runtime Flow

```text
compiled exact Cursor profile
  -> preflight readiness
  -> AgentConnection.initialize
  -> advertised cursor_login authenticate
  -> session/new
  -> confirmed config_options domain event
  -> core reducer and store
  -> controller actions and selector UI

user recovery -> ControllerActions.recheckCursor(sessionId)
  -> restart only that configured session's preflight/connection flow
  -> replace only that session's availability/runtime state
```

The first line applies only after a literal profile is added following ADR-003's gate. Until then, the same flow terminates at `uncertified_recipe`, which remains a truthful, visible Cursor-only state rather than a generic model-picker failure.

## Implementation Design

### Core Interfaces

The template requires a Go interface. This is a protocol-neutral contract sketch only; Kitten's implementation remains TypeScript and must not add Go source.

```go
type CursorRechecker interface {
    RecheckCursor(sessionID string)
}
```

The controller exposes one narrow no-throw action. The implementation catches asynchronous failures and emits existing normalized availability state rather than leaking a rejected promise into React.

```ts
export interface ControllerActions {
  recheckCursor(sessionId: SessionId): void;
}

export type CursorConfigCapabilityResult =
  | "not_advertised"
  | "accepted"
  | "rejected";
```

The adapter keeps the confirmed-only config path. It calls the live ACP operation only for an option currently advertised by the session and returns the complete agent-confirmed snapshot. The store never performs an optimistic local option mutation.

```ts
async setSessionConfigOption(
  sessionId: SessionId,
  configId: string,
  value: string,
): Promise<readonly ConfigOption[]>;
```

### Data Models

| Model | Location | Change | Invariant |
|---|---|---|---|
| `CertifiedCursorRuntimeProfile` | `src/config/configLoader.ts` | Reuse unchanged shape; add one literal only after reviewed evidence. | Exact command, ordered args, complete environment, and exact semantic version. |
| Cursor readiness cause | `src/config/readiness.ts` plus controller runtime state | Reuse bounded `binary_not_found`, `uncertified_recipe`, `version_mismatch`, `authentication_required`, and `handshake_failed` handling. | No raw provider error, command, path, version, or credential crosses into UI or telemetry. |
| `ConfigOption[]` | `src/core/types.ts` and session reducer | Reuse existing protocol-free state and wholesale confirmed updates. | Visible model/effort options originate only from the active session snapshot. |
| `CursorConfigCapabilityResult` | Native contract evidence only | Add the three closed values above. | Persist no option ID, option value, prompt, account, raw protocol output, or credential. |
| Recheck request | `ControllerActions` only | Accept one existing configured `SessionId`; add no persisted request model. | Recheck affects only the chosen unavailable Cursor session. |

No database, config-file schema, or runtime-persistent certification store is introduced. The existing compiled registry is the source of truth for support; native evidence is a reviewed release artifact, not application state.

### API Endpoints

Kitten exposes no HTTP API for this work. The only external operations are existing ACP calls inside `src/agent/agentConnection.ts`.

| Operation | Preconditions | Required behavior |
|---|---|---|
| `initialize` | Local preflight accepted the exact profile. | Negotiate protocol and capability state once for the connection. |
| `authenticate` | `initialize` advertised the certified `cursor_login` method. | Authenticate with the advertised method before session creation; normalize failure to `authentication_required`. |
| `session/new` | Initialization and authentication succeeded. | Create the runtime session and emit its confirmed config options. |
| `session/set_config_option` | The ready session advertises a visible selectable option. | Submit only an advertised current value or user choice; consume the complete confirmed options snapshot. |

`agent --list-models`, direct `--model` arguments, and unadvertised option IDs are not protocol operations and are prohibited as alternate sources of truth.

## Integration Points

| Integration | Authentication and authorization | Failure handling |
|---|---|---|
| Local Cursor `agent acp` subprocess | Cursor's native advertised `cursor_login`; Kitten never stores credentials. | Preflight rejects an unreviewed recipe/version; adapter classifies native login failure; all other ACP failures become bounded handshake failure. |
| ACP session configuration | Existing authenticated session only. | A missing advertised option results in `not_advertised`; a rejected live request results in `rejected`; neither enables a direct CLI fallback. |
| Existing Claude Code and Codex sessions | No new integration. | Controller recheck targets one selected Cursor session; healthy siblings retain their state and usability. |
| Local opt-in diagnostics | User-controlled, content-free local recording only. | Contract evidence records closed outcomes; Phase 1 adds no free-form telemetry. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/config/configLoader.ts` | Modified | Adds a reviewed literal profile only after native evidence. High trust-boundary risk. | Preserve exact matcher and reject all profiles outside the reviewed snapshot. |
| `src/config/readiness.ts` | Modified or covered | Confirms existing causes and recovery wording distinguish unsupported profiles from user-remediable conditions. Medium UX risk. | Add focused cause/recovery assertions without changing cross-provider semantics. |
| `src/agent/agentConnection.ts` | Modified or covered | Native config evidence must use the existing negotiated session path. High protocol-boundary risk. | Keep all ACP calls here and return only confirmed config snapshots. |
| `src/app/controller.ts` | Modified | Adds selected-session Cursor recheck orchestration. Medium lifecycle risk. | Restart only the selected unavailable configured session and preserve sibling state. |
| `src/app/actions.ts` | Modified | Adds the UI-safe recheck action. Low surface-area risk. | Expose no connection or provider internals to UI components. |
| `src/ui/ModelSelect.tsx` | Modified | Chooses recovery copy before generic empty-options copy. Medium truthfulness risk. | Render unready recovery, ready controls, and ready/no-options as three distinct states. |
| `test/cursorAcp.contract.test.ts` | Modified | Adds closed live-config capability evidence. High release-gate risk. | Keep opt-in, content-free, and non-mutating by submitting only a current advertised value. |
| Focused tests and docs | Modified | Captures support boundary and prevents copy/telemetry drift. Medium regression risk. | Extend colocated tests plus `cursorDocumentation.test.ts` and telemetry coverage as needed. |

## Testing Approach

### Unit Tests

- `src/config/configLoader.test.ts`: exact reviewed profile acceptance; altered command, ordered args, environment, or version rejection; no profile guessed before evidence.
- `src/config/readiness.test.ts`: bounded Cursor preflight causes and distinct user-remediable versus certification-pending recovery text.
- `src/agent/agentConnection.test.ts`: initialize before authentication; advertised `cursor_login` required before `session/new`; absent/rejected login; complete confirmed config snapshot after live update.
- `src/core/sessionReducer.test.ts` and selector coverage: config options replace atomically; only `model` and `thought_level` remain visible; no optimistic state mutation.
- `src/app/controller.test.ts` and `src/app/actions.test.ts`: `recheckCursor` restarts only the target unavailable Cursor session, catches failure, and leaves ready siblings untouched.
- `src/ui/ModelSelect.test.tsx` and `src/ui/CockpitApp.test.tsx`: unready Cursor recovery takes precedence over generic no-options copy; ready Cursor with no advertised option has the explicit provider-specific state; active-session controls still apply confirmed options.
- `src/telemetry/recorder.test.ts` and `test/cursorDocumentation.test.ts`: outcome enums remain closed/content-free and docs remain local-only with no exact version or cloud claim.

### Integration Tests

- Use existing mock ACP agents to exercise complete configure → initialize → authenticate → session → selector flows without credentials.
- Run the normal suite with no Cursor executable present to prove deterministic isolation and preserved Claude/Codex behavior.
- Run `KITTEN_CURSOR_ACP_CONTRACT=1` only on the reviewed local macOS Cursor installation. The contract must prove exact profile matching, initialization, native authentication, session creation, a completed synthetic prompt, safe permission behavior, clean disposal, and one closed config-capability result.
- Contract cases are: no visible option (`not_advertised`), a visible option accepted (`accepted`), or a visible option explicitly rejected (`rejected`). Do not persist raw option details or use a direct Cursor CLI fallback.

## Development Sequencing

### Build Order

1. **Establish focused baseline tests and native-contract evidence shape** — no dependencies; document the closed `CursorConfigCapabilityResult` and verify existing config/readiness/selector behavior before modification.
2. **Preserve exact compiled-profile and preflight contracts** — depends on step 1; add or adjust configuration/readiness tests, but do not add a production profile until reviewed evidence exists.
3. **Extend adapter and native-contract live-config evidence** — depends on steps 1 and 2; keep ACP calls in `AgentConnection`, add mock coverage, and extend the opt-in contract with the non-mutating closed probe.
4. **Add selected-session `recheckCursor` controller action** — depends on steps 1 and 2; reuse existing start and availability paths while constraining effects to the selected unavailable Cursor session.
5. **Project readiness before options in the model selector** — depends on steps 3 and 4; render the three distinct Cursor states and route recheck only through `ControllerActions`.
6. **Align onboarding, telemetry guards, and focused tests** — depends on steps 2, 3, 4, and 5; preserve local-only language and closed content-free outcome boundaries.
7. **Execute deterministic verification** — depends on steps 1 through 6; run `rtk bun run typecheck && rtk bun test`, then `rtk bun run selfcheck` and the relevant build when boot-visible behavior changes.
8. **Review native certification evidence and add the literal profile if proven** — depends on steps 2, 3, 6, and 7; run the opt-in contract on the reviewed macOS installation, review the artifact, and only then commit the exact profile literal.

### Technical Dependencies

- A local macOS Cursor installation with the `agent` executable, authenticated account, and reviewed exact runtime details is required before any profile literal can be added.
- Cursor must advertise the certified authentication method after ACP initialization; otherwise certification remains blocked.
- The native session must either advertise a safe visible configuration option or return the closed `not_advertised` state.
- Existing ACP SDK and Cursor adapter contracts must remain compatible with the pinned project dependencies; a negotiated protocol mismatch remains a handshake failure.

## Monitoring and Observability

- Preserve the existing default-off, local-only `provider_readiness` categories: `ready`, `binary_missing`, `version_mismatch`, `uncertified_recipe`, `authentication_required`, and `handshake_failed`.
- Do not add command, profile, version, path, raw error, credential, prompt, code, option identifier, or option value to telemetry or contract evidence.
- Record the opt-in native contract's closed config result only in its reviewed local artifact: `not_advertised`, `accepted`, or `rejected`.
- Keep Phase 1 free of first-task aggregation. Phase 2 may add a separately reviewed, closed outcome category only if the PRD's opt-in reliability observation proceeds.
- Treat a new recurring `authentication_required`, `handshake_failed`, or config rejection outcome during native review as a reason to withhold, narrow, or revoke the exact profile rather than broaden fallback behavior.

## Technical Considerations

### Key Decisions

| Decision | Rationale | Trade-off | Rejected alternative |
|---|---|---|---|
| Compiled exact-profile certification | Reuses the existing strict trust boundary and prevents profile drift. | Manual renewal work. | Manifest, user override, discovery, and version ranges. |
| Selected-session recheck | Completes recovery without disrupting healthy sessions. | Adds a narrow controller lifecycle path. | App restart, no recheck, and generic provider restart. |
| Closed native config probe | Proves negotiated live-config behavior without recording provider data or mutating the active choice. | One additional native request. | Observe-only evidence, deferment, and direct CLI flags. |
| Readiness-first selector rendering | Prevents an unready session from appearing merely optionless. | Adds explicit UI-state precedence. | Reusing generic empty-options copy. |

### Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No local Cursor evidence is available | High until a reviewed macOS installation is used | Leave the production registry empty and retain truthful unsupported recovery. |
| Cursor protocol or authentication behavior changes | Medium | Require fresh opt-in native evidence before profile renewal; normalize failures without cross-provider changes. |
| A provider advertises a config option but rejects an update | Medium | Record `rejected`, preserve unavailable controls, and do not synthesize a fallback. |
| Recheck disrupts another session | Low | Scope the action to one selected configured Cursor session and test sibling continuity. |
| UI copy regresses into a generic optionless state | Medium | Add focused mounted tests for unready, ready/no-options, and ready/options branches. |
| Contract evidence becomes content-bearing | Low | Restrict persisted output to closed booleans/enums and review the artifact before certification. |

## Architecture Decision Records

- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Keeps support limited to a revocable exact-profile evidence snapshot.
- [ADR-002: Define support by a completed first Cursor task after reviewed proof](adrs/adr-002.md) — Sets the first completed task and truthful recovery as the product contract.
- [ADR-003: Keep Cursor certification compiled and gate it on reviewed native evidence](adrs/adr-003.md) — Uses the existing compiled registry and requires deterministic plus reviewed native evidence.
- [ADR-004: Recheck only the selected unavailable Cursor session](adrs/adr-004.md) — Adds a narrow controller action that preserves healthy sibling sessions.
- [ADR-005: Record a closed live-config capability result in the native contract](adrs/adr-005.md) — Proves negotiated live configuration without direct CLI fallback or content-bearing evidence.
