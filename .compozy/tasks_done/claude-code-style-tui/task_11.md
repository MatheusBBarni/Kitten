---
status: completed
title: "Dual-agent StatusBar rebuild"
type: frontend
complexity: high
dependencies:
    - task_01
    - task_08
    - task_09
    - task_10
---

# Task 11: Dual-agent StatusBar rebuild

## Overview
Rebuild the status strip into the reskin's signature surface: a per-agent lozenge carrying focus, run-state, and model/context slots, a shared branch and cwd, and an always-visible, honest hand-off affordance.
It renders only signals it can stand behind (hide-when-absent) and holds an 80-column priority-collapse budget with both agents at their richest state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render, per agent: a focus marker, the run-state as glyph + label + color, a model slot (`selectSessionModel`), and a context slot (`selectSessionContext`) colored by the `context` thresholds (ok / warn ~70% / critical ~85%).
- MUST render a shared git-branch (`selectSessionBranch`) and cwd segment.
- MUST render an always-visible hand-off affordance showing the key and direction, and the reason (from `begin()` / derived store state) when it cannot run.
- MUST hide any slot whose selector returns `null` (zero width), keeping focus and run-state as two orthogonal signals.
- MUST hold an 80-column priority-collapse budget (shed order: branch, then context%, then effort) and update `StatusStrip.test` to assert it with both agents at their longest state.
- MUST read all colors from the palette (task_01) and use narrow per-session selectors.
</requirements>

## Subtasks
- [ ] 11.1 Build the per-agent lozenge (focus marker + run-state glyph/label/color).
- [ ] 11.2 Add the model slot and the context slot with threshold colors.
- [ ] 11.3 Render the shared branch + cwd segment.
- [ ] 11.4 Render the honest hand-off affordance (key + direction, or reason).
- [ ] 11.5 Implement hide-when-absent and the 80-column priority-collapse.
- [ ] 11.6 Rewrite `StatusStrip.test` for the new width budget and collapse order.

## Implementation Details
Rebuild `src/ui/StatusStrip.tsx` and rewrite `src/ui/StatusStrip.test.tsx`; touch `src/ui/keymap.ts` if the hand-off hint text moves.
Consume the palette (task_01), the slot selectors (task_08) with real branch data (task_09), and the hand-off result (task_10).
See ADR-006, ADR-007, ADR-001, and the TechSpec "System Architecture" (StatusBar) and "Testing Approach".

### Relevant Files
- `src/ui/StatusStrip.tsx` — the current `AgentStatusChip` / `KEYMAP_HINT` structure to rebuild.
- `src/ui/StatusStrip.test.tsx` — the 80-column code-point assertion to update.
- `src/store/selectors.ts` — `selectSessionBranch/Model/Context` (task_08).
- `src/app/handoff.ts` — the discriminated result (task_10).
- `src/ui/theme.ts` — run-state + context threshold colors (task_01).
- `src/ui/keymap.ts` — keymap hint text.

### Dependent Files
- `src/ui/CockpitApp.tsx` — mounts `StatusStrip`; may pass the hand-off flow/derived state.

### Related ADRs
- [ADR-006: Status Bar - Typed Slot Contract, Delegated Data Plumbing, and Honest Hand-off Affordance](adrs/adr-006.md) — Slots, hide-when-absent, honest hand-off.
- [ADR-007: Git Branch via Boot plus Turn-Boundary Refresh](adrs/adr-007.md) — Branch segment source.
- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — 80-column budget, hide-when-absent.

## Deliverables
- Rebuilt dual-agent `StatusBar` with slots, honest hand-off, and priority-collapse.
- Updated `StatusStrip.test` enforcing the new 80-column budget.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the width budget and priority-collapse **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The focus marker shows on the focused agent only; the other agent has no marker.
  - [ ] The run-state renders the right label + color for idle, working, awaiting_approval, and not_ready.
  - [ ] The model slot is hidden when `selectSessionModel` is `null` and shown when set.
  - [ ] The context slot renders `context.ok` below 70%, `context.warn` at 70-85%, and `context.critical` above 85%.
  - [ ] The branch segment is hidden when `selectSessionBranch` is `null` and shown when set.
  - [ ] The hand-off affordance shows "^T hand off -> Codex" when enabled and the reason when disabled.
- Integration tests:
  - [ ] With both agents at their richest both-visible state, the top strip row is exactly 80 code points.
  - [ ] As width narrows, the strip sheds branch, then context%, then effort, in that order.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The bar communicates focus, run-state, model, branch, and context at a glance and stays within 80 columns
- The hand-off is always visible and explains itself when it cannot run
