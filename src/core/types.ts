/**
 * Kitten domain core types.
 *
 * This module is the stable, protocol-free heart of the app (ADR-003). It holds
 * the normalized session model, the domain event union the reducer consumes, and
 * the hand-off data shapes. It imports NOTHING from the ACP SDK or any I/O layer:
 * the Agent Adapter Layer (`src/agent`) owns translation of ACP wire types into
 * these domain types, so no protocol churn leaks into the core.
 *
 * Type shapes follow the TechSpec "Data Models" and "Core Interfaces" sections.
 */

/**
 * The kind of agent a session runs - the spawn-recipe identity, not the session's
 * own identity (ADR-004). Two sessions can share a `ProviderKind`; each still gets
 * its own {@link SessionId}. Renamed from the former `AgentId`.
 */
export type ProviderKind = "claude-code" | "codex"

/**
 * A Kitten-assigned session instance identity, opaque and stable from config load,
 * assigned before any ACP handshake (ADR-004). This is what the store keys by, so a
 * not-ready session - one with no ACP id yet - still exists in the collection.
 */
export type SessionId = string

/** Every provider kind Kitten drives, in default cockpit seed order (ADR-001). */
export const PROVIDER_KINDS: readonly ProviderKind[] = ["claude-code", "codex"]

/** The human-facing name for each provider kind; the default session title. */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<ProviderKind, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
}

/**
 * Coarse per-session lifecycle state surfaced to the UI status strip and the
 * attention derivation (ADR-006).
 *
 * `finished` and `error` are the terminal states the overview routes attention to:
 * `finished` means the turn ended and the developer's input is expected; `error`
 * means the prompt threw or the transport/subprocess was lost. `idle` is the
 * quiescent "nothing to do" state (including after the developer cancels a turn).
 * The adapter derives `finished`/`error` only from terminal signals, never from a
 * streaming update, so `finished` cannot flicker mid-turn.
 */
export type SessionStatus = "idle" | "working" | "awaiting_approval" | "finished" | "error"

/**
 * Whether a session's status is one the developer must act on: an approval to
 * answer, a crash to look at, or a finished turn awaiting their next move (ADR-006).
 * A pure predicate every attention surface reads - the status strip, the Ctrl+S
 * overview, the jump-to-next action, and the notifier - so they can never disagree
 * about which sessions need you.
 */
export const needsAttention = (status: SessionStatus): boolean =>
  status === "awaiting_approval" || status === "error" || status === "finished"

/** Normalized classification of a tool call, translated from the agent's own kinds. */
export type ToolCallKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other"

/** Progress of a single tool call. `completed` means applied; `failed` is terminal. */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"

/** A unified diff proposed or produced by a tool call, scoped to one file path. */
export interface ToolCallDiff {
  path: string
  unified: string
}

/**
 * The reduced, fully-populated record of a tool call as stored in the transcript.
 * The reducer upserts these by `toolCallId` from a stream of {@link ToolCallUpdate}s.
 */
export interface ToolCallRecord {
  toolCallId: string
  kind: ToolCallKind
  title: string
  status: ToolCallStatus
  locations: string[]
  diff?: ToolCallDiff
}

/**
 * The event payload for a `tool_call` domain event.
 *
 * Both ACP `tool_call` and `tool_call_update` notifications translate to a single
 * domain `tool_call` event carrying this partial: `toolCallId` is always present,
 * every other field is optional. Omitting a field preserves the prior value on
 * upsert; setting `diff` to `null` clears the stored diff. This partial shape is
 * what makes the "omitted fields preserved, explicit nulls clear" merge semantics
 * expressible (a fully-populated {@link ToolCallRecord} cannot express omission).
 */
export interface ToolCallUpdate {
  toolCallId: string
  kind?: ToolCallKind
  title?: string
  status?: ToolCallStatus
  locations?: string[]
  diff?: ToolCallDiff | null
}

/** A single entry in an agent's plan (translated from the ACP `plan` notification). */
export interface PlanEntry {
  content: string
  priority?: "low" | "medium" | "high"
  status?: "pending" | "in_progress" | "completed"
}

/** A user's message turn in the transcript, keyed by `messageId`. */
export interface UserTurn {
  kind: "user"
  messageId: string
  text: string
}

/** An agent's message turn; streamed deltas concatenate onto `text` by `messageId`. */
export interface AgentTurn {
  kind: "agent"
  messageId: string
  text: string
}

/** A tool-call turn in the transcript; the record is upserted by `toolCallId`. */
export interface ToolCallTurn {
  kind: "tool_call"
  record: ToolCallRecord
}

/** An ordered transcript entry: a message from either party or a tool call. */
export type Turn = UserTurn | AgentTurn | ToolCallTurn

/**
 * An edit diff that has been proposed but not yet applied/approved.
 * Derived from `edit`-kind tool calls that carry a diff and are not yet complete.
 */
export interface PendingDiff {
  toolCallId: string
  path: string
  unified: string
}

/**
 * The seed that fixes a session's identity at construction (ADR-004): everything
 * the reducer needs to build an empty session slice before any handshake. `cwd` and
 * `title` come from config; `acpSessionId` is empty until the ACP session opens.
 */
export interface SessionSeed {
  id: SessionId
  providerKind: ProviderKind
  title: string
  cwd: string
  task?: string
  /** The ACP session id, when already known; defaults to `""` (not yet handshaken). */
  acpSessionId?: string
}

/**
 * The full state of one session, and the sole thing the reducer writes.
 *
 * `id` is the Kitten instance identity the store keys by; `providerKind` is the kind
 * of agent it runs; `acpSessionId` is the ACP session id (empty until the handshake
 * completes). `referencedFiles` and `pendingDiffs` are pure derivations of the
 * tool-call turns and are recomputed on every reduction, so they never drift.
 */
export interface SessionState {
  id: SessionId
  providerKind: ProviderKind
  title: string
  cwd: string
  task?: string
  acpSessionId: string
  turns: Turn[]
  status: SessionStatus
  /** File path -> strongest access seen. `edited` takes precedence over `read`. */
  referencedFiles: Map<string, "read" | "edited">
  /** Edit diffs proposed but not yet applied/approved. */
  pendingDiffs: PendingDiff[]
  /** The agent's most recently reported plan, if any. */
  plan: PlanEntry[]
}

/**
 * The normalized domain events the reducer consumes, translated from the ACP
 * `SessionNotification` union by the adapter. No ACP wire type appears here.
 */
export type DomainSessionEvent =
  | { kind: "agent_message"; messageId: string; textDelta: string }
  | { kind: "user_message"; messageId: string; text: string }
  | { kind: "tool_call"; call: ToolCallUpdate } // upsert by toolCallId
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "status"; status: SessionStatus } // idle | working | awaiting_approval | finished | error

/**
 * The context bundle handed from a source agent to a target agent. Deterministic
 * in V1 (ADR-002); an LLM-backed assembler can replace the producer later without
 * changing this shape.
 */
export interface HandoffBundle {
  intent: "continue"
  summary: string // deterministic transcript excerpt in V1
  files: { path: string; reason: "read" | "edited" }[]
  pendingDiffs: PendingDiff[]
  redactionCount: number // secrets stripped before preview
}

/**
 * A provider's spawn recipe: how to launch its ACP adapter (BYO, config-driven;
 * ADR-005). Keyed by {@link ProviderKind} in {@link AppConfig.providers}, so the
 * kind is the map key rather than a field. Overridable per field; the defaults pin
 * the adapter package versions.
 */
export interface ProviderRecipe {
  displayName: string
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * A provider's spawn recipe paired with its own {@link ProviderKind}. This is the
 * shape the agent adapter layer spawns from: a {@link ProviderRecipe} plus the `id`
 * the map key carries in config. Renamed conceptually from the former per-agent
 * config; still the connection/transport input.
 */
export interface AgentConfig extends ProviderRecipe {
  id: ProviderKind
}

/**
 * One declared session in the config file (ADR-005). Each session names the provider
 * to spawn and the working directory to open it against; `title` defaults to the
 * `cwd` basename, and `task`, when present, is sent as the session's first prompt.
 * Two descriptors may share a `provider` - each resolves to its own {@link SessionId}.
 */
export interface SessionDescriptor {
  provider: ProviderKind
  cwd: string
  title?: string
  task?: string
}

/**
 * The loaded application configuration (ADR-005). `providers` is the map of spawn
 * recipes keyed by kind; `sessions` is the ordered fleet to open. An empty `sessions`
 * list means zero-config: one session per configured provider in the launch directory.
 */
export interface AppConfig {
  providers: Record<ProviderKind, ProviderRecipe>
  sessions: SessionDescriptor[]
  telemetryEnabled: boolean
}

/**
 * A {@link SessionDescriptor} resolved into the per-session input the controller
 * consumes without further transformation: the {@link SessionSeed} that fixes the
 * session's identity and placement, plus the {@link AgentConfig} its connection is
 * spawned from.
 */
export interface ResolvedSession {
  seed: SessionSeed
  spawn: AgentConfig
}

/** A content-free telemetry record (opt-in, local JSONL only). */
export interface TelemetryEvent {
  type: string
  at: number
  sessionRef: string
  charBucket?: number // never prompt/code content
}
