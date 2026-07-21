# Local-first governed Workflow Board

## Overview

Kitten Orchestrator will provide a macOS-first, local-first Workflow Board for individual developers who want coding-agent work to move through an explicit, inspectable process. A board belongs to one trusted repository. Users arrange Workflow Stages on a canvas, connect them into one ordered path, assign a default local Workflow Skill after creating each stage, and create cards that can run through Direct ACP.

V1 is a strategic bet: it couples a familiar Kanban workflow with the controls developers need to trust long-running agent work—an immutable Run Context, append-only Run Transcript, scoped clarification, bounded concurrency, and a final human review boundary. The starter path is `Backlog → To-do → Refinement → Ready → Doing → Finished → Closed`, but it is a configurable template rather than a hidden fixed workflow.

### Summary / Differentiator

The differentiator is governed progression, not a generic agent board. Each stage has an explicit validated Skill; each attempt records exactly what ran; cards retain visible chat and history at every stage; and no successful run silently publishes work. The board makes agent execution continuously observable and steerable without confusing a column with the system’s execution state.

## Problem

Coding-agent work frequently loses its operational context between planning, implementation, verification, and review. A simple task board can show where a card sits, while a chat session can show what an agent said, but neither alone answers the essential questions: which workflow should run now, what exact instructions and configuration ran, whether the agent needs a human, and whether the work is ready for review.

The issue is sharper when an agent runs for a while. Users need to open any ticket at any stage and see its live or historical conversation, tool progress, questions, and terminal outcome. They also need a prompt composer that remains available while an agent is running and after it settles, so they can capture a follow-up without abandoning the card’s history or guessing how the message will be handled.

### Market Data

Agent-aware boards already offer card movement, in-board chat, persistent sessions, and stage prompts. Kangentic offers a local desktop board with coding-agent lifecycle controls and per-column behaviors; Anban offers agent-native cards and chat; Kanboard exposes agent board operations. Kitten should therefore compete on durable local governance: an auditable attempt record, stage-bound local Skills, a trusted-repository boundary, and explicit review—not on another autonomous dispatcher. [Kangentic](https://kangentic.com/) · [Anban](https://www.getanban.com/) · [Kanboard](https://kanboard.io/)

Trust remains an adoption constraint: Stack Overflow’s 2025 survey reports more developers distrust AI-output accuracy than trust it, and many do not plan to use AI for project planning. This supports a product where the operator can always inspect and direct work without an agent silently pushing, opening a PR, merging, or completing a card. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai/)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Linear Workflow Canvas | Critical | A board starts blank, then users drag stage columns on a canvas and connect visible arrows into one validated directed path. The conventional seven-stage path is an optional starter template; branching, joins, and cycles are rejected. |
| F2 | Stage-default Workflow Skills | Critical | Creating a stage immediately exposes a default Skill selector from the local Skill Catalog. A stage remains visibly incomplete and cannot launch work until a validated default is selected. |
| F3 | Trusted Repository and Card Setup | Critical | Each board binds to exactly one trusted repository. Cards carry title, description, provider, model, effort, `runnable`, optional Skill override, Workflow Stage, and independent Execution Status. |
| F4 | Direct ACP Run Attempts | Critical | Starting a card resolves its override or current stage default Skill, validates runnable configuration and the global limit, creates an immutable Run Context, and launches only Direct ACP in V1. |
| F5 | Always-visible Card Composer | Critical | Every selected card shows a composer. When idle, submission starts a fresh attempt in the current stage; while running, it visibly queues the next message with removal control, never silently cancels, forks, or duplicates live work. |
| F6 | Work History Inspector | High | At every stage, the right inspector shows all Run Transcripts chronologically, newest expanded, including Run Context, conversation, tool/activity events, scoped `ask_user` events, queued operator messages, and terminal outcome. |
| F7 | Governed Movement and Stage Lock | High | Users move only settled cards. A successful agent attempt advances exactly one stage; `running` and `needs_attention` cards are locked until cancellation or settlement. Every transition records actor, reason, workflow version, and idempotency identity. |
| F8 | Attention and Review Boundaries | High | An agent’s scoped `ask_user` request sets `needs_attention` without changing stage and returns submitted, skipped, timed-out, or cancelled outcomes to the same live attempt. Final-stage success becomes `ready_for_review`; an operator alone may mark a card complete. |
| F9 | Local Settings and Concurrency | Medium | Settings expose theme preference, local Skill Catalog validation, Agent Profile readiness/defaults for new cards, and a global automatic-execution limit that defaults to one active card across boards. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Configured-stage activation | ≥90% of created stages receive a validated catalog Skill before their first run | Local board event audit |
| Complete attempt evidence | 100% of terminal attempts retain Run Context, ordered transcript events, and terminal outcome | SQLite integrity and integration checks |
| Persistent-composer availability | 100% of selected-card states render a usable composer | UI state-matrix tests |
| Governed review boundary | 0 automatic pushes, PR openings, merges, or completions | Execution-policy integration tests |
| Attempt-to-review conversion | ≥50% of runnable cards reach `ready_for_review` within 14 days in an opt-in early-user cohort | Content-free local aggregate events |
| Transition integrity | 0 accepted stale, duplicate, or out-of-version transitions in deterministic recovery tests | State-machine test suite |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Must do |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Strong |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**.

## Council Insights

- **Recommended approach:** deliver the configurable linear board first, with default local Skills, Direct ACP attempts, immutable evidence, a persistent queued composer, and explicit review.
- **Key trade-offs:** canvas flexibility versus an understandable single-path state model; immediate agent steering versus safe, capability-backed delivery; visible history versus false claims of crash-resumable ACP sessions.
- **Risks identified:** stale completion events after workflow edits, duplicate transitions, active-composer ambiguity, and recovery gaps. Mitigate with workflow-version fencing, idempotency identities, generation-scoped `ask_user`, explicit queue state, deterministic replay tests, and interrupted—not falsely resumed—attempts after restart.
- **Stretch goal (V2+):** certified provider-specific native steering and non-linear workflow routing, admitted only after evidence of user demand and runtime safety.

## Out of Scope (V1)

- **Branches, joins, cycles, and conditional graph routing** — linear workflow semantics are the deliberate V1 constraint.
- **Universal live-message injection** — active input is queued until a provider has certified, testable steering support.
- **Compozy or other execution routes** — V1 is Direct ACP only, so one governed runtime model can be proven.
- **Cloud sync, collaboration, and a general board MCP API** — these dilute the local-first, individual-developer learning loop.
- **Automatic push, pull-request creation, merge, deployment, or final completion** — human review is a load-bearing trust boundary.
- **Agent-selected Skills or free-text Skill names** — Skills must resolve from the validated local catalog.
- **Pretended ACP-session recovery after a desktop crash** — the record remains durable, but a fresh attempt is required.

## Architecture Decision Records

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — limits V1 to a validated linear canvas and a safe persistent-composer contract.

## Open Questions

- Which local Skill roots and validation failures should appear in the first Skill Catalog UI?
- What certified evidence is sufficient to enable native active-turn steering for an individual provider?
- Should predecessor import be offered as an explicit later action, given V1 first launch begins with a blank board?
- What early-user cohort will supply the opt-in, content-free learning data?

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `src/agent/agentConnection.ts` | Reuse protocol normalization, Direct ACP session lifecycle, model/effort application, cancellation, and MCP declarations behind the desktop-owned controller. |
| `src/app/kittenMcpBridge.ts` and `src/agent/askUserMcp.ts` | Reuse only the scoped, capability-fenced `ask_user` behavior per attempt; do not import current multi-agent delegation. |
| `src/core/transcriptProjection.ts` | Reuse protocol-free transcript concepts, while the desktop owns its durable append-only SQLite event schema. |
| `CONTEXT.md`, ADR-0022, ADR-0023 | Preserve the established Workflow Board terminology and packages-only ownership boundary. |
