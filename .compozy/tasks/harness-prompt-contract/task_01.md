---
status: pending
title: "Add deterministic V1 harness prompt renderer"
type: backend
complexity: medium
---

# Task 01: Add deterministic V1 harness prompt renderer

## Overview

Create Kitten's sole V1 harness-prompt domain contract and its complete evidence suite as one pure-core change. This task makes the base contract reviewable, deterministic, bounded, and explicit about unsupported input without delivering any prompt to an agent or changing user-visible behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add the protocol-free V1 harness contract described in TechSpec "Core Interfaces" and return only the typed rendered or rejected outcomes defined there.
2. MUST render the reviewed V1 base in its exact canonical envelope with LF-only whitespace, no trailing newline, a deterministic whitespace-token count of at most 150, and no fallback for unsupported versions.
3. MUST accept only valid static optional blocks, reject malformed, reserved, duplicate, over-count, over-budget, empty, control-bearing, or bidi-bearing input with the fixed rejection code from TechSpec "Data Models", and preserve caller input.
4. MUST render valid optional blocks after the base in lexical stable-ID order, escape delimiter-relevant text, and enforce the eight-block and 800-token extension bounds from TechSpec "Implementation Design".
5. MUST keep the production module free of ACP SDK, adapter, I/O, runtime, React, telemetry, configuration, persistence, controller, and UI dependencies; no existing transport or transcript path may change.
6. SHOULD keep V1's optional-block list empty in production while exposing the caller-supplied static-block seam for the later #20 capability card.
</requirements>

## Subtasks

- [ ] 1.1 Add the reviewed V1 contract constants, domain types, and fixed result-code vocabulary.
- [ ] 1.2 Define the canonical base rendering, version recognition, and deterministic size accounting.
- [ ] 1.3 Validate optional block identifiers, text, duplicate behavior, and configured limits.
- [ ] 1.4 Render escaped optional blocks in canonical order without mutating caller-owned values.
- [ ] 1.5 Add exact, semantic, negative, boundary, determinism, and source-boundary coverage.
- [ ] 1.6 Run the focused suite and the full typecheck/test regression gate.

## Implementation Details

Create the two colocated core files identified in TechSpec "System Architecture". Follow the strict unknown-input and discriminated-result conventions in TechSpec "Core Interfaces"; do not copy the interface definitions into this task or introduce an adapter-facing representation. Keep delivery, capability selection, diagnostics emission, and all session behavior out of scope.

### Relevant Files

- `src/core/harnessPrompt.ts` — new pure V1 contract, renderer, validation, limits, ordering, and escaping surface.
- `src/core/harnessPrompt.test.ts` — new colocated Bun test suite for the full contract boundary.
- `src/core/statusline.ts` — reference for strict unknown-input validation, printable/control checks, duplicate rejection, and discriminated results.
- `src/core/statusline.test.ts` — reference for table-driven negative and boundary cases in a pure-core suite.
- `src/core/bundleAssembler.ts` — reference for deterministic, bounded, non-mutating core behavior.
- `src/core/bundleAssembler.test.ts` — reference for direct pure-domain testing and stable output assertions.
- `.claude/rules/layering.md` — mandatory core purity and ACP-boundary rule.
- `.claude/rules/testing.md` — repository test and verification conventions.

### Dependent Files

- `src/agent/agentConnection.ts` — remains unchanged; it is the future #19 ACP consumer boundary and MUST NOT be imported by this task.
- `src/app/actions.ts` — remains unchanged; visible prompt recording and transport routing stay out of scope.
- `package.json` — remains unchanged; existing Bun typecheck and test scripts are the regression gate.

### Related ADRs

- [ADR-001: Keep the Harness Contract Static, Deterministic, and Narrowly Extensible](adrs/adr-001.md) — static base, bounded seam, and fail-closed requirements.
- [ADR-002: Release the Harness Contract as a Reviewer-First Foundation](adrs/adr-002.md) — reviewer-visible behavior and explicit unsupported-version outcome.
- [ADR-003: Use a Pure TypeScript Renderer with Caller-Supplied Static Blocks](adrs/adr-003.md) — module ownership, typed outcomes, caller-supplied blocks, and no-storage boundary.

## Deliverables

- `src/core/harnessPrompt.ts` containing the V1 contract, validated static-block seam, canonical rendering, and typed rejection outcomes.
- `src/core/harnessPrompt.test.ts` covering exact output, semantic truth, invalid input, bounds, escaping, determinism, immutability, and source purity.
- No modifications to ACP adapter, app/controller, configuration, persistence, telemetry, or UI files.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration regression coverage through the repository typecheck/test gate **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] V1 with no optional blocks returns the exact base envelope, mandated host/precedence/verification/host-control/exposed-capability statements, LF-only whitespace, and no trailing newline.
  - [ ] The base remains at or below 150 deterministic whitespace tokens and excludes provider names, user-content placeholders, authorization claims, and security-guarantee language.
  - [ ] Unknown, blank, and malformed requested versions return only `rejected` with `unsupported_version` and retain the requested version rather than rendering a fallback.
  - [ ] Valid lowercase dot-separated block IDs are accepted; empty, uppercase, malformed, reserved `base.*`, and duplicate IDs return their documented fixed codes.
  - [ ] Eight blocks and exactly 800 extension whitespace tokens succeed; nine blocks and 801 tokens return `block_limit_exceeded` and `extension_budget_exceeded` respectively.
  - [ ] Empty-after-trim text, CR, tabs, C0 controls, and bidi characters are rejected; valid internal LF is preserved after outer-whitespace normalization.
  - [ ] Fragment text escapes `&`, `<`, and `>`; the base remains verbatim; fragments use fixed delimiters and two-LF separation.
  - [ ] Reversed valid inputs yield identical text and lexically ordered block IDs; frozen input arrays and blocks remain unchanged.
  - [ ] Source inspection rejects ACP SDK, adapter, `Bun`, `process`, timer, React, recorder, and telemetry imports in the production module.
- Integration tests:
  - [ ] `bun run typecheck && bun test` passes with the new core module and suite while `src/agent/agentConnection.ts` and `src/app/actions.ts` remain unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The exact V1 base-only rendering is stable, reviewable, and never silently substituted for an unsupported version.
- Every invalid optional-block condition has a fixed typed rejection outcome and valid blocks render deterministically without mutating input.
- The production module remains protocol-free and no #19/#20 lifecycle, capability, transcript, configuration, persistence, telemetry, or UI behavior is introduced.
