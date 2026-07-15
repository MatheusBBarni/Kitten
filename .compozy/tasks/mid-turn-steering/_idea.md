# Mid-Turn Steering

## Overview

Kitten needs a reliable way for developers to redirect a long-running agent without creating a competing ACP prompt or losing their instruction. V1 introduces first-class steering: one active turn per session, visible steering states, verified native support where available, and a lossless cancel-and-follow-up fallback otherwise.

It serves developers supervising agent work and is a strategic reliability foundation, not a provider-policy platform.

### Summary / Differentiator

Kitten provides one trustworthy steering contract across providers: native steering stays behind the adapter boundary, while unsupported providers receive the same visible, ordered, lossless behavior through a safe fallback.

## Problem

Today, an ordinary prompt can be sent while a session is already working. That can replace local tracking for the prior turn before it settles, allowing concurrent calls, interleaved outcomes, and ambiguity over which user instruction actually owns the active work. A developer correcting an agent during a long tool call needs to know their instruction is queued, sent, or restored—not silently discarded.

Current agent tools establish a clear expectation: steering differs from stopping. Claude Code distinguishes interruption from a correction delivered after an active tool action; Copilot similarly supports follow-up direction and explicit stop behavior. Kitten needs that control model without exposing provider-specific behavior.

### Market Data

Stack Overflow’s 2025 survey reports widespread use of AI agents for software engineering and meaningful productivity benefits, while accuracy and security concerns remain high. Reliable human supervision is therefore a trust feature, not mere polish. [2025 Developer Survey](https://survey.stackoverflow.co/2025/ai)

Claude Code and GitHub Copilot distinguish steering from stopping, giving developers a staged intervention model during active work. Kitten can provide that model consistently across adapters. [Anthropic](https://code.claude.com/docs/en/how-claude-code-works), [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Single active turn | Critical | Prevent ordinary prompt submission from creating a second active ACP prompt for the same session. |
| F2 | Explicit steering action | Critical | Let developers submit steering separately from a new prompt, with queued, sending, delivered, and failed states. |
| F3 | Provider-neutral fallback | Critical | Use verified native steering when available; otherwise queue, reach an interaction-safe boundary, cancel, settle, and send one interruption-marked follow-up. |
| F4 | Lossless intent recovery | High | Preserve chronological queued text, coalesce without losing text, and visibly restore it when cancellation or delivery is ambiguous or fails. |
| F5 | Interaction-safe lifecycle | High | Keep permission and clarification work from being orphaned, resolved against the wrong turn, or raced by replacement and close events. |
| F6 | Clear transcript semantics | High | Distinguish the original user turn, its interruption, and the steering follow-up without duplicate user messages. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| ACP adapter | Contains native steering detection and fallback transport details. |
| Prompt action surface | Separates ordinary prompts from explicit steering. |
| Interaction coordinator | Defines safe boundaries around permissions and clarifications. |
| Session store and transcript | Owns visible lifecycle state and interruption markers. |
| Composer UI | Shows queued, sending, and failed steering states and restores unsent text. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Concurrent ACP prompts per session | 0 | Instrumented lifecycle tests and opt-in content-free counters. |
| Accepted steering requests with exactly one terminal outcome | 100% | State-machine and integration test matrix. |
| Queued text restored after failed or ambiguous delivery | 100% | Failure-path tests for cancel, timeout, crash, close, and replacement. |
| Named lifecycle race scenarios covered | 100% | Tests for coalescing, interaction drain, late terminal event, timeout, close, crash, and generation replacement. |
| Users correctly identifying steering state in assisted testing | at least 80% | Task-based usability test. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Strategic Bet.

## Council Insights

- **Recommended approach:** Ship a narrow, lossless steering contract: protocol-free lifecycle rules, controller-sequenced effects, ACP-specific adapter behavior, and store-committed confirmed outcomes.
- **Key trade-offs:** Native-only support is simpler but inconsistent; a provider-policy platform is flexible but premature; bounded settlement protects responsiveness but needs explicit ambiguous-delivery recovery.
- **Risks identified:** Late terminal events, stale generations, interaction races, duplicate follow-ups, and false success after timeout. Mitigate with request identities, generation fencing, idempotent settlement, and adversarial tests.
- **Dissenting view:** The smallest possible V1 could defer some lifecycle-race coverage. The council recommends retaining all issue-named failure scenarios because they define “lossless.”
- **Stretch goal (V2+):** An agent supervision layer with a timeline, intervention inbox, takeover, and provider-specific steering optimizations.

## Out of Scope (V1)

- **Provider-policy configuration** — defer until real provider differences show a user need.
- **Automatic retry after ambiguous delivery** — risks duplicate instructions; restore text for deliberate user action instead.
- **Persistent steering history and analytics** — focus first on live-session correctness.
- **Multi-author steering controls** — no collaboration model is defined yet.
- **Full intervention workspace or takeover mode** — valuable, but depends on the reliable lifecycle foundation.

## Architecture Decision Records

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — Defines the safety contract and V1 boundaries.

## Open Questions

- Which providers can truthfully advertise native steering capability, and what evidence is required?
- What terminal-settlement bound gives developers responsive feedback without causing premature recovery?
- What is the clearest composer interaction for steering while preserving ordinary prompt behavior?
- Should interruption markers be persisted across session restoration, or remain only in the active transcript?
