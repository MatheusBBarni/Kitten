---
status: completed
title: Render active explore policy in session and tab presentation
type: frontend
complexity: medium
---

# Task 05: Render active explore policy in session and tab presentation

## Overview

Expose the accepted immutable `explore` policy while a child is active, using the same visible and focusable session surfaces operators already use. This task keeps role and restriction rendering separate from dialog launch behavior so both remain small, testable, and selector-driven.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render active `explore` role and concise textual restrictions beside existing child lineage and lifecycle information in the session overlay.
- MUST add only a compact selector-provided explore cue to tab presentation while preserving selected, focus, overflow, and reachability behavior.
- MUST consume the immutable accepted snapshot through existing selector presentation; views MUST NOT read raw delegation state or configuration directly.
- MUST preserve terminal child transcript/lifecycle behavior and MUST NOT imply a restored or historical child retains a current verified policy.
- MUST make role and restrictions understandable without relying solely on color, animation, or hidden status.
</requirements>

## Subtasks
- [x] 5.1 Extend active child presentation consumers with the selector-provided explore cue.
- [x] 5.2 Render concise role and restriction text in the sessions overlay.
- [x] 5.3 Render the compact explore cue in tab workspace child labels.
- [x] 5.4 Preserve existing focus, overflow, terminal transcript, and lifecycle behavior.
- [x] 5.5 Add session and tab presentation regression coverage.

## Implementation Details

Use TechSpec sections “System Architecture,” “User Experience,” and “Testing Approach.” Limit this work to presentation consumers of the selector output; selector structure and dialog launch behavior remain outside this task.

### Relevant Files
- `src/ui/SessionsOverlay.tsx` — canonical full delegated-child lineage and lifecycle presentation.
- `src/ui/SessionsOverlay.test.tsx` — text-based child presentation and terminal transcript regression tests.
- `src/ui/TabWorkspace.tsx` — compact visible-child label and overflow/reachability presentation.
- `src/ui/TabWorkspace.test.tsx` — selected, overflow, and child-label presentation coverage.

### Dependent Files
- `src/store/selectors.ts` — provides immutable role/restriction presentation values.
- `src/core/types.ts` — owns the accepted child snapshot being projected.
- `src/ui/DelegationDialog.tsx` — separately owns pre-launch availability and denial behavior.

### Related ADRs
- [ADR-002: Make Verified Safe Delegation the Operator Product Contract](adrs/adr-002.md) — requires visible active safety information.
- [ADR-003: Resolve Explore Policy in Core and Snapshot It on Registration](adrs/adr-003.md) — requires presentation to consume immutable snapshots.
- [ADR-006: Verify the Explore Contract Through Layered Tests](adrs/adr-006.md) — requires accessible text assertions.

## Deliverables

- Sessions overlay role/restriction text for active explore children.
- Compact tab-workspace explore cue sourced from selector presentation.
- Regression coverage for lifecycle, terminal transcript, focus, selected, and overflow behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for active child presentation across session surfaces **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Session overlay renders `explore` and every concise restriction cue alongside existing Child-of and lifecycle text.
  - [x] Tab workspace renders the selector-provided explore cue without reading raw child snapshots or configuration.
  - [x] Role/restriction text remains available when palette values change, proving it is not color-only.
- Integration tests:
  - [x] An active explore child appears correctly in both session overlay and tab workspace while focus can move normally.
  - [x] Terminal explore children retain existing transcript/lifecycle behavior without claiming live policy verification after terminal or restore conditions.
  - [x] Existing selected-tab and overflow/reachability behavior remains unchanged with the compact cue present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Active explore children are visibly distinguishable through text in both full and compact session surfaces.
- Existing navigation and terminal-child behavior remains intact.
