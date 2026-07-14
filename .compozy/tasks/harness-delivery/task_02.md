---
status: pending
title: "Add Certified Runtime Profiles and Adapter Envelope"
type: refactor
complexity: high
---

# Task 02: Add Certified Runtime Profiles and Adapter Envelope

## Overview

Add the exact-profile certification gate and opaque adapter envelope that make hidden harness encoding possible only for verified recipes. The task certifies Claude Code, Codex, and Cursor through the same evidence model and leaves every unknown or changed provider unsupported by default.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add an exact, protocol-free profile registry for certified Claude Code, Codex, Cursor, and future provider entries; see TechSpec "Integration Points".
2. MUST default deny for unknown command, ordered arguments, environment, package or SDK version, incomplete evidence, or changed recipe identity.
3. MUST add an opaque `HarnessPromptEnvelope` at the agent boundary so visible `PromptBlock[]` remain distinct from optional harness content.
4. MUST preserve today's block-to-ACP mapping byte-for-byte when the envelope has no harness.
5. MUST reject unsupported or mismatched harness envelopes before ACP `prompt`; MUST NOT introduce a universal tagged composite fallback.
6. MUST add opt-in credentialed contract evidence for Claude Code, Codex, and Cursor using only synthetic content and fixed content-free results.
</requirements>

## Subtasks

- [ ] 2.1 Define certified profile identity and evidence rules.
- [ ] 2.2 Add default-deny capability resolution for future providers.
- [ ] 2.3 Add the opaque envelope at the agent boundary.
- [ ] 2.4 Apply only certified profile encodings to harness-bearing envelopes.
- [ ] 2.5 Preserve ordinary prompt behavior for envelopes without harnesses.
- [ ] 2.6 Add deterministic and opt-in credentialed profile evidence.

## Implementation Details

Follow TechSpec "Core Interfaces", "Integration Points", and "Testing Approach". Model the registry after the narrow existing clarification capability gate; keep all ACP types and provider-specific encoding inside `src/agent/` and do not expand controller, persistence, store, or UI scope in this task.

### Relevant Files

- `src/config/harnessCapability.ts` — new exact profile registry and default-deny decision.
- `src/config/harnessCapability.test.ts` — new evidence and mismatch coverage.
- `src/agent/agentConnection.ts` — converts opaque envelopes at the ACP-only boundary.
- `src/agent/agentConnection.test.ts` — verifies envelope-to-wire behavior through existing in-memory helpers.
- `test/harnessAdapter.contract.test.ts` — new opt-in Claude Code and Codex certification contract suite.
- `test/cursorAcp.contract.test.ts` — extends opt-in Cursor evidence for the envelope path.
- `test/mockAgent.ts` — raw `PromptRequest` observer for deterministic wire assertions.

### Dependent Files

- `src/config/clarificationCapability.ts` — design precedent only; clarification behavior must remain unchanged.
- `src/app/controller.ts` — task_03 consumes the pure profile decision before visible prompt recording.
- `src/app/harnessDelivery.ts` — task_01 supplies the fixed unsupported-profile failure category.
- `src/app/controller.test.ts` — task_03 asserts no ACP call on unsupported profile.

### Related ADRs

- [ADR-004: Gate harness encoding through exact certified runtime profiles](adrs/adr-004.md) — primary scope and evidence gate.
- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — visible-content isolation and fail-closed requirement.
- [ADR-003: Own delivery state by controller generation and persist only a content-free checkpoint](adrs/adr-003.md) — terminal prompt semantics.

## Deliverables

- Exact certified profile registry with future-provider default deny.
- Adapter envelope path that preserves ordinary raw prompt mapping without harnesses.
- Deterministic wire tests and opt-in credentialed contract suites for all three built-ins.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for certified, unsupported, and mismatched profiles **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Exact Claude Code, Codex, and Cursor fixtures resolve eligible only with complete matching evidence.
  - [ ] Unknown recipe, reordered arguments, wrong SDK version, missing evidence, partial evidence, and future provider resolve unsupported.
  - [ ] Envelope without harness preserves the current raw ACP prompt block mapping.
  - [ ] Each certified fixture selects only its profile encoder and never emits a generic tagged composite.
  - [ ] Unsupported or profile-mismatched envelope rejects before ACP prompt and leaves mock prompt capture empty.
- Integration tests:
  - [ ] Opt-in Claude Code, Codex, and Cursor contracts use synthetic values, dispose cleanly, and report only fixed profile/version/check outcomes.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Claude Code, Codex, Cursor, and future-provider entries share one exact evidence policy.
- No harness-bearing request reaches an unsupported profile or leaks through generic user text.
