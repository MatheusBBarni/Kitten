# Idea: Fix Concurrent Kitten MCP Calls Within One Session

## Overview

Kitten should let an agent author run valid parallel `ask_user` and `agent_run` calls from one parent session without a false socket-level failure. V1 is a focused reliability repair: preserve the existing private, capability-bound route and its limits; move valid concurrent admission behind the controller boundary; and present genuine capacity pressure truthfully in the existing tool outcome row.

The value is continuity during supervised agent work. A developer should not lose a valid interaction merely because two bundled MCP calls used distinct local sockets. The release is intentionally narrow: no scheduler, durable run history, configurable concurrency administration, or automatic retry of ambiguous child-start requests.

## Summary / Differentiator

Parallel coding agents are increasingly expected to remain inspectable and controllable. Kitten's differentiator is not raw fan-out; it is safe, local, session-isolated concurrency that preserves human supervision, capability-derived authority, and content-free diagnostics.

## Problem

The bundled `kitten-ask-user` MCP child opens a local socket for each `ask_user` or `agent_run` invocation. The current per-route single-socket binding can reject a second valid call as `busy` before the controller can apply its configured limits or provide a meaningful outcome. The agent author sees only a generic failed MCP row and cannot tell false contention from a stale route or legitimate capacity limit.

This is especially damaging in a supervised multi-agent workflow: `ask_user` may need a developer decision while `agent_run` starts or observes delegated work. Both calls are valid within one parent session, yet the transport falsely represents their overlap as a failure. The repair must preserve separate-session isolation, private route authorization, generation fencing, bounded resources, and the product's content-free telemetry contract.

### Market Data

- GitHub's 2024 multinational survey, updated in 2025, reports that more than 97% of respondents had used AI coding tools at work; workflow reliability therefore affects a broad, rapidly normalizing category. [GitHub survey](https://github.blog/news-insights/research/survey-ai-wave-grows/)
- Cursor exposes asynchronous background agents with status, follow-ups, and takeover, reinforcing the expectation that parallel work remains observable rather than silently failing. [Cursor Background Agents](https://docs.cursor.com/background-agent)
- MCP defines the host as the lifecycle, permission, and connection authority, and permits multiple connections where a transport supports them. This favors controller-owned bounded admission over a child-owned workaround. [MCP architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture/index), [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Bounded concurrent route admission | Critical | Valid same-session bundled MCP calls reach controller-owned admission through independently authenticated connections, within existing bounded resource limits. |
| F2 | Exact, safe terminal outcomes | Critical | Every admitted or rejected call settles once with a closed outcome; stale, invalid, and over-limit requests remain fail-closed. |
| F3 | Truthful recovery state | Critical | A legitimate temporary capacity condition is distinct from route unavailability. Manual retry guidance is never shown for an ambiguous `agent_run.start` outcome. |
| F4 | Content-free bridge observability | High | The controller records only allowlisted failure and outcome categories plus bounded dimensions after it can classify the request; no prompt, endpoint, capability, identifier, or raw error is retained. |
| F5 | Existing tool-row clarity | High | The current MCP tool-call surface distinguishes retryable capacity pressure from unavailable instead of reducing both to a generic failed row. |

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Generated Kitten MCP child | Retains the existing `ask_user` and `agent_run` public contracts and local forwarding model. |
| Authenticated MCP bridge | Keeps capability-derived session/generation authority, private endpoints, bounded frames, call limits, and teardown behavior. |
| Controller | Becomes the owner of legitimate admission, route failure classification, and lifecycle settlement. |
| Telemetry recorder | Uses a closed, opt-in, content-free outcome vocabulary. |
| Tool-call reducer and row | Reuses the existing state and rendering pipeline to present bounded recovery information. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Valid same-route parallel completion | 100% of 2–4 valid concurrent calls complete without socket-level false `busy` in deterministic integration coverage | Real child-mode, authenticated-IPC integration test |
| Honest configured-limit classification | 100% of deliberate concurrency/call-limit scenarios return a closed bounded reason and the expected UI state | Bridge, controller, and rendered tool-row tests |
| Cross-session isolation | 100% of concurrent two-session tests preserve route ownership; 0 cross-route outcomes | Capability and generation-isolation integration tests |
| Telemetry privacy compliance | 0 disallowed content, route, capability, endpoint, identifier, or raw-error fields in emitted bridge records | Allowlist/schema assertions over opt-in telemetry records |
| Ambiguous-start replay prevention | 0 automatic replays of an `agent_run.start` request after a lost or ambiguous result | Disconnect and settlement regression tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Quick Win

## Council Insights

- **Recommended approach:** Admit bounded independently authenticated calls through the existing route, while keeping authority and genuine capacity decisions controller-owned.
- **Key trade-offs:** Direct bounded admission avoids scheduler scope creep; a future fairness queue is justified only if fixed admission budgets prove unable to prevent starvation.
- **Risks identified:** Disconnects, route replacement, stale generations, duplicate `agent_run.start` effects, and content leakage. Mitigate them through exact-once settlement, generation checks at admission and dispatch, bounded resources, and allowlisted telemetry.
- **Stretch goal (V2+):** Add evidence-driven fair scheduling or execution-confidence history only after V1 demonstrates sustained real-world pressure.

## Out of Scope (V1)

- **Configurable queues, priorities, or fairness scheduler** — changes this repair into an orchestration platform without evidence that bounded admission is insufficient.
- **Durable tool-result or error history** — expands persistence and privacy scope beyond the immediate false-contention defect.
- **Automatic retry or replay of `agent_run.start`** — can create duplicate child work when the original execution state is ambiguous.
- **New dashboard or MCP-specific result surface** — the existing tool-call row is sufficient to communicate the required bounded state.
- **Cross-session shared capacity management** — session isolation is an existing safety contract, not a capacity pool to redesign here.

## Architecture Decision Records

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — fixes false socket exclusivity without introducing scheduler or replay semantics.

## Open Questions

- Which controller-owned fixed admission budgets provide enough parallel progress without starving the interaction path?
- What exact bounded copy should distinguish a retryable authoritative `busy` from an `unavailable` or ambiguous outcome?
- Does the current closed telemetry vocabulary need a new tool-kind or retryability dimension, and can it remain strictly content-free?
