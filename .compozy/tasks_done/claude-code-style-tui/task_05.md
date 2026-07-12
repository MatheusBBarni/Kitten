---
status: completed
title: "Transient boot-banner render root"
type: frontend
complexity: medium
dependencies:
    - task_02
    - task_03
---

# Task 05: Transient boot-banner render root

## Overview
Paint the welcome banner during the ACP handshake, when the terminal is currently blank, by rendering a transient banner root into the renderer before the cockpit mounts and swapping it out once agents are ready.
The existing readiness gate and stderr diagnostics stay untouched, and the first successful boot marks the first-run state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the `WelcomeBanner` into the renderer between `createRenderer()` and `renderCockpit()` in `src/index.ts`, with agents shown as `connecting`.
- MUST choose the banner variant from the `welcomeBanner` config preference and `bannerVariant`/`readFirstRunSeen` (task_02).
- MUST dispose the boot root before `renderCockpit()` so there is one live tree at a time.
- MUST leave the readiness gate and its stderr diagnostics/exit path unchanged (a blocked boot still tears down and exits).
- MUST call `markFirstRunSeen()` once on the first successful boot.
- MUST NOT read the store (it does not exist yet during the handshake).
</requirements>

## Subtasks
- [ ] 5.1 Add a `renderBootBanner(renderer, ...)` helper that mounts the banner and returns a disposer.
- [ ] 5.2 Wire it into the `src/index.ts` boot sequence with the variant decision.
- [ ] 5.3 Dispose the boot root and swap to `renderCockpit` when the controller resolves.
- [ ] 5.4 Mark first-run seen on the first successful boot.
- [ ] 5.5 Add a boot integration test for the paint-and-swap.

## Implementation Details
Modify `src/index.ts` (boot sequence between `createRenderer()` and `renderCockpit()`) and add a small helper (e.g. `src/ui/bootBanner.tsx`) so the boot render is testable in isolation.
Consume `WelcomeBanner` (task_03) and `bannerVariant`/`markFirstRunSeen` (task_02).
See ADR-003 and ADR-005, and the TechSpec "System Architecture" (Boot banner root).

### Relevant Files
- `src/index.ts` — boot sequence; `createRenderer()` and `renderCockpit()` seam.
- `src/ui/main.tsx` — `renderCockpit` / root creation conventions.
- `src/ui/WelcomeBanner.tsx` — the banner rendered (task_03).
- `src/config/appState.ts` — `bannerVariant`, `markFirstRunSeen` (task_02).

### Dependent Files
- None; the swap hands off to the existing cockpit render.

### Related ADRs
- [ADR-003: Boot Banner via a Transient Pre-Controller Render Root](adrs/adr-003.md) — This task's core decision.
- [ADR-005: First-Run Persistence via a Runtime State File plus a Read-Only Config Setting](adrs/adr-005.md) — First-run marker written on first successful boot.

## Deliverables
- A transient boot-banner root in `src/index.ts` with a testable helper.
- First-run marking on first successful boot.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: banner paints during a delayed handshake, then swaps to the cockpit **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The boot helper renders the `full` banner on first run and the `quiet` banner when the marker is set.
  - [ ] With `welcomeBanner: "off"`, the boot helper paints nothing.
  - [ ] `markFirstRunSeen()` is called exactly once after a successful boot.
- Integration tests:
  - [ ] With a controller that resolves after a delay, the frame shows "connecting..." during the handshake and then a mounted cockpit (an agent `displayName`) with no residual banner.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The handshake window shows the branded banner instead of a blank screen
- The readiness gate and stderr diagnostics behave exactly as before
