# Idea: Deliver the Kitten Harness Exactly Once per Fresh ACP Session

## Overview

Kitten should deliver the versioned, protocol-free harness from #18 exactly once with the first real user prompt of each genuinely fresh ACP session. This serves daily Kitten users who expect a new, replaced, or fallback agent conversation to receive stable host guidance without changing what appears in their transcript.

V1 covers the complete session lifecycle: new sessions, successful loads, load fallbacks, replacements, handoff-first prompts, cancellation, close, and crash paths. If Kitten cannot establish safe harness delivery, it stops that user turn and presents a concise, actionable degraded-session status.

### Summary / Differentiator

Kitten differentiates through trustworthy lifecycle semantics: host guidance is delivered once per fresh controller generation, never leaks into user-visible artifacts, and never silently degrades after ambiguous transport failure.

## Problem

ACP v1 does not provide a universal hidden host-instruction field or an early prompt-acceptance acknowledgement. A host that naively prepends text to every prompt risks duplicate instructions, user-turn duplication after partial failures, and pollution of transcripts, history, handoffs, persistence, and diagnostics. [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup) and [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)

Kitten already distinguishes fresh `session/new` from successful `session/load`, fresh load fallbacks, and replacement generations. However, its current prompt path records the user's blocks and maps them directly to ACP. Without a controller-owned delivery decision, a harness cannot be injected safely or consistently across those paths.

### Market Data

Coding-agent use is growing: a 2026 study estimates adoption across GitHub projects at 15.85–22.60%. Teams also expect controlled, auditable agent behavior rather than opaque prompt mutation. [Coding-agent adoption study](https://arxiv.org/abs/2601.18341), [GitHub coding-agent announcement](https://github.com/newsroom/press-releases/coding-agent-for-github-copilot)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Generation-scoped delivery state | Critical | The controller tracks `not_required`, `pending`, `in_flight`, `delivered`, and fixed failure states by live ACP identity plus controller generation. |
| F2 | First-turn delivery envelope | Critical | The first user prompt for a fresh generation carries the rendered #18 harness through a separate protocol-free envelope; user-visible blocks remain unchanged. |
| F3 | Explicit lifecycle decisions | Critical | New, load, failed-load fallback, replacement, handoff-first, cancellation, close, and crash paths deterministically choose delivery or `not_required`. |
| F4 | Safe failure and retry policy | Critical | Conclusively pre-dispatch failures may retry; ambiguous or post-dispatch failures never auto-resubmit and instead stop the turn with an actionable degraded status. |
| F5 | Verified adapter encoding | High | `src/agent/` applies provider/runtime-profile encoding while core, store, UI, and harness rendering remain ACP-free. |
| F6 | Content-free observability | High | Diagnostics and any required restoration control facts expose only version, state, lifecycle path, profile ID, and fixed failure category. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| #18 harness contract | Supplies the deterministic, versioned protocol-free rendered harness. |
| Controller runtime | Owns live ACP identity, generation, creation/load/replacement truth, and delivery state. |
| Prompt actions | Continues recording only original user blocks before dispatch. |
| ACP adapter | Encodes the separate delivery envelope for verified runtime profiles. |
| Handoff flow | Sends the reviewed handoff bundle as the first visible user content while excluding hidden harness text from later handoffs. |
| Persistence and telemetry | May retain only minimal content-free control metadata when needed for safe restoration. |

## KPIs

| KPI | Target | How to Measure |
| --- | ---: | --- |
| Fresh lifecycle coverage | 100% of defined fresh paths | Contract tests for new, fallback, replacement, handoff-first, and crash recovery |
| Duplicate harness delivery | 0 occurrences | Exact mock-ACP assertions across follow-up, retry, and replacement tests |
| Hidden-content leakage | 0 occurrences | Transcript, persistence, history, handoff, and telemetry assertions |
| Deterministic failure settlement | 100% of modeled failures settle once | Tests for pre-dispatch failure, partial output, cancellation, close, and crash |
| Unsupported-profile clarity | 100% fixed actionable status | Runtime-profile and diagnostics contract tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Strategic Bet

## Council Insights

- **Recommended approach:** a controller-owned, per-generation delivery state machine; adapters encode, but do not own lifecycle policy.
- **Key trade-offs:** full lifecycle coverage is more work than fresh-session-only delivery, but avoids establishing an incomplete ownership boundary that later work must retrofit.
- **Risks identified:** ACP cannot prove provider consumption; timeout or partial output makes delivery ambiguous; an incorrect adapter profile could expose or duplicate content.
- **Mitigations:** define `delivered` as successful controller submission, not provider consumption; fail closed after possible dispatch; require profile-level contract tests; retain only content-free diagnostic facts.
- **Stretch goal (V2+):** an adapter-profile assurance layer with capability probes, self-checks, and compatibility reporting.

## Out of Scope (V1)

- **Harness wording and versioning policy** — owned by #18.
- **Capability-specific harness fragments** — owned by #20.
- **Provider-native system-prompt replacement** — ACP does not make this portable, and it would exceed Kitten's host boundary.
- **Automatic retry after ambiguous delivery** — could duplicate user work or hidden guidance.
- **A user-facing harness editor** — would weaken the reviewed, versioned contract.
- **Persisting rendered harnesses, user prompts, paths, or raw errors** — violates the content-free safety boundary.

## Architecture Decision Records

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — Makes the controller authoritative for delivery state and establishes fail-closed ambiguity handling.

## Open Questions

- Which built-in adapter profiles can prove the required host-versus-user encoding contract?
- Can a content-free persisted delivery marker safely distinguish an old restored provider session from an ambiguous first-turn failure?
- What exact evidence class can establish a conclusively pre-dispatch failure for retry?
- Should a verified tagged composite be acceptable for custom recipes, or should unverified recipes always become degraded?
