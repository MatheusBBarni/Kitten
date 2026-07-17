---
status: completed
title: Render truthful concurrent MCP tool outcomes
type: frontend
complexity: low
---

# Task 05: Render truthful concurrent MCP tool outcomes

## Overview

Make the existing tool-call row explain a genuine temporary capacity constraint
differently from an unavailable action. The terminal UI must give concise,
content-free manual guidance without adding retry controls or suggesting that an
ambiguous delegated-work start can be repeated safely.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST render distinct textual, non-color-only failed states for `temporary_capacity` and `unavailable` using only the core failure kind and no raw bridge or MCP data.
- 2. MUST state that capacity recovery is manual and depends on a known terminal outcome; unavailable and ambiguous work MUST NOT be presented as safe to retry.
- 3. MUST preserve existing tool kind labels, MCP title formatting, bullets, diff rendering, locations, generic failed-tool wording, keyboard behavior, and palette conventions.
- 4. MUST add no retry button, automatic retry, new dashboard, persisted history, or new UI action surface.
- 5. MUST remain resilient when the optional failure kind is absent or when a non-MCP tool is failed.
</requirements>

## Subtasks

- [x] 5.1 Define concise, accessible presentation text for each approved failed state.
- [x] 5.2 Render the optional domain failure kind through the existing tool-call row only.
- [x] 5.3 Preserve the generic tool-call and MCP-title presentation paths.
- [x] 5.4 Prove no replay affordance or private diagnostic detail enters the rendered transcript.

## Implementation Details

See TechSpec sections “Data Flow”, “Impact Analysis”, and “Testing Approach”.
Use the protocol-free field supplied by Task 03; presentation must not inspect
ACP/MCP objects or infer a retry state from a generic failed status.

### Relevant Files

- `src/ui/ToolCallRow.tsx` — owns the one-line status label, MCP title formatting, colors, and optional detail rendering.
- `src/ui/ToolCallRow.test.tsx` — renders tool rows with the OpenTUI test harness and asserts visible labels.
- `src/core/types.ts` — provides the optional protocol-free failure kind consumed by the row.

### Dependent Files

- `src/agent/acpTranslate.ts` — supplies classified bounded outcomes without passing source text to the UI.
- `src/core/sessionReducer.ts` — ensures transcript records preserve or clear the optional failure kind correctly.
- `src/ui/ConversationView.tsx` — passes transcript tool records through the existing `ToolCallRow` composition without a new action surface.

### Related ADRs

- [ADR-002: Center the MVP on mixed supervised work and deliberate recovery](adrs/adr-002.md) — requires continuity and truthful manual recovery.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — defines the bounded presentation and no-replay constraints.

## Deliverables

- Distinct, accessible `temporary_capacity` and `unavailable` text in the existing tool-call row.
- Preserved generic failed-tool and existing MCP-title rendering behavior.
- UI regression coverage proving no retry affordance or private text is shown.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for transcript-level rendering **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A failed bundled-MCP record with `temporary_capacity` renders a textual capacity state and manual-only known-outcome guidance without relying on color.
  - [x] A failed record with `unavailable` renders distinct unavailable text and does not imply retry is safe.
  - [x] A failed record without a failure kind keeps the current generic failed wording.
  - [x] MCP title formatting, non-MCP titles, status bullets, diffs, locations, and palette behavior remain unchanged for classified and unclassified rows.
  - [x] Rendered output contains no route, endpoint, capability, call ID, raw error, prompt, task, or retry-control sentinel.
- Integration tests:
  - [x] A transcript turn containing each classified record renders through `ConversationView` without changing ordering, focus, or the surrounding message presentation.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Developers can distinguish temporary capacity from unavailability in the existing tool outcome surface.
- The UI adds no unsafe replay affordance and exposes no private implementation detail.
