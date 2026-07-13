---
status: completed
title: MCP config - domain type, schema, and normalization
type: backend
complexity: medium
dependencies: []
---

# Task 01: MCP config - domain type, schema, and normalization

## Overview
Introduce the SDK-free MCP server domain type and a global `mcpServers` config field, with strict validation and normalization from the name-keyed config map into a domain list.
This is the foundation every other MCP task builds on, and it enforces the stdio-only V1 boundary at config load.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an `McpServerConfig` domain type in `src/core/types.ts` with fields name, command, args, and env (Record<string,string>), importing nothing from the ACP SDK.
- MUST add `mcpServers: McpServerConfig[]` to `AppConfig`, defaulting to an empty list in `defaultAppConfig()`.
- MUST accept `mcpServers` in the config file as a name-keyed object validated with a strict schema in `USER_CONFIG_SCHEMA`, and normalize it into the domain list with the name lifted from each key.
- MUST reject any entry declaring a remote transport (a `url` field or a non-stdio `type`) by throwing `ConfigError` naming the offending server, per the stdio-only V1 scope.
- MUST merge `mcpServers` in `mergeAppConfig()` and copy it defensively in `defaultAppConfig()`, consistent with the existing per-field merge approach.
- SHOULD follow the existing `ConfigError` message convention that names the offending field or key.
</requirements>

## Subtasks
- [x] 01.1 Define `McpServerConfig` in `types.ts` and add the `mcpServers` field to `AppConfig`.
- [x] 01.2 Add a strict, stdio-only `mcpServers` map schema to `USER_CONFIG_SCHEMA`.
- [x] 01.3 Normalize the name-keyed map into `McpServerConfig[]` with the name from each key.
- [x] 01.4 Default to an empty list and merge in `defaultAppConfig()` / `mergeAppConfig()`.
- [x] 01.5 Reject remote-transport entries with a descriptive `ConfigError`.

## Implementation Details
Modify `src/core/types.ts` (add the type and the `AppConfig` field) and `src/config/configLoader.ts` (schema, normalization, default, merge).
See the TechSpec "Data Models" section for the config-file shape and normalized domain shape, and "Core Interfaces" for `McpServerConfig`.
Follow the existing strict-schema and `ConfigError` conventions in `configLoader.ts`.

### Relevant Files
- `src/core/types.ts` — home of `AppConfig` and domain types; add `McpServerConfig` and the field.
- `src/config/configLoader.ts` — `USER_CONFIG_SCHEMA`, `defaultAppConfig`, `mergeAppConfig`, `parseAppConfig`; add schema, normalization, default, merge.
- `src/config/configLoader.test.ts` — existing config tests to extend with MCP cases.

### Dependent Files
- `src/app/controller.ts` — will read `AppConfig.mcpServers` in task_05.
- `src/config/mcpResolver.ts` — new resolver (task_02) consumes `McpServerConfig`.

### Related ADRs
- [ADR-002: V1 Product Scope](adrs/adr-002.md) — single global list.
- [ADR-003: MCP Server Domain Model and ACP Translation Boundary](adrs/adr-003.md) — SDK-free type, name-keyed map, stdio only.

## Deliverables
- `McpServerConfig` type and `AppConfig.mcpServers` field.
- Strict name-keyed schema with stdio-only validation and map-to-list normalization.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration coverage of the parse-and-normalize path via `loadAppConfig` against a temp file **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Parsing a config with two named stdio servers yields a two-element `mcpServers` list with names lifted from the keys ("github", "linear").
  - [x] An entry containing a `url` field (remote) throws `ConfigError` naming that server.
  - [x] An unknown key inside a server entry is rejected by the strict schema with `ConfigError`.
  - [x] A config omitting `mcpServers` yields an empty list (default).
  - [x] `mergeAppConfig` keeps the user-provided `mcpServers` over the empty default.
- Integration tests:
  - [x] `loadAppConfig` against a temp file with a name-keyed `mcpServers` map returns the normalized list.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `McpServerConfig` exported and free of any ACP SDK import
- Remote-transport entries rejected at load with a named `ConfigError`
- Name-keyed map normalized to a domain list on `AppConfig`
