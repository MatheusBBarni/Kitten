---
status: completed
title: Explore-v2 real-adapter certification
type: backend
complexity: high
---

# Task 15: Explore-v2 real-adapter certification

## Overview

Add one opt-in credentialed real-adapter contract suite that proves the exact Context Pack child capability against a pinned configured provider recipe. It is certification evidence, not a profile activation mechanism.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The contract suite MUST be skipped by default unless KITTEN_CREDENTIALED_CONTEXT_PACK_CONTRACT equals 1, and an absent credential MUST start no adapter transport.
- The suite MUST accept one exact built-in provider recipe at a time, defaulting to claude-code, and validate the resolved pinned npx command rather than a local dev binary.
- Real stdio/ACP must prove the exact Context Pack tools plus scoped ask_user, and generic rejection/absence of agent_run, shell, general Git, external MCP, cross-session routes, sealing, sending, export, and approval.
- The real child MUST complete one capped workspace read and revision-fenced parent-draft mutation while sibling state, sealed payload, and builder authority remain unchanged.
- Invalid provider input, wrong revision, escape/oversize mutations, unexpected adapter close, and teardown failures MUST fail the credentialed run.
- Passing evidence MUST NOT add or activate a production provider profile; authorization needs a later reviewed change tied to exact output and versions.
</requirements>

## Subtasks

- [x] 15.1 Add credential/env/provider gating and exact pinned-command validation.
- [x] 15.2 Launch one configured real adapter over stdio/ACP with the accepted bridge declaration.
- [x] 15.3 Assert the exact tools/list schema and rejection of every forbidden route.
- [x] 15.4 Complete one bounded read and revision-fenced parent-only mutation.
- [x] 15.5 Enforce per-round and total deadlines, cleanup, and default-skip behavior.

## Implementation Details

Model the opt-in suite on the existing clarification adapter contract test. Use the real adapter transport and Context Pack bridge from earlier work; retain a 120-second per-round and 300-second total deadline. The suite must document its explicit invocation in its test header but must not alter CI/default suite behavior.

### Relevant Files

- test/contextPackAdapter.contract.test.ts — new opt-in real adapter certification suite.

### Dependent Files

- src/config/contextPackCapability.ts — closed explore-v2 recipe/evidence resolver.
- src/app/contextPackBridge.ts — generation-bound bridge under test.
- src/agent/contextPackMcp.ts — exact dedicated tool registrar.
- src/app/controller.ts — accepted Context Build and cleanup lifecycle.
- src/agent/transport.ts — real spawned adapter seam.
- test/clarificationAdapter.contract.test.ts — established credentialed contract pattern.

### Related ADRs

- [ADR-004: Use a separate generation-bound Context Pack bridge for explore-v2](adrs/adr-004.md)
- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md)

## Deliverables

- One default-skipped opt-in real-adapter certification suite.
- Exact recipe, tool-list, bounded mutation, negative-authority, deadline, and cleanup evidence.
- No profile promotion, telemetry change, CI activation, or default-suite dependency.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for a credentialed real adapter path with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Without the opt-in environment variable, the suite registers skipped and starts no transport.
  - [x] Invalid provider input rejects before spawn, and the resolved command is the exact pinned configured npx package/version.
  - [x] Per-round and total deadline failures surface as certification failures.
- Integration tests:
  - [x] tools/list exposes only scoped ask_user plus the three Context Pack tools, and all forbidden tool/route attempts fail generically.
  - [x] A real authenticated child reads bounded workspace data and makes one expected-revision parent mutation; sibling drafts, sealed payload, and builder authority remain unchanged.
  - [x] Wrong revision, out-of-workspace/oversize input, unexpected close, and teardown leave no active bridge route.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A real configured adapter can independently prove the closed explore-v2 contract when explicitly credentialed.
- Certification evidence cannot silently broaden production provider availability.
