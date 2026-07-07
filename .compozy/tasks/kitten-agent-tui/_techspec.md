# TechSpec: Kitten - Cross-Agent Hand-off Cockpit

## Executive Summary

Kitten is a Bun + TypeScript terminal application built on `@opentui/react`, running two AI coding agents (Claude Code and Codex) over the Agent Client Protocol (ACP) and letting a developer hand a live task from one to the other through a human-curated context bundle.
The architecture is layered (ADR-003): an **Agent Adapter Layer** wraps each agent as a `Bun.spawn` subprocess behind an ACP `ClientSideConnection` and translates the ACP `SessionNotification` union into Kitten's own domain events, so no protocol types leak upward; a **pure Domain Core** holds the session model, the hand-off `BundleAssembler` strategy, and secret redaction; a **reactive store** feeds an **OpenTUI/React UI shell**.

The primary technical trade-off is choosing React over Solid for the UI (ADR-004): the team gains contributor familiarity and ecosystem at the cost of Solid's fine-grained streaming reactivity, which we offset with an external store, per-frame token coalescing, and localized subscriptions so the reconciler never re-renders the transcript per token.
The second deliberate trade-off is the deterministic hand-off bundle (ADR-002): the MVP assembles the bundle from structured ACP data (transcript excerpt, referenced files from tool-call `locations`, pending diffs from `edit` tool calls) and relies on the human preview to curate, deferring the model-risky LLM curation engine behind the validation gate.

## System Architecture

### Component Overview

**Agent Adapter Layer (imperative shell)** - `AgentConnection`

- One instance per agent. Spawns the configured agent command via `Bun.spawn`, wires stdin/stdout to an ACP `ClientSideConnection`, implements the ACP `Client` interface (`requestPermission`, `sessionUpdate`, filesystem callbacks).
- Translates `SessionNotification` (`agent_message_chunk`, `tool_call`, `tool_call_update`, `plan`, etc.) into normalized `DomainSessionEvent`s. Buffers `agent_message_chunk` and flushes at most once per frame.
- Runs the readiness handshake (`initialize`) and reports ready / not-ready.
- This is the anti-corruption boundary; the ACP SDK is imported nowhere above it.

**Domain Core (pure)** - no I/O, fully unit-testable

- `SessionState` model and its reducer (applies `DomainSessionEvent`s to a transcript).
- `BundleAssembler` strategy interface with a `DeterministicAssembler` implementation.
- `SecretRedactor` (pattern-based scan).
- Telemetry heuristics (e.g. re-explanation detection), as pure predicates over events.

**Reactive Store** - `AppStore`

- Holds per-agent `SessionState`, the focused agent, per-agent status, and overlay state (hand-off preview, approval prompt).
- Exposes narrow selectors so React components subscribe only to what they render.

**UI Shell (OpenTUI + React)** - `CockpitApp`

- `StatusStrip` (both agents' state), `ConversationView` (`<markdown>` messages, tool-call rows, `<diff>` for edits), `PromptEditor` (`<textarea>`), `HandoffPreview` (editable overlay), `ApprovalPrompt` (overlay).

**Config & Readiness** - `ConfigLoader`, `AgentReadinessChecker`

- Loads `AppConfig` (agent commands, telemetry opt-in), validates each agent at startup.

**Data flow:** keypress in `PromptEditor` sends to `AgentConnection.prompt()`, the ACP `session/update` stream returns, `AgentConnection` translates and coalesces it into the `AppStore`, and `ConversationView` re-renders the affected view.
Hand-off key triggers `DeterministicAssembler.assemble(sourceSession)`, then `SecretRedactor`, then the `HandoffPreview` (edit), then on confirm `targetConnection.prompt(bundle)`, and focus switches to the target.

## Implementation Design

### Core Interfaces

The Agent Adapter Layer boundary that the rest of the app depends on:

```typescript
type AgentId = "claude-code" | "codex"
type Unsubscribe = () => void

interface AgentConnection {
  readonly id: AgentId
  connect(): Promise<ReadyState>                 // spawn + ACP initialize handshake
  newSession(cwd: string): Promise<string>       // returns sessionId
  prompt(sessionId: string, blocks: PromptBlock[]): Promise<PromptResult>
  cancel(sessionId: string): Promise<void>
  onUpdate(cb: (event: DomainSessionEvent) => void): Unsubscribe
  onPermission(handler: (req: PermissionRequest) => Promise<PermissionOutcome>): void
  dispose(): Promise<void>
}
```

Normalized domain events (translated from the ACP `SessionNotification` union; no ACP types leak):

```typescript
type DomainSessionEvent =
  | { kind: "agent_message"; messageId: string; textDelta: string }
  | { kind: "user_message"; messageId: string; text: string }
  | { kind: "tool_call"; call: ToolCallRecord }        // upsert by toolCallId
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "status"; status: AgentStatus }            // idle | working | awaiting_approval
```

The hand-off assembly strategy (deterministic in V1, LLM-backed in Phase 2 without touching callers):

```typescript
interface BundleAssembler {
  assemble(session: SessionState, target: AgentId): HandoffBundle
}
```

### Data Models

```typescript
interface SessionState {
  agentId: AgentId
  sessionId: string
  turns: Turn[]
  status: AgentStatus
  referencedFiles: Map<string, "read" | "edited">   // derived from tool-call locations
  pendingDiffs: PendingDiff[]                        // edit tool calls not yet applied/approved
}

interface ToolCallRecord {
  toolCallId: string
  kind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other"
  title: string
  status: "pending" | "in_progress" | "completed" | "failed"
  locations: string[]
  diff?: { path: string; unified: string }
}

interface HandoffBundle {
  intent: "continue"
  summary: string              // deterministic transcript excerpt in V1
  files: { path: string; reason: "read" | "edited" }[]
  pendingDiffs: PendingDiff[]
  redactionCount: number       // secrets stripped before preview
}

interface AgentConfig { id: AgentId; displayName: string; command: string; args: string[]; env: Record<string, string> }
interface AppConfig { agents: AgentConfig[]; telemetryEnabled: boolean }
interface TelemetryEvent { type: string; at: number; sessionRef: string; charBucket?: number } // no prompt/code content
```

### API Endpoints

Not applicable.
Kitten is a local terminal application with no HTTP surface.
Its external boundary is the ACP JSON-RPC-over-stdio channel to each agent subprocess (see Integration Points), and its internal surface is the `AgentConnection` interface and the `AppStore` dispatch, both covered above.

## Integration Points

**ACP agents over stdio** (Claude Code, Codex)

- **Purpose:** drive each agent's session and receive streamed updates, tool calls, diffs, and permission requests.
- **Transport:** `Bun.spawn` the configured command; JSON-RPC over the child's stdin/stdout via the ACP `ClientSideConnection`.
- **Authentication:** owned by the agents themselves (their own keys/subscriptions); Kitten passes through configured `env` and never stores agent credentials.
- **Error handling:** the startup readiness check completes the `initialize` handshake before an agent is marked ready; a failed spawn, handshake, or mid-session crash marks that agent not-ready and surfaces a legible error, without taking down the other agent or the app.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| Project scaffold (Bun/TS/OpenTUI) | new | Greenfield repo setup; low risk | Initialize package, tsconfig (`jsxImportSource: @opentui/react`), bunfig, test runner |
| Agent Adapter Layer | new | ACP subprocess + translation; highest integration risk (pre-1.0 SDK) | Build behind anti-corruption boundary; mock-agent tests |
| Domain Core (assembler, redactor, model) | new | Pure logic; bundle quality risk | Unit test heavily; prototype the deterministic bundle early |
| Reactive Store | new | Streaming performance risk under React | External store + per-frame coalescing |
| UI Shell (cockpit, views, overlays) | new | Flicker/copy-paste risk | Use OpenTUI `<markdown>`/`<diff>`; snapshot tests |
| Config & readiness | new | First-run friction risk | Clear per-agent ready/not-ready states |
| Telemetry recorder | new | Privacy risk | Opt-in, content-free, local JSONL only |
| Packaging (compiled binary) | new | Cross-platform FFI risk | Validate each target artifact in CI |

## Testing Approach

### Unit Tests

- **Strategy:** exercise the pure Domain Core directly. Key targets: `DeterministicAssembler` (correct referenced-file set, correct pending-diff extraction, excerpt bounds), `SecretRedactor` (known secret patterns redacted, false-negative bias documented), the `SessionState` reducer (event application, tool-call upsert by `toolCallId`), and the re-explanation heuristic predicate.
- **Boundaries:** the core has no I/O, so no mocks are required; feed it event fixtures.
- **Edge cases:** empty transcript, an all-dead-end transcript, a hand-off with no pending diffs, secrets embedded inside a diff, tool-call updates that clear fields (`null` semantics).

### Integration Tests

- **Components together:** `AgentConnection` driven against a **mock in-process ACP agent** that implements the `Agent` interface and emits scripted `session/update` notifications and a `requestPermission` round-trip. Assert correct translation to `DomainSessionEvent`s and correct permission outcomes.
- **Store-level:** dispatch a scripted event stream into `AppStore` and assert resulting session state, focus switching, and hand-off bundle contents end to end (assemble → redact → target prompt payload).
- **UI snapshots:** OpenTUI `testRender` for `CockpitApp`, a streaming `ConversationView`, and `HandoffPreview`, at a fixed width/height.
- **Test data / environment:** all fixtures are in-repo; no real agent binaries, keys, or network are used in CI.

## Development Sequencing

### Build Order

1. **Project scaffold** - Bun project, TypeScript config for the React binding, bunfig, `bun test` runner. No dependencies.
2. **Domain Core types + `SessionState` reducer** - depends on step 1. Pure, test-first.
3. **Agent Adapter Layer (`AgentConnection`)** - depends on steps 1-2. Spawn + ACP `ClientSideConnection` + `SessionNotification` to `DomainSessionEvent` translation + `requestPermission`; verified with the mock agent.
4. **Config & readiness (`ConfigLoader`, `AgentReadinessChecker`)** - depends on step 3.
5. **Reactive store (`AppStore`) with per-frame update coalescing** - depends on steps 2-3.
6. **Deterministic `BundleAssembler` + `SecretRedactor`** - depends on step 2. Can proceed in parallel with step 5.
7. **UI shell: renderer bootstrap, `CockpitApp`, `StatusStrip`, `ConversationView`, `PromptEditor`** - depends on step 5.
8. **`ApprovalPrompt` wiring (requestPermission to overlay to outcome)** - depends on steps 3 and 7.
9. **Hand-off flow: `HandoffPreview` overlay, assemble → redact → edit → prompt target → switch focus** - depends on steps 6 and 7.
10. **Hand-back** - depends on step 9 (reuses the same flow in reverse).
11. **Telemetry recorder + heuristics (opt-in, local JSONL)** - depends on steps 2, 5, and 9.
12. **First-run flow + packaging (`bun build --compile`, curl installer, npm publish)** - depends on steps 4 and 7; release automation depends on all prior steps.

### Technical Dependencies

- The ACP TypeScript SDK (`@agentclientprotocol/sdk`) and OpenTUI (`@opentui/core`, `@opentui/react`), both pre-1.0; pin versions.
- Working ACP adapters for Claude Code and Codex available on the developer's machine (BYO, ADR-005).
- A terminal that supports the rendering features OpenTUI relies on (validated per platform in CI for the compiled binary).

## Monitoring and Observability

- **Metrics (opt-in, local JSONL, content-free):** `handoff_invoked`, `handoff_sent`, `handoff_repeat`, `reexplanation_detected`, `bundle_edit_chars` (bucketed), `agent_ready` / `agent_unready`, `first_response_ms`. These feed the PRD kill-or-scale gate.
- **Re-explanation heuristic:** after a hand-off, if the developer's next message to the target agent (before that agent's first tool call or edit) crosses a length/shape threshold that looks like context restatement, record `reexplanation_detected = true`. Only the boolean and a coarse char bucket are stored, never the text.
- **Debug log:** a structured, flag-gated log surfaced through OpenTUI's console overlay, with fields `agentId`, `sessionId`, `event`, `durationMs` for diagnosing adapter and streaming issues.
- **Alerting:** none; Kitten is a local tool. The metrics are reviewed against the pre-registered thresholds to make the go/no-go decision.

## Technical Considerations

### Key Decisions

- **Layered architecture with an ACP anti-corruption layer (ADR-003).** Rationale: isolate two pre-1.0 dependencies and keep the hand-off core pure. Trade-off: a translation layer and two session representations. Alternatives rejected: ACP types throughout, event-sourced core.
- **React UI binding (ADR-004).** Rationale: contributor familiarity and ecosystem. Trade-off: must manage render scope and coalesce streaming. Alternatives rejected: Solid (better streaming, chosen against for familiarity), core imperative.
- **BYO config-driven ACP subprocess spawn (ADR-005).** Rationale: stay thin, respect existing installs and auth, one path for native-ACP and wrapper agents. Trade-off: user bears setup; Kitten must report per-agent failures clearly. Alternatives rejected: bundling adapters, hybrid shims.
- **Compiled standalone binary distribution (ADR-006).** Rationale: no user runtime prerequisite, supports the under-60-second first run. Trade-off: cross-compile and larger binary. Alternatives rejected: npm-only, Homebrew-first.
- **Deterministic hand-off bundle in V1 (ADR-002).** Rationale: validate demand before building the LLM curation engine; the human preview curates. Trade-off: rougher bundle, more editing.
- **Layered testing (unit + mock-agent integration + snapshot).** Rationale: confidence on the riskiest parts without slow, flaky real-agent CI. Trade-off: the mock agent must track ACP behavior.

### Known Risks

- **Deterministic bundle quality** (medium likelihood): a weak bundle undersells the wedge. Mitigation: prototype the assembler early against real transcripts; instrument edit volume. Needs prototyping.
- **Poisoned transcript** (medium): carrying a stalled agent's dead-ends degrades the receiver. Mitigation: the human preview drops turns before send; measure continuation acceptance.
- **Streaming flicker under React** (medium): naive re-renders reintroduce the top terminal complaint. Mitigation: per-frame coalescing and localized subscriptions are mandatory and snapshot-tested.
- **Pre-1.0 dependency churn** (high): ACP SDK and OpenTUI ship breaking changes. Mitigation: anti-corruption boundary, pinned versions, capability negotiation isolated to the adapter.
- **Re-explanation detection accuracy** (medium): the heuristic may mis-count. Mitigation: tune against early real usage; keep it content-free; treat the metric as directional. Needs prototyping.
- **Cross-platform compiled binary / native FFI** (medium): OpenTUI's Zig core must load on each target. Mitigation: validate every release artifact on a real terminal in CI.
- **Secret redaction false negatives** (medium): a missed secret could be forwarded. Mitigation: conservative patterns plus the human preview as a second line; never auto-send without preview.

## Architecture Decision Records

- [ADR-001: V1 Scope - Cross-Agent Hand-off Wedge, Not a Generic Multi-Agent Switcher](adrs/adr-001.md) - V1 commits to the hand-off wedge over a generic switcher.
- [ADR-002: Validation-First Thin Slice for V1](adrs/adr-002.md) - human-curated hand-off; LLM curation deferred behind a validation gate.
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) - isolate pre-1.0 deps; keep the hand-off core pure.
- [ADR-004: React Binding for the OpenTUI UI Layer](adrs/adr-004.md) - React over Solid, with a store and coalesced streaming.
- [ADR-005: BYO Agents via Config-Driven ACP Subprocess Spawn](adrs/adr-005.md) - spawn agents from config; user provides binaries and auth.
- [ADR-006: Distribution as a Compiled Standalone Binary](adrs/adr-006.md) - `bun build --compile` per platform plus npm.
