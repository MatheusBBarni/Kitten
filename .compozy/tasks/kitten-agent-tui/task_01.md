---
status: completed
title: "Project scaffold and tooling"
type: infra
complexity: medium
dependencies: []
---

# Task 01: Project scaffold and tooling

## Overview
Stand up the greenfield Bun + TypeScript project so every later task has a working build, type-check, and test loop.
This establishes the dependency set (OpenTUI React binding, the ACP TypeScript SDK, React), the TypeScript/JSX configuration for `@opentui/react`, and a runnable entry point that proves OpenTUI renders in the terminal.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST initialize a Bun project with pinned versions of `@opentui/core`, `@opentui/react`, `react`, and the ACP TypeScript SDK (both dependencies are pre-1.0 and MUST be version-pinned per the TechSpec "Technical Dependencies").
- MUST configure `tsconfig.json` with `jsx: "react-jsx"` and `jsxImportSource: "@opentui/react"` per ADR-004.
- MUST configure `bun test` as the test runner and provide one passing smoke test so CI has a green baseline.
- MUST provide a runnable entry point that boots a `createCliRenderer` + `createRoot` and renders a placeholder, exiting cleanly on Ctrl+C.
- MUST establish the source directory layout (`src/core`, `src/agent`, `src/config`, `src/store`, `src/app`, `src/ui`, `src/telemetry`) referenced across the TechSpec build order.
</requirements>

## Subtasks
- [x] 1.1 Initialize `package.json`, `bunfig.toml`, and `.gitignore` with pinned OpenTUI/React/ACP dependencies
- [x] 1.2 Configure `tsconfig.json` for the `@opentui/react` JSX runtime and strict type-checking
- [x] 1.3 Create the source directory skeleton matching the TechSpec component layers
- [x] 1.4 Add a runnable entry point that renders a placeholder cockpit frame and exits on Ctrl+C
- [x] 1.5 Wire `bun test` and add a smoke test that asserts the entry module loads

## Implementation Details
Create the project root configuration and directory skeleton. See TechSpec "System Architecture" for the component layers that determine the folder layout, and "Development Sequencing → Technical Dependencies" for the pinned dependencies. The entry point should follow the OpenTUI React bootstrap pattern (`createCliRenderer` then `createRoot(renderer).render(...)`).

### Relevant Files
- `package.json` — new; declares scripts and pinned dependencies
- `tsconfig.json` — new; JSX config for `@opentui/react` (ADR-004)
- `bunfig.toml` — new; Bun/test configuration
- `src/index.ts` — new; runnable entry that boots the renderer
- `src/**/` — new; empty layer directories for later tasks

### Dependent Files
- Every subsequent task file under `src/**` — all build on this scaffold

### Related ADRs
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) — determines the JSX/tsconfig setup
- [ADR-006: Distribution as a Compiled Standalone Binary](adrs/adr-006.md) — build tooling must stay `bun build --compile` friendly

## Deliverables
- A Bun project that type-checks and runs the placeholder entry point
- Pinned dependency manifest and JSX-configured `tsconfig.json`
- Source directory skeleton for all layers
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that boots the entry module without a native crash **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Smoke: importing `src/index.ts` resolves without throwing
  - [x] Config: `tsconfig.json` sets `jsxImportSource` to `@opentui/react` (assert parsed value)
  - [x] Dependencies: `package.json` pins exact versions for OpenTUI and the ACP SDK (no `^`/`~` ranges)
- Integration tests:
  - [x] Entry point creates and then destroys a renderer in a non-TTY test mode without leaking the terminal
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `bun run` on the entry point renders the placeholder and exits cleanly on Ctrl+C
- The directory skeleton and pinned dependencies match the TechSpec
