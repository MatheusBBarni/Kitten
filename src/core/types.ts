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

import type { PromptHistoryEvent, PromptHistoryState } from "./promptHistory.ts"
import type { StatuslinePreference } from "./statusline.ts"
import type { ExplorePolicySnapshot } from "./explorePolicy.ts"

/**
 * The kind of agent a session runs - the spawn-recipe identity, not the session's
 * own identity (ADR-004). Two sessions can share a `ProviderKind`; each still gets
 * its own {@link SessionId}. Renamed from the former `AgentId`.
 */
export type ProviderKind = "claude-code" | "codex" | "cursor"

/**
 * A Kitten-assigned session instance identity, opaque and stable from config load,
 * assigned before any ACP handshake (ADR-004). This is what the store keys by, so a
 * not-ready session - one with no ACP id yet - still exists in the collection.
 */
export type SessionId = string

/** Closed review/cleanup standing for one Kitten-managed worktree binding. */
export type ManagedWorktreeAvailability =
  | "unverified"
  | "available"
  | "unavailable"
  | "cleanup_refused"

/** Bounded lifecycle reasons; raw Git errors and workspace content never enter core state. */
export type ManagedWorktreeReason =
  | "not_git_repository"
  | "detached_head"
  | "submodules_unsupported"
  | "root_conflict"
  | "collision"
  | "verification_failed"
  | "missing"
  | "external"
  | "dirty"
  | "unmerged"
  | "live_owned"
  | "not_managed"
  | "git_failed"

/** Immutable, protocol-free identity and review state for a Kitten-managed worktree. */
export interface ManagedWorktreeBinding {
  readonly kind: "managed"
  readonly id: string
  readonly repoRoot: string
  readonly worktreePath: string
  readonly branch: string
  readonly baseBranch: string
  readonly baseSha: string
  readonly ownerSessionId: SessionId
  readonly availability: ManagedWorktreeAvailability
  readonly reason?: ManagedWorktreeReason
}

/** Closed, protocol-free lifecycle for one host-owned delegated child. */
export type DelegatedChildStatus =
  | "starting"
  | "running"
  | "needs_input"
  | "finished"
  | "failed"
  | "cancelled"

/** The statuses that permanently settle delegated child work. */
export type DelegatedChildTerminalStatus = Extract<
  DelegatedChildStatus,
  "finished" | "failed" | "cancelled"
>

/** Immutable exactly-once terminal result metadata supplied by the controller. */
export interface DelegatedChildTerminalSnapshot {
  readonly status: DelegatedChildTerminalStatus
  readonly at: number
}

/** Protocol-free projection of one child owned by exactly one parent generation. */
export interface DelegatedChildSnapshot {
  readonly childId: SessionId
  readonly parentId: SessionId
  readonly parentGeneration: number
  readonly childGeneration: number
  readonly status: DelegatedChildStatus
  readonly task: string
  readonly desiredOutcome: string
  /** Accepted launch-time policy; absent only on the legacy path removed by task 03. */
  readonly policy?: ExplorePolicySnapshot
  readonly terminal?: DelegatedChildTerminalSnapshot
}

/** Closed capacity boundary that refused an otherwise valid registration. */
export type ExploreCapacityScope = "per-parent" | "global"

/** Parent close intent is state, while cancellation and teardown stay controller-owned. */
export type DelegationParentCloseState = "open" | "closing"

/** Ordered ownership metadata for one flat delegation group. */
export interface DelegationParent {
  readonly parentId: SessionId
  readonly parentGeneration: number
  readonly childIds: readonly SessionId[]
  readonly closeState: DelegationParentCloseState
}

/** Ephemeral normalized delegation projection; never persisted in V1. */
export interface DelegationState {
  readonly parents: Readonly<Record<SessionId, DelegationParent>>
  readonly children: Readonly<Record<SessionId, DelegatedChildSnapshot>>
}

/** Parent-group presentation derived entirely from immutable child snapshots. */
export type DelegationAggregateStatus = "active" | "needs_input" | "settled"

type DelegatedChildActiveStatus = Exclude<DelegatedChildStatus, DelegatedChildTerminalStatus>

/** Pure state transitions; runtime ownership and timestamp creation stay outside core. */
export type DelegationEvent =
  | {
      readonly kind: "register_child"
      readonly parentId: SessionId
      readonly childId: SessionId
      readonly parentGeneration: number
      readonly childGeneration: number
      readonly task: string
      readonly desiredOutcome: string
      /** Accepted immutable policy for reservation-aware explore registration. */
      readonly policy?: ExplorePolicySnapshot
    }
  | {
      readonly kind: "publish_child_status"
      readonly parentId: SessionId
      readonly childId: SessionId
      readonly parentGeneration: number
      readonly childGeneration: number
      readonly status: DelegatedChildActiveStatus
    }
  | {
      readonly kind: "publish_child_status"
      readonly parentId: SessionId
      readonly childId: SessionId
      readonly parentGeneration: number
      readonly childGeneration: number
      readonly status: DelegatedChildTerminalStatus
      readonly at: number
    }
  | {
      readonly kind: "mark_parent_closing"
      readonly parentId: SessionId
      readonly parentGeneration: number
    }
  | {
      readonly kind: "remove_child"
      readonly parentId: SessionId
      readonly childId: SessionId
      readonly parentGeneration: number
      readonly childGeneration: number
    }

/** Every provider kind Kitten understands, kept stable for config validation. */
export const PROVIDER_KINDS: readonly ProviderKind[] = ["claude-code", "codex", "cursor"]

/**
 * The launch order for Kitten's built-in three-provider cockpit. Codex is the
 * default focused agent, while explicitly configured session arrays retain the
 * order the user declared.
 */
export const DEFAULT_PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claude-code", "cursor"]

/** Shared full and compact labels for every closed provider identity. */
export interface ProviderDisplayMetadata {
  displayName: string
  compactLabel: string
}

/** Total UI-facing metadata; views never need provider-specific label branches. */
export const PROVIDER_METADATA = {
  "claude-code": { displayName: "Claude Code", compactLabel: "Claude" },
  codex: { displayName: "Codex", compactLabel: "Codex" },
  cursor: { displayName: "Cursor", compactLabel: "Cursor" },
} as const satisfies Readonly<Record<ProviderKind, ProviderDisplayMetadata>>

/** The human-facing name for each provider kind; the default session title. */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<ProviderKind, string>> = Object.fromEntries(
  PROVIDER_KINDS.map((kind) => [kind, PROVIDER_METADATA[kind].displayName]),
) as Record<ProviderKind, string>

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
export type SessionStatus =
  | "idle"
  | "working"
  | "awaiting_clarification"
  | "awaiting_approval"
  | "finished"
  | "error"

/**
 * Whether a session's status is one the developer must act on: an approval to
 * answer, a crash to look at, or a finished turn awaiting their next move (ADR-006).
 * A pure predicate every attention surface reads - the status strip, the `/sessions`
 * overview, the jump-to-next action, and the notifier - so they can never disagree
 * about which sessions need you.
 */
export const needsAttention = (status: SessionStatus): boolean =>
  status === "awaiting_clarification" ||
  status === "awaiting_approval" ||
  status === "error" ||
  status === "finished"

/** One protocol-free choice presented by a structured clarification field. */
export const CLARIFICATION_LIMITS = {
  maxFields: 10,
  maxOptionsPerField: 20,
  maxTextLength: 4_096,
} as const

export interface ClarificationOption {
  /** Stable adapter-normalized identifier returned in a submitted outcome. */
  id: string
  label: string
  description?: string
}

interface ClarificationFieldBase {
  /** Stable adapter-normalized identifier used as the outcome-values key. */
  id: string
  label: string
  description?: string
  required: boolean
}

/** A field whose answer must reference one normalized option identifier. */
export interface ClarificationSingleField extends ClarificationFieldBase {
  mode: "single"
  options: ClarificationOption[]
  /** Whether the operator may answer outside the normalized option set. */
  allowsCustom: boolean
}

/** A field whose answer may reference several normalized option identifiers. */
export interface ClarificationMultiField extends ClarificationFieldBase {
  mode: "multi"
  options: ClarificationOption[]
  /** Whether the operator may combine normalized selections with custom text. */
  allowsCustom: boolean
}

/** A field answered with protocol-free text rather than a choice identifier. */
export interface ClarificationTextField extends ClarificationFieldBase {
  mode: "text"
  options?: never
}

/** Every adapter-normalized field shape accepted by the core and downstream UI. */
export type ClarificationField =
  | ClarificationSingleField
  | ClarificationMultiField
  | ClarificationTextField

/** Adapter-normalized clarification content with no request or connection lifecycle data. */
export interface ClarificationPayload {
  title?: string
  context?: string
  prompt: string
  fields: ClarificationField[]
}

/** One structured answer, preserving option identity separately from custom text. */
export interface ClarificationAnswer {
  selectedOptionIds: string[]
  customText?: string
}

/** The closed terminal vocabulary shared by every clarification transport. */
export type ClarificationOutcome =
  | { kind: "submitted"; answers: Record<string, ClarificationAnswer> }
  | { kind: "skipped" }
  | { kind: "timed_out" }
  | { kind: "cancelled" }

/** User-owned lifecycle for one conversation in the workspace. */
export type ConversationLifecycle = "visible" | "background" | "closed"

/** Finite, protocol-free reasons why a conversation runtime is unavailable. */
export type ConversationUnavailableReason =
  | "provider-unavailable"
  | "connection-failed"
  | "restore-unavailable"
  | "teardown-failed"

/** Runtime standing exposed to the workspace without carrying raw ACP errors. */
export type ConversationAvailability =
  | { kind: "starting" }
  | { kind: "ready" }
  | {
      kind: "unavailable"
      reasonCode: ConversationUnavailableReason
      retryable: boolean
    }

/** Prevents duplicate teardown while lifecycle remains unchanged until success. */
export type TeardownState = "open" | "closing"

/** Workspace acknowledgement for the current execution-status epoch. */
export interface AttentionRecord {
  status: SessionStatus
  seen: boolean
  sequence: number
}

/** User-owned metadata for one non-Closed conversation. */
export interface WorkspaceConversation {
  sessionId: SessionId
  displayName: string
  lifecycle: Exclude<ConversationLifecycle, "closed">
  createdOrdinal: number
  availability: ConversationAvailability
  teardownState: TeardownState
  attention: AttentionRecord
}

/** Protocol-free workspace state; selection is nullable for a valid empty view. */
export interface WorkspaceState {
  conversations: Record<SessionId, WorkspaceConversation>
  order: SessionId[]
  selectedVisibleId: SessionId | null
}

/** Ephemeral workspace feedback; never persisted or sent to telemetry. */
export type WorkspaceNotice = { code: "no-provider-available" }

/**
 * The complete UI projection for an unsafe fresh-conversation start.
 *
 * Every field is a closed Kitten-owned enum. In particular, this shape has no
 * room for harness text, user task text, profile/version data, paths, raw errors,
 * ACP identifiers, or provider payloads.
 */
export const HARNESS_DELIVERY_FAILED_NOTICE = {
  state: "failed",
  reason: "safe_start_unavailable",
  recoveryAction: "start_fresh",
} as const

export type HarnessDeliveryNotice = typeof HARNESS_DELIVERY_FAILED_NOTICE

/** Reject any expanded or content-bearing object at an untyped boundary. */
export function isHarnessDeliveryNotice(value: unknown): value is HarnessDeliveryNotice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 3 &&
    record.state === HARNESS_DELIVERY_FAILED_NOTICE.state &&
    record.reason === HARNESS_DELIVERY_FAILED_NOTICE.reason &&
    record.recoveryAction === HARNESS_DELIVERY_FAILED_NOTICE.recoveryAction
}

/** Seed accepted by the pure workspace factory for boot and restore. */
export interface WorkspaceConversationSeed {
  sessionId: SessionId
  displayName: string
  lifecycle?: Exclude<ConversationLifecycle, "closed">
  createdOrdinal?: number
  availability?: ConversationAvailability
  teardownState?: TeardownState
  attention?: AttentionRecord
}

/** Pure workspace transitions. Runtime and I/O effects stay in the controller. */
export type WorkspaceEvent =
  | {
      kind: "create"
      sessionId: SessionId
      displayName: string
      availability?: ConversationAvailability
      initialStatus?: SessionStatus
    }
  | { kind: "rename"; sessionId: SessionId; displayName: string }
  | { kind: "select"; sessionId: SessionId }
  | { kind: "select_adjacent"; direction: "previous" | "next" }
  | { kind: "background"; sessionId: SessionId }
  | { kind: "reopen"; sessionId: SessionId }
  | { kind: "set_availability"; sessionId: SessionId; availability: ConversationAvailability }
  | { kind: "set_teardown_state"; sessionId: SessionId; teardownState: TeardownState }
  | { kind: "execution_status"; sessionId: SessionId; status: SessionStatus }
  | { kind: "close_succeeded"; sessionId: SessionId }

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

/** One selectable value within a {@link ConfigOption}: the opaque `value` sent back to the agent and its human-facing `name`. */
export interface ConfigSelectOption {
  value: string
  name: string
}

/**
 * A Kitten-owned, protocol-free config option advertised by an agent for a session
 * (ADR-003). Translated from the ACP config-option wire shape by the adapter, so no
 * SDK type leaks into the core. `category` is kept an opaque string (`"model"`,
 * `"thought_level"`, ...); the store and selectors never hardcode it as a named
 * field, and the UI filters to a visible allowlist (ADR-004). V1 models select
 * options only - boolean options are not represented.
 */
export interface ConfigOption {
  /** Opaque ACP config id, echoed back verbatim when changing the value. */
  id: string
  /** Opaque category id (`"model" | "thought_level" | ...`); never treated as a closed union here. */
  category: string
  label: string
  currentValue: string
  options: ConfigSelectOption[]
}

/** User-authored model and reasoning-effort preferences for one provider. */
export interface ProviderModelDefault {
  model?: string
  effort?: string
}

/**
 * Protocol-free terminal outcome of the latest explicit provider-default attempt.
 * Values appear only after the live provider has confirmed them.
 */
export type DefaultApplyResult =
  | { kind: "none" }
  | { kind: "applied"; model: string; effort?: string }
  | { kind: "applied"; effort: string; model?: undefined }
  | { kind: "partial"; model: string; unavailable: "effort" }
  | { kind: "unavailable"; unavailable: "model" | "effort" | "session" }

/**
 * A protocol-free slash command advertised by an agent for one live session.
 *
 * ACP owns the wire representation (including its extensibility metadata and
 * input wrapper); the adapter flattens that shape before it reaches this core
 * model.
 */
export interface AvailableCommand {
  /** The command token without a leading slash (for example, `review`). */
  name: string
  /** Human-readable explanation shown in Kitten's command menu. */
  description: string
  /** Optional free-form argument hint supplied by the agent. */
  hint?: string
}

/** Context-window usage reported by an agent; `percent` is normalized to [0, 1]. */
export interface ContextUsage {
  used: number
  size: number
  percent: number
}

/** The config-option category id for the model picker. */
export const MODEL_CATEGORY = "model"
/** The config-option category id for the reasoning-effort picker (ACP `thought_level`). */
export const EFFORT_CATEGORY = "thought_level"

/**
 * The only config-option categories the UI ever surfaces (ADR-004): the model and
 * reasoning-effort pickers. This is a fail-closed allowlist, not a denylist - every
 * other category (`mode`, whose Claude values include `bypassPermissions`,
 * `model_config`, and any future or unknown category) is filtered out before any
 * rendering, so the selector can never expose a permission-mode toggle.
 */
export const VISIBLE_CATEGORIES: readonly string[] = [MODEL_CATEGORY, EFFORT_CATEGORY]

/**
 * Keep only the {@link VISIBLE_CATEGORIES} allowlisted options, dropping every other
 * category (ADR-004). Pure and order-preserving; the caller memoizes the result so a
 * fresh array does not thrash a subscriber (the per-agent selectors stay referentially
 * stable by returning the unfiltered slice).
 */
export const visibleConfigOptions = (options: ConfigOption[]): ConfigOption[] =>
  options.filter((option) => VISIBLE_CATEGORIES.includes(option.category))

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
  /** Internal requests remain visible in the live transcript but are not retained for resume. */
  persist?: boolean
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

/** One provider-neutral prompt fragment. V1 steering carries plain text only. */
export interface PromptBlock {
  readonly type: "text"
  readonly text: string
}

/** Closed lifecycle vocabulary for one accepted steering request. */
export type SteeringPhase =
  | "idle"
  | "queued"
  | "waiting"
  | "cancelling"
  | "settling"
  | "sending"
  | "failed"

/** One generation-fenced direction accepted during an active turn. */
export interface SteeringRequest {
  readonly id: string
  readonly generation: number
  readonly blocks: readonly PromptBlock[]
  readonly phase: SteeringPhase
}

/** Live-only steering truth. Raw blocks are cleared only by delivery or acknowledgement. */
export interface SteeringState {
  readonly activeTurnId: string | null
  readonly queue: readonly SteeringRequest[]
  readonly recovery: readonly PromptBlock[] | null
}

/** Pure steering lifecycle events emitted by later controller work. */
export type SteeringEvent =
  | {
      readonly kind: "steering_enqueue"
      readonly activeTurnId: string
      readonly requestId: string
      readonly generation: number
      readonly blocks: readonly PromptBlock[]
    }
  | {
      readonly kind:
        | "steering_wait"
        | "steering_cancel"
        | "steering_settle"
        | "steering_send"
        | "steering_recover"
        | "steering_acknowledge_recovery"
      readonly requestId: string
      readonly generation: number
    }
  | {
      readonly kind: "steering_deliver"
      readonly requestId: string
      readonly generation: number
      readonly messageId: string
    }

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
  /** Controller-produced managed-worktree identity, when this session owns one. */
  readonly worktreeBinding?: ManagedWorktreeBinding
  /** The ACP session id, when already known; defaults to `""` (not yet handshaken). */
  acpSessionId?: string
}

/** Raw context-window usage reported by an agent. */
export interface SessionUsage {
  /** Tokens currently in the agent's context window. */
  used: number
  /** Total context-window size in tokens. */
  size: number
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
  /** The session working tree's current branch, when it can be resolved. */
  branch?: string
  task?: string
  /** Immutable managed-worktree identity and bounded controller-published review state. */
  readonly worktreeBinding?: ManagedWorktreeBinding
  acpSessionId: string
  turns: Turn[]
  status: SessionStatus
  /** File path -> strongest access seen. `edited` takes precedence over `read`. */
  referencedFiles: Map<string, "read" | "edited">
  /** Edit diffs proposed but not yet applied/approved. */
  pendingDiffs: PendingDiff[]
  /** The agent's most recently reported plan, if any. */
  plan: PlanEntry[]
  /** Raw agent-reported context usage; undefined until the first report. */
  usage?: SessionUsage
  /**
   * The full set of config options the agent has advertised for this session
   * (ADR-003), replaced wholesale on every `config_options` event because the
   * agent always returns the complete set. Empty when nothing is advertised.
   */
  configOptions: ConfigOption[]
  /** Terminal result of the latest explicit provider-default attempt, if any. */
  defaultApplyResult: DefaultApplyResult | null
  /** The latest complete slash-command list advertised for this session. */
  commands: AvailableCommand[]
  /** Current-run composer submissions and recall position, private to this session. */
  promptHistory: PromptHistoryState
  /** Reducer-owned, live-only mid-turn steering lifecycle. */
  steering: SteeringState
}

/** One semantically bounded shell command and its captured raw output. */
export interface ShellCommandRecord {
  id: string
  command: string
  /** Unredacted terminal output; redaction happens only during hand-off assembly. */
  output: string
  /** `null` while the command is running. */
  exitCode: number | null
}

/** Protocol-free semantic state for the persistent shell. */
export interface ShellState {
  status: "idle" | "running"
  cwd: string
  /** Bounded most-recent-first-by-retention command ring in execution order. */
  commands: ShellCommandRecord[]
  /** Revision of the imperative terminal screen exposed to store subscribers. */
  renderRev: number
}

/** Stable shell context captured for the curated hand-off flow. */
export interface ShellSnapshot {
  cwd: string
  commands: ShellCommandRecord[]
}

/** Semantic events emitted by the shell runtime and folded by `shellReducer`. */
export type ShellEvent =
  | { kind: "screen"; rev: number }
  | { kind: "command_started"; id: string; command: string }
  | { kind: "command_finished"; id: string; exitCode: number; output: string }
  | { kind: "cwd_changed"; cwd: string }

/**
 * The normalized domain events the reducer consumes, translated from the ACP
 * `SessionNotification` union by the adapter. No ACP wire type appears here.
 */
export type DomainSessionEvent =
  | { kind: "agent_message"; messageId: string; textDelta: string }
  | { kind: "user_message"; messageId: string; text: string; persist?: boolean }
  | { kind: "tool_call"; call: ToolCallUpdate } // upsert by toolCallId
  | { kind: "plan"; entries: PlanEntry[] }
  | { kind: "status"; status: SessionStatus }
  | { kind: "usage"; used: number; size: number }
  | { kind: "branch"; branch: string }
  | { kind: "config_options"; options: ConfigOption[] } // wholesale replace of the advertised config option set
  | { kind: "default_apply_result"; result: DefaultApplyResult }
  | { kind: "commands"; commands: AvailableCommand[] } // wholesale replace of the advertised slash-command set
  | PromptHistoryEvent
  | SteeringEvent

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
  /** Redacted shell state offered to the developer for explicit preview curation. */
  shell?: ShellSnapshot
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
 * Whether a resolved provider recipe may use Kitten's structured clarification
 * path. This stays protocol-free; ACP capability types remain in `src/agent`.
 */
export type ClarificationCapability =
  | { status: "supported"; adapterPackage: string; adapterVersion: string }
  | {
      status: "unsupported"
      reason: "unknown_recipe" | "recipe_overridden" | "unverified_recipe"
    }

/** A protocol-free stdio MCP server declaration shared by every agent session. */
export interface McpServerConfig {
  name: string
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
 * Runtime-only provider behavior derived from a fully merged recipe. The certified
 * branch is sealed to Cursor's native ACP command and carries no protocol types.
 */
export type ProviderRuntimeProfile =
  | { readonly kind: "standard" }
  | {
      readonly kind: "cursor-certified"
      readonly command: "agent"
      readonly args: readonly ["acp"]
      readonly env: Readonly<Record<string, string>>
      readonly certifiedVersion: string
      readonly authenticationMethod: "cursor_login"
    }

/** A provider config after all runtime-only capability classification. */
export interface ResolvedAgentConfig extends AgentConfig {
  clarificationCapability: ClarificationCapability
  runtimeProfile: ProviderRuntimeProfile
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

/** A curated, named theme palette that can be persisted as a user preference. */
export type ThemePresetId = "catppuccin-mocha" | "catppuccin-latte"

/** The user's persisted theme choice; `auto` follows the terminal-reported mode. */
export type ThemePreference = "auto" | "light" | "dark" | ThemePresetId

/** Whether the welcome banner follows first-run state, always expands, or stays hidden. */
export type WelcomeBannerPreference = "auto" | "always" | "off"

/** Fully resolved policy for the controller-owned integrated shell. */
export interface ShellConfig {
  enabled: boolean
  command: string
  scrollback: number
}

/**
 * The loaded application configuration (ADR-005). `providers` is the map of spawn
 * recipes keyed by kind; `sessions` is the ordered fleet to open. An empty `sessions`
 * list means zero-config: one session per configured provider in the launch directory.
 */
export interface AppConfig {
  providers: Record<ProviderKind, ProviderRecipe>
  providerDefaults: Partial<Record<ProviderKind, ProviderModelDefault>>
  sessions: SessionDescriptor[]
  mcpServers: McpServerConfig[]
  shell: ShellConfig
  /** Kitten-owned whole-form clarification timeout; callers cannot override it per request. */
  clarificationTimeoutSeconds: number
  persistenceEnabled: boolean
  telemetryEnabled: boolean
  theme: ThemePreference
  welcomeBanner: WelcomeBannerPreference
  statusline: StatuslinePreference
}

/**
 * A {@link SessionDescriptor} resolved into the per-session input the controller
 * consumes without further transformation: the {@link SessionSeed} that fixes the
 * session's identity and placement, plus the {@link AgentConfig} its connection is
 * spawned from.
 */
export interface ResolvedSession {
  seed: SessionSeed
  spawn: ResolvedAgentConfig
}

/** A content-free telemetry record (opt-in, local JSONL only). */
export interface TelemetryEvent {
  type: string
  at: number
  sessionRef: string
  charBucket?: number // never prompt/code content
}
