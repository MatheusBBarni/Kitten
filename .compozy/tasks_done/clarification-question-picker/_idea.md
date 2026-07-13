# Clarification Question Picker

## Overview

Kitten should help users answer agent clarification requests with structured, session-attributed choices instead of forcing them to compose an ambiguous free-form reply. The feature serves Kitten’s keyboard-first users who operate one or more live coding-agent sessions.

V1 is intentionally narrow: it handles explicit, structured clarification requests only from provider adapters verified to support the complete request/response path. It combines a selectable question card with reliable blocked-session visibility, so a user can tell which agent is waiting, understand the consequences of each choice, choose one or many options, or switch to text. It does not attempt to infer intent from ordinary agent prose.

### Summary / Differentiator

Unlike single-agent tools, Kitten can normalize questions across providers and make waiting decisions visible across multiple live sessions. The differentiator is not a prettier multiple-choice prompt; it is a trustworthy, provider-neutral clarification loop that prevents background agents from appearing stalled.

## Problem

When an agent needs a user preference or a decision with materially different outcomes, an unstructured chat question is slow to parse and easy to answer incompletely. In a multi-session terminal cockpit, the problem is worse: a background agent may be waiting while the user continues working elsewhere, making a blocked session look broken rather than awaiting input.

Kitten currently has a robust permission-request pattern but no equivalent product surface for clarification. Treating clarification as a regular prompt loses the response contract and may create a new conversational turn instead of resuming the waiting agent. Treating it as a permission also conflates different levels of user risk and intent.

V1 therefore focuses on explicit structured requests and is gated on confirming at least one provider adapter can carry the complete request/response lifecycle. It must make pending decisions visible, attribute each request to its session, let the user answer without ambiguity, and preserve a text fallback when provided options do not fit.

### Market Data

- Claude Code supports structured user input with labeled options, multi-select, free text, and pause-until-answered behavior. [Documentation](https://code.claude.com/docs/en/agent-sdk/user-input)
- Codex guidance recommends asking only questions that materially affect a plan and presenting meaningful options with a recommended choice where appropriate. [Plan-mode template](https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md)
- A Codex report shows that an unanswered question can appear as a stalled session when the user is not notified. [Issue #11097](https://github.com/openai/codex/issues/11097)
- GitHub reports that 73% of surveyed Copilot users felt it helped them stay in flow and 87% felt it conserved mental effort on repetitive work. This is directional evidence for reducing AI-workflow friction, not proof of this feature’s effect. [Research](https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness-/)

## Integration with Existing Features

| Integration Point | How |
|---|---|
| Permission-request experience | Reuse its modal interaction quality and queueing precedent while keeping clarification semantics distinct. |
| Multi-session cockpit | Attribute every question and waiting state to the originating agent session. |
| Conversation input | Return structured answers to the waiting request rather than treating them as ordinary new prompts. |
| Local telemetry | Measure content-free interaction outcomes; retain Kitten’s local, opt-in telemetry posture. |

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Structured clarification cards | Critical | For verified provider adapters, present explicit agent questions with concise context, option labels, and consequence descriptions in a dedicated clarification experience. |
| F2 | Session-attributed waiting visibility | Critical | Clearly identify the waiting agent and keep pending questions visible and reachable when their session is unfocused. |
| F3 | Flexible answers with text fallback | Critical | Support single-select, multi-select, and a visible switch to custom text; never force a false choice. |
| F4 | Safe decision lifecycle | High | Ensure each request can be confirmed, explicitly cancelled, or invalidated safely when its agent/session is no longer available. |
| F5 | Keyboard-first interaction | High | Provide predictable navigation, direct option selection, confirmation, cancellation, and focus behavior without a mouse. |
| F6 | Privacy-preserving outcome measurement | Medium | Record local, content-free signals for completion, cancellation, latency, answer mode, and visibility failures; assess option quality in user research. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Structured answer completion | ≥80% of presented requests | Locally count requests answered with an explicit structured or text response divided by requests presented. |
| Explicit cancellation rate | ≤20% of presented requests | Locally count user cancellations separately from submitted answers. |
| Median response latency | ≤30 seconds | Measure local elapsed time from presentation to terminal outcome. |
| Unnoticed waiting requests in usability testing | 0 per test session | Observe whether participants can identify every waiting session without being told. |
| Option-fit satisfaction | ≥80% of usability-study participants | Ask participants after a completed request whether the offered choices fit their intended answer; treat text use as valid, not as failure. |
| Capability transparency | 100% of configured providers | Verify that every configured provider visibly reports whether structured clarification is supported before the feature is enabled. |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Maybe |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** ship a provider-normalized clarification flow only for adapters verified to support explicit structured requests, paired with visible multi-session waiting state.
- **Key trade-offs:** use thin shared interaction-routing primitives for identity, ownership, ordering, lifecycle, and attention; keep permission and clarification payloads, policies, and terminology distinct.
- **Risks identified:** unequal provider capabilities, stale or duplicate requests, disconnects, background-session invisibility, and poor option quality. Mitigate them with explicit lifecycle outcomes, session attribution, text fallback, and local measurements.
- **Stretch goal (V2+):** a persistent decision inbox with blocked-session navigation, notifications, history, prioritization, and reusable answers.

## Out of Scope (V1)

- **Inference from ordinary agent prose** — unreliable intent detection would create false positives and ambiguous response routing.
- **Full decision-inbox history and triage** — valuable only after V1 proves question frequency and user value.
- **Silent automatic defaults or timeouts** — user decisions must never be submitted without an explicit, visible action.
- **Cross-session prioritization and reusable answer libraries** — expand scope before the core reliability loop is validated.
- **Conflating permissions with clarifications** — these decisions carry different risk, language, and cancellation semantics.

## Architecture Decision Records

- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md) — Defines the narrow V1 boundary, minimal routing contract, and exclusions.

## Open Questions

- Which supported provider adapters can issue structured clarification requests through Kitten’s current transport surface?
- Should unresolved requests persist across session restoration, or should users receive a clear expired/cancelled outcome?
- What wording standard should agents follow for option labels, consequences, and recommendations?
- Which local telemetry controls and retention rules best meet Kitten’s privacy posture?
