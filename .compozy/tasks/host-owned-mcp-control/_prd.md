# PRD: Host-Owned MCP Child Control

## Overview

Kitten will give solo developers a trustworthy way for their primary coding agent to initiate a small batch of independent child tasks while the developer supervises the work in the normal Kitten workspace. Every child remains a visible, attributable conversation with a clear state and a direct recovery path if it needs attention.

The MVP solves the gap between manual delegation and opaque provider-native subagents. It validates **supervised parallel progress**: developers can let a primary agent start independent work without losing awareness of who owns each child, what it is doing, or where to intervene.

## Goals

- Let a primary coding agent initiate bounded parallel child work for a solo developer.
- Make every active, attention-blocked, and terminal child visible and attributable to its initiating task.
- Give a developer a direct path from a child needing attention to that child’s normal conversation.
- Provide the same child-control experience to Codex and Claude Code users.
- Validate demand through repeated voluntary use, not one-time novelty or hidden automation.

## User Stories

### Solo developer supervising a primary coding agent

- As a solo developer, I want my primary coding agent to start several independent tasks so that research, verification, and other parallel work can progress together.
- As a solo developer, I want to see every child task in my normal workspace so that background work never becomes invisible or ambiguous.
- As a solo developer, I want to know which primary task initiated each child so that I can understand responsibility and context at a glance.
- As a solo developer, I want a direct way to open a child that needs attention so that I can recover without searching through unrelated conversations.
- As a solo developer, I want clear terminal states so that I can distinguish completed, failed, and cancelled work before deciding what to do next.

### Developer using a supported coding-agent provider

- As a Codex or Claude Code user, I want the same supervised delegation experience so that provider choice does not change visibility or trust.

## Core Features

### Critical

- **Agent-initiated bounded launch** — A primary coding agent can begin a small set of independent child tasks on the developer’s behalf. The product describes these tasks as supervised background work, not autonomous completion.
- **Visible child conversations** — Each launched child appears as a normal Kitten conversation without displacing the developer’s primary task.
- **Attribution and status** — The workspace clearly associates each child with its initiating task and shows whether it is starting, running, needs input, finished, failed, or cancelled.
- **Attention recovery** — When a child needs developer input or approval, Kitten makes that state conspicuous and provides a direct path into the child conversation.
- **Owner-scoped observation** — A primary task can observe only the child work it initiated. Unrelated work remains distinct and cannot be confused with or controlled as part of that task.

### High

- **Clear bounded outcomes** — Launch requests that cannot be honored give an explicit outcome rather than creating partial, hidden, or ambiguous background work.
- **Provider-consistent experience** — Supported providers receive the same product behavior and child visibility guarantees.

## User Experience

1. A developer gives the primary coding agent a task that contains independent work.
2. The primary agent begins a bounded set of child tasks. Each child appears promptly in the normal workspace while the primary task remains available.
3. The developer sees child lineage and concise lifecycle labels at a glance, including any active or unattended work before the primary task can appear settled.
4. If a child needs input, Kitten highlights that state and lets the developer open the exact child conversation directly.
5. The developer can inspect the child’s normal conversation, provide any needed input through the existing experience, and return to the primary task.
6. Finished, failed, and cancelled children remain distinguishable long enough for the developer to understand the outcome and decide on follow-up work.

The experience must use concise terminal-readable labels, preserve keyboard navigation through existing conversation surfaces, and avoid requiring a second results dashboard.

## High-Level Technical Constraints

- Child work must remain normal visible Kitten conversations, not hidden provider-owned activity.
- The experience must work consistently for Codex and Claude Code without weakening user-configured integrations.
- A child must remain visibly attributable only to the task that initiated it; Kitten must not present unrelated work as controllable by another task.
- The MVP must not promise that active child ownership or observation survives a Kitten restart.
- Product measurement must remain local, opt-in, and content-free; task text, code, and conversation content are not product analytics.

## Non-Goals (Out of Scope)

- **Autonomous completion** — V1 does not promise that child work proceeds without developer supervision or intervention.
- **Rich child management** — Waiting, stopping, steering, forwarding input, handoffs, and transcript retrieval are deferred until usage proves which control is most valuable.
- **Role profiles and capability policy** — Configurable child personas, permissions, and recursive delegation limits are separate product work.
- **Parallel-edit isolation** — Managed workspaces and conflict-prevention policy are separate product work; MVP users should start with independent tasks.
- **Nested delegation and workflow scheduling** — V1 is a flat set of child tasks, not a general task graph or automation platform.
- **Shared-team coordination** — The initial experience optimizes for one developer supervising their own local work.
- **Restored child ownership after restart** — V1 does not claim that previously active child relationships can be resumed or controlled after Kitten restarts.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver agent-initiated bounded child launch, visible attribution and lifecycle status, owner-scoped observation, and direct attention recovery.
- Position the feature as supervised parallel progress for independent work.
- **Success criteria to proceed:** beta users repeatedly choose parallel child launches, can reliably identify attention-blocked children, and report no confusion about ownership or hidden activity.

### Phase 2

- Add the single next child-management capability most strongly supported by MVP evidence, such as completion-aware observation or explicit stopping.
- Improve aggregate awareness only if developers report that the normal workspace no longer provides sufficient supervision.
- **Success criteria to proceed:** the added capability reduces observed recovery friction without weakening the visible, attributable child model.

### Phase 3

- Consider role-based child experiences, safer parallel-edit workflows, and broader management only after explicit policy and product decisions.
- Evaluate whether the feature should expand beyond supervised solo-developer use.
- **Long-term success criteria:** sustained repeat use, maintained user trust, and a clear evidence-backed reason to broaden the scope.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Repeat parallel-launch use | At least 30% of invited beta users initiate child work on two or more separate days within 30 days | Local, opt-in aggregate usage counts. |
| Child visibility | 100% of accepted child launches appear with an attributable lifecycle state | Product acceptance coverage and dogfood observation. |
| Attention discoverability | At least 90% of dogfood participants find a child needing attention within two interactions | Moderated usability sessions. |
| Ownership comprehension | At least 80% of dogfood participants correctly identify a child’s initiating task | Post-task usability prompt. |
| Hidden-work incidents | 0 verified reports of active child work that lacks visible status or attribution | Dogfood issue review and lifecycle observations. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers distrust unattended child work | Position V1 as supervised progress, keep every child visible, and make attention states explicit. |
| Low repeat use indicates novelty rather than value | Use repeat launches as the primary expansion gate and avoid broadening the platform without that evidence. |
| Users expect complete management parity immediately | State V1 boundaries clearly and use observed friction to prioritize only one next control. |
| Parallel work creates cognitive overload | Keep child labels concise, preserve direct lineage, and reuse normal conversation navigation. |
| Independent tasks produce conflicting changes | Encourage independent MVP tasks and defer workspace-isolation promises to a dedicated later phase. |
| Trust erodes through unclear data handling | Keep measurement local, opt-in, and content-free. |

## Architecture Decision Records

- [ADR-001: Expose a bounded start-and-poll MCP surface](adrs/adr-001.md) — Establishes the narrow V1 child-control boundary.
- [ADR-002: Validate supervised parallel progress before autonomous orchestration](adrs/adr-002.md) — Positions the MVP around visible attribution, direct recovery, and repeat-use learning.

## Open Questions

- What maximum number of simultaneously visible child tasks remains understandable for the first beta cohort?
- Which independent task categories generate enough repeat use to justify the first expansion?
- Should the first post-MVP management capability be completion-aware observation or explicit stopping?
- What terminal-history duration gives developers enough follow-up context without creating workspace clutter?
- What beta cohort can provide reliable repeat-use and attention-recovery feedback within 30 days?
