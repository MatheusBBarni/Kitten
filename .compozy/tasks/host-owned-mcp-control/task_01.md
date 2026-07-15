---
status: pending
title: Compose the bundled Kitten MCP child server
type: backend
complexity: medium
---

# Task 01: Compose the bundled Kitten MCP child server

## Overview

Create a reusable Kitten-owned MCP child-server composition point while preserving the existing `ask_user` tool and reserved child-mode behavior. This gives later work one protocol-only stdio host for multiple bundled tools without changing normal Kitten startup.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The bundled child server MUST keep `ask_user` available with its existing strict public contract and exports.
- 2. The reserved `--ask-user-mcp` behavior MUST dispatch before normal repository, readiness, and TUI boot paths.
- 3. MCP stdout MUST remain protocol-only; child-mode failures MUST use the existing generic failure discipline.
- 4. The composition point MUST remain in `src/agent/` and MUST NOT import controller, store, session identity, or capability-routing code.
</requirements>

## Subtasks

- [ ] 1.1 Establish a bundled MCP server composition point for tool registrars.
- [ ] 1.2 Preserve the standalone `ask_user` registrar and compatibility wrapper behavior.
- [ ] 1.3 Route the existing reserved child flag through the generalized child runner.
- [ ] 1.4 Prove child transport close behavior and normal boot isolation.

## Implementation Details

Follow the TechSpec “System Architecture,” “Integration Points,” and first Build Order item. Keep the existing public child-mode symbols stable while extracting composition; the second bundled tool is intentionally outside this task.

### Relevant Files
- `src/agent/kittenMcp.ts` — new MCP stdio-server composition and transport lifecycle seam.
- `src/agent/askUserMcp.ts` — existing strict `ask_user` schema, registrar, and compatibility exports.
- `src/agent/askUserMcp.test.ts` — regression coverage for the preserved standalone contract.
- `src/agent/kittenMcp.test.ts` — new in-memory composition and close-lifecycle coverage.
- `src/index.ts` — early reserved-mode dispatch before normal application boot.
- `test/firstRunBoot.test.ts` — regression coverage for the regular boot path.

### Dependent Files
- `src/app/askUserBridge.ts` — currently consumes legacy child-mode constants and remains compatible during this task.
- `src/app/controller.ts` — continues to generate the existing declaration and lifecycle wiring unchanged.
- `test/askUserMcp.integration.test.ts` — retains the existing one-tool same-binary assertion until later integration expansion.

### Related ADRs
- [ADR-003: Extend the authenticated Kitten MCP bridge with atomic bounded agent control](adrs/adr-003.md) — establishes one bundled generated server.

## Deliverables

- A new bundled MCP composition module with preserved `ask_user` behavior.
- Compatible early child-mode dispatch with no normal-boot regression.
- Colocated unit tests and boot regression tests with 80%+ coverage.
- Integration compatibility evidence for the existing child mode.

## Tests

- Unit tests:
  - [ ] An in-memory bundled server lists the existing `ask_user` tool with its unchanged name and schema behavior.
  - [ ] Closing the child transport settles the generalized runner without emitting non-protocol stdout.
  - [ ] The compatibility wrapper still creates a server exposing only `ask_user` before the second tool is registered.
- Integration tests:
  - [ ] Running with `--ask-user-mcp` enters the child path before the repository and readiness gates.
  - [ ] Running without the reserved flag keeps the normal first-run boot behavior unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The project has one reusable bundled child-server seam with no change to the visible `ask_user` contract.
- The normal Kitten executable remains side-effect-free on import and unchanged without the explicit child flag.
