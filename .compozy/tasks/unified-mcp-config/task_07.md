---
status: completed
title: Redact MCP secrets in telemetry and logs
type: backend
complexity: low
dependencies:
    - task_05
---

# Task 07: Redact MCP secrets in telemetry and logs

## Overview
Ensure any MCP-related value that could reach logs, telemetry, or error messages passes through the existing secret redactor, so tokens supplied via server env never leak.
Telemetry stays content-free counters; this task hardens the emission points introduced by MCP provisioning against accidental secret exposure.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST route any MCP env value that could appear in a log, telemetry event, or error message through `createSecretRedactor().redact` before emission.
- MUST keep MCP telemetry content-free: counts and reason categories only, never server env values or secret content.
- MUST redact secret-shaped values in any warning or error that names a skipped server.
- SHOULD reuse `defaultSecretPatterns` (the `credential_assignment` and `http_auth_header` patterns).
</requirements>

## Subtasks
- [ ] 07.1 Identify the MCP emission points (controller warnings, telemetry events, errors).
- [ ] 07.2 Apply the redactor to any value that may carry a secret before emission.
- [ ] 07.3 Confirm MCP telemetry emits only counts and reason categories.

## Implementation Details
Touch the MCP emission points introduced by task_05 (controller warnings and skip reasons) and the telemetry path.
Use `src/core/secretRedactor.ts`. See the TechSpec "Monitoring and Observability" section and ADR-004.

### Relevant Files
- `src/core/secretRedactor.ts` — `createSecretRedactor` / `redact` API and `defaultSecretPatterns`.
- `src/telemetry/recorder.ts` — telemetry emission (content-free counters).
- `src/app/controller.ts` — where MCP warnings and skip reasons are emitted.

### Dependent Files
- None.

### Related ADRs
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) — redaction requirement for MCP values.

## Deliverables
- Redaction applied at every MCP emission point.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration test proving no cleartext secret reaches emitted output **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A skip warning whose server env contained a token-shaped value emits that value redacted (`[REDACTED]`) rather than in cleartext.
  - [ ] An MCP telemetry event contains only counts and a reason category, with no env value string.
  - [ ] A server name and a benign reason ("unresolved environment variable: X") pass through unredacted.
- Integration tests:
  - [ ] Provisioning a server carrying a secret env value produces no cleartext secret in any emitted telemetry or log line.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No secret appears in any MCP log or telemetry output
- MCP telemetry remains content-free counters
