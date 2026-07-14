# Provider-Independent `ask_user` MCP Bridge

## Overview

Kitten will let every eligible agent session ask its supervising operator structured questions through one local `ask_user` contract. The feature targets developers running live Codex, Claude Code, or custom ACP sessions in the cockpit.

V1 reuses Kitten’s existing clarification experience while removing reliance on provider-specific ACP elicitation support. It is intentionally narrow: one operator-interaction tool, one consistent contract, and a live-session reliability boundary. Codex is the end-to-end proof path, not the product boundary.

### Summary / Differentiator

Unlike generic human-in-the-loop tools that relay questions to a separate device or service, Kitten keeps the question, answer, session identity, and continuation inside the active local cockpit. That supports immediate, accountable operator intervention without cross-session ambiguity.

## Problem

A coding agent occasionally needs a decision it cannot safely infer: which migration strategy to choose, whether to preserve a compatibility boundary, or how to resolve an ambiguous requirement. Today, an agent whose ACP adapter lacks verified elicitation support must guess, stall, or ask through unstructured chat. Kitten already has a structured clarification model and dialog, but its production capability is unavailable through the built-in Codex recipe.

The consequence is not merely a missing UI control. The operator loses a reliable moment to guide an agent in the same turn, and a multi-provider cockpit becomes limited by whichever provider implements a particular protocol callback. Native ACP elicitation should remain fail-closed until verified; a provider-neutral operator interaction path is needed alongside it.

### Market Data

- Coding-agent clarification is an established interaction: VS Code supports agent questions and GitHub Copilot CLI distinguishes interactive questioning from no-question autonomous operation. [VS Code documentation](https://code.visualstudio.com/docs/agent-customization/prompt-files), [GitHub Copilot documentation](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot)
- The 2025 Stack Overflow survey reports that 84% of developers using agents at work use them for software development, while 75.3% would still ask a person when they do not trust an AI answer. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai)
- [ask-a-human](https://ask-a-human.ai/) already offers cross-client agent questioning, validating demand while leaving room for Kitten’s same-session, local-first experience.
- MCP guidance highlights session hijacking and per-tool human control, making trustworthy session ownership and content privacy core product requirements. [MCP security guidance](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Session-owned `ask_user` contract | Critical | Every eligible session receives the same local structured-question capability; Kitten, not the caller, establishes the owning session. |
| F2 | Structured operator answers | Critical | Operators can select one or many suggestions, provide a custom answer, or explicitly skip. Questions support stable IDs and optional header/context. |
| F3 | Explicit terminal outcomes | Critical | Agents receive submitted, skipped, timed-out, or cancelled results and can continue their own decision process. |
| F4 | Reliable live-session lifecycle | Critical | Each request settles at most once while its session generation is live; replacement, close, provider failure, and shutdown resolve pending work rather than leaving it hanging. |
| F5 | Provider-neutral experience | High | Codex proves the end-to-end path; Claude Code and custom eligible providers receive the same product contract without separate UIs. |
| F6 | Privacy-safe observability | High | Local telemetry records only fixed outcomes and coarse duration buckets, never question, answer, path, provider recipe, or routing content. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Clarification model and dialog | Reuse the existing structured prompt and modal queue; users learn no second question UI. |
| Session lifecycle | Tie every request to its active Kitten session and cancel stale work during replacement or failure. |
| MCP server configuration | Add the Kitten bridge predictably alongside user-configured MCP servers without changing their order. |
| Native ACP elicitation | Retain it as an independent verified fast path; the bridge does not weaken its fail-closed policy. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Submitted-answer rate | ≥80% of non-lifecycle-ended questions | Local outcome counters: submitted ÷ questions not ended by replacement, close, crash, or shutdown |
| Live-request settlement | 100% settle once in lifecycle and concurrency coverage | Fake-transport and integration tests across all terminal paths |
| Session-routing correctness | 100% in multi-session and stale-generation coverage | Contract tests that reject incorrect, duplicate, and late responses |
| Privacy compliance | 0 telemetry records containing question or answer content | Recorder schema tests and emitted-record inspection |
| Provider contract coverage | 100% of eligible configured sessions receive the bridge without changing user MCP order | Configuration and session-creation tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Ship one provider-neutral, local `ask_user` bridge that reuses Kitten’s existing clarification experience and establishes session ownership inside Kitten.
- **Key trade-offs:** A Codex-only integration would be faster but violates the selected cross-provider promise; a durable generalized interaction platform is more ambitious but premature.
- **Risks identified:** Cross-session answer leakage, stale/duplicate settlement, hanging agent calls, MCP-order disruption, untrusted payloads, and content leakage in telemetry.
- **Reliability boundary:** V1 guarantees at most one accepted outcome while the owning session generation is live. Cross-process crash replay requires durable state and is deferred.
- **Stretch goal (V2+):** A durable Kitten interaction bus shared by MCP and ACP, with restart recovery, idempotent replay, and future operator-interaction tools.

## Out of Scope (V1)

- **Cross-crash recovery and replay** — requires durable journaling and reconciliation beyond the validated live-session use case.
- **Generic MCP tool hosting** — V1 validates one high-value operator interaction, not a broad extension platform.
- **Remote, mobile, or cloud answer delivery** — weakens the local cockpit differentiator and expands privacy and identity scope.
- **Provider-specific question UIs** — fragments the operator experience and undermines the single-contract goal.
- **Persistent pending-question history** — adds retention and privacy policy work before demand is proven.
- **Autonomous answer generation** — changes the feature from accountable operator intervention into an autonomy policy product.

## Architecture Decision Records

- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — Establishes the narrow contract, security controls, and non-durable crash boundary.

## Open Questions

- Which configured providers qualify as bridge-eligible at launch, and how should unsupported providers be disclosed?
- What default timeout best balances agent progress with an operator’s attention?
- What payload and queue limits preserve a responsive cockpit without rejecting legitimate structured questions?
- When should Kitten invest in durable recovery or escalation-policy controls after V1 data arrives?
