# Host-Owned MCP Child Control

## Overview

Kitten will let a primary coding agent launch a bounded batch of independent child tasks through one provider-neutral MCP interface. It targets solo developers who want parallel progress without hidden work: every child remains a normal, visible Kitten conversation with clear lifecycle and attention state.

V1 is intentionally narrow: start owned children and poll their status. It validates the core delegation loop before adding broader orchestration controls.

### Summary / Differentiator

Unlike provider-native subagents, Kitten owns child identity, visibility, and lifecycle consistently across Codex and Claude Code. The differentiator is trustworthy, host-owned parallel work—not a broad workflow engine.

## Problem

A solo developer can use Kitten’s existing UI to delegate work, but a primary coding agent has no provider-neutral way to initiate those children itself. Provider-native delegation would fragment behavior, hide lifecycle details, and bypass Kitten’s safety and session UX.

Parallel coding agents are becoming an expected workflow, but developers still need visibility and control. RepoPrompt CE offers the closest host-owned MCP pattern, while Claude Code, GitHub Copilot, and Codex foreground visible background sessions. [RepoPrompt](https://repoprompt.com/docs), [Claude Code agent view](https://code.claude.com/docs/en/agent-view), [GitHub Copilot session management](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents), [Codex app](https://openai.com/index/introducing-the-codex-app/)

### Market Data

AI-assisted development is growing, but autonomous-agent adoption remains uneven: Stack Overflow reports that 52% of developers either do not use agents or use only simpler AI tools, and 38% do not plan to adopt them. This supports a focused, trustworthy solo-developer loop over a full automation platform. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai)

GitHub reports 1.1 million public repositories using an LLM SDK, up 178% year over year—an adoption signal rather than causal market proof. [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Provider-neutral child launch | Critical | Let Codex and Claude Code use the same `agent_run` contract to start a bounded batch of independent child tasks. |
| F2 | Authenticated ownership | Critical | Derive the parent from the authenticated Kitten connection; reject fabricated, stale, recursive, or cross-parent child control. |
| F3 | Owned status polling | Critical | Return stable Kitten child IDs and lifecycle snapshots only for children owned by the caller’s parent session. |
| F4 | Visible normal conversations | Critical | Every successful child launch becomes a normal, focusable Kitten conversation with lineage, running, needs-input, and terminal cues. |
| F5 | Bounded, fail-closed operation | High | Enforce request, batch, and concurrency limits; invalid routes or lifecycle states fail explicitly without side effects. |

### Integration with Existing Features

| Integration point | Product behavior |
| --- | --- |
| Host-owned orchestration registry | The MCP surface consumes Kitten’s existing child ownership and lifecycle model. |
| Normal session workspace | Children remain visible, focusable conversations rather than hidden provider work. |
| Existing attention surfaces | A child needing input is explicit, so the developer can recover through the normal session UI. |
| Bundled MCP bridge | User-configured MCP servers remain intact while Kitten adds one generated local control surface. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Child-start reliability | ≥99% | Accepted starts that create visible child conversations / accepted start requests in integration and dogfood telemetry. |
| Visibility latency | <1 second p95 | Time from accepted start to child lifecycle presence in the workspace. |
| Ownership enforcement | 100% | Contract cases reject cross-parent, stale-route, fabricated-ID, and recursive-control attempts. |
| Lifecycle consistency | 100% | Test matrix finds no duplicate terminal state or snapshot published after a stale generation. |
| Attention discoverability | ≥90% | Dogfood participants identify a child needing input within two interactions. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Ship bounded batch `start` plus owned-child `poll`; preserve visible normal child conversations and route-derived ownership.
- **Key trade-offs:** Polling is less convenient than waiting, but avoids defining a second completion lifecycle before demand is proven.
- **Dissent retained:** Start-and-poll is viable only when attention and terminal states are unambiguous and human recovery through the session UI is reliable.
- **Risks and mitigations:** Prevent cross-session control and resource exhaustion with authenticated ownership, lifecycle checks, limits, and explicit failures.
- **Stretch goal (V2+):** Add a bounded non-cancelling `wait` as a thin convenience layer over a proven polling contract.

## Out of Scope (V1)

- **Wait, cancel, steer, and respond** — These require separate lifecycle, timeout, authorization, and interaction contracts.
- **`agent_explore` and `agent_manage`** — Batch probes, role discovery, transcripts, and handoffs broaden the surface before core value is validated.
- **Nested delegation and scheduling** — V1 supports independent flat child work, not a workflow engine.
- **Worktree isolation and profile policy** — These remain dedicated follow-up concerns, not implied safety guarantees of this feature.
- **Automatic retries or decomposition** — The agent explicitly chooses bounded work; Kitten must not introduce opaque automation.

## Architecture Decision Records

- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — Defines the accepted V1 scope, ownership model, and exclusions.

## Open Questions

- What maximum child-batch size keeps V1 usable and resource-safe?
- What runtime or budget guard prevents unattended child work from becoming wasteful?
- How long should terminal child snapshots remain pollable?
- What dogfood signal should trigger prioritizing `wait`, cancellation, or input forwarding next?
