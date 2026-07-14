# PRD: Multi-Agent Orchestration Registry

## Overview

Kitten will let a developer quickly delegate independent pieces of an active coding task to child agents without leaving the parent task. The developer gives each child an explicit task and desired outcome, stays focused on the parent, and immediately sees the child as **Running**.

The product serves developers who need to parallelize research, implementation, or verification work while retaining clear ownership and confidence in every child’s status. It makes delegated work a visible, controllable part of the normal Kitten workspace rather than a provider-private process.

## Goals

- Make explicit child delegation feel immediate: the parent remains active while a requested child becomes visibly Running in under one second at the 95th percentile.
- Reach at least 95% successful child launches during dogfooding, measured as a visible Running child after a launch request.
- Let at least 75% of dogfood delegation groups reach an inspected terminal outcome without manual recovery or session-state reconstruction.
- Ensure no owned child is left unresolved after a confirmed parent close or cancellation.
- Validate that developers can use visible parallel work without losing their place in the parent task.

## User Stories

### Primary persona: developer coordinating one active coding task

- As a developer, I want to give a child an explicit task and desired outcome so that I can delegate a bounded piece of work with confidence.
- As a developer, I want to remain in my parent task after starting a child so that I can continue my own work without context switching.
- As a developer, I want to see a newly started child marked **Running** immediately so that I know delegation succeeded.
- As a developer, I want to open any child from my usual workspace surfaces so that I can inspect or intervene without hunting for hidden work.
- As a developer, I want to see when a child needs my input, finishes, fails, or is cancelled so that I can manage parallel work deliberately.
- As a developer, I want to inspect the group’s settled outcomes so that I can collect delegated work without manually polling every conversation.
- As a developer, I want a clear warning before closing a parent with active children so that I do not accidentally abandon or discard active delegated work.

### Secondary persona: developer returning to background work

- As a developer returning to Kitten, I want delegated child work to be distinguishable from ordinary peer conversations so that I can understand why it exists and what needs attention.

## Core Features

### P0 — Explicit child launch

The developer can start a child from an active parent by providing a concise task and desired outcome. The product positions this capability for independent work that can progress in parallel.

After launch, focus stays on the parent task. The product provides immediate confirmation and identifies the new child as **Running**.

### P0 — Visible child identity and state

Each delegated child appears in the normal workspace and session views with a clear relationship to its parent. Users can distinguish a child’s Running, needs-input, finished, failed, and cancelled states without relying on color alone.

### P0 — Child attention and intervention

When a child needs a response or encounters a failure, the parent can identify the child, open it, and provide the needed response or direction. A child-specific stop action is available when the developer decides the work should not continue.

### P0 — Group outcome collection

The parent can see whether its delegated child set is still active or settled, inspect each terminal outcome, and navigate to the relevant child conversation. The product retains a readable terminal outcome long enough for the developer to review it.

### P0 — Safe parent closure

When the developer tries to close a parent with active children, the product clearly explains the effect and offers cancel-and-close or keep-working. Confirming closure stops the active child work; the product never silently turns delegated work into unrelated orphaned sessions.

### P1 — Bounded retention and cleanup

Terminal delegated children remain available for a bounded review period and can be cleaned up without affecting unrelated conversations.

## User Experience

### Start delegation

1. The developer is working in an active parent conversation.
2. They choose to delegate an independent piece of work.
3. They provide the child’s task and desired outcome.
4. They remain in the parent conversation.
5. The product immediately confirms the launch and shows the child as **Running** in normal workspace surfaces.

### Continue and supervise

1. The developer continues the parent task while children work in the background.
2. The workspace distinguishes delegated children and surfaces any child that needs attention.
3. The developer can open the child, respond, give additional direction, or stop it.

### Collect outcomes

1. The parent shows whether delegated work is still active or has settled.
2. The developer reviews the terminal status and outcome for each child.
3. The developer can move to the relevant child conversation for full context.

### Close safely

1. The developer attempts to close a parent that has active children.
2. The product states how many child tasks will be affected and that they will be cancelled.
3. The developer either confirms cancellation and close or returns to work.

### Accessibility and clarity

- State labels use explicit text such as **Running**, **Needs input**, **Finished**, **Failed**, and **Cancelled**.
- Parent-child cues and attention states are understandable without color alone.
- Confirmation language clearly distinguishes stopping child work from merely hiding or backgrounding it.

## High-Level Technical Constraints

- Delegated children must remain visible, focusable Kitten conversations across supported agent providers.
- The product must not rely on provider-specific child-agent behavior for core user promises.
- A visible Running indication must appear within one second at the 95th percentile after a successful child launch.
- The product must keep telemetry opt-in, local, and content-free; task and code content must not be collected for product measurement.
- After restart, the product must not claim that live parent-child ownership is still active unless it can do so safely; V1 may show affected work as no longer live.

## Non-Goals (Out of Scope)

- Automatic task decomposition or autonomous child creation.
- Reusable child-role prompts or profile marketplaces.
- Nested delegation, dependency graphs, scheduling, or generalized workflow automation.
- Cross-parent child adoption or detached delegated work.
- Provider-specific subagent features as a requirement for the core experience.
- Remote or cloud execution management.
- Cost optimization, token budgeting, or billing controls.
- An agent-facing orchestration API.

## Phased Rollout Plan

### MVP (Phase 1)

- Explicit task-and-outcome child launch from an active parent.
- Parent remains focused while the child becomes visibly **Running**.
- Normal workspace visibility, attention states, child intervention, terminal outcomes, and safe parent closure.
- Success criteria: ≥95% successful visible launches, <1 second p95 Running indication, and zero unresolved owned children after confirmed close or cancellation.

### Phase 2

- Improve delegated-work review and navigation based on dogfood findings.
- Add optional reusable launch guidance only when recurring, validated patterns justify it.
- Success criteria: ≥75% delegation-loop completion without manual recovery and ≥90% usability success locating a child that needs input within two actions.

### Phase 3

- Evaluate a provider-neutral automation surface that consumes the trusted delegation registry.
- Consider richer planning or coordination only after the MVP demonstrates repeat use and safe lifecycle behavior.
- Success criteria: evidence of sustained multi-child usage and a validated user need beyond explicit, independent delegation.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Visible child-launch success | ≥95% | Successful launch requests that produce a visible Running child during dogfooding or opt-in local telemetry. |
| Launch feedback latency | <1 second p95 | Time from successful launch request to a visible Running indication. |
| Delegation-loop completion | ≥75% | Dogfood groups reaching an inspected terminal outcome without manual recovery. |
| Attention discoverability | ≥90% | Usability participants finding a child needing input within two actions. |
| Orphaned delegated work | 0 | Owned children unresolved after confirmed parent close or cancellation. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers delegate work that is not independent | Set clear launch guidance around bounded, independent tasks and keep task/outcome entry explicit. |
| Users mistake Running for completed or reviewed work | Use explicit lifecycle labels and preserve terminal outcomes for review. |
| Users lose confidence after missing a child’s request for input | Surface child-specific attention through normal workspace routes and retain a clear parent-child cue. |
| Group cancellation discards useful in-progress work | Explain the number and state of affected children and require confirmation before cancelling and closing. |
| The feature becomes a broad automation project before value is proven | Keep automatic decomposition, scheduling, templates, and agent-facing automation out of scope for MVP. |
| Provider differences make the experience feel inconsistent | Define user-visible promises at the Kitten level and position provider-specific behavior as non-essential. |

## Architecture Decision Records

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — Keeps delegation bounded, provider-neutral, and safely owned by the host.
- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — Makes immediate visible Running feedback the primary V1 product moment.

## Open Questions

- What maximum number of concurrent children keeps the experience understandable and resource-safe?
- What terminal outcome summary best lets a parent decide whether to open a child’s full conversation?
- Which existing session types, if any, should not participate in delegation?
- What review-retention duration best balances recovery value with workspace clutter?
- Which recurring task patterns would justify optional reusable launch guidance after MVP validation?
