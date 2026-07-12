---
status: completed
title: "Layered attention notifier"
type: backend
complexity: high
dependencies:
  - task_04
---

# Task 08: Layered attention notifier

## Overview
Add a notifier that reaches the developer when a session newly needs them while their attention is elsewhere: it rings the terminal bell and fires a native OS notification through a per-OS shell-out, gated on terminal focus, with the bell as the universal fallback.
This is the part of the feature that actually cuts idle time for an away developer, and it stays content-free.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `src/notify` module with a `NotificationChannel` seam and OS detection selecting `osascript` (macOS), `notify-send` (Linux), or a PowerShell toast (Windows), with no added dependency, per ADR-007 and the TechSpec "Integration Points" section.
- MUST subscribe to session-status transitions and fire once per transition into a needs-you state (`awaiting_approval`, `error`, `finished`), deduplicated per session, carrying only title, provider, working directory, and state.
- MUST gate on terminal focus (DECSET 1004): fire the OS notification only while Kitten is unfocused, falling back to notify-on-transition where focus state is unknown, and always ring the bell.
- MUST treat the OS channel as best-effort: a failed shell-out still rings the bell.
- MUST wire the notifier at boot alongside the telemetry recorder.
</requirements>

## Subtasks
- [x] 8.1 Define the `NotificationChannel` seam and the per-OS shell-out behind OS detection.
- [x] 8.2 Subscribe to status transitions and fire once per transition into needs-you, deduplicated per session.
- [x] 8.3 Add the terminal focus listener and gate the OS notification on the unfocused state with its fallback.
- [x] 8.4 Ring the terminal bell on every needs-you transition as the universal fallback.
- [x] 8.5 Wire the notifier into the boot path next to the telemetry recorder.

## Implementation Details
Build the notifier per ADR-007 and the TechSpec "Integration Points" section: a store subscription for transitions, an injectable channel seam, OS detection, and a focus source from OpenTUI.
The message is assembled only from the session's own title, provider, directory, and state; no prompt or transcript content is ever passed to a shell command.

### Relevant Files
- `src/notify/` - new module: the notifier, the channel seam, OS detection, and the shell-outs.
- `src/index.ts` - boot wiring alongside the telemetry recorder.
- `src/store/appStore.ts` - the `subscribeSelector` the notifier watches.

### Dependent Files
- `src/ui/CockpitApp.tsx` - the focus source may surface through the UI/OpenTUI focus events.

### Related ADRs
- [ADR-007: Layered Attention Notifications - Per-OS Shell-Out with Focus Gating](../adrs/adr-007.md) - the delivery, gating, and fallback design.
- [ADR-003: Native OS-Level Attention Notifications in V1](../adrs/adr-003.md) - the product decision to notify at the OS level.

## Deliverables
- A `src/notify` module delivering bell plus a per-OS native notification with no new dependency.
- Focus-gated firing with a documented fallback and per-session deduplication.
- Boot wiring for the notifier.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests driving a session into a needs-you state while unfocused **(REQUIRED)**.

## Tests
- Unit tests (with an injected channel and focus seam):
  - [ ] A `working` to `awaiting_approval` transition while unfocused fires exactly one bell and one channel call.
  - [ ] The same transition while focused fires neither the bell OS notification nor the channel (in-app only).
  - [ ] Staying in `awaiting_approval` across further events fires nothing more (per-session dedup).
  - [ ] A channel whose shell-out throws still rings the bell.
  - [ ] With focus state unknown, a needs-you transition still notifies (fallback).
  - [ ] The channel input contains only title, provider, `cwd`, and state, never prompt or transcript text.
- Integration tests:
  - [ ] Drive a mock session to `error` with the app marked unfocused and assert exactly one notification carrying that session's title, directory, and state.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Notifications fire once per needs-you transition, gated on focus, content-free
- The bell always fires even when the native channel fails
