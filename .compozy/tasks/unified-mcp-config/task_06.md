---
status: pending
title: Readout surfaces - selfcheck and status strip
type: frontend
complexity: medium
dependencies:
  - task_02
  - task_05
---

# Task 06: Readout surfaces - selfcheck and status strip

## Overview
Surface the per-agent loaded/skipped MCP readout in two places: `selfcheck` (an offline pre-flight computed from the resolver, so users can verify without opening the cockpit) and the running cockpit's status strip (from live `AgentRuntimeState`).
This delivers the visibility that keeps a silent no-op from going unnoticed.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render, in `selfcheck` output, each configured MCP server's status from the resolver result (loaded versus skipped-with-reason), without requiring a live agent session.
- MUST show a per-agent MCP indicator in the status strip sourced from `AgentRuntimeState.mcp`, including a warning affordance when any server was skipped.
- MUST never display secret values; show names and reasons only.
- MUST handle the empty `mcpServers` case cleanly in both surfaces (no crash, no misleading output).
- SHOULD follow the existing `StatusStrip` chip conventions and the `selfcheck` frame format.
</requirements>

## Subtasks
- [ ] 06.1 Compute and render the MCP readout in `runSelfCheck` using the resolver.
- [ ] 06.2 Add a per-agent MCP indicator and warning to the status strip from runtime state.
- [ ] 06.3 Show skipped-server names and reasons without any secret value.
- [ ] 06.4 Handle the empty-list case in both surfaces.

## Implementation Details
Modify `src/app/selfCheck.ts` (use the resolver; extend the `SelfCheckResult` frame) and `src/ui/StatusStrip.tsx` (and `AgentStatusChip`).
Data sources per the codebase: `controller.runtimes()[].mcp` for the strip; the resolver for the offline `selfcheck` readout.
See the TechSpec "System Architecture" (Readout surfaces).

### Relevant Files
- `src/app/selfCheck.ts` — `runSelfCheck`, `SelfCheckResult`; add the MCP readout.
- `src/ui/StatusStrip.tsx` — `AgentStatusChip` reads `AgentRuntimeState`; add the MCP indicator.
- `src/config/mcpResolver.ts` — resolver used for the offline `selfcheck` readout.
- `src/ui/StatusStrip.test.tsx` — existing strip tests to extend.

### Dependent Files
- None downstream.

### Related ADRs
- [ADR-002: V1 Product Scope](adrs/adr-002.md) — the loaded-servers readout.
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) — skipped reasons shown, warn never block.

## Deliverables
- `selfcheck` MCP readout and status-strip MCP indicator/warning.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration test of the `selfcheck` frame including MCP status lines **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `runSelfCheck` with a config of one resolvable and one unset-variable server renders the first as loaded and the second as skipped with its reason.
  - [ ] `runSelfCheck` with no `mcpServers` renders no MCP section (or an explicit "none") without error.
  - [ ] The status strip renders a warning indicator for an agent whose `AgentRuntimeState.mcp.skipped` is non-empty.
  - [ ] The status strip renders no MCP warning when `mcp.skipped` is empty.
  - [ ] No secret value from a server env appears in either rendered output.
- Integration tests:
  - [ ] The `selfcheck` frame end to end includes per-server MCP status lines for a given config.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Both surfaces show loaded and skipped servers
- No secret value is rendered
- Empty-list case handled cleanly
