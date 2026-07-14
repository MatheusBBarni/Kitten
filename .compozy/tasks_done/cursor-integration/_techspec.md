# Cursor Integration

## Executive Summary

This specification implements the PRD's default third session, independent availability, reviewed handoffs, and honest capability boundary by extending Kitten's existing closed-provider model. Cursor becomes a built-in `ProviderKind` with a native `agent acp` profile; config resolution attaches runtime-only certification and authentication metadata only to the exact supported recipe. The existing controller, session model, target picker, redacted handoff preview, and local telemetry remain the integration path.

The primary trade-off is profile-specific support rather than accepting arbitrary Cursor commands. That adds a credentialed compatibility contract and version check, but it makes login, recovery, and optional capability behavior honest. The workspace has no installed `agent` binary, so the first certified version literal is a release dependency: it must come from a reviewed, opt-in contract run rather than being guessed in source.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/types.ts` | Add `cursor` to provider identity and represent runtime-only provider profile metadata. | Protocol-free types only; no subprocess or ACP imports. |
| `src/config/configLoader.ts` | Define Cursor's built-in recipe, strict override shape, default launch order, and exact-profile resolution. | Owns configuration defaults and validation. |
| `src/config/readiness.ts` | Verify the certified Cursor version, then map binary, version, authentication, and handshake outcomes into user-facing readiness. | Probes one provider independently; never blocks siblings. |
| `src/agent/agentConnection.ts` | Run `initialize`, then profile-directed `cursor_login`, before creating any Cursor session. | Sole ACP boundary; no ACP type escapes. |
| `src/config/clarificationCapability.ts` | Keep Cursor structured clarification unsupported until a separate exact-profile contract is recorded. | Fail-closed optional capability classification. |
| `src/app/controller.ts` and `src/app/actions.ts` | Reuse resolved sessions and the existing fail-soft action path for Cursor. | No Cursor-specific ACP calls or new state owner. |
| `src/ui/StatusStrip.tsx`, `src/ui/ModelSelect.tsx`, and first-run copy | Remove Claude-or-Codex assumptions and render Cursor through provider metadata. | UI reads actions/selectors only. |
| Existing handoff flow and picker | Treat Cursor as one ready target among many. | Preview, redaction, curation, and confirmation remain unchanged. |

The startup flow is:

`default config` -> `resolved Cursor profile` -> `version probe` -> `ACP initialize` -> `cursor_login` -> `session/new` -> `controller/store` -> `existing session and handoff UI`.

If any Cursor-only step fails, readiness records Cursor as unavailable with the actionable reason. The controller continues with every ready Claude Code or Codex session. No new global boot gate, storage, or service is introduced.

## Implementation Design

### Core Interfaces

The production contract is TypeScript. The Go-shaped definition below is documentation-only to satisfy the shared TechSpec template; no Go source is added to this Bun/TypeScript repository.

```ts
export type ProviderRuntimeProfile =
  | { kind: "standard" }
  | {
      kind: "cursor-certified"
      command: "agent"
      args: readonly ["acp"]
      certifiedVersion: string
      authenticationMethod: "cursor_login"
    }

export type ReadyState =
  | { ready: true; protocolVersion: number; canLoadSession: boolean }
  | { ready: false; reason: "authentication_required" | "handshake_failed"; error: string }
```

```go
// Documentation-only structural equivalent; production remains TypeScript.
type CursorProfile struct {
    Command          string
    CertifiedVersion string
    Authentication   string
}
```

`ResolvedAgentConfig` gains a required `runtimeProfile`. `findAgentConfig()` derives it after merging configuration, so the user config schema never accepts authentication or certification fields. The profile is `cursor-certified` only when the complete resolved Cursor recipe matches the built-in command, ordered arguments, environment, and certified version policy; all other Cursor overrides resolve to `standard` and are reported as uncertified by readiness.

`AgentConnection.connect()` retains its existing shared initialization request. When `runtimeProfile.kind` is `cursor-certified`, it calls the ACP authentication method before returning ready. Authentication exceptions return the normalized `authentication_required` state; all other initialization failures return `handshake_failed`. The adapter remains the only place that imports ACP types or calls the ACP client.

The adapter call is `await connection.authenticate({ methodId: profile.authenticationMethod })`. It runs after `initialize` and before `newSession`; an ACP `auth_required`, unavailable method, or rejected login is normalized into the Cursor-only authentication outcome.

### Data Models

| Model | Location | Rules |
| --- | --- | --- |
| `ProviderKind` | `src/core/types.ts` | Extend the closed union and provider constants with `cursor`; append it to default order so existing Codex-first focus remains unchanged. |
| `ProviderRuntimeProfile` | `src/core/types.ts` | Runtime-only resolved metadata; never parsed from user JSON or displayed as user content. |
| `CURSOR_ACP_PROFILE` | `src/config/configLoader.ts` or a colocated config helper | Defines `agent acp`, `cursor_login`, and one exact certified semantic version. Its literal is committed only with a passing credentialed contract result. |
| `ResolvedAgentConfig.runtimeProfile` | Config-to-adapter handoff | Carries the sealed profile from config resolution to readiness and the adapter. |
| `NotReadyReason` | `src/config/readiness.ts` | Add `version_mismatch`, `uncertified_recipe`, and `authentication_required` with concise recovery messages. |
| Clarification capability | `src/config/clarificationCapability.ts` | Cursor remains `unsupported`; do not add it to the verified list until a distinct complete contract pass exists. |

No session-state, transcript, persistence, or telemetry storage model changes are required. Existing session identity remains `SessionId`; `ProviderKind` is only the spawn-recipe identity, so multiple sessions may still share Cursor in an explicit configuration.

### Provider Resolution and Readiness Algorithm

1. Add Cursor's built-in recipe and display metadata to the existing provider constants and strict config schema.
2. Merge user recipe deltas using the current field-level rules, then derive a `runtimeProfile` from the final resolved recipe rather than display name or requested provider label.
3. On a zero-configuration launch, resolve the ordered Codex, Claude Code, and Cursor sessions in the launch directory; retain Codex as the initial focus.
4. For a certified Cursor profile, run the injectable version probe for `agent --version`; reject an absent, malformed, or non-matching result as `version_mismatch` before spawning a long-lived connection.
5. Start the normal readiness connection. The shared adapter initializes ACP, then invokes `cursor_login` for the certified Cursor profile.
6. Map a login failure to `authentication_required`; map unsupported protocol, unexpected process exit, and normal handshake failures through the established readiness messages.
7. After successful readiness, create Cursor's live session with the existing `session/new` path. Existing config options, permission requests, updates, cancellation, session persistence capability detection, and error events flow through the generic adapter/controller paths.
8. For an overridden or uncertified Cursor recipe, show an explicit `uncertified_recipe` recovery message and do not attempt Cursor-specific authentication or optional capabilities.

### API Endpoints

Not applicable. Kitten remains a local terminal application with no HTTP surface. The only external protocol call added is the documented ACP authentication request over the existing stdio connection.

## Integration Points

| Boundary | Integration | Error and safety behavior |
| --- | --- | --- |
| Cursor CLI | Native `agent acp` subprocess for an exact certified profile. | Version mismatch or process absence leaves only Cursor unavailable. |
| ACP authentication | Adapter-owned `cursor_login` after shared initialization. | Authentication failure becomes a Cursor-only readiness reason; it never escapes into the UI as a rejected callback. |
| Existing session controller | Resolved Cursor session uses the same connect, `session/new`, update, prompt, cancel, and dispose lifecycle. | A failed Cursor lifecycle operation routes through existing `onError` and does not mutate sibling sessions. |
| Handoff flow | Cursor participates through provider/session identity only. | The existing target picker excludes the source, admits ready sessions, and opens preview before any send. |
| Config and first-run guidance | Strict provider deltas and existing readiness output describe Cursor setup. | Malformed config remains a hard error; a missing Cursor installation is a per-agent availability state. |
| Opt-in telemetry | Existing local recorder may count bounded Cursor readiness outcomes and handoff events. | Never record versions, command values, credentials, prompts, code, or transcript content. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/types.ts` | modified | Closed provider union fans out to records and UI metadata. | Add Cursor identity, display name, default order, runtime profile type, and exhaustive fixtures. |
| `src/config/configLoader.ts` | modified | Defines the supported Cursor recipe and zero-config third session. | Extend defaults, strict schema, cloning, merge, resolution, and loader tests. |
| `src/config/readiness.ts` | modified | Adds profile-aware version and authentication outcomes. | Add injectable version probe, outcome taxonomy, recovery messages, and tests. |
| `src/agent/agentConnection.ts` | modified | Adds profile-directed authentication inside the ACP boundary. | Authenticate only certified Cursor profiles; normalize failure without leaking ACP types. |
| `src/config/clarificationCapability.ts` | modified | Closed maps must recognize Cursor while preserving fail-closed behavior. | Keep Cursor unsupported until a separate credentialed capability contract passes. |
| `src/app/controller.ts` / `src/app/actions.ts` | modified | Provider union and telemetry assumptions may be exhaustive. | Preserve generic lifecycle and content-free provider attribution. |
| `src/ui/StatusStrip.tsx` / `src/ui/ModelSelect.tsx` | modified | Claude-or-Codex branches mislabel a third provider. | Derive labels from shared provider metadata and test Cursor rendering. |
| `README.md` / first-run reporting | modified | Current copy names only two agents. | Document Cursor local setup, recovery, and reviewed-handoff boundaries. |
| Tests and ACP mocks | modified | Authentication and third-provider defaults require deterministic seams. | Extend mock ACP behavior, config/readiness/controller/UI coverage, and credentialed contract gating. |

## Testing Approach

### Unit Tests

- `src/config/configLoader.test.ts`: Cursor defaults, strict Cursor override validation, three-session zero-config resolution, stable Codex-first focus, and exact-profile derivation after merge.
- `src/config/readiness.test.ts`: Cursor missing binary, missing/malformed/mismatched version, uncertified override, authentication-required, protocol mismatch, and sibling independence.
- `src/agent/agentConnection.test.ts`: certified Cursor calls `initialize` then `authenticate(cursor_login)` before `session/new`; authentication failure returns a normalized not-ready result; non-Cursor profiles never authenticate.
- `src/config/clarificationCapability.test.ts`: Cursor is unsupported by default and a Cursor override cannot accidentally become supported.
- `src/core/types.test.ts`: provider metadata maps and exhaustive constants include Cursor without changing `SessionId` semantics.

### Integration Tests

- `src/app/controller.test.ts`: a zero-config three-provider fleet creates a live Cursor session when the mock authenticates, and leaves Claude Code/Codex usable for every Cursor readiness failure.
- `src/app/handoff.test.ts` and `src/ui/HandoffTargetPicker.test.tsx`: Cursor appears as an eligible ready target; no picker selection or preview confirmation sends any prompt.
- `src/ui/StatusStrip.test.tsx` and `src/ui/ModelSelect.test.tsx`: Cursor labels render from metadata and neither view retains a two-provider conditional.
- `test/firstRunBoot.test.ts` and README contract tests: Cursor recovery text is actionable, content-free, and does not turn a one-ready-agent boot into a global failure.

### Credentialed Contract

Add an opt-in Cursor contract alongside the existing adapter contract pattern. When `KITTEN_CURSOR_ACP_CONTRACT=1` and a local Cursor CLI is authenticated, it must:

1. capture `agent --version` and require an exact semantic version;
2. start `agent acp`, initialize, authenticate with `cursor_login`, create a temporary session, and complete one benign prompt;
3. verify permission request/response behavior when Cursor advertises it;
4. dispose the session and subprocess cleanly; and
5. record a reviewed result containing only recipe identity, version, and boolean checks.

The normal test suite always skips this contract. A skipped, failed, or partial run does not enable the profile or any Cursor-specific optional capability.

After implementation, run `bun run typecheck && bun test`; because boot, config, and UI behavior change, also run `bun run selfcheck` and `bun run build`. Tests use injected transports, fake version probes, and in-memory terminal rendering; they never spawn a real Cursor agent unless the explicit contract gate is enabled.

## Development Sequencing

### Build Order

1. Add Cursor provider identity, metadata, runtime-profile types, and exhaustive type fixtures in `src/core/types.ts` — no dependencies.
2. Define Cursor's built-in recipe, certified-profile resolver, strict schema branches, and default session order in `src/config/configLoader.ts` — depends on step 1.
3. Extend configuration and provider-identity tests for defaults, overrides, and three-session resolution — depends on steps 1 and 2.
4. Add injected Cursor version probing, not-ready reasons, and recovery formatting in `src/config/readiness.ts` — depends on steps 1 and 2.
5. Add adapter-owned profile authentication and normalized authentication failure in `src/agent/agentConnection.ts` — depends on step 1 and the runtime profile from step 2.
6. Extend clarification classification, controller/readiness wiring, and content-free provider telemetry exhaustiveness — depends on steps 1, 4, and 5.
7. Remove two-provider UI branches and update first-run/README copy — depends on steps 1, 2, and 6.
8. Add mocked adapter, readiness, controller, handoff, rendered UI, and boot coverage — depends on steps 3 through 7.
9. Add the opt-in credentialed Cursor contract and commit the certified version/profile only after its reviewed pass — depends on steps 2, 4, 5, and 8.
10. Run typecheck, full tests, self-check, build, and the credentialed contract when available — depends on steps 1 through 9.

### Technical Dependencies

- A locally installed Cursor CLI that exposes the documented `agent acp`, `agent --version`, and `cursor_login` behavior is required only for the opt-in credentialed contract and release certification.
- The existing ACP SDK exposes `authenticate({ methodId })`; the adapter contract must verify that Cursor accepts the certified `cursor_login` method after initialization.
- No new package, persistent store, HTTP endpoint, remote registry, or configuration-writer behavior is required.

## Monitoring and Observability

- Add only opt-in local, content-free counters for Cursor readiness outcomes: `ready`, `binary_missing`, `version_mismatch`, `uncertified_recipe`, `authentication_required`, and `handshake_failed`.
- Preserve existing content-free handoff events; provider attribution may identify `cursor` but must not include prompts, code, credentials, command lines, or exact CLI versions.
- Use existing first-run/readiness messages as the developer-facing operational view. No external logging, alerting, dashboard, or network reporting is added.

## Technical Considerations

### Key Decisions

| Decision | Rationale | Trade-off | Rejected alternative |
| --- | --- | --- | --- |
| Built-in native `agent acp` profile | Matches Cursor's documented local ACP server and the PRD's first-class integration goal. | Support is limited to a certified version/profile. | Generic user-supplied command. |
| Runtime-only profile metadata | Lets config resolve exact recipe identity while the adapter receives only the required auth contract. | Adds a small resolved-config type. | User-authored auth fields or adapter imports from config. |
| Adapter-owned `cursor_login` | Keeps ACP calls inside `src/agent/` and makes login failure a normal readiness result. | The generic adapter gains one profile-directed branch. | External-only login or UI-driven authentication. |
| Version probe before session startup | Makes the certification claim enforceable and recovery actionable. | Users on another Cursor version are unavailable until recertified. | Any-version best-effort launch. |
| Fail-closed optional capabilities | Login success does not prove clarification, restoration, or other optional behavior. | Some useful features stay unavailable initially. | Advertising every initialized capability. |

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Cursor changes its CLI name, version format, or ACP authentication sequence | Medium | Keep the exact profile contract-tested and block profile updates without reviewed evidence. |
| Authentication reports an opaque agent error | Medium | Preserve its safe, actionable message in Cursor-only readiness output and maintain mock coverage. |
| Default Cursor absence appears as a cockpit failure | Medium | Keep Cursor in the existing independent readiness path and test one-ready-sibling boot scenarios. |
| A profile override silently receives Cursor-specific calls | Low | Derive the runtime profile from the final full recipe and mark non-exact overrides uncertified. |
| UI labels or telemetry omit the third provider | Medium | Replace binary branches with shared provider metadata and compile/test exhaustive unions. |

## Architecture Decision Records

- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — establishes the local first-class provider and reviewed-handoff boundary.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — adds Cursor to zero-config launch without blocking ready siblings.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — seals the native profile, version contract, and adapter-owned Cursor authentication flow.
