# Product Requirements Document: Clarification Question Picker

## Overview

The Clarification Question Picker gives Kitten users a fast, unambiguous way to answer the decisions that block a live coding agent. When a verified supported provider sends a structured clarification request, Kitten immediately presents a dialog that identifies the requesting session, explains the choice, and lets the user select one option, select several compatible options, enter text, or explicitly cancel.

The feature serves keyboard-first developers working with one or more live agent sessions. Its value is fast unblocking: users resolve meaningful questions in context and return to their work immediately, while agents avoid waiting on ambiguous free-form replies. V1 handles every structured request from a provider whose complete request-and-response experience has been verified. It does not infer questions from ordinary chat text.

## Goals

- Enable users to submit a clear structured or text response for at least **80%** of presented clarification requests.
- Keep median time from dialog presentation to an explicit answer or cancellation at **30 seconds or less**.
- Ensure **0** usability-test cases in which a supported request is not noticed by the user who is actively using Kitten.
- Achieve **80% or greater** option-fit satisfaction in usability studies, while treating text responses as a valid outcome.
- Clearly communicate structured-clarification availability for **100%** of configured providers before a user encounters a request.
- Preserve Kitten’s trust posture: all feature measurement remains opt-in, local, and content-free.

## User Stories

### Active coding user

- As a developer focused on a coding task, I want a clarification request to appear immediately with the necessary context so that I can unblock the agent without composing a vague reply.
- As a developer, I want to choose a single option or provide my own text so that the response reflects my intent even when the offered choices do not.
- As a developer, I want to return to exactly what I was doing after I answer so that answering an agent does not derail my workflow.

### Multi-session operator

- As a developer running multiple agent sessions, I want every immediate dialog to name the requesting session so that I never answer the wrong agent.
- As a developer, I want an explicit cancel action so that I can decline a decision without Kitten silently selecting an answer or leaving the agent in an unclear waiting state.

### Keyboard-first user

- As a keyboard-first user, I want to navigate, select, submit, cancel, and move to text input without using a mouse so that the picker matches the rest of the cockpit.

### User of an unsupported provider

- As a developer, I want to know whether my current provider supports structured clarification before relying on this experience so that I have accurate expectations.

## Core Features

### Critical

- **Immediate session-attributed dialog** — Show every eligible structured clarification request immediately. The dialog must state which session is asking and provide enough request context for an informed answer.
- **Choice and text responses** — Support single-select, multi-select when options are compatible, and a clearly available text-response path. A user must never be forced into an inaccurate choice.
- **Explicit submit and terminal cancellation** — Require a deliberate submission or terminal cancellation. Never silently submit a default answer, treat inaction as approval, or leave a cancelled request unresolved.
- **Fast return to work** — Close the dialog after a terminal user action and restore normal cockpit interaction without an intermediate confirmation or decision-history screen.

### High

- **Keyboard-first, accessible interaction** — Provide predictable keyboard navigation and direct choice selection. Use clear labels and non-color-only state cues so users can understand the request and their current selection.
- **Capability transparency** — Clearly communicate whether a configured provider can use structured clarification before the user depends on the feature.

### Medium

- **Privacy-preserving outcome measurement** — When telemetry is enabled, record content-free signals for response completion, cancellation, latency, response mode, and attention visibility. Collect option-fit feedback through usability research rather than message content.

## User Experience

1. A verified supported agent needs an explicit user decision and submits a structured request.
2. Kitten immediately opens a dialog over the cockpit. Normal editor and global interactions pause while the dialog is active.
3. The user sees the requesting session, concise question context, available choices, and the text-response and cancellation paths.
4. The user selects an answer using the keyboard, enters a text response when no option fits, or explicitly declines through terminal cancellation.
5. Kitten closes the dialog after the user’s terminal action and returns focus to the prior work. The agent receives either the user’s explicit response or a clear terminal cancellation outcome.

The experience must avoid surprise and false certainty. Every choice needs clear wording; descriptions should explain meaningful consequences when the agent provides them. The dialog must remain readable in a constrained terminal, work without a mouse, and not rely on color alone to communicate selection, source session, or cancellation.

There is no separate onboarding flow in V1. The first supported request teaches the interaction through concise keyboard hints and clear action labels. Provider capability status remains discoverable before a request arrives.

## High-Level Technical Constraints

- The feature is available only for providers whose complete structured clarification request-and-response experience is verified in Kitten.
- The product must distinguish clarifications from permissions in language and user expectations; a clarification is not authorization to perform an action.
- A user response must resume the request that prompted it, rather than appear as an unrelated new conversation message.
- Feature measurements must remain opt-in, local, and content-free.
- A provider that cannot support the experience must be clearly identified as unsupported rather than receiving a degraded or misleading picker.

## Non-Goals (Out of Scope)

- **Detecting questions in ordinary agent prose** — V1 only handles explicit structured requests because guessing user intent creates false interruptions and ambiguous answers.
- **Passive background-only handling** — The user chose immediate dialogs rather than a waiting queue, badge-only state, or notification-first flow.
- **Persistent decision history, search, or reusable answers** — V1 optimizes for immediate unblocking, not decision management.
- **Silent defaults, automatic timeouts, or implicit submission** — User agency requires a visible, explicit terminal action.
- **Editing or reopening a submitted answer** — The agent may ask again if needed; a revision workflow is not part of V1.
- **Combining clarification with permission approval** — The two interactions have different user meaning and risk.

## Phased Rollout Plan

### MVP (Phase 1)

- Support every structured clarification request from verified providers.
- Provide immediate session-attributed dialogs with single-select, multi-select, text input, explicit cancellation, and fast return to work.
- Communicate provider capability availability and collect opt-in, content-free outcome signals.

**Success criteria to proceed to Phase 2**
- At least 80% structured answer completion.
- Median response latency of 30 seconds or less.
- No unnoticed supported request in usability testing.
- At least 80% option-fit satisfaction in usability studies.

### Phase 2

- Refine question wording and context guidance from usability evidence.
- Add user-visible, lightweight feedback on whether choices fit without collecting prompt or code content.
- Improve clarity for providers with different structured-request capabilities.

**Success criteria to proceed to Phase 3**
- Response completion and latency targets remain stable as supported-provider coverage grows.
- Cancellation stays at or below 20% of presented requests, with research showing cancellations are intentional rather than caused by confusing options.

### Phase 3

- Evaluate a persistent, cross-session decision experience only if data shows recurring demand beyond immediate unblocking.
- Consider optional review, history, prioritization, and reusable-answer experiences as separate product decisions.

**Long-term success criteria**
- Users report that agent decisions are easier to notice and resolve than in unstructured chat.
- The feature reduces corrective clarification loops without increasing unwanted interruption.

## Success Metrics

| Metric | Target | Measurement |
|---|---:|---|
| Structured answer completion | ≥80% of presented requests | Count explicit structured or text responses divided by requests presented. |
| Explicit cancellation rate | ≤20% of presented requests | Count cancellations separately from answered requests. |
| Median response latency | ≤30 seconds | Measure elapsed time from dialog presentation to terminal user action. |
| Unnoticed supported requests in usability testing | 0 per session | Observe whether active participants recognize every supported request without prompting. |
| Option-fit satisfaction | ≥80% of participants | Ask usability-study participants whether the choices fit their intended response. |
| Capability transparency | 100% of configured providers | Verify that a provider’s supported or unsupported status is visible before use. |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Immediate dialogs interrupt users too often. | Track cancellation and latency, and keep structured requests focused on real user decisions. |
| Offered choices do not represent the user’s intent. | Always provide text input, require clear labels, and use option-fit research to improve guidance. |
| Users expect the picker for a provider that cannot support it. | Clearly show capability availability and do not present a degraded or misleading experience. |
| Users mistake a clarification for a permission request. | Use distinct language, visual framing, and explicit explanation of what the answer will do. |
| Measurement creates privacy concern. | Keep telemetry opt-in, local, and content-free; use research rather than request content for qualitative assessment. |

## Architecture Decision Records

- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md) — Limits V1 to verified structured request-and-response capability and preserves a text fallback.
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md) — Requires immediate handling for every supported structured request and immediate return to work after the user acts.

## Open Questions

- Which configured providers can meet the complete structured clarification capability gate at launch?
- What minimum question context and option descriptions are sufficient for users to answer confidently in a terminal-sized dialog?
- Should users be able to configure immediate interruption behavior after V1 data establishes its impact on flow?
- What research sample and task mix will best validate option-fit satisfaction before expanding provider coverage?
