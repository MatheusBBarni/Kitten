# PRD: Reliable Concurrent MCP Calls for Supervised Work

## Overview

Kitten must let an agent author continue valid overlapping supervised work within one parent session. The MVP fixes the moment where an agent needs a developer decision while it also starts or observes delegated work: both valid actions should make progress rather than one appearing to fail merely because it overlaps the other.

The product promise is continuity and truth. When capacity is genuinely constrained, Kitten must clearly distinguish that temporary, recoverable state from an unavailable action and give the developer a safe next step. The product must never imply that an action with an unknown outcome can be repeated safely.

### Market Context

Parallel agent work is becoming a normal expectation: Cursor lets users inspect background-agent status, send follow-ups, and take over work. [Cursor Background Agents](https://docs.cursor.com/background-agent) GitHub's 2024 survey of 2,000 software-team respondents found that more than 97% had used AI coding tools at work, increasing the importance of reliable, understandable supervised workflows. [GitHub survey](https://github.blog/news-insights/research/survey-ai-wave-grows/)

## Goals

- Allow valid overlapping developer-input and delegated-work actions from the same parent session to continue within the product's bounded capacity.
- Give agent authors a clear, concise distinction between a temporary capacity constraint and an unavailable action.
- Provide a deliberate recovery path only when the original action's outcome is known.
- Preserve developer trust through session isolation and content-free, opt-in operational signals.
- Keep the first release narrow enough to validate the core mixed-work scenario before considering broader work-management features.

## User Stories

### Agent Author

- As an agent author, I want a developer decision and delegated work to remain usable when they overlap so that my supervised task does not stop for a false failure.
- As an agent author, I want to know whether a blocked action is temporarily constrained or unavailable so that I can choose the right next step.
- As an agent author, I want recovery guidance to be explicit about when retrying is safe so that I do not create duplicate delegated work.

### Kitten Maintainer

- As a maintainer, I want bounded, content-free outcome categories for concurrent-work failures so that I can assess reliability without collecting developer prompts or task content.

### Privacy-Conscious Developer

- As a developer, I want concurrent work from another session to remain isolated from mine so that overlapping activity never changes my session's authority or reveals my work.

## Core Features

### P0: Mixed-Work Continuity

When a developer decision overlaps with valid delegated work from the same parent session, Kitten continues both actions within the existing bounded capacity. This is the MVP's primary proof scenario.

### P0: Truthful Outcome States

Kitten presents a temporary capacity constraint differently from an unavailable action. Each visible state uses plain language and does not expose private implementation details, internal routes, or raw errors.

### P0: Deliberate Recovery Guidance

For a known temporary capacity constraint, Kitten provides concise manual recovery guidance. It does not automatically repeat a delegated-work start or imply that an action with an unknown outcome is safe to repeat.

### P1: Session-Safe Concurrent Work

Concurrent work remains scoped to its originating parent session. A developer's work is not affected by, visible to, or recoverable from another session's activity.

### P1: Content-Free Reliability Signals

Opt-in local reliability signals use only bounded outcome categories and coarse measurements. They do not retain prompts, task text, capabilities, endpoints, identifiers, or raw errors.

## User Experience

### Normal Mixed-Work Flow

1. An agent asks the developer for a decision while delegated work is being started or observed.
2. Kitten keeps both valid actions active within the session's allowed capacity.
3. The developer can answer the decision and continue following the delegated work without a generic failed-tool interruption.

### Genuine Temporary Capacity Constraint

1. An action reaches a real bounded capacity limit.
2. Kitten shows a concise temporary-capacity state that is visibly different from unavailability and does not rely on color alone.
3. If the original action is known to have ended without completing, Kitten tells the developer how to retry deliberately.
4. If the action's outcome is unknown, Kitten explains that it cannot safely offer retry guidance.

### Unavailable Action

1. A session is no longer able to serve an action.
2. Kitten shows an unavailable state, distinct from temporary capacity pressure.
3. The developer can continue with unaffected work rather than being led toward an unsafe retry.

## High-Level Technical Constraints

- The MVP must preserve strict separation between parent sessions and must not grant one session access to another session's work.
- All user-facing failure states must be bounded and free of private implementation details.
- Local reliability observation remains opt-in and content-free.
- The MVP must retain bounded resource use and must fail closed when a genuine limit is reached.
- Existing supervised workflows remain the product baseline; the release adds continuity and clarity rather than a new autonomous work-management surface.

## Non-Goals (Out of Scope)

- **Automatic retry or replay of delegated-work starts** — an unknown outcome must never look safe to repeat.
- **Configurable scheduling, priority controls, or fairness administration** — the MVP validates reliability before adding a broader management product.
- **Durable history of tool results or errors** — this expands privacy and retention scope without solving the immediate continuity problem.
- **A new concurrent-work dashboard** — the existing tool outcome experience is sufficient for the first release.
- **Shared capacity or recovery across sessions** — session isolation remains a core user-trust boundary.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver mixed-work continuity, truthful outcome states, deliberate recovery guidance, session-safe behavior, and content-free reliability signals.
- Validate the primary developer-decision plus delegated-work scenario with dogfood users.
- Proceed when all MVP success metrics are met and no privacy or isolation regressions are observed.

### Phase 2

- Review content-free reliability signals and developer feedback to determine whether bounded capacity messaging remains sufficient under real use.
- Refine user-facing wording and discoverability if developers still mistake temporary limits for unavailable actions.
- Proceed only if evidence shows additional control or visibility would materially improve supervised work.

### Phase 3

- Consider evidence-driven fair work scheduling or execution-confidence history only after explicit product, privacy, and retention decisions.
- Do not begin this phase merely because parallel work is available; it requires demonstrated user demand beyond the MVP scenario.

## Success Metrics

| Metric | MVP Target | Measurement |
| --- | --- | --- |
| Valid mixed-work continuity | 100% of approved mixed developer-decision plus delegated-work scenarios complete without a false temporary-capacity failure | MVP release review and dogfood feedback |
| Truthful outcome presentation | 100% of reviewed temporary-capacity and unavailable scenarios display distinct bounded states | Product acceptance review |
| Safe recovery | 0 automatic repeats of an action with an unknown outcome | Release behavior review |
| Session isolation | 0 observed cross-session visibility, recovery, or authority incidents | Release safety review |
| Privacy posture | 0 prompt, task, or raw-error content retained in opt-in reliability records | Privacy review before release |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers interpret a temporary state as a safe invitation to repeat unknown work | Use explicit manual-recovery language only after a known terminal outcome; distinguish ambiguous outcomes. |
| The MVP grows into a general agent-management product | Keep delivery tied to the mixed supervised-work scenario and the non-goals in this PRD. |
| Users cannot tell capacity pressure from unavailability | Use concise, distinct text states and verify them with dogfood review. |
| Reliability observation undermines privacy trust | Keep observation opt-in, local, bounded, and content-free. |
| Demand for richer controls is assumed rather than demonstrated | Use Phase 2 feedback and aggregate reliability signals before proposing scheduling or history. |

## Architecture Decision Records

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — preserves session safety while allowing valid concurrent work.
- [ADR-002: Center the MVP on mixed supervised work and deliberate recovery](adrs/adr-002.md) — defines the primary user moment and rules out automatic replay of ambiguous work.

## Open Questions

- What exact user-facing wording best communicates a known temporary constraint without overpromising recovery?
- Which dogfood cohort can exercise mixed supervised work often enough to validate the MVP before wider release?
- What evidence threshold would justify a future scheduling or execution-confidence product instead of further wording refinement?
