# Multi-Agent Orchestration Registry

## Overview

Kitten will let a developer delegate independent pieces of one active coding task to multiple child agents while retaining trustworthy host-owned control. Each child remains a normal, focusable Kitten session; Kitten—not an ACP provider—owns parent-child identity, lifecycle, visibility, interaction routing, cancellation, and cleanup.

V1 is deliberately bounded: one flat set of child sessions under one active parent, with explicit lifecycle status and a minimal way to inspect and await outcomes. It is a strategic foundation for later automation, not a generic workflow platform.

### Summary / Differentiator

Competitors increasingly support parallel agents, but their provider-specific child-agent behavior can vary. Kitten’s differentiator is reliable, provider-neutral delegation where every child remains visible, inspectable, and controllable in the normal workspace.

## Problem

Developers can already run several independent ACP sessions in Kitten, but all sessions are peers. A developer coordinating a coding task across research, implementation, and verification work must manually create conversations, remember their relationship, monitor tabs, route interactions, and reconstruct when the collective work is complete. If a provider owns sub-agents privately, lifecycle, visibility, failure behavior, and safety can differ across adapters.

The product needs a host-owned delegation model. A parent must be able to start bounded child work, see each child’s status, provide needed input, steer or cancel it, and confidently know when the group has settled. Parent close and session replacement must never leave invisible work, unresolved waits, or stale updates.

### Market Data

Parallel agent work is becoming a standard expectation: Codex presents project-organized threads, Cursor foregrounds asynchronous workers and worktrees, and Claude Code exposes child attribution and parent-routed interactions. [Codex app](https://openai.com/index/introducing-the-codex-app/), [Cursor multitask](https://cursor.com/changelog/04-24-26), [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)

RepoPrompt CE demonstrates the closest product pattern: a host-owned control plane with start, wait/poll, steer, respond, and cancel operations. [RepoPrompt CE](https://repoprompt.com/docs) An OpenAI-authored 2026 study reports that over 10% of active Codex users manage at least three concurrent agents weekly; this is a vendor-reported adoption signal, not independent market sizing. [Study](https://arxiv.org/abs/2606.26959)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Parent-owned child registration | Critical | Start a bounded, flat set of child sessions for one parent and record immutable ownership, role/profile, creation source, and current lifecycle state before work begins. |
| F2 | Visible child lifecycle | Critical | Show every child in the normal workspace and session surfaces with a clear parent-child cue, running/terminal state, and attention state. |
| F3 | Reliable delegation controls | Critical | Let the parent start, inspect, steer, cancel, and respond to interactions for each owned child without relying on provider-native subagent semantics. |
| F4 | Group completion and result inspection | Critical | Let the parent inspect terminal states, wait for its child set to settle, and navigate to each child’s stable terminal result reference. |
| F5 | Safe parent closure | High | When live children exist, clearly confirm that closing the parent will cancel them; confirmation cascades cancellation and never silently detaches work. |
| F6 | Bounded terminal retention | High | Retain terminal child snapshots long enough for inspection and cleanup without deleting unrelated user-created sessions. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Dynamic conversations | Children are created through the normal session path and remain ordinary focusable conversations. |
| Workspace tabs and `/sessions` | Existing visibility and attention surfaces gain parent-child and delegated-work cues. |
| Interaction handling | Child prompts requiring a response remain attributable and visible to the parent. |
| Session lifecycle | Child failures remain isolated; stale or replaced generations cannot publish into new child work. |
| Existing persistence | V1 preserves current session persistence but does not claim live delegation ownership after restart. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Child-start reliability | ≥95% | Successful child registrations that become visible and running / parent child-start requests during dogfooding or opt-in local telemetry. |
| Lifecycle correctness | 100% | Race and failure test matrix finds zero duplicate terminal settlements or unresolved child waits after close, replacement, or cancellation. |
| Child visibility latency | <1 second p95 | Time from a successful child-start request to child presence in workspace/session surfaces. |
| Delegation-loop completion | ≥75% | Dogfood delegation groups reach an inspected terminal outcome without manual recovery or session-state reconstruction. |
| Attention routing | ≥90% | In usability evaluation, participants find a child requiring input within two actions. |
| Orphaned child work | 0 | No live or unresolved owned child remains after a confirmed parent close or cancellation. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet with compounding value**

## Council Insights

- **Recommended approach:** Build a flat, in-memory, host-owned delegation registry around normal Kitten sessions, with a minimal wait/inspect/result loop.
- **Key trade-offs:** Keep the registry authoritative for delegation while preserving controller ownership of session runtimes; require close confirmation but use deterministic cascade cancellation once confirmed.
- **Risks identified:** Split lifecycle ownership, stale or duplicated terminal publication, orphaned child work, and scope expanding into a scheduler.
- **Risk mitigations:** Atomic registration, generation-fenced updates, exactly-once terminal settlement, idempotent cleanup, isolated child failures, and a comprehensive lifecycle-race test matrix.
- **Stretch goal (V2+):** A provider-neutral automation/MCP surface that consumes the trusted registry rather than owning orchestration itself.

## Out of Scope (V1)

- **Restart restoration of live ownership** — V1 must not fabricate parent-child ownership after a process restart.
- **Nested or recursive delegation** — Flat child sets are sufficient to validate the active-task delegation loop.
- **Dependency graphs and scheduling** — Independent parallel work is the target; DAGs would make V1 a workflow engine.
- **Automatic task decomposition** — The developer explicitly chooses and starts child work in V1.
- **Automatic retries and resource optimization** — Reliability means clear lifecycle states, not hidden recovery policies.
- **Cross-parent adoption or detachment** — Parent closure offers cancel-and-close or abort-close only.
- **Provider-native subagent integration** — The host registry remains provider-neutral and the source of truth.
- **Agent-facing orchestration API** — A future consumer of the registry, not a V1 requirement.

## Architecture Decision Records

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — Defines bounded, provider-neutral delegation with a minimal join contract and safe parent closure.

## Open Questions

- What maximum number of concurrent children keeps the V1 experience understandable and resource-safe?
- Which child role labels best help a developer distinguish delegated work at a glance?
- What minimum terminal result reference is most useful across ACP providers?
- Which existing session types, if any, should be ineligible to become delegation parents or children?
- What retention duration best balances inspection value with workspace clutter?
