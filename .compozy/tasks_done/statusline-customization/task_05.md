---
status: completed
title: "Add Strict Focused-Agent Proposal Orchestration"
type: backend
complexity: medium
---

# Task 05: Add Strict Focused-Agent Proposal Orchestration

## Overview

Add an app-layer flow that sends the product-owned statusline instruction and the developer's request through the selected focused agent's normal transcript. It must wait for the prompt's terminal result, examine only newly produced agent turns, and return an accepted proposal or a legible recovery outcome without persisting raw conversation content.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create an app-layer statusline flow that uses only `ControllerActions.sendPrompt`, store read models, and the pure core parser; it MUST NOT import ACP types or hold an `AgentConnection`.
- MUST submit a product-owned prompt that lists only the permitted declarative schema, forbids resolved runtime values and executable output, and requires one sole fenced JSON reply with no prose.
- MUST snapshot the selected session transcript before the request, wait for the normal prompt path to reach its terminal result, then inspect only post-request agent turns.
- MUST map unavailable session, failed or cancelled prompt, zero new response, multiple responses, and invalid parser output to legible recovery results rather than throwing or guessing.
- MUST leave raw request and response text in the intentional normal transcript only; it MUST NOT copy them to config, telemetry, statusline preference, or modal persistence.
</requirements>

## Subtasks

- [x] 5.1 Define the product-owned request instruction and a small flow result surface for proposal, invalid-response, and unavailable outcomes.
- [x] 5.2 Capture the pre-request transcript boundary and address the selected focused session through the existing action facade.
- [x] 5.3 Collect completed post-request agent turns only after `sendPrompt` settles, then enforce the shared parser contract.
- [x] 5.4 Convert availability, cancellation, malformed reply, and empty-response cases into recovery-ready outcomes.
- [x] 5.5 Add deterministic transcript-fixture tests with injected controller actions and no real agent process.

## Implementation Details

Implement the orchestration seam in TechSpec "Component Overview" and "Focused ACP agent" integration guidance. `sendPrompt` already writes the user turn and resolves only after buffered agent messages flush; preserve that ordering instead of adding an ACP response API or parsing the entire transcript.

### Relevant Files

- `src/app/statuslineFlow.ts` — new focused-session request, transcript-boundary capture, response collection, parser invocation, and recovery outcome flow.
- `src/app/statuslineFlow.test.ts` — colocated fixtures for completed turns and all failure paths.
- `src/app/actions.ts` — existing UI-safe `sendPrompt` contract the flow must consume without bypassing.
- `src/core/types.ts` — existing `Turn`, `AgentTurn`, and session identity read models used to select post-request transcript entries.
- `src/core/statusline.ts` — shared strict proposal parser and safe layout contract.

### Dependent Files

- `src/ui/StatuslineOverlay.tsx` — displays proposal, invalid-response, and unavailable outcomes.
- `src/store/appStore.ts` — stores only transient flow phase and normalized proposal data.
- `test/fakeController.ts` — can provide an injected normal transcript and recorded prompt call for UI-level flow tests.

### Related ADRs

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — keeps the model at an interpretation boundary only.
- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — establishes conversational-first recovery behavior.
- [ADR-004: Use the focused agent transcript with a strict fenced proposal contract](adrs/adr-004.md) — selects the transcript path and strict sole-block acceptance rule.

## Deliverables

- A focused-agent statusline request flow with an inspectable product-owned prompt.
- Strict transcript-boundary collection and recovery results for every non-proposal outcome.
- Colocated deterministic tests using fake actions and transcript fixtures.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for normal-transcript proposal flow **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A selected ready session receives the product-owned instruction plus request through `sendPrompt` exactly once.
  - [x] The instruction excludes resolved cwd, branch, provider, model, effort, and raw transcript values while requiring the allowlisted fenced-JSON shape.
  - [x] Only an agent turn added after the captured transcript boundary and terminal prompt completion is parsed.
  - [x] A sole valid fenced block returns a normalized proposal, while prose, multiple blocks, multiple new agent replies, malformed JSON, and invalid layouts return invalid-response.
  - [x] No ready session, a null prompt result, cancellation, an action failure, or zero new agent text returns unavailable without rejecting.
- Integration tests:
  - [x] A fake normal transcript receives a request, flushes a valid response before terminal completion, and yields a preview-ready proposal without modifying config or telemetry state.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Conversational proposals use the normal focused transcript while accepting only one schema-valid response.
- Every unavailable or malformed path is recoverable and never persists raw conversation content.
