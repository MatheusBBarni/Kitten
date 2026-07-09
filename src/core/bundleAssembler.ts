/**
 * Hand-off bundle assembly.
 *
 * When the developer presses the hand-off key, Kitten turns the source agent's
 * live {@link SessionState} into a {@link HandoffBundle}: a bounded transcript
 * excerpt, the set of files the agent touched, and the diffs it proposed but
 * has not applied. The bundle is redacted, then shown in the preview-and-edit
 * overlay, then sent to the target agent as a prompt.
 *
 * V1 assembles the bundle **deterministically** from ACP's structured session
 * data rather than asking a model to curate it (ADR-002). The human preview is
 * the curation step. {@link BundleAssembler} is deliberately a one-method
 * interface so the Phase 2 LLM-backed assembler drops in behind it without any
 * caller changing.
 *
 * This module is part of the pure Domain Core (ADR-003): no I/O, no ACP SDK, no
 * UI. `assemble` never mutates the session it is given, and the same session
 * always yields the same bundle.
 */

import { createSecretRedactor, type SecretRedactor } from "./secretRedactor.ts"
import type { AgentId, HandoffBundle, PendingDiff, SessionState, Turn } from "./types.ts"

/**
 * The hand-off assembly strategy (TechSpec "Core Interfaces").
 *
 * Deterministic in V1, LLM-backed in Phase 2, without touching callers.
 */
export interface BundleAssembler {
  assemble(session: SessionState, target: AgentId): HandoffBundle
}

/** The bounds that keep the transcript excerpt from becoming a full dump. */
export interface BundleLimits {
  /** How many of the most recent turns are eligible for the excerpt. */
  maxTurns: number
  /** Per-turn cap; a longer turn is truncated with a visible marker. */
  maxTurnChars: number
  /** Hard cap on the assembled `summary` string. */
  maxSummaryChars: number
}

export const DEFAULT_BUNDLE_LIMITS: BundleLimits = {
  maxTurns: 20,
  maxTurnChars: 600,
  maxSummaryChars: 4000,
}

export interface DeterministicAssemblerOptions {
  limits?: Partial<BundleLimits>
  redactor?: SecretRedactor
}

/** Appended to a turn whose text was cut to fit {@link BundleLimits.maxTurnChars}. */
const TRUNCATION_MARKER = " [truncated]"

/** Shown when the transcript has no turns at all. */
const EMPTY_TRANSCRIPT = "No transcript yet."

/**
 * Room reserved inside `maxSummaryChars` for the omitted-turns notice, so the
 * final summary honours the cap exactly rather than overshooting by the notice.
 */
const OMISSION_NOTICE_RESERVE = 48

/**
 * Build the V1 deterministic assembler.
 *
 * The referenced file set and the pending diffs are read straight off the
 * session: the reducer already derives them from tool-call `locations` and from
 * `edit`-kind tool calls, and recomputes them on every event, so they cannot
 * drift from the transcript. Assembly's own job is to bound the excerpt, order
 * the files stably, and redact everything before it leaves.
 */
export function createDeterministicAssembler(options: DeterministicAssemblerOptions = {}): BundleAssembler {
  const limits: BundleLimits = { ...DEFAULT_BUNDLE_LIMITS, ...options.limits }
  const redactor = options.redactor ?? createSecretRedactor()

  return {
    assemble(session: SessionState, target: AgentId): HandoffBundle {
      const excerpt = buildExcerpt(session, target, redactor, limits)
      const diffs = redactDiffs(session.pendingDiffs, redactor)

      return {
        intent: "continue",
        summary: excerpt.summary,
        files: collectFiles(session),
        pendingDiffs: diffs.pendingDiffs,
        redactionCount: excerpt.redactionCount + diffs.redactionCount,
      }
    },
  }
}

/**
 * The referenced file set, sorted by path so the same session always renders
 * the same list. `edited` already wins over `read` in the reducer's derivation.
 */
function collectFiles(session: SessionState): HandoffBundle["files"] {
  return [...session.referencedFiles].map(([path, reason]) => ({ path, reason })).sort(byPath)
}

function byPath(a: { path: string }, b: { path: string }): number {
  if (a.path === b.path) return 0
  return a.path < b.path ? -1 : 1
}

/** Redact every pending diff's unified text, leaving `path` and id untouched. */
function redactDiffs(
  pendingDiffs: readonly PendingDiff[],
  redactor: SecretRedactor,
): { pendingDiffs: PendingDiff[]; redactionCount: number } {
  let redactionCount = 0
  const redacted = pendingDiffs.map((diff) => {
    const result = redactor.redact(diff.unified)
    redactionCount += result.count
    return { toolCallId: diff.toolCallId, path: diff.path, unified: result.text }
  })
  return { pendingDiffs: redacted, redactionCount }
}

/**
 * Render a bounded excerpt of the tail of the transcript.
 *
 * Turns are taken newest-first until the character budget runs out, then
 * re-ordered back into transcript order. Working backwards means the excerpt
 * always ends at the agent's most recent state, which is what the target agent
 * needs to continue, and it means a turn is either included whole or dropped
 * whole. Anything dropped is announced rather than silently swallowed.
 *
 * Each turn is redacted *before* it is truncated: truncating first could cut a
 * credential in half and leave the remainder unmatchable, and so unredacted.
 * Only the redactions inside surviving turns are counted, so `redactionCount`
 * describes the bundle the developer is actually looking at.
 */
function buildExcerpt(
  session: SessionState,
  target: AgentId,
  redactor: SecretRedactor,
  limits: BundleLimits,
): { summary: string; redactionCount: number } {
  const header = `Transcript excerpt from ${session.agentId} (intent: continue, target: ${target}).`

  const eligible = limits.maxTurns > 0 ? session.turns.slice(-limits.maxTurns) : []
  let omitted = session.turns.length - eligible.length

  const budget = limits.maxSummaryChars - header.length - OMISSION_NOTICE_RESERVE
  const entries: string[] = []
  let used = 0
  let redactionCount = 0

  for (let i = eligible.length - 1; i >= 0; i -= 1) {
    const rendered = renderTurn(eligible[i] as Turn, session.agentId, redactor, limits.maxTurnChars)
    // +1 for the newline that will join this entry to the next.
    if (used + rendered.text.length + 1 > budget) {
      omitted += i + 1
      break
    }
    used += rendered.text.length + 1
    redactionCount += rendered.redactionCount
    entries.unshift(rendered.text)
  }

  const notice = omitted > 0 ? `[${omitted} earlier turn(s) omitted]` : undefined
  const body = entries.length > 0 ? entries.join("\n") : EMPTY_TRANSCRIPT
  const summary = [header, "", notice, body].filter((part) => part !== undefined).join("\n")

  // The reserve above already keeps us inside the cap; slicing makes the bound
  // unconditional even for a caller-supplied `maxSummaryChars` smaller than the
  // header. Cutting the tail can only shorten a placeholder, never expose text.
  return { summary: summary.slice(0, Math.max(0, limits.maxSummaryChars)), redactionCount }
}

/** Redact a single turn, then bound it. Tool calls render as a one-line row. */
function renderTurn(
  turn: Turn,
  agentId: AgentId,
  redactor: SecretRedactor,
  maxTurnChars: number,
): { text: string; redactionCount: number } {
  const raw = formatTurn(turn, agentId)
  const { text, count } = redactor.redact(raw)
  return { text: truncate(text, maxTurnChars), redactionCount: count }
}

function formatTurn(turn: Turn, agentId: AgentId): string {
  switch (turn.kind) {
    case "user":
      return `user: ${turn.text}`
    case "agent":
      return `${agentId}: ${turn.text}`
    case "tool_call": {
      const { kind, status, title, locations } = turn.record
      const where = locations.length > 0 ? ` (${locations.join(", ")})` : ""
      return `tool[${kind}/${status}] ${title}${where}`
    }
    default:
      return assertNever(turn)
  }
}

/** Cut to `max` characters, reserving room for the marker so the bound holds. */
function truncate(text: string, max: number): string {
  if (max <= 0) return ""
  if (text.length <= max) return text
  if (max <= TRUNCATION_MARKER.length) return text.slice(0, max)
  return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
}

/** Exhaustiveness guard: a compile error here means a turn kind is unhandled. */
function assertNever(turn: never): never {
  throw new Error(`Unhandled turn: ${JSON.stringify(turn)}`)
}
