---
status: completed
title: "Add Cursor onboarding, docs, and reviewed-handoff regression coverage"
type: docs
complexity: high
---

# Task 07: Add Cursor onboarding, docs, and reviewed-handoff regression coverage

## Overview

Document Cursor as a certified local third session with independent availability and retain exact reviewed-handoff safety language. Add first-run and handoff regressions that prove an unavailable Cursor does not block ready siblings and a Cursor transfer still requires target selection, preview, curation, and confirmation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. README MUST describe Cursor as a certified local `agent acp` session and MUST distinguish it from Cursor cloud or background products.
- 2. README MUST state that missing, unauthenticated, incompatible, or uncertified Cursor leaves ready siblings usable and MUST NOT invent the exact certified version before reviewed evidence exists.
- 3. README MUST preserve reviewed-handoff language: target choice, redacted editable/curatable preview, and explicit confirmation; it MUST NOT imply auto-send or guaranteed secret removal.
- 4. First-run coverage MUST prove a content-free Cursor-specific recovery message is forwarded unchanged and a ready sibling keeps boot unblocked.
- 5. Handoff coverage MUST prove Cursor is eligible only when ready, source is excluded, choosing Cursor opens a preview, and no prompt sends before explicit confirmation.
- 6. Rendered Cursor-to-Claude hand-back MUST exercise the same picker and preview flow, without a Cursor-only shortcut.
</requirements>

## Subtasks
- [x] 7.1 Document the certified local-session scope, recovery behavior, and capability boundary.
- [x] 7.2 Add README contract coverage for truthful third-session and safety claims.
- [x] 7.3 Cover first-run and boot continuity for an unavailable Cursor with ready siblings.
- [x] 7.4 Add flow-level reviewed Cursor target and confirmation regressions.
- [x] 7.5 Add rendered Cursor hand-back coverage through the shared picker and preview.

## Implementation Details

Follow the TechSpec "User Experience," "Integration Points," and "Testing Approach" sections. `firstRun.ts` is already provider-agnostic and forwards readiness text verbatim, so this task changes tests and documentation rather than adding a Cursor branch there.

### Relevant Files
- `README.md` — local Cursor scope, setup/recovery, certified-profile boundary, and reviewed-handoff documentation.
- `test/cursorDocumentation.test.ts` — new README contract for third-session, local-only, recovery, and confirmation claims.
- `src/config/firstRun.test.ts` — direct first-run report continuity and verbatim-gap coverage.
- `test/firstRunBoot.test.ts` — rendered boot remains mounted with an unavailable Cursor and ready siblings.
- `src/app/handoff.test.ts` — flow-level target, preview, no-send-before-confirm, and focus transfer coverage.
- `src/ui/HandoffTargetPicker.test.tsx` — rendered Cursor target and hand-back picker/preview regression.

### Dependent Files
- `src/config/readiness.ts` — owns Cursor-specific recovery text used in the first-run assertions.
- `src/app/controller.ts` — owns generic runtime availability and prompt dispatch.
- `src/app/handoff.ts` — retains the generic source exclusion, target picker, redaction, curation, and confirmation flow.
- `src/ui/HandoffPreview.tsx` — remains the mandatory confirmation surface before send.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — local first-class session and reviewed handoffs.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — availability and sibling continuity.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — honest certification boundary without guessed version copy.

## Deliverables
- Truthful Cursor local-session, recovery, and reviewed-handoff documentation.
- README contract coverage for safety and capability-boundary claims.
- First-run, boot, flow, and rendered-picker Cursor regressions.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for boot continuity and reviewed handoffs **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] A first-run report with ready Claude Code/Codex and unavailable Cursor is unblocked, retains sibling readiness, and contains Cursor's exact safe gap.
  - [x] README contract requires third local session, independent recovery, reviewed handoff, and cloud/background exclusion wording.
  - [x] Claude-source handoff with ready Codex/Cursor sends nothing at begin or Cursor target selection and sends once only after confirm.
- Integration tests:
  - [x] Boot with the same fleet keeps the cockpit mounted and reports only Cursor's actionable content-free recovery gap.
  - [x] Rendered picker shows Cursor but not its source, opens preview on selection, and sends only on the following confirmation.
  - [x] Cursor hands work back to Claude through the same picker, preview, and confirmation sequence.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Documentation makes no cloud, auto-send, guaranteed-redaction, or uncertified-version claim.
- Every Cursor-directed or Cursor-originated handoff retains the mandatory reviewed confirmation boundary.
