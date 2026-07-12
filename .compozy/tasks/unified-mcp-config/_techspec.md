# TechSpec: Unified MCP Configuration for Kitten

## Executive Summary

Kitten provisions MCP servers into both agents by injecting them into each ACP `session/new` call, replacing the hardcoded empty `mcpServers: []` at the single existing call site.
A new SDK-free domain type carries each stdio server declaration; a name-keyed `mcpServers` map in the config file is normalized by the loader into one global list on `AppConfig`.
That list threads from `createCockpitSession` through the controller into a widened `AgentConnection.newSession`, and translation to the ACP `McpServer` wire shape (env as a name/value array, absolute command path) is confined to `acpTranslate.ts` so no SDK type crosses the anti-corruption boundary.
A per-agent readout of loaded and skipped servers hangs off the controller's boot-time `AgentRuntimeState` and renders in both `selfcheck` and the status strip.
Env values are `${VAR}` references resolved at boot; an unresolved reference skips that one server with a warning, while structural config mistakes fail loud at parse.
Release is gated on a real-subprocess smoke test that proves the pinned adapters honor injected servers.

**Primary technical trade-off:** injecting per session (rather than writing agent config files) keeps the change small, SDK-bounded, and file-safe, at the cost of MCP tools being available only inside Kitten sessions. Standalone use is deferred to V2 (ADR-001).

## System Architecture

### Component Overview

- **Config layer** (`src/core/types.ts`, `src/config/configLoader.ts`): adds the `McpServerConfig` domain type, a strict `mcpServers` schema, and map-to-list normalization onto `AppConfig`. Responsible for structural validation (stdio only) and failing loud on malformed entries.
- **Env-reference resolver** (new pure helper in `src/config`): expands `${VAR}` in server env values at boot against an injectable env map (default `process.env`); reports unresolved variables upward rather than throwing.
- **Agent adapter** (`src/agent/agentConnection.ts`, `src/agent/acpTranslate.ts`): widened `newSession`; a `toAcpMcpServers` translator mapping domain servers to the SDK `McpServer` union (env-as-array, absolute command) with a skip-and-warn when a command cannot be resolved. SDK types stay inside `src/agent`.
- **Controller** (`src/app/controller.ts`): threads the global list into `startSession`, resolves env and translates per session, and records a per-agent loaded/skipped result on `AgentRuntimeState`.
- **Readout surfaces** (`src/app/selfCheck.ts`, `src/ui/StatusStrip.tsx`): render the per-agent loaded/skipped set from `controller.runtimes()`.
- **Redaction** (`src/core/secretRedactor.ts`): every resolved MCP env value passes through the redactor before any log or telemetry emission.

**Data flow:** config file to `loadAppConfig` (parse, validate, normalize) to `AppConfig.mcpServers` to `createCockpitSession` to `controller.startSession`, which resolves `${VAR}` and translates to the ACP shape, then calls `newSession(cwd, servers)` which issues the ACP `session/new` with the server list; the boot result (loaded and skipped names) lands on `AgentRuntimeState` and surfaces in `selfcheck` and the status strip.

## Implementation Design

### Core Interfaces

The SDK-free domain type and the new global config field:

```ts
// src/core/types.ts
export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env: Record<string, string> // values may hold ${VAR} references, resolved at boot
}

export interface AppConfig {
  providers: Record<ProviderKind, ProviderRecipe>
  sessions: SessionDescriptor[]
  telemetryEnabled: boolean
  mcpServers: McpServerConfig[] // normalized from the name-keyed config map; global
}
```

The widened connection method and the SDK-bounded translator:

```ts
// src/agent/agentConnection.ts — signature widens from newSession(cwd)
newSession(cwd: string, mcpServers: McpServerConfig[]): Promise<string>

// src/agent/acpTranslate.ts — SDK McpServer type never leaves this file
export function toAcpMcpServers(servers: McpServerConfig[]): McpServer[]
```

The per-agent readout, added to the controller's ready boot state:

```ts
// src/app/controller.ts — the ready variant of AgentRuntimeState gains:
mcp: { loaded: string[]; skipped: { name: string; reason: string }[] }
```

### Data Models

- **Config file (name-keyed map):**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

- **Normalized domain:** `McpServerConfig[]`, with `name` lifted from each map key.
- **ACP wire (translator output):** `McpServerStdio { name, command (absolute), args, env: { name, value }[] }`.
- **Readout:** per-agent `{ loaded: string[]; skipped: { name, reason }[] }` on `AgentRuntimeState`.

### API Endpoints

Not applicable. Kitten is a terminal application with no HTTP surface. The only external request is the ACP `session/new`, covered under Integration Points.

## Integration Points

- **ACP adapters** (`@agentclientprotocol/claude-agent-acp@0.57.0`, `@agentclientprotocol/codex-acp@1.1.0`): servers are provisioned through `NewSessionRequest.mcpServers`.
- **Authentication:** Kitten owns no agent auth (the adapters do); MCP server secrets are supplied via `${VAR}` env references resolved from the user's environment.
- **Error handling:** an unsupported transport is rejected at config load; an unresolved env reference skips that server with a warning; a server the adapter fails to start surfaces in the readout. Startup is never blocked.
- **Retry:** none in V1; the next launch re-provisions from the current config.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/core/types.ts` | modified | Add `McpServerConfig` and `AppConfig.mcpServers`. Low risk. | Add types |
| `src/config/configLoader.ts` | modified | Strict `mcpServers` schema (stdio only), map-to-list normalization, default empty, merge. Low-medium. | Extend schema and merge |
| Env-reference resolver | new | Pure `${VAR}` expander, injectable env. Low. | New file + tests |
| `src/agent/acpTranslate.ts` | modified | `toAcpMcpServers` (env-as-array, absolute command). Low-medium. | Add translator |
| `src/agent/agentConnection.ts` | modified | Widen `newSession`, pass translated servers. Medium: signature ripples to fakes. | Widen and wire |
| `src/app/controller.ts` | modified | Thread list, resolve env, compute loaded/skipped, extend `AgentRuntimeState`. Medium. | Thread and record |
| `src/app/selfCheck.ts` | modified | Update `createOfflineConnection` fake signature; render readout. Low. | Update fake, render |
| `src/ui/StatusStrip.tsx` | modified | Per-agent MCP indicator/warning. Low. | Render |
| Test fakes (`StubConnection`, in-memory stubs) | modified | Update `newSession` signature. Low but broad. | Update fakes |
| `test:mcp-smoke` + fixture MCP server | new | Real-subprocess honor gate. Medium: adapter dependency. | New test + fixture |

## Testing Approach

### Unit Tests

- **Config:** name-keyed map parsing and normalization to a list, name uniqueness via the map, rejecting http/sse entries with a `ConfigError`, strict unknown-key rejection, default empty list, and merge behavior.
- **Env resolver:** `${VAR}` expansion, an unresolved variable reported (not thrown), multiple references in one value, and an injected env map.
- **Translator:** `McpServerConfig` to `McpServerStdio`, env map to name/value array, absolute-command resolution, and skip-and-warn when a command cannot be resolved.
- **Controller:** the global list reaches `newSession` (asserted via a `StubConnection` that captures its arguments), loaded/skipped is computed onto `AgentRuntimeState`, and a skipped server (unresolved var) does not block session start.
- **Redaction:** a known token value is redacted before any telemetry or log emission.
- **Mocks and boundaries:** `StubConnection` capturing `newSession` args, an injectable env map, and the in-process transport pair.

### Integration Tests

- **In-memory contract test:** drive a real `ClientSideConnection` over the in-process transport pair and assert the `mcpServers` array reaches the agent side with the correct shape (wiring, runs on every unit invocation).
- **Real-subprocess honor gate (`test:mcp-smoke`):** spawn each pinned adapter, inject a fixture stdio MCP server that exports one known tool, create a session, and assert the tool appears. Requires the adapters installed; runs under a dedicated script, not the default unit path. This is the release gate.

## Development Sequencing

### Build Order

1. Add `McpServerConfig` and `AppConfig.mcpServers` to `src/core/types.ts`. No dependencies.
2. Add the strict `mcpServers` schema, map-to-list normalization, default, and merge in `configLoader.ts`. Depends on step 1.
3. Add the pure `${VAR}` env-reference resolver. Depends on step 1.
4. Add `toAcpMcpServers` in `acpTranslate.ts`. Depends on step 1.
5. Widen `AgentConnection.newSession`, call the translator at the session-creation site, and update every fake implementation. Depends on steps 1 and 4.
6. Thread the global list into `controller.startSession`, resolve env, and record loaded/skipped onto `AgentRuntimeState`. Depends on steps 2, 3, and 5.
7. Render the readout in `selfCheck.ts` and `StatusStrip.tsx`. Depends on step 6.
8. Route resolved MCP env values through the secret redactor in the telemetry/log path. Depends on step 6.
9. Add the in-memory contract test. Depends on step 5.
10. Add the fixture stdio MCP server and the `test:mcp-smoke` real-subprocess honor gate. Depends on step 5.
11. Write the setup documentation and a commented example config. Depends on step 2.

### Technical Dependencies

- The pinned adapters must be installed in whatever environment runs the honor gate.
- A minimal fixture stdio MCP server is required for the gate.
- No infrastructure or external-service dependencies otherwise.

## Monitoring and Observability

- **Metrics:** per-agent counts of loaded versus skipped MCP servers at boot, and the added startup latency from provisioning.
- **Log and telemetry events** (content-free, honoring Kitten's local-only telemetry stance): declared-server count, per-agent loaded count, and per-agent skipped count tagged by reason category (`unresolved_env`, `unresolvable_command`, `unsupported_transport`). No secret values are ever emitted; all values pass the redactor.
- **Release signal:** the `test:mcp-smoke` result is the gate; there is no runtime alerting for a local CLI.

## Technical Considerations

### Key Decisions

- **Inject over ACP, not write to disk** (ADR-001): smallest, file-safe change; trade-off is in-Kitten-only scope.
- **SDK-free domain type plus translation confined to `src/agent`** (ADR-003): preserves the anti-corruption boundary; trade-off is a widened `newSession` that ripples to fakes.
- **Name-keyed config map, stdio only, http/sse rejected at load** (ADR-002, ADR-003): simple and familiar; trade-off is no remote transport in V1.
- **Split failure semantics: structural errors fail loud at parse, unresolved `${VAR}` skips and warns at boot** (ADR-004): honors warn-never-block for the real runtime failure; trade-off is two failure paths to test.
- **Real-subprocess honor gate under a dedicated tag** (ADR-005): the only test that catches a silent no-op; trade-off is an adapter dependency for that test.

### Known Risks

- **Adapter silent no-op.** Likelihood: unknown until measured. Mitigation: the honor gate blocks release; the readout names servers at runtime.
- **Signature ripple to fakes.** Likelihood: certain. Mitigation: the single `AgentConnection` contract surfaces every fake at compile time.
- **Startup latency.** Likelihood: low. Mitigation: measure against the <150ms target; provisioning is a per-session request, not a blocking probe.
- **Cross-platform command resolution.** Likelihood: low-medium. Mitigation: resolve via `Bun.which` with skip-and-warn; the honor gate exercises the real path.

## Architecture Decision Records

- [ADR-001: MCP Propagation Mechanism](adrs/adr-001.md) - inject over the ACP session, not writing agent config files.
- [ADR-002: V1 Product Scope](adrs/adr-002.md) - guarded parity with a single global MCP list.
- [ADR-003: MCP Server Domain Model and ACP Translation Boundary](adrs/adr-003.md) - SDK-free domain type, name-keyed config, translation confined to `src/agent`.
- [ADR-004: Environment-Reference Resolution and Failure Semantics](adrs/adr-004.md) - `${VAR}` resolved at boot; structural errors fail loud, unresolved vars skip and warn.
- [ADR-005: Adapter-Honor Smoke Test](adrs/adr-005.md) - a gated real-subprocess integration test proves the pinned adapters honor injected servers.
