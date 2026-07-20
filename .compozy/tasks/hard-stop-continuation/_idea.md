# Idea: Hard Stop Continuation

## Overview

Hard Stop Continuation makes an explicit `Esc` interruption recoverable for iterative coding users. When Kitten can prove that the interrupted ACP turn has settled in the same live session generation, it preserves the healthy session and sends one queued continuation as the next ordinary prompt. When it cannot prove safety, it keeps the draft visible and offers `/new`; it never guesses, retries, or sends into uncertainty.

V1 is a focused reliability repair, not an interruption platform. It covers every explicit Hard Stop, maintains current approval and clarification ownership, and keeps queued text ephemeral. Its value is continuity: a developer can interrupt a response to refine the task without losing the thread, duplicating a harness, or exposing the next draft beyond the live composer.

### Summary / Differentiator

Competing tools expose stateful cancellation, but Kitten can differentiate through a provider-neutral, terminal-native recovery contract: interrupt without losing the thread, while keeping the queued continuation local, one-shot, and privacy-bounded.

## Problem

Today, cancelling a fresh harness-bearing prompt can turn an otherwise healthy Kitten session into **Safe start unavailable**. The user’s next draft remains only in the composer; it is neither added to the transcript nor sent, and `/new` becomes the sole recovery path. The failure is not merely an inconvenient cancellation result: it forces an iterative coding user to abandon live context precisely when they interrupted to improve the task.

The current path conservatively marks an in-flight first harness as indeterminate before the provider turn reaches terminal settlement. That behavior avoids an unsafe resend, but it also permanently blocks ordinary continuation in a session that may still be healthy. Extending steering would be incorrect: the continuation is a normal next prompt, not a concurrent follow-up or a prefixed steering instruction.

V1 must resolve the tension without making provider assumptions. A cancellation acknowledgment, an open socket, or a late callback does not by itself prove that a provider is ready for another turn. Any timeout, connection error, session replacement, stale generation, or missing proof must preserve the draft and route recovery to `/new`.

### Market Data

- The [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/ai) reports that 84% of respondents use or plan to use AI development tools, 50.6% of professional developers use them daily, and 52% report a positive productivity effect. Reliable control of agent work therefore affects routine developer flow, not an edge case.
- [Abad et al.](https://arxiv.org/abs/1805.05508) studied 4,910 software-development tasks and a 132-developer survey; its cited programming-session research found that reconstructing context after interruption can take 15–30 minutes. This feature aims to preserve that context after a deliberate interruption.
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/cancel-and-roll-back) distinguishes cancellation states and removes queued prompts before cancelling active work. [VS Code’s agent-harness guidance](https://code.visualstudio.com/blogs/2026/05/15/agent-harnesses-github-copilot-vscode) checks cancellation between agent rounds. These patterns support state-aware, settlement-gated recovery rather than racing an active turn.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Explicit Hard Stop | Critical | `Esc` cancels only an eligible working turn while retaining the healthy ACP session and preserving approval/clarification interaction ownership. |
| F2 | One live continuation | Critical | After a Hard Stop, accept exactly one user-submitted continuation, hold it until safe settlement, and keep later drafts editable. |
| F3 | Proof-gated ordinary dispatch | Critical | Dispatch the queued continuation as a normal next prompt only on affirmative, current-generation safe-settlement evidence; otherwise retain it visibly and offer `/new`. |
| F4 | Lossless second Escape | High | A second `Esc` removes the queued continuation, restores its text to the composer, and does not issue another provider cancellation. |
| F5 | Truthful first-turn harness recovery | High | Record `settled_interrupted` after a confirmed, settled first harness interruption; do not duplicate the harness or claim the provider consumed it. |
| F6 | Live-only privacy boundary | High | Keep continuation text out of persistence, telemetry, diagnostics, and handoff material; emit only allowlisted content-free lifecycle outcomes where measurement is enabled. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Controller prompt lifecycle | Retains authority for provider cancellation, terminal settlement, session identity, and generation fencing. |
| Steering recovery | Preserves steering’s precedence and cancellation cleanup, but never uses steering transport for a continuation. |
| Harness delivery | Adds the truthful `settled_interrupted` lifecycle checkpoint for a cancelled first harness turn. |
| Composer and interaction ownership | Exposes a narrow recovery phase while preserving editable drafts and the existing approval/clarification rules. |
| Persistence, telemetry, and handoff | Persists only closed harness metadata where required; continuation text remains outside all durable or cross-session surfaces. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Lossless hard-stop outcome | 100% of deterministic hard-stop race scenarios end in exactly one ordinary dispatch or a visibly recoverable draft | Controller, reducer, and UI race suites covering settlement, timeout, error, close, replacement, stale generation, and repeated Escape. |
| Unsafe continuation dispatches | 0 dispatches after an indeterminate, stale, or withdrawn continuation | Deferred-promise and adversarial adapter tests with duplicate, delayed, missing, and stale terminal events. |
| Eligible same-session continuation | At least 95% of content-free, proof-eligible hard stops dispatch the single queued continuation in the original session | Opt-in local outcome counters: `settled_interrupted`, queued, dispatched, restored, and `/new` fallback—never draft text or identifiers. |
| Recovery responsiveness | p95 ≤ 250 ms from authoritative terminal settlement to queued-continuation dispatch | Controlled timing instrumentation in integration tests and opt-in local aggregate timing buckets. |
| Privacy compliance | 0 continuation-text occurrences in persistence, telemetry, diagnostics, or handoff regression fixtures | Sentinel-based negative assertions over run records, telemetry JSONL, diagnostics, and assembled handoff bundles. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Must do |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Quick Win

## Council Insights

- **Recommended approach:** Use a named, controller-owned, live-only interruption-recovery coordinator with one continuation slot. It may send only after affirmative, current-generation adapter-safe settlement evidence.
- **Key trade-offs:** Broad recovery coverage is valuable, but coverage cannot outrun transport proof. A narrow coordinator is more maintainable than a durable retry platform and more coherent than repurposing steering.
- **Risks identified:** Stale or duplicate callbacks, weak cancellation semantics, withdrawn-draft replay, harness duplication, privacy leakage, and interaction-ownership regressions. Mitigate through atomic slot removal before dispatch, session/generation/prompt fencing, adapter proof gates, sentinel privacy tests, and preserved `/new` fallback.
- **Stretch goal (V2+):** Establish explicit Provider Recovery Profiles that declare adapter-safe settlement capability and make coverage expansion evidence-driven.

## Out of Scope (V1)

- **Durable draft queues, retries, or automatic replay** — would enlarge persistence and duplicate-execution risk before the one-slot recovery behavior is proven.
- **Generic continuation after an unverified terminal callback** — would turn provider ambiguity into an unsafe delivery promise.
- **A generalized interruption-management platform** — configurable queues, priorities, waiting, or orchestration are not required for the immediate recovery outcome.
- **Provider rollback or workspace undo** — interruption recovery preserves the session and draft; it does not claim transactional reversal of provider or filesystem work.
- **Changing approval or clarification cancellation semantics** — those interactions retain their existing owner and precedence.

## Architecture Decision Records

- [ADR-001: Use a bounded, proof-gated same-session continuation](adrs/adr-001.md) — Selects the live-only, controller-owned recovery boundary and safe fallback.

## Open Questions

- Which currently supported adapters can provide affirmative safe-settlement evidence, and what exact evidence is sufficient for each?
- How should the composer label queued, restored, and `/new` fallback states so that users never infer a send before it occurs?
- What baseline will establish whether the 95% proof-eligible same-session-continuation target is realistic in opt-in local usage?
- Should Provider Recovery Profiles become a distinct follow-up once V1 outcome data shows material adapter coverage gaps?
