---
status: completed
title: Envelope-only adapter bridge guidance
type: refactor
complexity: medium
---

# Task 03: Envelope-only adapter bridge guidance

## Overview

Remove the adapter's server-name-driven injection of bridge guidance so the adapter encodes only the envelope explicitly supplied by the controller. This makes the reviewed core catalog the single owner of optional V1 wording and prevents restored sessions from acquiring a new hidden instruction merely because a bridge server is attached.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST remove automatic bridge or `ask_user` guidance injection that is inferred from MCP server presence in the agent adapter.
- 2. MUST preserve the `HarnessPromptEnvelope`, exact certified-profile validation, provider-specific envelope encoding, and ordinary user-block mapping.
- 3. MUST preserve controller-owned MCP bridge provisioning, opaque bridge declaration handling, and the real `ask_user` and supervised `agent_run` tool registrations.
- 4. MUST ensure both new and loaded sessions receive optional guidance only when it is explicitly present in the caller-supplied harness envelope.
</requirements>

## Subtasks

- [ ] 3.1 Remove adapter state and helpers that infer host guidance from attached server names.
- [ ] 3.2 Retain exact-profile envelope encoding and ordinary prompt mapping without hidden prepended blocks.
- [ ] 3.3 Update new-session and loaded-session adapter expectations to reject implicit bridge wording.
- [ ] 3.4 Update focused prompt and handoff integration assertions for the envelope-only behavior.
- [ ] 3.5 Preserve bridge provisioning, tool registration, and existing redaction guarantees.

## Implementation Details

See TechSpec sections “Provider/Adapter Boundaries”, “Detailed Design”, and “Testing Strategy”. This refactor changes prompt guidance ownership only; it must not alter the bridge's registration, private endpoint/capability data, or MCP tool behavior.

### Relevant Files

- `src/agent/agentConnection.ts` — removes server-name-driven guidance while preserving explicit envelope encoding and certified-profile checks.
- `src/agent/agentConnection.test.ts` — replaces implicit-injection assertions with explicit-envelope and loaded-session coverage.
- `test/clarificationLifecycle.integration.test.tsx` — updates ordinary-prompt expectations that currently include implicit leading bridge guidance.
- `src/ui/HandoffPreview.test.tsx` — updates handoff payload expectations while retaining preview and redaction guarantees.

### Dependent Files

- `src/app/controller.ts` — remains the source of the explicit rendered harness envelope and bridge provisioning.
- `src/app/kittenMcpBridge.ts` — remains the private generation-bound MCP declaration owner.
- `src/agent/askUserMcp.ts` — retains the exposed structured interaction tool contract without becoming prompt-injection evidence.
- `src/index.ts` — retains normal MCP registration for `ask_user` and supervised `agent_run`.

### Related ADRs

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — prohibits optional claims inferred from incomplete evidence.
- [ADR-003: Compose Capabilities in Core and Make the Adapter Envelope-Only](adrs/adr-003.md) — makes the controller-supplied envelope the sole guidance source.

## Deliverables

- An envelope-only adapter with no server-name-driven bridge guidance injection.
- Updated adapter and focused integration tests for new and restored session behavior.
- Preserved exact-profile validation, MCP provisioning, tool availability, handoff preview, and redaction behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for explicit envelope and restored-session behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A fresh session with the bridge server attached and no harness envelope sends only its caller-supplied developer blocks.
  - [ ] A loaded session with the bridge server attached likewise receives no implicit host-guidance block.
  - [ ] An envelope without harness guidance preserves the exact ordinary ACP prompt mapping.
  - [ ] Every certified profile carries explicit harness text only in its provider-specific envelope field, while a nonmatching profile still fails before ACP dispatch.
- Integration tests:
  - [ ] Ordinary clarification-flow prompts contain no implicit leading bridge guidance while preserving their existing interaction behavior.
  - [ ] Handoff preview payload expectations remain redacted and confirmation-gated without an adapter-injected bridge block.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The adapter never derives optional guidance from MCP server presence.
- Bridge provisioning and exposed MCP-tool behavior are unchanged, while restored sessions acquire no new hidden instruction.

