## Overview

Default Models per Provider lets individual Kitten users declare a default model and reasoning effort for each provider in personal `config.json`. When a developer intentionally selects a provider-backed session through `/model`, Kitten restores that provider's configured default and shows the actual confirmed result.

The feature removes repetitive setup from multi-provider workflows while preserving user ownership of configuration and Kitten's trustworthy, agent-confirmed state.

## Goals

- Eliminate additional confirmation steps when a valid provider default is restored through an intentional `/model` selection.
- Make model-and-effort preferences predictable by reapplying them every time the developer deliberately returns to that provider session.
- Preserve developer trust by clearly distinguishing fully applied, partially applied, and unavailable defaults.
- Keep user configuration declarative and personal: Kitten must not create or rewrite it.
- Support changing preferences outside Kitten without altering a live session; new valid preferences take effect on a later intentional selection.

## User Stories

### Individual multi-provider developer

- As a developer who uses Claude Code and Codex, I want each provider to restore my preferred model and reasoning effort when I select it so that I do not repeat configuration work.
- As a developer who regularly switches providers during a task, I want the same deliberate `/model` action to produce the same configured result each time so that the active setup is predictable.

### Developer making a one-off adjustment

- As a developer, I want to make a temporary model or effort change for the current session so that I can adapt to an immediate task without rewriting my preferences.
- As a developer, I want my configured provider default restored the next time I deliberately select that provider so that temporary changes do not create hidden long-term drift.

### Developer with a stale preference

- As a developer, I want Kitten to show when a saved effort is unavailable while retaining my available model choice so that I understand the actual configuration and can act deliberately.

## Core Features

### Critical: Per-provider personal preferences

Users can declare an optional default model and reasoning effort for each supported provider in their personal configuration. Missing preferences preserve Kitten's existing `/model` behavior. Invalid or unknown preference entries are surfaced clearly rather than ignored.

### Critical: Intentional default restoration

Selecting a different provider-backed session through `/model` automatically restores that provider's default model and reasoning effort without another confirmation. Returning to a provider after a manual temporary change restores the configured default again.

### Critical: Transparent partial results

If the chosen model is available but the saved effort is not, Kitten applies the model, retains the last confirmed effort, and labels the outcome as partially applied. Kitten never silently selects a different effort. If a configured model is unavailable, the session keeps its verified state and reports that the default was unavailable.

### High: Confirmed-state feedback

The existing `/model` picker and status strip make the active provider, model, and reasoning effort legible after every selection. They distinguish confirmed, partially applied, and unavailable results without transient notifications or user-dismissed alerts.

### High: Safe preference refresh

When a user updates a valid personal configuration outside Kitten, the new defaults are available on a later intentional `/model` selection. Existing live sessions stay unchanged until the user explicitly selects a provider.

## User Experience

1. A developer adds provider-specific model and reasoning-effort preferences to personal configuration.
2. The developer opens `/model` and intentionally selects a session for another provider.
3. Kitten restores that provider's configured model and, when available, configured reasoning effort without asking for another confirmation.
4. The picker and status strip show the provider, model, and effort that are actually active.
5. If the saved effort is unavailable, the developer sees a partial-result indication and can choose an effort explicitly. If the saved model is unavailable, the developer sees that the default was unavailable and keeps the prior confirmed configuration.
6. A manual model or effort choice remains available for the active session but is replaced by the configured default when the developer next intentionally selects that provider through `/model`.

The feature adds no new persistent modal, toast, or settings screen. Existing keyboard navigation and status information remain the primary discovery and feedback surfaces.

## High-Level Technical Constraints

- Personal configuration remains strictly user-authored; Kitten never writes defaults or manual choices back to `config.json`.
- Only model and reasoning-effort preferences are in scope. Other provider controls remain unavailable through this feature.
- The product must show the state confirmed by the live provider rather than a requested or assumed state.
- A configuration reload must not alter the active model or effort until the user intentionally selects a provider through `/model`.

## Non-Goals (Out of Scope)

- A settings screen or interactive editor for default preferences.
- Persisting manual model or effort changes back to personal configuration.
- Automatically choosing a substitute model or effort when a saved preference is unavailable.
- Applying defaults during passive focus changes, ordinary startup, or configuration reloads.
- Replacing providers, creating new agent sessions, or changing provider authentication.
- Context-aware model routing, workspace-specific profiles, team-shared defaults, and handoff-specific preferences.

## Phased Rollout Plan

### MVP (Phase 1)

- Per-provider personal model-and-effort defaults.
- Automatic restoration only after an intentional provider/session selection in `/model`.
- Clear confirmed, partial, and unavailable outcomes in the existing picker and status strip.
- No application-originated configuration writes and no change to live sessions on preference reload.

**Success criteria to proceed to Phase 2:** valid defaults restore without an extra confirmation step, unavailable preferences remain truthful, and early users can predict the behavior after a manual temporary change.

### Phase 2

- Improve configuration discoverability through documentation or a guided, non-mutating setup experience.
- Add a preference health view that helps users identify unavailable saved values before switching providers.

**Success criteria to proceed to Phase 3:** users can set up and maintain defaults with minimal support, and preference failures are understood without ambiguity.

### Phase 3

- Explore workspace-aware profiles and context-aware provider, model, or effort recommendations.
- Evaluate whether teams need a shareable baseline while keeping personal preferences in control.

**Long-term success criteria:** richer automation improves switching confidence without introducing silent configuration changes.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Confirmed default restoration | At least 95% of eligible selections confirm both configured values | Opt-in, content-free local outcome counters |
| Switching friction | Zero extra confirmation steps after selecting a provider with a valid default | End-to-end interaction measurement |
| Partial-result transparency | 100% of unavailable-effort outcomes display the confirmed model and retained effort | Product acceptance coverage and opt-in outcome counters |
| Configuration integrity | Zero application-originated writes to personal configuration | Runtime and integration validation |
| Invalid-preference clarity | 100% of malformed or unknown entries surface actionable feedback | Configuration acceptance coverage |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers expect manual changes to persist | State clearly that manual choices are temporary and reapply the configured default only after a deliberate `/model` selection. |
| Provider availability changes make preferences stale | Retain verified state, report the unavailable or partial outcome, and never silently substitute another value. |
| Users cannot discover configuration syntax | Provide examples and a future guided, non-mutating setup experience. |
| Automatic behavior reduces trust | Limit it to a user-initiated provider/session selection and keep results visible in the existing picker and status strip. |

## Architecture Decision Records

- [ADR-001: Apply per-provider defaults on intentional model-session selection](adrs/adr-001.md) — establishes personal defaults, explicit selection, confirmed state, and no configuration writes.
- [ADR-002: Restore configured defaults on each intentional provider selection](adrs/adr-002.md) — establishes temporary manual changes, partial application, and no silent effort substitution.

## Open Questions

- What concise wording best distinguishes a fully applied default, a partially applied default, and an unavailable default in the picker and status strip?
- What documentation format best helps users author valid personal configuration without adding a settings editor?
- Should a future health view be available only on demand or appear when Kitten first detects an unavailable saved default?
