---
status: completed
title: Apply the responsive T3-inspired desktop shell and visual system
type: frontend
complexity: high
---

# Task 16: Apply the responsive T3-inspired desktop shell and visual system

## Overview

Apply the approved restrained visual hierarchy across the integrated
supervision shell without importing T3 Code branding or lifecycle semantics.
Wide layouts show navigation, board, and workbench coherently; narrow layouts
show one focused surface with explicit restorative navigation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The shell MUST use a quiet neutral hierarchy, sparse primary accent, and text-backed semantic colors for attention, review, failure, running, and success.
2. Wide layout MUST keep repository navigation, Kanban board, and selected-card workbench oriented as distinct labelled regions.
3. Narrow layout MUST show one focused surface with explicit Back navigation and preserved board/workbench context.
4. Settings and critical workbench actions MUST remain reachable in every supported shell mode.
5. Focus visibility, logical reading order, text status meaning, and reduced-motion behavior MUST remain intact.
6. Components MUST use Tailwind utilities; `styles.css` MUST remain limited to imports, tokens, base/focus/reduced-motion rules, and existing shared legacy rules.
7. Generated Tailwind output MUST be produced by the existing build command and MUST NOT be hand-edited.
</requirements>

## Subtasks

- [ ] 16.1 Establish neutral, accent, semantic-status, typography, radius, and depth tokens.
- [ ] 16.2 Apply compact chrome and readable hierarchy across navigation, board, workbench, and review.
- [ ] 16.3 Compose labelled navigation/board/workbench regions for wide layouts.
- [ ] 16.4 Compose one focused restorative surface for narrow layouts.
- [ ] 16.5 Preserve Settings, critical actions, focus order, text labels, and reduced motion.
- [ ] 16.6 Regenerate Tailwind output through the supported build.
- [ ] 16.7 Add semantic, responsive-state, and compiled-style regression coverage.

## Implementation Details

Follow the PRD **T3 Code-inspired Visual Language** and TechSpec **Desktop shell
and workbench** sections. Adapt hierarchy and density only; retain Kitten's
repositories, boards, stages, cards, attempts, and statuses. Automated tests
prove structure, while native visual quality remains a separate gate.

### Relevant Files

- `packages/desktop/src/renderer/styles.css` — theme tokens, base hierarchy, focus, and reduced-motion rules.
- `packages/desktop/src/renderer/generated.css` — regenerated Tailwind output.
- `packages/desktop/src/renderer/main.tsx` — compact application chrome and responsive surface routing.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx` — wide and narrow board/workbench composition.
- `packages/desktop/src/renderer/features/board/ProjectSidebar.tsx` — compact supervision navigation.
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` — responsive workbench and explicit Back action.

### Dependent Files

- `packages/desktop/test/cardInspectorRenderer.integration.test.ts` — semantic responsive-shell assertions.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — adapt interaction hierarchy, retain Kitten semantics.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — responsive presentation preserves view identities.
- [ADR-006: Require Packaged Native Lifecycle-Matrix Verification](adrs/adr-006.md) — automation cannot satisfy the native visual gate.

## Deliverables

- Cohesive T3-inspired wide and narrow supervision shell.
- Regenerated Tailwind output with focus/reduced-motion semantics.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for responsive structure and context preservation **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Expose navigation, board, and workbench as labelled regions in wide markup.
  - [ ] Expose a labelled Back action that restores board context in narrow markup.
  - [ ] Retain visible text labels independently of lifecycle color classes.
  - [ ] Keep Settings reachable while the workbench is open.
  - [ ] Preserve logical DOM/focus order through navigation, board, workbench, and composer.
  - [ ] Disable nonessential animation under reduced motion without hiding progress/state.
  - [ ] Produce required responsive and focus-visible variants after `styles:build`.
- Integration tests:
  - [ ] Preserve board/card context when opening and closing workbench in both shell modes.
  - [ ] Preserve board, card, attempt, draft, and review selection across resize.
  - [ ] Render empty, attention, running, failed, ready-review, and stale-review states with distinct text.
  - [ ] Verify no T3 branding, thread identity, or copied lifecycle terminology appears.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every touched surface shares one coherent hierarchy without changing workflow meaning.
- Responsive layout never hides the next valid supervision action.
