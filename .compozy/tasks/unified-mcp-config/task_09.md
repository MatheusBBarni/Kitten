---
status: completed
title: Setup documentation and example config
type: docs
complexity: low
dependencies:
  - task_01
---

# Task 09: Setup documentation and example config

## Overview
Document how to declare MCP servers in Kitten's config and provide a commented example, so a user can hand-author the `mcpServers` map with env-reference secrets and understand V1 scope.
Documentation is the authoring experience for V1 (there is no helper command), so it must be accurate and copy-pasteable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST document the `mcpServers` config block: name-keyed map, stdio fields (command, args, env), and `${VAR}` env references.
- MUST provide a copy-pasteable commented example with at least one realistic server using an env reference.
- MUST state V1 scope and behavior: stdio only (remote rejected at load), MCPs active in Kitten sessions (standalone deferred), and skip-with-warning on unresolved references.
- MUST explain where to view the loaded/skipped readout (selfcheck and the status strip).
- SHOULD note that a referenced variable must be set in the environment before launch.
</requirements>

## Subtasks
- [x] 09.1 Add an MCP section to the README Configuration docs.
- [x] 09.2 Provide a commented example `mcpServers` map with an env reference.
- [x] 09.3 Document V1 scope, failure behavior, and the readout location.

## Implementation Details
Update `README.md` (Configuration section).
Reference the PRD "User Experience" section and the config shape from the TechSpec "Data Models" section.
This is a documentation task; no product code changes.

### Relevant Files
- `README.md` — Configuration section, where the MCP block is documented.

### Dependent Files
- None.

### Related ADRs
- [ADR-002: V1 Product Scope](adrs/adr-002.md) — scope statements to document.
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) — env references and skip-with-warning behavior.

## Deliverables
- A README MCP configuration section with a commented example.
- A validation test confirming the documented example parses against the loader **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] The documented example config parses successfully through `loadAppConfig` (the example is valid against the schema).
  - [x] The documented remote-rejection claim matches behavior: the shown http example is rejected by the loader, consistent with task_01.
- Integration tests:
  - [x] The example config, when loaded, yields the documented server list, keeping docs and schema in sync.
- Test coverage target: >=80% (example-validation test)
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80% for any example-validation test
- Docs describe the map shape, env references, V1 scope, and the readout location
- The documented example config is valid against the loader
