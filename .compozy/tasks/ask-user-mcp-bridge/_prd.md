# PRD: Provider-Independent `ask_user` MCP Bridge

## Overview

Kitten will give the developer supervising a live coding-agent session one consistent way to answer consequential questions without leaving the cockpit. The feature allows every eligible configured session to request structured operator input when proceeding incorrectly could cause an incorrect or irreversible change.

The product closes a provider gap without changing the operator’s mental model: a question appears in the active cockpit, identifies the requesting session, presents concise context and choices, accepts a clear outcome, and lets the same agent run continue. It is valuable because it makes agent autonomy safer at the moments where developer judgment matters most, while avoiding interruptions for routine choices.

## Goals

- Prevent consequential agent mistakes by creating an explicit operator decision point before the agent proceeds.
- Deliver the same structured-question experience to every eligible configured session, with Codex as the end-to-end proof path.
- Make no-response behavior explicit: agents receive a timed-out result rather than treating silence as approval.
- Reach a submitted answer for at least 80% of eligible questions before expanding the feature scope.
- Maintain operator trust by keeping questions and answers local to the active cockpit and excluding their content from telemetry.

## User Stories

### Supervising developer

- As a developer supervising an agent, I want a consequential question to take priority in the cockpit so that I notice it before the agent makes a harmful choice.
- As a developer, I want to see which session is asking, its working context, and the available choices so that I can make a confident decision quickly.
- As a developer, I want to select a suggested answer, provide my own answer, skip, or let the question time out so that I retain control without being forced into an answer.
- As a developer, I want the agent to continue the same run after my response so that I do not have to restate context or restart work.

### Multi-provider operator

- As an operator running several eligible providers, I want the same question experience in each session so that I do not have to learn provider-specific interaction rules.
- As an operator, I want concurrent questions to be clearly attributed to their own sessions so that I never answer the wrong agent.

### Privacy-conscious developer

- As a privacy-conscious developer, I want question and answer content to remain in the local cockpit and out of telemetry so that sensitive project context is not turned into product analytics.

## Core Features

### Critical: Consequential-decision questions

An agent may ask only when it reaches a decision where a wrong choice could create an incorrect or irreversible change. Each question includes a clear prompt, optional short context, structured suggested choices when useful, and enough session attribution for the operator to understand who is asking.

### Critical: High-priority operator attention

A consequential question takes priority over ordinary cockpit interactions. The interface supports keyboard-first completion and clearly distinguishes suggested choices, custom answers, skip, cancellation, and timeout.

### Critical: Explicit outcomes and same-run continuation

Each question ends with a submitted, skipped, timed-out, or cancelled outcome. The agent receives that outcome and may choose its safe next step in the existing run. Silence never counts as consent.

### High: Consistent eligible-session experience

Every eligible configured session receives the same question contract and operator experience. Codex is the initial proof path; other eligible sessions do not receive separate question UIs or degraded product semantics.

### High: Trustworthy session ownership and privacy

The operator can identify the requesting session before answering. Questions and answers stay local, are treated as private operator interaction, and are excluded from telemetry; analytics use only fixed outcomes and coarse timing.

## User Experience

1. An agent reaches a consequential decision and pauses rather than guessing.
2. Kitten presents a high-priority dialog that identifies the requesting session and gives concise context, structured choices, and a custom-answer option.
3. The operator answers, skips, cancels, or does not respond before the configured timeout.
4. Kitten communicates the explicit outcome to the agent and restores the cockpit to normal work.
5. The agent continues the same run using the outcome as input, or takes its own safe next step after timeout or cancellation.

The experience must be keyboard-first, understandable without provider-specific knowledge, and accessible through clear labels, focus handling, and non-color status cues. Concurrent requests must preserve clear ownership and avoid making the operator infer which session will receive an answer.

## High-Level Technical Constraints

- The experience must preserve Kitten’s existing provider-neutral session model and user-configured MCP-server behavior.
- A question must be bound to its real requesting session; an operator answer must never be delivered to another session.
- Native verified ACP clarification remains available as an independent path and must not be weakened by this feature.
- The product must remain local-first and content-free in telemetry, with no question or answer content retained for analytics.
- The MVP promises one accepted outcome while a session generation remains live; recovery after an application-process crash is not an MVP promise.

## Non-Goals (Out of Scope)

- Asking the operator about every agent ambiguity or routine implementation choice.
- Treating silence, timeout, or a dismissed dialog as approval.
- Provider-specific clarification interfaces or inconsistent feature sets for eligible sessions.
- Remote, mobile, cloud, or marketplace-based human escalation.
- Persistent history of pending questions or cross-crash replay and recovery.
- A general platform for arbitrary agent tools, autonomous answer generation, or operator-policy automation.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver consequential-decision questions, high-priority cockpit interaction, structured answer/skip/custom-answer options, explicit timeout and cancellation outcomes, and same-run continuation.
- Make the common experience available to every eligible configured session, with Codex as the end-to-end proof path.
- Keep questions and answers local and telemetry content-free.
- **Success criteria:** at least 80% of eligible questions receive a submitted answer; all live-session outcomes are clear and correctly attributed.

### Phase 2

- Use MVP outcome data and operator feedback to refine question wording, discovery, timeout defaults, and eligibility disclosures.
- Improve visibility into why questions were asked and how often operators skip or time out, without collecting content.
- **Success criteria:** sustained answer rate at or above the MVP threshold and evidence that operators view questions as helpful rather than interruptive.

### Phase 3

- Evaluate durable recovery, richer operator controls, and a broader interaction surface only if MVP adoption demonstrates recurring value beyond the single question workflow.
- **Success criteria:** a validated demand case and explicit product justification for expanding beyond live-session clarification.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Submitted-answer rate | ≥80% of eligible questions | Content-free local outcome counters |
| Consequential-question completion | ≥95% of questions reach a clear terminal outcome while the session is live | Fixed submitted, skipped, timed-out, and cancelled outcomes |
| Correct session attribution | 100% in MVP acceptance coverage | Multi-session interaction validation |
| Privacy compliance | 0 question or answer content in telemetry | Telemetry-schema and record review |
| Consistent eligible-session availability | 100% of eligible configured sessions receive the common experience | Launch configuration validation |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Operators experience questions as interruptions | Restrict MVP to consequential decisions and monitor submitted, skipped, and timed-out outcomes. |
| Agents ask vague or low-value questions | Require concise context, clear choices where useful, and a visible question purpose. |
| Operators do not trust privacy boundaries | Keep content local, make session attribution clear, and state that telemetry contains outcomes and timing only. |
| A timeout surprises the operator or agent | Display timeout state clearly and return an explicit result rather than implying consent. |
| Provider inconsistency weakens the value proposition | Define eligibility clearly and retain one shared user experience for all eligible sessions. |
| Remote escalation products appear more convenient | Position Kitten around immediate local supervision for developers already present in the cockpit. |

## Architecture Decision Records

- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — Defines the local, provider-neutral V1 and its live-session reliability boundary.
- [ADR-002: Reserve MVP questions for consequential operator decisions](adrs/adr-002.md) — Defines question policy, priority behavior, MVP availability, and the 80% expansion gate.

## Open Questions

- How should Kitten explain that a configured provider is not eligible for the common question experience?
- What timeout default best balances uninterrupted operator focus with timely agent progress?
- What operator feedback qualifies a question as helpful enough to justify broader rollout?
- Which future use cases, if any, justify investment in durable recovery or richer operator-control policy?
