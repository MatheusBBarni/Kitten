---
status: pending
title: MCP provisioning resolver - env references and command resolution
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 02: MCP provisioning resolver - env references and command resolution

## Overview
Add a pure, boot-time resolver that expands `${VAR}` environment references in each MCP server's env and resolves its command to an absolute path, partitioning servers into those ready to provision and those skipped with a reason.
Centralizing both resolutions here gives a single, testable source for the loaded/skipped readout and for the warn-never-block behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement a pure function taking `McpServerConfig[]` plus an injectable env map (default `process.env`) and returning `{ resolved: McpServerConfig[]; skipped: { name: string; reason: string }[] }`.
- MUST expand `${VAR}` references in each server's env values against the provided env map.
- MUST place a server in `skipped` (reason names the missing variable) when a referenced variable is absent, and MUST NOT throw for this case (warn-never-block per ADR-004).
- MUST resolve each server's command to an absolute path via an injectable resolver defaulting to `Bun.which`, and place a server in `skipped` with a command-not-found reason when resolution fails.
- MUST NOT import the ACP SDK; this is a pure domain/config helper.
- SHOULD emit resolved servers with absolute commands and fully expanded env so the translator (task_03) is a pure mapping.
</requirements>

## Subtasks
- [ ] 02.1 Expand `${VAR}` references over env values using the injectable env map.
- [ ] 02.2 Resolve each command to an absolute path via the injectable command resolver.
- [ ] 02.3 Partition servers into `resolved` and `skipped` with structured reasons.
- [ ] 02.4 Guarantee no throw on runtime-resolution failures (missing var, missing command).

## Implementation Details
Add a new pure module in `src/config` (for example `mcpResolver.ts`) plus its test.
It consumes `McpServerConfig` from task_01. See the TechSpec "System Architecture" (Env-reference resolver) and ADR-004 for the failure stance.
Mirror the injectable-seam pattern used by `ReadinessOptions` (`binaryExists` defaulting to `Bun.which`) and `LoadAppConfigOptions` (`env`).

### Relevant Files
- `src/config/configLoader.ts` — `McpServerConfig` import and the `ConfigError` style and module location.
- `src/config/readiness.ts` — example injectable-seam options (`createConnection`, `binaryExists` default `Bun.which`).
- `src/core/secretRedactor.ts` — resolved env values are secret-bearing (consumed by task_07).

### Dependent Files
- `src/app/controller.ts` — calls the resolver at boot (task_05).
- `src/app/selfCheck.ts` — uses the resolver for the offline readout (task_06).

### Related ADRs
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) — the resolution and skip-with-reason behavior.
- [ADR-002: V1 Product Scope](adrs/adr-002.md) — one global list resolved once.

## Deliverables
- A pure resolver returning `{ resolved, skipped }` with structured skip reasons.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Injectable seams for env map and command resolver enabling deterministic tests **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] A server with env `{ TOKEN: "${GH}" }` and env map `{ GH: "abc" }` resolves to `{ TOKEN: "abc" }` and appears in `resolved`.
  - [ ] A server referencing `${MISSING}` (absent from the env map) appears in `skipped` with a reason naming MISSING, and no error is thrown.
  - [ ] A value `"${A}/${B}"` expands both references.
  - [ ] A server whose command resolves via the injected resolver carries an absolute command in `resolved`.
  - [ ] A server whose command cannot be resolved appears in `skipped` with a command-not-found reason.
  - [ ] Mixed input (one resolvable, one unresolved-var) yields exactly one `resolved` and one `skipped`.
- Integration tests:
  - [ ] With an injected env map and command resolver, a two-server list produces the expected `resolved`/`skipped` partition end to end.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No throw on an unresolved variable or unresolvable command
- Resolved servers carry absolute commands and expanded env
- Module imports no ACP SDK type
