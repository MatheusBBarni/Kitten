# Harness Capability Composition

## Overview

Kitten needs each fresh coding-agent session to receive only the host guidance that is true for that session. Today, a static baseline cannot express the difference between a session with a confirmed Kitten capability and a minimally capable or custom provider. The result is either missed guidance or an agent being told that a tool, role, isolated workspace, steering action, or handoff operation exists when it does not.

This feature gives developers a trustworthy, low-noise startup experience. Every eligible fresh agent receives Kitten's stable baseline plus only independently confirmed optional guidance. A session with no confirmed optional capability remains a successful base-only experience. The feature serves developers coordinating agents through Kitten, not a new prompt-management workflow.

The market already treats scoped startup context and role/tool-aware behavior as normal: [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents) supports custom agent prompts with declared tools and MCP servers, while [Cursor](https://docs.cursor.com/context/rules-for-ai) applies rules at the start of model context. Kitten differentiates by making those operational claims provider-neutral and truthful for the actual fresh session.

## Goals

- Ensure every eligible fresh agent receives concise host guidance that matches only capabilities Kitten has confirmed.
- Make zero false capability claims the primary release bar; base-only guidance is a valid, successful outcome.
- Keep healthy starts silent so developers focus on their task rather than hidden host configuration.
- Preserve the operating assumptions of restored and active conversations; changed capability guidance starts only in a new Kitten run.
- Prove one independently confirmed Kitten MCP bridge and child-control guidance slice in V1.
- Establish structured clarification as the next staged user outcome once its availability is independently confirmed.

## User Stories

### Developer starting a fresh coding task

- As a developer, I want a new agent to receive only the host guidance that applies to its current session so that I can trust its plan and tool use.
- As a developer, I want a normal successful start to stay quiet so that I can begin work without a configuration dashboard or extra confirmation step.
- As a developer, I want an agent with the Kitten bridge available to understand the relevant host-supported workflow so that it can use that workflow accurately.

### Developer using a limited or custom provider

- As a developer, I want a minimally capable agent to receive valid base guidance instead of invented feature instructions so that it remains useful and predictable.
- As a developer, I want Kitten to avoid treating a provider name as proof of a capability so that custom configuration does not create misleading agent behavior.

### Developer continuing or recovering work

- As a developer, I want a restored conversation to keep its existing operating assumptions so that Kitten does not silently change the agent's behavior midway through work.
- As a developer, I want clear, content-free recovery information only when an expected capability-specific start cannot proceed truthfully so that I know the safe next action without exposing private context.

### Maintainer extending Kitten capabilities

- As a Kitten maintainer, I want future capability guidance to enter through a reviewable staged path so that new user promises do not contradict existing guidance or overstate availability.

## Core Features

### Critical: Truthful fresh-session guidance

For every eligible fresh session, Kitten provides the stable baseline and adds optional guidance only when the related capability is independently confirmed for that session. Unknown, unavailable, conflicting, or stale facts never produce an optional claim.

### Critical: Valid base-only experience

Developers can use Kitten with a custom, limited, or not-yet-integrated provider without loss of correctness. When no optional capability is confirmed, the agent receives the baseline only; Kitten does not treat that state as a degraded normal experience.

### Critical: Silent healthy operation

Healthy fresh starts show no routine composition badge, prompt summary, or configuration overlay. Developers receive a concise, content-free recovery or diagnostic signal only when Kitten cannot make the capability-specific start truthfully.

### Critical: Stable conversation continuity

Capability-specific guidance applies to new, fallback, and replacement conversations only. Restored and already active conversations retain their existing operating assumptions. Updated capability guidance becomes available after the developer starts a new Kitten run.

### Critical: One proven V1 capability slice

V1 delivers accurate operational guidance for the confirmed Kitten MCP bridge and child-control workflow. That slice proves the value end to end without implying that all planned capability families are ready.

### High: Staged capability growth

Kitten can add future guidance only after each user-facing capability has independently confirmed availability and clear ownership of its wording. Structured clarification is the first Phase 2 priority; roles, managed workspaces, steering, and curated handoff guidance follow only when they meet the same standard.

### High: Reviewable, content-free composition record

Kitten can provide maintainers with a bounded, content-free record of the selected guidance identity and whether the agent used the base-only experience. It never records prompt text, task content, repository content, sensitive paths, credentials, or environment values.

## User Experience

1. A developer starts Kitten and opens a fresh agent session.
2. Kitten determines the guidance it can truthfully provide for that fresh session.
3. On a healthy start, the developer sees the familiar task flow with no new badge, modal, or prompt editor. The agent receives the appropriate baseline and any confirmed optional guidance.
4. If no optional capability is confirmed, the developer experiences the same quiet start and the agent receives valid base guidance only.
5. If the session cannot support a capability-specific start truthfully, Kitten keeps private guidance private, avoids making the false claim, and presents a short actionable recovery state only when the user needs one.
6. If the developer resumes an existing conversation, Kitten continues that conversation without introducing new hidden guidance.
7. If a capability changes after Kitten is already running, the developer starts a new Kitten run before newly available guidance can affect an agent.

Recovery messaging must be concise, keyboard-accessible, and understandable without exposing prompt content or implementation detail. Normal operation remains the default, quiet experience.

## High-Level Technical Constraints

- Guidance must remain advisory; Kitten's actual confirmation, sandbox, permission, role, and process controls remain authoritative.
- The baseline contract, fresh-session delivery lifecycle, and provider-specific handling remain distinct product boundaries. This feature adds only truthful optional guidance.
- Optional guidance must stay concise and bounded: no more than eight extensions and no more than 800 extension tokens in addition to the established base contract.
- Capability-specific guidance must not expose prompt text, user or repository content, sensitive paths, credentials, bridge secrets, or environment values in normal UI, persistence, or diagnostics.
- Provider identity or configuration defaults alone are insufficient to make a user-facing capability promise.

## Non-Goals (Out of Scope)

- Rewriting the stable base harness wording, version policy, or size boundary.
- Replacing fresh-session delivery, recovery, retry, or provider-specific handling with a new general mechanism.
- Activating clarification, roles, managed workspaces, steering, or handoff guidance before each capability has independently confirmed availability.
- Updating an active or restored conversation's hidden guidance in place.
- Adding a routine capability dashboard, prompt editor, or developer-facing catalogue browser.
- Treating prompt guidance as permission, authorization, sandboxing, or a prompt-injection defense.
- Recording hidden prompt content or sensitive session data for observability.

## Phased Rollout Plan

### MVP (Phase 1)

- Give every eligible fresh session either the valid baseline or the baseline plus the confirmed Kitten MCP bridge and child-control guidance.
- Keep healthy starts silent and ensure base-only remains a successful outcome.
- Preserve continuity for restored and active sessions, and apply changed guidance only in a new Kitten run.
- Provide content-free recovery information only when a capability-specific start cannot be represented truthfully.

Success criteria to proceed to Phase 2:

- Release evidence shows zero false optional-capability claims across supported fresh-session scenarios.
- Every supported fresh-session outcome is either truthful optional guidance or a valid base-only start.
- Developers can complete normal fresh starts without a new routine status surface.

### Phase 2

- Add structured clarification guidance only when Kitten has independently confirmed that the relevant interaction is available to the session.
- Preserve the same silent healthy experience and base-only fallback for sessions without clarification.
- Collect content-free outcome evidence and developer feedback on whether the distinction between available and unavailable interaction is clear.

Success criteria to proceed to Phase 3:

- Structured clarification creates no false availability claims in supported sessions.
- Developers understand the recovery path when clarification is unavailable or cannot be confirmed.
- Normal-session noise remains at or below the MVP baseline.

### Phase 3

- Consider staged guidance for confirmed roles, managed workspace isolation, steering, and curated handoff behavior.
- Maintain one consistent user promise: optional guidance appears only when the active fresh session can support it truthfully.
- Reassess whether a content-free developer diagnostic surface is needed based on observed recovery and support needs.

Long-term success criteria:

- Capability growth remains concise, attributable, and understandable as Kitten supports more providers and workflows.
- No feature expansion weakens the valid base-only experience or changes an existing conversation without an explicit fresh start.

## Success Metrics

| Metric | Target | Measurement |
| --- | ---: | --- |
| False optional-capability claims | 0 | Release evidence and content-free incident review for supported fresh-session scenarios. |
| Truthful fresh-session outcomes | 100% | Every eligible start receives either confirmed optional guidance or the valid baseline only. |
| Restored-session continuity violations | 0 | Lifecycle outcome review confirms no new optional guidance enters a continued conversation. |
| Healthy starts with routine user-facing composition state | 0% | Product review of successful start flows and user reports. |
| Sensitive content in composition records | 0 | Privacy review of content-free diagnostic and persistence outputs. |
| Phase 2 clarification availability claims | 0 false claims | Supported-session outcomes and recovery feedback after Phase 2 activation. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers mistake a quiet normal start for missing functionality | Keep the normal flow familiar, explain the product promise in documentation, and reserve notices for actionable degraded states. |
| Users expect every provider to expose the same workflows | State the base-only experience explicitly and activate optional guidance only from independently confirmed availability. |
| A planned dependency is delayed | Preserve a complete V1 with the bridge slice and defer each later capability without weakening the baseline. |
| Broad feature requests pressure V1 scope | Keep zero false claims as the release bar and publish the staged capability rule. |
| Recovery messaging confuses users or exposes too much | Use concise, content-free language and validate comprehension before expanding the surface. |

## Architecture Decision Records

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — selects a default-deny, generation-valid snapshot with a staged catalog and one proven V1 slice.
- [ADR-002: Make Truthful Capability Guidance a Silent Fresh-Run Default](adrs/adr-002.md) — sets the silent healthy experience, new-run change boundary, zero-false-claim release bar, and Phase 2 priority.

## Open Questions

- What concise recovery wording best distinguishes an unavailable capability-specific start from a normal base-only start without adding a routine status surface?
- What content-free evidence and developer feedback threshold should authorize Phase 3 guidance for roles, managed workspaces, steering, or handoff?
- After structured clarification, which staged capability has the greatest demonstrated developer demand?
