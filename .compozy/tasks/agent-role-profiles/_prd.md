## Overview

`agent-role-profiles` gives Kitten operators one trustworthy way to delegate exploratory work. The MVP introduces a fixed `explore` child experience that is available only when Kitten can verify its safety promise. An active child is visibly marked as read-only, non-recursive, capability-bounded, and capacity-limited. When Kitten cannot establish that promise, it refuses the request before any child starts and explains the unavailable guarantee in plain language.

The feature serves developers who use Kitten to coordinate coding agents and need delegation without accidental authority expansion, unbounded child creation, or hidden access to connected tools. It is valuable because it turns safety from an operator assumption into an explicit product contract and gates production enablement of the agent-control surface.

## Goals

- Give every operator a clear answer before launch: safe `explore` delegation is available and constrained, or it is unavailable and will not start.
- Prevent every unverified `explore` request from creating a child or falling back to a broader authority level.
- Make active child restrictions and capacity status understandable through textual, accessible UI in the existing delegation experience.
- Apply the same safe-delegation promise to all production child-launch paths before agent-control is enabled for production use.
- Keep policy outcome measurement local, opt-in, and content-free.

## User Stories

### Kitten operator

- As a Kitten operator, I want to launch an `explore` child only when its safe boundary is verified so that I can delegate investigation without expanding authority.
- As a Kitten operator, I want to understand the active child’s role and restrictions at a glance so that I can confidently supervise its work.
- As a Kitten operator, I want a specific explanation when safe exploration is unavailable so that I know why no child was started without being steered toward an unsafe workaround.
- As a Kitten operator, I want predictable child-capacity behavior so that delegation cannot unexpectedly consume uncontrolled resources.

### Safety-conscious maintainer

- As a maintainer, I want production child-control entry points to preserve the same visible safety contract so that an operator does not receive different protections depending on how delegation begins.
- As a maintainer, I want opt-in policy insights without task or code content so that product learning does not compromise operator privacy.

## Core Features

### Critical: Verified `explore` delegation

- Present `explore` as the only MVP role and describe its user-facing restrictions before launch.
- Enable the role only when Kitten can verify the promised safe boundary for the selected runtime.
- Start a child only after the safe status is established; never silently substitute an unrestricted child.

### Critical: Purposeful unavailable state

- When the safe boundary is unavailable, preserve the operator’s task context and show a plain-language explanation before any work begins.
- Make clear that the request was refused to protect the operator, not because work was attempted and failed.
- Do not offer a warning-only continuation or an unrestricted fallback from the unavailable state.

### Critical: Visible active safety contract

- Mark active children as `explore` and present the effective restrictions in text, not color alone.
- Keep the child visible and focusable in the existing conversation and session surfaces.
- Avoid implying that a restored or historical child still has a current, live safety guarantee.

### High: Bounded delegation capacity

- Apply finite per-operator and overall child capacity to `explore` delegation.
- Communicate when safe capacity is unavailable and prevent additional children from starting beyond that boundary.
- Keep the capacity promise consistent for operator-initiated and agent-control-initiated delegation.

### Medium: Privacy-respecting product insight

- When an operator has opted in, record aggregate availability, denial, and capacity outcomes.
- Keep policy insight local and content-free; exclude task text, outcomes, paths, identities, provider recipes, and raw error text.

## User Experience

1. An operator enters the existing delegation flow with an investigation task and desired outcome.
2. Kitten presents the `explore` role with a concise textual safety summary and its current availability.
3. If the role is available, the operator launches it and receives a visible, focusable child that remains part of the familiar delegation workflow.
4. The child’s role and active restrictions remain discoverable while it is active, including when the operator changes focus or opens session management.
5. If the role is unavailable or safe capacity has been reached, Kitten does not create a child. It preserves the operator’s task context and explains the unavailable protection in plain language.
6. All status and restriction information must be keyboard-accessible and understandable without relying on color, animation, or hidden state.

## High-Level Technical Constraints

- The product must extend the existing visible delegation experience rather than introduce an untracked or detached child workflow.
- Every production path that can request a child must uphold the same `explore` availability, restriction, and capacity contract.
- A displayed safety label is valid only while its boundary can be verified; the product must refuse rather than approximate the promise.
- Privacy remains local and opt-in, with no delegated task, code, identity, path, recipe, or free-form error content in policy telemetry.
- The feature must preserve Kitten’s per-agent degradation posture: an unavailable safe path must not prevent unrelated ready agents from remaining usable.

## Non-Goals (Out of Scope)

- Multiple role types such as `engineer`, `pair`, or `design`.
- Operator-editable or workspace-editable role policies.
- Warning-only launches, unrestricted fallbacks, or a “continue anyway” action.
- Universal runtime eligibility at MVP launch.
- Persistent claims that historical or restored children retain a current verified boundary.
- Organization-wide governance, billing controls, or a general policy-management platform.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver fixed `explore` delegation, explicit availability and denial states, visible active restrictions, bounded capacity, and opt-in content-free policy outcomes.
- Gate production enablement of the agent-control surface on the same product contract.
- Proceed only when no unverified launch can start a child and operators can distinguish available, active, and unavailable states.

### Phase 2

- Add eligible runtimes only after each can meet the same user-visible safe-delegation promise.
- Improve product insight from opt-in aggregate availability and denial outcomes.
- Proceed only when expanded support does not reduce denial clarity, accessibility, or the safety standard.

### Phase 3

- Consider additional roles or configurable policy only after evidence shows that the fixed `explore` contract is trusted, understandable, and consistently upheld.
- Require every future role to offer an equally clear boundary and refusal experience.

## Success Metrics

| Metric | Target | Measurement |
|---|---:|---|
| Unverified `explore` launches that start a child | 0 | Release qualification and post-release policy outcomes. |
| Prohibited authority expansions from active `explore` children | 0 | Safety review outcomes and opt-in aggregate policy events. |
| Operators who correctly identify role availability and restrictions | ≥90% | Moderated usability validation within 10 seconds of the launch view. |
| Denied requests that receive a specific, plain-language reason | 100% | UX acceptance review across all child-launch entry points. |
| Capacity-bound violations | 0 | Release qualification and aggregate opt-in capacity outcomes. |
| Content-bearing policy telemetry fields | 0 | Privacy review of the emitted policy-event contract. |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Operators perceive denial as a product failure and seek unsafe workarounds. | Explain the missing guarantee plainly, preserve task context, and never position an unrestricted continuation as equivalent. |
| Uneven runtime support creates confusion. | Disclose availability before launch and use the same role language and denial standard everywhere. |
| Demand for role variety expands MVP scope. | Keep V1 to one fixed `explore` role and evaluate expansion only after trust and comprehension evidence. |
| Dependencies delay production rollout of child control. | Treat safe delegation as an explicit gate and sequence product communication with the dependency work. |
| Policy measurement is perceived as surveillance. | Keep it opt-in, local, aggregate, and content-free; state that posture in the product experience. |

## Architecture Decision Records

- [ADR-001: Fail Closed with an Attestable Fixed Explore Profile](adrs/adr-001.md) — Establishes the narrow safety boundary and runtime-scoped eligibility for V1.
- [ADR-002: Make Verified Safe Delegation the Operator Product Contract](adrs/adr-002.md) — Commits the PRD to one visible safe path and a clear refusal without fallback.

## Open Questions

- Which runtimes will be eligible for the first public safe-delegation release?
- What initial per-operator and overall child-capacity values best balance investigation usefulness with predictable control?
- What wording produces the clearest unavailable-state understanding in operator validation?
- What adoption and refusal evidence should trigger evaluation of the next eligible runtime?
