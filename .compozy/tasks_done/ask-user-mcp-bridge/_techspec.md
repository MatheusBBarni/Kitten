# TechSpec: Provider-Independent `ask_user` MCP Bridge

## Executive Summary

This specification implements the PRD’s consequential-decision workflow as a Kitten-owned local MCP bridge. A controller-owned application service registers one authenticated route for each live session generation, injects a generated stdio MCP server declaration after the user’s resolved servers, and sends normalized forms through the existing clarification coordinator. The same Kitten binary runs the provider-facing MCP child mode; it uses `@modelcontextprotocol/sdk` 1.29.0 and stdio while private local IPC connects it back to the owning cockpit session.

The primary trade-off is additional parent/child IPC lifecycle code in exchange for a provider-neutral request path that preserves Kitten’s session, generation, and modal-queue invariants. V1 deliberately guarantees at most one accepted outcome only while the parent session generation is live. It does not add durable persistence, restart replay, remote delivery, or a generic MCP-hosting platform.

## System Architecture

### Component Overview

| Component | Location | Responsibility | Boundary |
| --- | --- | --- | --- |
| `AskUserBridge` | `src/app/askUserBridge.ts` | Registers routes, owns private endpoints/capabilities, normalizes IPC calls, and delegates to the controller clarification entrypoint. | App lifecycle only; no MCP wire types. |
| Controller integration | `src/app/controller.ts` | Creates/removes one bridge registration per session generation, composes generated and user MCP declarations, and routes all terminal lifecycle events into the bridge/coordinator. | Sole owner of session ID and generation. |
| MCP child mode | `src/agent/askUserMcp.ts` | Runs same-binary `--ask-user-mcp` mode, validates MCP input with Zod, performs authenticated IPC, and serializes tool results. | MCP SDK and IPC wire only. |
| Protocol-free clarification model | `src/core/types.ts` | Represents form title/context, bounded fields, structured answers, and terminal outcomes. | No MCP, ACP, I/O, or React imports. |
| Clarification coordinator and UI | `src/app/controller.ts`, `src/ui/ClarificationPrompt.tsx` | Queues/preempts forms, enforces exact live-generation settlement, renders fields, and returns the captured outcome. | Receives only normalized core types. |
| ACP translator | `src/agent/acpTranslate.ts` | Keeps verified native elicitation as a separate ingress/egress path and maps normalized submitted answers back to ACP when supported. | ACP types remain in `src/agent/`. |
| Telemetry recorder | `src/telemetry/recorder.ts` | Records expanded fixed outcome enum and duration bucket without request, route, or content data. | Local, opt-in, content-free. |

### Data and Control Flow

```text
agent provider
  -> stdio MCP `ask_user` child
  -> authenticated local socket / named pipe
  -> AskUserBridge route (SessionId + generation derived from capability)
  -> controller clarification coordinator
  -> existing ClarificationPrompt
  -> exact terminal outcome
  -> AskUserBridge
  -> MCP child structured result
  -> same provider turn continues
```

1. Before ACP opens or restores a session, the controller creates a bridge registration for its next generation.
2. The registration creates a private endpoint and a random capability, then contributes one generated `McpServerConfig` after the user-resolved list without reordering user entries.
3. ACP starts the provider session with that per-session list. The generated server runs the same executable with `--ask-user-mcp` and receives endpoint/capability only through its generated environment.
4. The child accepts an MCP `tools/call` for `ask_user`, validates and bounds the request, and forwards it through IPC with the capability. It never accepts a caller-supplied Kitten session ID.
5. `AskUserBridge` resolves the capability to the registered live generation, converts the form to a protocol-free payload, and delegates it to the controller’s coordinator-backed clarification entrypoint.
6. The existing UI displays the form. Submission, skip, timeout, cancellation, or session loss settles the captured coordinator request once.
7. The bridge serializes the outcome to the child. The child returns the MCP tool result and then waits for another call or process shutdown.

## Implementation Design

### Core Interfaces

The production implementation uses TypeScript. The following Go-shaped contract is included as the language-neutral primary dependency surface required by this workflow; the TypeScript interface immediately below is the source implementation contract.

```go
type AskUserRoute struct {
    Capability string
    SessionID string
    Generation uint64
}

type AskUserBridge interface {
    Register(route AskUserRoute) error
    Ask(route AskUserRoute, form AskUserForm) (AskUserOutcome, error)
    Cancel(sessionID string, generation uint64, reason string)
}
```

```ts
export interface AskUserBridge {
  register(input: BridgeRegistration): GeneratedMcpServer
  ask(capability: string, form: AskUserForm): Promise<AskUserOutcome>
  cancelSession(sessionId: SessionId, generation: number, reason: ClarificationSessionLossReason): void
  dispose(): Promise<void>
}

export interface ClarificationRequestHandle {
  requestId: string
  outcome: Promise<AskUserOutcome>
  timeout(): boolean
}
```

`createInteractionCoordinator` gains a request-handle entrypoint for clarifications. It exposes the generated request ID and permits a timeout to settle the same active or suspended request without accepting an arbitrary UI identity. Existing ACP clarification registration uses the same normalized path.

### Data Models

```ts
export interface AskUserForm {
  title?: string
  context?: string
  fields: readonly AskUserField[] // 1..10
}
export interface AskUserField {
  id: string; header?: string; question: string; context?: string
  options: readonly { id: string; label: string; description?: string }[] // <=20
  allowsMultiple: boolean; allowsCustom: boolean
}
export type AskUserOutcome =
  | { kind: "submitted"; answers: Record<string, ClarificationAnswer> }
  | { kind: "skipped" } | { kind: "timed_out" } | { kind: "cancelled" }
```

`ClarificationPayload` gains optional form `title` and `context`. Choice fields gain `allowsCustom`; text-only fields remain the no-options form. `ClarificationAnswer` preserves `selectedOptionIds` and optional `customText`, rather than flattening selections into ambiguous strings. Native ACP translation converts only the normalized subset it can faithfully represent; unsupported or invalid native results cancel safely.

The MCP request schema is intentionally narrow:

| Field | Constraints |
| --- | --- |
| `title`, `context` | Optional strings, bounded to 4 KiB each. |
| `fields` | Required array of 1–10 fields. |
| Field `id`, `question` | Required non-empty strings; IDs unique within the form. |
| Field `header`, `context` | Optional strings, each bounded to 4 KiB. |
| `options` | Optional 0–20 unique stable-ID options with bounded label/description. |
| `allows_multiple`, `allows_custom` | Optional booleans; each field must have options or allow custom input. |
| Timeout | Not accepted from MCP; Kitten uses its fixed configured 300-second default. |

The MCP response is a structured JSON text result with `outcome` (`submitted`, `skipped`, `timed_out`, or `cancelled`) and an `answers` object only for submitted forms. Each answer contains `selected_option_ids`, `custom_text`, and normalized ordered values. Schema or authorization failures return an MCP error result with no private route details.

### API Endpoints

There are no HTTP endpoints. The external surface is one local stdio MCP tool:

| MCP method | Tool | Request | Response |
| --- | --- | --- | --- |
| `tools/call` | `ask_user` | Bounded `AskUserForm`; no session identity and no caller timeout. | Structured terminal outcome and submitted answers when applicable. |

The internal IPC protocol is JSONL over one authenticated local stream. Its envelope contains `kind`, opaque `callId`, and capability. The parent maps the capability to session ownership; `callId` only correlates a child request/response and never enters telemetry. Frames over 64 KiB, unknown methods, malformed JSON, duplicate `callId`, invalid capabilities, and stale routes fail closed.

## Integration Points

### ACP session provisioning

`src/app/controller.ts` replaces its single shared MCP array at session-open time with `mcpServersFor(runtime)`: the resolved user list in original order followed by the generated reserved bridge entry. This composition runs for fresh sessions, restored sessions, and dynamically created conversations. Failure to create the bridge registration marks only that session unavailable; it does not alter user MCP declarations or other sessions.

### Executable mode and MCP SDK

`src/index.ts` recognizes `--ask-user-mcp` before normal repository/readiness/UI boot. That branch invokes `runAskUserMcp(process.env)` from `src/agent/askUserMcp.ts` and exits when stdio closes. Add `@modelcontextprotocol/sdk` at exact version `1.29.0` as a direct dependency. The MCP child creates `McpServer`, registers `ask_user` with Zod input validation, and connects `StdioServerTransport`; stdout remains protocol-only.

### Local IPC and lifecycle

Use a per-registration Unix-domain socket in a mode-0700 temporary directory on POSIX and a unique named pipe on Windows. Pass endpoint and capability only through the generated MCP server environment. The bridge accepts one bounded request stream per generated child and removes the registration after session replacement, failure, close, or disposal. Endpoint teardown cancels all associated coordinator requests with the existing loss reason; late child traffic receives a generic cancelled/unavailable result and cannot revive a route.

### RepoPrompt CE reference boundary

Adopt only the reusable ideas from `MCPAskUserToolProvider.swift`: schema validation before UI routing, connection-derived ownership, whole-form timeout, and structured outcome serialization. Do not port its window/tab singleton assumptions, Objective-C/Swift types, legacy request shape, or broader MCP tool catalog.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `package.json`, `bun.lock` | Modified | Add direct exact MCP SDK dependency; risk of accidental transitive reliance. | Add `@modelcontextprotocol/sdk@1.29.0` and preserve exact pinning. |
| `src/index.ts` | Modified | Adds child-only CLI branch; risk of normal boot regression. | Dispatch before cockpit boot and test both paths. |
| `src/agent/askUserMcp.ts` | New | MCP/IPC adapter and Zod schema; high trust boundary. | Validate, bound, and redact all untrusted input/output errors. |
| `src/app/askUserBridge.ts` | New | Per-session endpoint/capability registry; high lifecycle risk. | Own registration, authenticated routing, cancellation, and disposal. |
| `src/app/controller.ts` | Modified | Per-session generated MCP declaration and coordinator handle/timeout use. | Compose deterministically for fresh, restore, dynamic, close, and failure paths. |
| `src/core/types.ts` | Modified | Adds form metadata, custom selections, and terminal outcomes. | Keep every type protocol-free and exhaustive. |
| `src/ui/ClarificationPrompt.tsx`, `keymap.ts` | Modified | Renders title/context/custom choice and explicit skip. | Preserve modal priority, focus isolation, and separate Escape cancellation. |
| `src/agent/acpTranslate.ts` | Modified | Maps richer normalized outcomes back to supported ACP forms. | Keep unsupported shapes fail-closed. |
| `src/config/configLoader.ts` | Modified | Adds fixed clarification timeout config with 300-second default. | Strictly validate a positive bounded value; never accept an MCP override. |
| `src/telemetry/recorder.ts` | Modified | Extends closed outcome categories. | Keep requests, capabilities, text, paths, and answers out of records. |

## Testing Approach

### Unit Tests

- `src/agent/askUserMcp.test.ts`: Zod/schema validation, duplicate IDs/options, size/count limits, fixed-timeout omission, serialized submitted/skip/timeout/cancelled outputs, and no-content error messages.
- `src/app/askUserBridge.test.ts`: capability-only route lookup, unknown/stale generation rejection, one route per generation, endpoint cleanup, bounded frames, duplicate call rejection, and loss cancellation.
- `src/app/controller.test.ts`: coordinator request handles settle active or suspended forms once; timer/submission races; native ACP and bridge forms share normalization; fresh/restore/dynamic MCP composition preserves user order then bridge.
- `src/core/types.test.ts` and `src/agent/acpTranslate.test.ts`: rich answer validation, optional title/context, custom selection behavior, exhaustive terminal outcomes, and native unsupported-shape cancellation.
- `src/ui/ClarificationPrompt.test.tsx`: title/context display, multi-field custom answers, explicit skip, timeout projection, keyboard focus isolation, and a cancelled Escape path.
- `src/telemetry/recorder.test.ts`: new closed terminal enum and proof that all content, route, capability, and call IDs remain absent.

### Integration Tests

- Add `test/askUserMcp.integration.test.ts` that starts the same executable in `--ask-user-mcp` mode, connects through real `StdioServerTransport`/MCP client APIs, and uses the real local IPC framing against a fake controller bridge.
- Extend the fake ACP agent to receive the generated per-session MCP declaration, call `ask_user`, observe the existing dialog projection, submit each terminal outcome, and continue the same prompt turn.
- Run two fake agents concurrently. Assert each call reaches only its owner, one clarification preempts/resumes correctly, and user MCP declarations retain order before the generated bridge server.
- Cover timeout, explicit skip, UI cancellation, session replacement, conversation close, provider error, bridge child exit, parent disposal, stale-generation reply, invalid capability, and duplicate response.
- Keep one manual Codex smoke scenario after automated coverage: a built-in Codex session calls `ask_user`, the operator answers in Kitten, and the same turn continues.

## Development Sequencing

### Build Order

1. Extend protocol-free clarification types, config timeout schema/default, closed telemetry enums, and exhaustive unit tests — no dependencies.
2. Add coordinator request handles, exact timeout settlement, and bridge-aware lifecycle cancellation tests — depends on step 1.
3. Implement the `AskUserBridge` registration/IPC service with capability and endpoint cleanup tests — depends on steps 1 and 2.
4. Add same-binary MCP child mode, direct SDK dependency, Zod schema, and serialized-result tests — depends on step 3.
5. Compose the generated bridge MCP declaration into controller fresh, restored, and dynamic session paths — depends on steps 3 and 4.
6. Extend UI/keymap behavior for form title/context, custom selection, explicit skip, and timeout state — depends on steps 1 and 2.
7. Extend ACP translation for the richer normalized model and retain its fail-closed behavior — depends on step 1.
8. Add spawned-child fake-ACP end-to-end coverage, then run the manual Codex smoke scenario — depends on steps 4, 5, 6, and 7.

### Technical Dependencies

- Add the direct exact MCP SDK dependency before compiling child mode.
- Confirm Bun’s compiled executable preserves `process.execPath` or provide the same-binary absolute path through the controller’s executable-path seam.
- Add a cross-platform local endpoint helper before enabling Windows support.
- Preserve injectable clocks, random generators, process spawners, endpoint factories, and controller/agent factories so lifecycle and race tests remain deterministic.

## Monitoring and Observability

- Record only the fixed terminal outcome (`submitted`, `skipped`, `timed_out`, `cancelled`) and existing coarse duration bucket.
- Add content-free counts for bridge route registration failure and child connection failure using bounded reason enums.
- Do not record MCP request IDs, session IDs, capability values, endpoint paths, provider command lines, title, context, options, field labels, or answers.
- The absence of an expected terminal outcome is a test/invariant failure, not an analytics fallback. There is no production alerting service in V1; local JSONL remains opt-in.

## Technical Considerations

### Key Decisions

- **Controller-owned bridge:** controller lifecycle ownership prevents duplicate or stale session routing; the trade-off is a new app service and explicit teardown paths.
- **Local socket/pipe plus capability:** narrows the attack surface and makes session identity server-derived; the trade-off is cross-platform endpoint support.
- **One bounded multi-field form:** reuses the current dialog and limits operator interruption; the trade-off is richer validation and UI state.
- **Fixed five-minute timeout:** predictable operator behavior and no agent-controlled blocking; the trade-off is no per-question tuning in V1.
- **Spawned-process integration gate:** proves the actual binary, MCP stdio, IPC, coordinator, and lifecycle path; the trade-off is a more involved test harness.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Capability or route spoofing by another local process | Medium | Private endpoint, random capability, session/generation binding, frame limits, and fail-closed parser. |
| Timeout races with a user submission | Medium | Settle only through captured coordinator request ID; make late outcomes inert. |
| Child leak after session teardown | Medium | Register child ownership, close endpoint first, terminate child, and test every lifecycle exit. |
| MCP SDK/package drift | Low | Direct exact `1.29.0` dependency, lockfile pin, and contract test against the real child mode. |
| UI regression for existing ACP elicitation | Medium | Normalize both ingress paths through shared core types and keep ACP-specific tests unchanged or updated exhaustively. |
| Cross-platform pipe behavior differs | Medium | Endpoint-factory seam with POSIX/Windows tests and no TCP fallback in V1. |

## Architecture Decision Records

- [ADR-001: Scope the provider-independent clarification bridge as a live-generation V1](adrs/adr-001.md) — Sets the provider-neutral product boundary and non-durable crash semantics.
- [ADR-002: Reserve MVP questions for consequential operator decisions](adrs/adr-002.md) — Limits questions to consequential decisions and sets the operator-control policy.
- [ADR-003: Use a controller-owned bridge with per-session authenticated local IPC](adrs/adr-003.md) — Locates routing in the controller and secures child-to-parent ownership.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — Fixes the schema, structured outcomes, limits, and timeout policy.
