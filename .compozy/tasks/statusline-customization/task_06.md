---
status: pending
title: "Build the Keyboard-First Statusline Command and Modal Workflow"
type: frontend
complexity: high
---

# Task 06: Build the Keyboard-First Statusline Command and Modal Workflow

## Overview

Add `/statusline` to the cockpit command registry and implement its modal disclosure, request, preview, failure, and recovery-preset workflow. The interface must remain keyboard-first, expose the exact rendered line and config change before confirmation, and preserve approval, clarification, help, shell, and prompt-editor precedence.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register exactly one discoverable no-argument `/statusline` cockpit command in the shared keymap registry so existing prompt-editor dispatch runs it rather than sending it to an agent.
- MUST render a store-owned modal that first discloses the visible normal-transcript data-use boundary and requires acknowledgement before it sends a request.
- MUST show the current-width single-line preview and exact personal config change for every valid proposal or preset, with explicit Confirm and Cancel controls.
- MUST offer only Workspace, Agent, and Compact presets after decline, unavailability, or invalid proposal; a valid conversational proposal MUST NOT be silently replaced.
- MUST use controller actions and `StatuslineFlow`, never direct config, connection, ACP, or telemetry access from the UI; all async keyboard callbacks MUST degrade to a visible error state rather than reject into React.
</requirements>

## Subtasks

- [ ] 6.1 Add the discoverable `/statusline` command and route its exact draft invocation through the cockpit command dispatcher.
- [ ] 6.2 Mount a modal overlay owned by the app-store slot and preserve established overlay precedence.
- [ ] 6.3 Implement concise disclosure, request entry, waiting, preview/diff, failure, and three-preset recovery states.
- [ ] 6.4 Use the shared renderer with reactive terminal dimensions to preview the active context at the current width.
- [ ] 6.5 Wire acknowledgement, request, Confirm, Cancel, and recovery selection through injected controller actions and flow outcomes.
- [ ] 6.6 Add command-dispatch and modal interaction coverage, including approval and clarification precedence.

## Implementation Details

Follow TechSpec "Data Models", "OpenTUI width", and "Impact Analysis" plus the established `PromptEditor` and existing modal patterns. The slash menu is non-modal and retains editor focus; the new modal owns its keyboard only after the exact cockpit command has been invoked. Reference the statusline core renderer rather than formatting preview strings in the component.

### Relevant Files

- `src/ui/keymap.ts` — add the command definition and a dedicated modal keymap surface if required.
- `src/ui/keymap.test.ts` — retain unique command registry, help discovery, and exact command assertions.
- `src/ui/CockpitApp.tsx` — dispatch the command, mount the modal, and preserve overlay ordering.
- `src/ui/CockpitApp.test.tsx` — cover command routing and interaction precedence in the mounted cockpit.
- `src/ui/StatuslineOverlay.tsx` — new keyboard modal for disclosure, request, preview/diff, failure, and recovery presets.
- `src/ui/StatuslineOverlay.test.tsx` — new direct modal interaction coverage with an injected fake controller.
- `src/ui/PromptEditor.tsx` — existing exact no-argument dispatch and command-menu integration that must remain compatible.

### Dependent Files

- `src/store/appStore.ts` and `src/store/selectors.ts` — provide the modal slot and narrow state subscriptions.
- `src/app/statuslineFlow.ts` — performs normal-transcript proposal collection and strict parsing.
- `src/app/actions.ts` — exposes acknowledgement and confirmation actions to the view.
- `src/core/statusline.ts` — supplies previews and the fixed recovery layouts.
- `test/fakeController.ts` — records modal-driven controller action calls without a real agent.

### Related ADRs

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — requires a previewable, declarative and non-executable surface.
- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — defines acknowledgement, explicit confirmation, and recovery-only presets.
- [ADR-004: Use the focused agent transcript with a strict fenced proposal contract](adrs/adr-004.md) — governs the visible request and response experience.

## Deliverables

- A discoverable exact `/statusline` command and fully keyboard-driven modal workflow.
- Disclosure, normal-transcript request, preview/diff, Confirm/Cancel, and recovery preset views.
- Colocated UI and cockpit dispatch coverage using injected fakes and in-memory rendering.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the statusline command workflow **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] `COCKPIT_COMMANDS` exposes one unique `statusline` name with concise help copy and exact no-argument dispatch accepts `/statusline` but not `/statusline describe compact`.
  - [ ] The first invocation shows disclosure; acceptance performs one request and decline opens presets without sending a prompt.
  - [ ] A valid proposal shows one-line preview plus exact config change, then Confirm calls the controller once while Cancel makes no confirmation call.
  - [ ] Invalid and unavailable outcomes explain the recovery state and expose exactly Workspace, Agent, and Compact presets.
  - [ ] A preset follows the same preview and Confirm/Cancel path as a valid proposal.
  - [ ] Escape, arrows, Enter, and text entry are consumed by the modal while approval or clarification overlays retain their existing higher precedence.
- Integration tests:
  - [ ] An in-memory cockpit invokes `/statusline`, acknowledges disclosure, receives a fake transcript proposal, confirms it, and shows the immediate saved-state path without sending an extra agent prompt.
  - [ ] Resizing the terminal changes preview width while retaining one line and preserving focused prompt-editor behavior before the modal opens.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Developers can complete request → preview/diff → Confirm or Cancel entirely from the keyboard.
- The feature is discoverable, explicit about data use, and preserves existing cockpit command and overlay behavior.
