---
status: completed
title: Normalize clarification forms, outcomes, and ACP translation
type: backend
complexity: high
---

# Task 01: Normalize clarification forms, outcomes, and ACP translation

## Overview

Extend Kitten’s protocol-free clarification contract so both native ACP elicitation and the new MCP bridge can represent form title/context, custom answers, and the four terminal outcomes. Preserve the existing ACP boundary by translating only forms and submitted answers that ACP can faithfully represent, and cancel unsupported shapes safely.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The protocol-free clarification payload MUST support optional form title/context, bounded choice metadata, and custom-answer capability without importing ACP or MCP types.
- 2. Terminal outcomes MUST distinguish submitted, skipped, timed_out, and cancelled, and submitted answers MUST preserve selected option IDs separately from custom text.
- 3. Native ACP translation MUST accept only normalized forms and submitted answers it can represent faithfully; unsupported fields or non-submitted outcomes MUST map to ACP cancellation.
- 4. Existing supported ACP elicitation behavior MUST remain valid after the richer model is introduced.
- 5. All compilation consumers of the retired `answered`/flat-values shape MUST be migrated to the equivalent submitted or cancelled behavior in this task; no compatibility variant may leave the core terminal vocabulary ambiguous.
</requirements>

## Subtasks

- [ ] 1.1 Define the protocol-free form and answer shapes required by the TechSpec Core Interfaces and Data Models sections.
- [ ] 1.2 Update native elicitation normalization to produce the shared form model or reject unsupported input.
- [ ] 1.3 Update native response translation to preserve valid submitted answers and fail closed for every other outcome.
- [ ] 1.4 Migrate existing controller, fake-agent, and UI call sites to the new closed outcome union without independently adding richer UI behavior.
- [ ] 1.5 Cover exhaustive outcome and invalid-shape behavior in colocated tests.

## Implementation Details

Modify the shared domain contract first, then adapt the ACP translation boundary to it. See the TechSpec “Core Interfaces” and “Data Models” sections; MCP-specific parsing and transport remain out of this task.

### Relevant Files
- `src/core/types.ts` — owns the protocol-free clarification payload, field, and outcome model.
- `src/core/types.test.ts` — validates domain invariants and exhaustiveness.
- `src/agent/acpTranslate.ts` — normalizes ACP elicitation and translates outcomes back to ACP.
- `src/agent/acpTranslate.test.ts` — covers accepted/rejected ACP form and response shapes.

### Dependent Files
- `src/agent/agentConnection.ts` — consumes the normalized clarification handler contract.
- `src/agent/agentConnection.test.ts` — proves a live adapter receives one normalized payload and response.
- `src/ui/ClarificationPrompt.tsx` — consumes the shared forms and requires mechanical outcome-union migration.
- `src/app/controller.ts` and `test/mockAgent.ts` — must be mechanically migrated wherever they construct or inspect the retired terminal contract.

### Related ADRs
- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — preserves a protocol-free core and fail-closed native path.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — defines the richer shared contract and terminal vocabulary.

## Deliverables

- Extended protocol-free clarification forms, answers, and terminal outcomes.
- Updated ACP normalization and response translation with safe unsupported-shape handling.
- Colocated domain and ACP translation tests with 80%+ coverage of changed behavior.
- Integration coverage through the adapter contract path.

## Tests

- Unit tests:
  - [ ] A submitted multi-field answer preserves option IDs and custom text separately.
  - [ ] A payload with title/context and custom-capable choices validates without protocol imports.
  - [ ] Duplicate IDs, invalid option values, and malformed native forms are rejected.
  - [ ] Skipped, timed_out, cancelled, custom-choice, duplicate-selection, unknown-selection, and missing-required outcomes map to safe ACP cancellation.
- Integration tests:
  - [ ] A supported native ACP elicitation round-trip still returns accepted content for a valid submitted answer.
  - [ ] An unsupported native form or richer unsupported answer never reaches the agent as fabricated content.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Core, UI, and transport layers can share one clarification model without ACP or MCP types leaking into `src/core/`.
- Native ACP remains fail-closed for unsupported semantics.
