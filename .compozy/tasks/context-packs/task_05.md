---
status: completed
title: Bounded workspace materialization and source fences
type: backend
complexity: high
---

# Task 05: Bounded workspace materialization and source fences

## Overview

Provide the controller-owned materializer that turns draft selection metadata into bounded file, slice, and diff artifacts only after workspace containment, identity, digest, and byte checks succeed.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Materialization MUST run outside core, UI, and child code and MUST accept only workspace-relative selection metadata.
- Full files, slices, and staged/unstaged diffs MUST enforce realpath containment, binary exclusion, source identity, SHA-256 digest, range, per-artifact, and total-byte bounds.
- Diff materialization MUST use a fixed host no-extension/no-color command and include only the addressed repository path.
- A changed, missing, escaped, binary, oversized, or malformed source MUST return a typed blocking or stale result without automatic rebasing.
- Materialized content MUST not enter persistence or telemetry.
</requirements>

## Subtasks

- [ ] 5.1 Define bounded artifact and source-fence inputs and outputs.
- [ ] 5.2 Materialize contained full files and validated line slices.
- [ ] 5.3 Materialize bounded staged and unstaged diffs with fixed command construction.
- [ ] 5.4 Verify digest and identity drift before returning artifacts.
- [ ] 5.5 Add containment, cap, command, and source-change coverage.

## Implementation Details

Follow the TechSpec materialization and source-fence rules. Reuse existing safe file-discovery containment and binary helpers rather than introducing a second path policy.

### Relevant Files

- src/app/contextPackMaterializer.ts — new bounded materialization boundary.
- src/app/contextPackMaterializer.test.ts — artifact and source-fence coverage.
- src/app/fileDiscovery.ts — reusable containment and binary helpers.
- src/app/fileDiscovery.test.ts — helper regression coverage.
- src/core/contextPack.ts — artifact/fence value contracts.
- src/core/types.ts — selection and typed denial contracts.
- src/core/secretRedactor.ts — later deterministic candidate-redaction seam.

### Dependent Files

- src/app/controller.ts — later review and sealing caller.
- src/app/contextPackBridge.ts — later bounded workspace-read caller.
- src/store/sessionReducer.ts — session workspace root source.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)

## Deliverables

- Controller-owned bounded materializer for full files, slices, and diffs.
- Source identity/digest fences and typed stale/blocked outcomes.
- Fixed safe diff invocation and no automatic refresh behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for a real temporary workspace with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Escaping paths and symlink escapes are rejected before any content read.
  - [ ] Binary, invalid range, and over-cap selections return typed denials.
  - [ ] A source digest or identity change marks material stale rather than rewriting selection metadata.
  - [ ] Staged and unstaged diff commands use fixed no-extension/no-color flags and a single addressed path.
  - [ ] Per-file and total byte limits are enforced deterministically.
- Integration tests:
  - [ ] A temporary workspace returns bounded full-file, slice, and diff artifacts only for contained paths.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only bounded, contained, identity-verified workspace material reaches candidate assembly.
- Changed sources remain visible as stale rather than being silently rebased.
