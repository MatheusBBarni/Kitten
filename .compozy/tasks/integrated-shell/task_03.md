---
status: completed
title: "ShellRuntime over Bun.Terminal and @xterm/headless"
type: backend
complexity: high
dependencies:
  - task_01
---

# Task 03: ShellRuntime over Bun.Terminal and @xterm/headless

## Overview
Build the imperative `ShellRuntime` that spawns a real shell in a native PTY, feeds its bytes to a terminal emulator, and exposes the screen and lifecycle to the rest of the app.
This is the highest-risk task and the de-risking spike: it proves `@xterm/headless` drives correctly under Bun and that the emulator's buffer can be read for rendering, before any UI or hand-off work depends on it.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `@xterm/headless` as a pinned dependency and confirm `Bun.Terminal` is available (Bun >= 1.3.5).
- MUST implement `ShellRuntime` and an injectable `ShellRuntimeFactory` in `src/shell/shellRuntime.ts`, matching the interface in the TechSpec "Core Interfaces" section.
- MUST spawn one long-lived interactive `$SHELL` in a `Bun.Terminal` PTY and pipe its output into an `@xterm/headless` instance.
- MUST expose `view()` returning the active buffer's visible rows as styled runs, `write(bytes)`, `interrupt()` (sends `0x03`), `resize(cols, rows)`, `onEvent`, `snapshot()`, and `dispose()`.
- MUST emit a `screen` `ShellEvent` at most once per render frame, reusing the existing frame-coalescing approach.
- MUST provide an in-memory factory for tests that scripts bytes and events without a real PTY, analogous to `createInMemoryTransportPair`.
- MUST be POSIX-only and dispose cleanly (kill the PTY, release the emulator) without throwing.

## Subtasks
- [x] 3.1 Add and pin `@xterm/headless`; verify `Bun.Terminal` availability
- [x] 3.2 Spawn the shell PTY and wire its output into the emulator
- [x] 3.3 Implement `view()`, `write`, `interrupt`, `resize`, `snapshot`, and `dispose`
- [x] 3.4 Coalesce screen updates to one `screen` event per frame
- [x] 3.5 Provide the in-memory `ShellRuntimeFactory` test double

## Implementation Details
Create `src/shell/shellRuntime.ts`. Mirror the transport/connection pattern in `src/agent/transport.ts` (injectable factory) and `src/agent/agentConnection.ts` (the frame scheduler and buffered flush). See TechSpec "Core Interfaces" for the `ShellRuntime` shape and "Integration Points" for the Bun/`@xterm/headless` boundary. Keep OSC parsing out of this task (task_04) — emit only `screen` events here.

### Relevant Files
- `src/agent/transport.ts` — `TransportFactory` seam and `Bun.spawn` pattern to mirror
- `src/agent/agentConnection.ts` — `createFrameScheduler` and buffered-flush pattern
- `src/app/controller.ts` — the disposal ownership model this runtime will join (task_05)

### Dependent Files
- `src/app/controller.ts` — will own and dispose the runtime (task_05)
- `src/ui/ShellPane.tsx` — will call `view()` (task_08)
- `src/shell/shellIntegration.ts` — will register OSC handlers on the emulator (task_04)

### Related ADRs
- [ADR-003: Shell Runtime and Rendering Architecture](adrs/adr-003.md) — PTY backend, emulator, and render/semantic split

## Deliverables
- `src/shell/shellRuntime.ts` with `ShellRuntime` + `ShellRuntimeFactory`
- Pinned `@xterm/headless` dependency
- In-memory test factory
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests against a real PTY **(REQUIRED)**

## Tests
- Unit tests (in-memory factory):
  - [x] scripted output bytes produce a `view()` whose rows match the expected styled runs
  - [x] `interrupt()` writes the `0x03` byte to the PTY sink
  - [x] `resize(cols, rows)` forwards new dimensions to the PTY and emulator
  - [x] multiple output chunks within one frame emit a single `screen` event
  - [x] `dispose()` resolves without throwing and after it `write` is a no-op
- Integration tests (real PTY):
  - [x] spawning `$SHELL` and writing `echo hello\n` renders `hello` in `view()`
  - [x] a colored output line yields styled runs with the expected foreground color
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The spike proves `@xterm/headless` renders a real shell's output under Bun
- Runtime disposes without leaking the PTY process
