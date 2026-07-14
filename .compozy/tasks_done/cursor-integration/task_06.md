---
status: completed
title: "Render Cursor through shared provider metadata"
type: frontend
complexity: medium
---

# Task 06: Render Cursor through shared provider metadata

## Overview

Remove the remaining two-provider UI label branches so a ready Cursor session renders as an equal third provider. Status and model-selection views must consume shared typed metadata while retaining their narrow-selector, keyboard, and per-session behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Status and model-selector labels MUST derive from the total typed provider metadata introduced by this feature; neither view may retain a `claude-code`/else branch or hard-coded Cursor special case.
- 2. UI code MUST remain selector/controller-only and MUST NOT import ACP, config-loading, readiness, or connection behavior.
- 3. The status strip MUST preserve narrow memoized model/effort selectors, headroom, MCP status, and normal 80-column no-overflow behavior.
- 4. The model selector MUST retain visible-conversation filtering, duplicate-label disambiguation, tab order, keyboard wrapping, session-ID actions, pending state, and explicit confirmation for established-session configuration changes.
- 5. A ready Cursor session MUST use the same label, model, and effort rendering behavior as the existing providers; unavailable/recovery presentation remains outside this task.
</requirements>

## Subtasks
- [x] 6.1 Replace the status-strip binary provider label with shared metadata.
- [x] 6.2 Replace model-selector base tab labels with shared metadata.
- [x] 6.3 Add a ready Cursor runtime fixture to status-strip coverage.
- [x] 6.4 Add a three-session model-selector fixture and preserve existing keyboard behavior.

## Implementation Details

Follow the TechSpec "Component Overview" and "Impact Analysis" sections. Do not add view state or broaden subscriptions; provider identity already reaches both views through their existing runtime/session projections.

### Relevant Files
- `src/ui/StatusStrip.tsx` — compact focused-provider label rendering.
- `src/ui/StatusStrip.test.tsx` — Cursor label, model, headroom, and width regression coverage.
- `src/ui/ModelSelect.tsx` — provider tab-label construction and duplicate disambiguation.
- `src/ui/ModelSelect.test.tsx` — three-provider tabs, Cursor navigation, and per-session option application.

### Dependent Files
- `src/core/types.ts` — shared provider metadata and Cursor identity.
- `src/store/selectors.ts` — existing narrow runtime/session identity projections.
- `src/app/controller.ts` — supplies ready Cursor runtime state through the generic controller.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — equal first-class session presentation.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — equal user-visible session behavior.

## Deliverables
- Metadata-derived provider labels in status and model-selection views.
- Ready Cursor UI fixtures covering display and per-session action behavior.
- Preserved keyboard, confirmation, selector, and layout contracts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for rendered three-session interaction **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] A ready Cursor status chip uses its shared compact label, advertised model label, and normal headroom/MCP rendering without other provider labels.
  - [x] An 80-column status strip with Cursor retains the existing no-overflow contract.
  - [x] Model tabs show metadata-derived Claude, Codex, and Cursor labels while duplicate providers still disambiguate by title.
  - [x] Keyboard navigation reaches Cursor and applies only Cursor's opaque configuration option after the existing confirmation flow.
- Integration tests:
  - [x] A rendered three-session selector retains visible-only filtering, tab order, wrapping, close/select/reopen flow, and session-ID-based actions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No UI provider label is derived from a binary Claude-or-Codex conditional.
- Cursor renders and receives model-selection actions as an equal ready session.
