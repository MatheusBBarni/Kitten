/**
 * The pure `SessionState` reducer.
 *
 * This is the single writer of {@link SessionState}. Given a current state and one
 * {@link DomainSessionEvent}, it returns a NEW state: it never mutates its input,
 * performs no I/O, and imports nothing from the ACP SDK (ADR-003). Because it is
 * deterministic and side-effect free, it is exhaustively unit-tested from fixtures.
 *
 * `referencedFiles` and `pendingDiffs` are not stored incrementally; they are
 * recomputed as pure derivations of the tool-call turns after each event, so they
 * can never drift from the transcript.
 */

import { createPromptHistoryState, promptHistoryReducer } from "./promptHistory.ts"
import type {
  DomainSessionEvent,
  PendingDiff,
  SessionSeed,
  SessionState,
  ToolCallRecord,
  ToolCallTurn,
  ToolCallUpdate,
  Turn,
} from "./types.ts"

/**
 * Create the empty starting state for one session from its {@link SessionSeed}.
 *
 * Identity fields (`id`, `providerKind`, `title`, `cwd`, `task`) come from the seed
 * and survive a later `startSession`; the transcript, status, and derived fields
 * start empty. `acpSessionId` defaults to `""` until the ACP handshake binds one.
 */
export function createSessionState(seed: SessionSeed): SessionState {
  return {
    id: seed.id,
    providerKind: seed.providerKind,
    title: seed.title,
    cwd: seed.cwd,
    branch: undefined,
    task: seed.task,
    acpSessionId: seed.acpSessionId ?? "",
    turns: [],
    status: "idle",
    referencedFiles: new Map(),
    pendingDiffs: [],
    plan: [],
    usage: undefined,
    configOptions: [],
    commands: [],
    promptHistory: createPromptHistoryState(),
  }
}

/** Apply one domain event to the state, returning a new state (no mutation). */
export function sessionReducer(state: SessionState, event: DomainSessionEvent): SessionState {
  switch (event.kind) {
    case "user_message":
      return withDerived({
        ...state,
        turns: [...state.turns, { kind: "user", messageId: event.messageId, text: event.text }],
      })

    case "agent_message":
      return withDerived({ ...state, turns: applyAgentMessage(state.turns, event.messageId, event.textDelta) })

    case "tool_call":
      return withDerived({ ...state, turns: applyToolCall(state.turns, event.call) })

    case "plan":
      // Latest plan wins; the plan does not alter the transcript turns.
      return { ...state, plan: event.entries }

    case "status":
      // Status changes never touch turns or derived fields.
      return { ...state, status: event.status }

    case "usage":
      // Usage updates replace only the latest raw context-window fact.
      return { ...state, usage: { used: event.used, size: event.size } }

    case "branch":
      // Branch refreshes replace only the off-render-path git value. A blank
      // event clears the optional field so hide-when-absent selectors return null.
      return { ...state, branch: event.branch || undefined }

    case "config_options":
      // The agent always returns the complete option set, so replace wholesale
      // (ADR-003); config options never touch turns, status, or derived fields.
      return { ...state, configOptions: event.options }

    case "commands":
      // Agents advertise a complete command set. The newest update wins without
      // changing transcript, status, or any derived fields.
      return { ...state, commands: event.commands }

    case "prompt_history": {
      const promptHistory = promptHistoryReducer(state.promptHistory, event)
      return promptHistory === state.promptHistory ? state : { ...state, promptHistory }
    }

    default:
      return assertNever(event)
  }
}

/**
 * Append a new agent turn for a fresh `messageId`, or concatenate the delta onto
 * the existing agent turn with that `messageId`. Only the most recent agent turn
 * can be extended, matching how streamed message chunks arrive.
 */
function applyAgentMessage(turns: Turn[], messageId: string, textDelta: string): Turn[] {
  const last = turns[turns.length - 1]
  if (last?.kind === "agent" && last.messageId === messageId) {
    const merged: Turn = { ...last, text: last.text + textDelta }
    return [...turns.slice(0, -1), merged]
  }
  return [...turns, { kind: "agent", messageId, text: textDelta }]
}

/**
 * Upsert a tool call by `toolCallId`: merge into the existing turn if present,
 * otherwise append a new tool-call turn. Ordering of existing turns is preserved.
 */
function applyToolCall(turns: Turn[], update: ToolCallUpdate): Turn[] {
  const index = turns.findIndex((t) => t.kind === "tool_call" && t.record.toolCallId === update.toolCallId)
  if (index === -1) {
    const turn: ToolCallTurn = { kind: "tool_call", record: mergeToolCall(undefined, update) }
    return [...turns, turn]
  }
  const existing = turns[index] as ToolCallTurn
  const turn: ToolCallTurn = { kind: "tool_call", record: mergeToolCall(existing.record, update) }
  return turns.map((t, i) => (i === index ? turn : t))
}

/**
 * Merge an update into a tool-call record.
 *
 * - New record: start from conservative defaults, then apply provided fields.
 * - Existing record: an omitted (`undefined`) field preserves the prior value; a
 *   provided value replaces it; `diff` set to `null` explicitly clears the diff.
 */
function mergeToolCall(existing: ToolCallRecord | undefined, update: ToolCallUpdate): ToolCallRecord {
  const base: ToolCallRecord = existing ?? {
    toolCallId: update.toolCallId,
    kind: "other",
    title: "",
    status: "pending",
    locations: [],
  }

  const merged: ToolCallRecord = {
    toolCallId: base.toolCallId,
    kind: update.kind ?? base.kind,
    title: update.title ?? base.title,
    status: update.status ?? base.status,
    locations: update.locations ?? base.locations,
    diff: base.diff,
  }

  if (update.diff === null) {
    delete merged.diff
  } else if (update.diff !== undefined) {
    merged.diff = update.diff
  }

  return merged
}

/** Recompute the fields derived from tool-call turns and return a new state. */
function withDerived(state: SessionState): SessionState {
  return {
    ...state,
    referencedFiles: deriveReferencedFiles(state.turns),
    pendingDiffs: derivePendingDiffs(state.turns),
  }
}

/**
 * Fold every tool-call turn's locations into a file -> access map. `edit`-kind
 * calls mark a path `edited`; any other kind marks it `read`. `edited` is sticky:
 * once a path is edited it stays edited regardless of later reads, and regardless
 * of turn order.
 */
function deriveReferencedFiles(turns: Turn[]): Map<string, "read" | "edited"> {
  const files = new Map<string, "read" | "edited">()
  for (const turn of turns) {
    if (turn.kind !== "tool_call") continue
    const access = turn.record.kind === "edit" ? "edited" : "read"
    for (const path of turn.record.locations) {
      if (access === "edited" || files.get(path) !== "edited") {
        files.set(path, access)
      }
    }
  }
  return files
}

/**
 * Collect the diffs of `edit`-kind tool calls that carry a diff and are not yet
 * applied. `completed` means applied and `failed` is terminal, so only `pending`
 * and `in_progress` edits contribute a {@link PendingDiff}.
 */
function derivePendingDiffs(turns: Turn[]): PendingDiff[] {
  const pending: PendingDiff[] = []
  for (const turn of turns) {
    if (turn.kind !== "tool_call") continue
    const { record } = turn
    const unapplied = record.status === "pending" || record.status === "in_progress"
    if (record.kind === "edit" && record.diff && unapplied) {
      pending.push({ toolCallId: record.toolCallId, path: record.diff.path, unified: record.diff.unified })
    }
  }
  return pending
}

/** Exhaustiveness guard: a compile error here means an event kind is unhandled. */
function assertNever(event: never): never {
  throw new Error(`Unhandled domain session event: ${JSON.stringify(event)}`)
}
