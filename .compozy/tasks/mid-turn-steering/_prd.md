# Product Requirements Document: Mid-Turn Steering

## Overview

Mid-Turn Steering gives a developer a safe way to redirect an active Kitten agent task. Instead of creating a competing prompt or forcing a hard stop, the developer can submit ordered direction for the active task and see whether it is queued, being sent, or needs recovery.

The feature serves developers supervising long-running coding-agent work. Its value is trust: Kitten must never silently lose their direction, and it must make the recovery path obvious when safe delivery is not possible.

### Market Context

Claude Code, GitHub Copilot, and Cursor distinguish in-flight direction from a hard stop and make queued work visible. Developer-agent adoption is high, but confidence in agent output remains constrained, making reliable human control a meaningful product differentiator. [Claude Code](https://code.claude.com/docs/en/interactive-mode), [GitHub Copilot](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-cli/use-copilot-cli/steer-agents), [Cursor](https://docs.cursor.com/en/agent/planning), [Stack Overflow 2025](https://survey.stackoverflow.co/2025/ai)

## Goals

- Ensure a session has one active agent task from the developer's perspective.
- Let developers redirect an active task without losing, silently retrying, or duplicating their instruction.
- Keep live steering status compact and visible at the composer.
- Distinguish steering from an explicit stop so developers can preserve completed work and choose the right level of intervention.
- Establish a consistent control experience across Kitten-supported agents.

## User Stories

### Developer supervising a long-running task

- As a developer, I want to add direction while an agent is working so that I can correct course without starting a competing task.
- As a developer, I want my directions handled in the order I entered them so that my latest intent is understandable and predictable.
- As a developer, I want to see whether my direction is queued, being sent, or failed so that I know what action to take next.

### Developer recovering from a failed intervention

- As a developer, I want Kitten to restore my exact unsent text when it cannot safely deliver it so that I can revise or resend it without retyping.
- As a developer, I want stopping work to remain separate from steering it so that I do not accidentally abandon useful progress.

### Developer responding to agent input

- As a developer, I want active permission or clarification requests to remain understandable while I steer so that I do not answer the wrong request or lose the agent's question.

## Core Features

### P0: One active task per session

- Kitten prevents a new ordinary submission from creating a second active task in the same session.
- When work is active, the composer clearly treats additional text as direction for that work rather than an unrelated prompt.
- A hard stop remains an explicit, separate developer choice.

### P0: Ordered steering and safe delivery

- Developers can submit one or more steering messages while a task is active.
- Kitten preserves the meaning and chronological order of those messages when it delivers them.
- Kitten waits for an appropriate user-interaction boundary before redirecting work, rather than leaving an approval or clarification unresolved.

### P0: Lossless recovery

- Every accepted steering message reaches one visible outcome: delivered or restored to the composer.
- If Kitten cannot safely complete the redirect, it restores the developer's exact text and identifies the failed state.
- Kitten does not automatically resend text after an ambiguous outcome.

### P1: Composer-first steering status

- The composer displays concise queued, sending, and failed states while work is active.
- The status remains legible without relying on color alone and does not obscure text recovery.
- The regular conversation retains enough continuity for a developer to understand that prior work was redirected, without turning live status into a noisy timeline.

### P1: Consistent supported-agent experience

- Kitten uses the best safe steering behavior each supported agent can provide while preserving the same product promise to the developer.
- If a provider cannot complete a safe redirect, Kitten presents recovery rather than pretending the instruction was delivered.

## User Experience

1. A developer starts a task and the agent begins working.
2. The developer identifies a correction, added constraint, or new priority and enters it in the composer.
3. Kitten keeps the task singular, accepts the direction as steering, and displays its compact live state at the composer.
4. If user input is needed for a permission or clarification, Kitten keeps that request clear and does not let steering obscure it.
5. Kitten redirects the work safely and the composer returns to a ready state.
6. If the redirect cannot be completed, the composer shows a failed state and contains the developer's exact restored text for deliberate recovery.

The interaction must be keyboard-accessible, use status language that does not depend on color alone, and make steering distinct from cancellation in wording and behavior.

## High-Level Technical Constraints

- The product must preserve one active task per session and one visible terminal outcome for each accepted steering request.
- Existing permission and clarification experiences must remain attributable to the correct active task.
- Product measurement remains opt-in, local, and free of prompt or code content.
- The feature must preserve the currently supported agent experience without requiring developers to understand provider-specific behavior.

## Non-Goals (Out of Scope)

- Automatic retry after an uncertain steering outcome.
- A persistent intervention timeline, steering history, or analytics dashboard.
- Provider-specific policy settings or control matrices.
- Multi-user or collaborative steering controls.
- A full agent supervision workspace, takeover mode, or task reordering interface.
- Broader changes to ordinary prompt composition outside an active task.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver one-active-task protection, ordered steering, lossless composer recovery, and compact composer status.
- Keep steering and hard stop visibly distinct.
- Proceed when all accepted steering messages have a visible terminal outcome in validated lifecycle scenarios and dogfood users can identify live status correctly.

### Phase 2

- Refine wording, discoverability, and recovery guidance using dogfood feedback and content-free outcome metrics.
- Improve supported-agent behavior only where it preserves the V1 product promise.
- Proceed when steering is used successfully in routine long-running tasks without recurring status confusion or text-recovery complaints.

### Phase 3

- Evaluate a richer intervention history or supervision surface if user research shows that compact composer status is insufficient.
- Consider advanced controls only after the core lossless experience remains reliable across supported agents.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Concurrent active tasks in one session | 0 | Validated lifecycle scenarios and opt-in content-free counters |
| Accepted steering messages with one visible terminal outcome | 100% | Lifecycle scenario results |
| Failed or ambiguous steering messages restored to the composer | 100% | Recovery scenario results |
| Dogfood users correctly identifying queued, sending, and failed states | At least 80% | Task-based usability sessions |
| Dogfood steering attempts completed without developer-reported text loss | At least 95% | Opt-in outcome feedback and issue review |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers expect immediate interruption and misread a safe wait as a failure | Keep queued and sending status visible, concise, and near the composer. |
| Developers confuse steering with stopping | Use separate wording, controls, and confirmation behavior. |
| A restored draft is overlooked after a failed delivery | Keep the exact text in the primary composer and show a persistent failed state. |
| Inconsistent agent behavior weakens trust | Promise consistent visible outcomes and recovery rather than identical timing. |
| Scope expands into a broad supervision product | Hold the MVP to lossless steering, composer status, and recovery. |

## Architecture Decision Records

- [ADR-001: Adopt a Lossless, Provider-Neutral Steering Contract for V1](adrs/adr-001.md) — Establishes safe, ordered steering as the V1 foundation.
- [ADR-002: Make V1 Steering Lossless and Composer-First](adrs/adr-002.md) — Chooses restored text and compact composer status over automatic retry or a live timeline.

## Open Questions

- What wording best distinguishes the active-task action from an ordinary new prompt?
- Which dogfood cohort will provide the first usability and recovery feedback?
- What level of intervention history, if any, would justify a Phase 3 supervision surface?
