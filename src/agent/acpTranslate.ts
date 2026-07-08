/**
 * ACP → domain translation (the anti-corruption boundary, ADR-003).
 *
 * This module is the ONLY place that reads ACP `SessionUpdate` wire shapes and
 * turns them into Kitten's protocol-free {@link DomainSessionEvent}s. It is pure:
 * no I/O, no subprocess, no ACP connection object. `agentConnection.ts` owns the
 * transport and lifecycle; this file owns the shape mapping so no ACP field ever
 * escapes upward.
 *
 * The ACP SDK is imported here (and in the sibling adapter/transport modules)
 * only; nothing under `src/core` or above `src/agent` may import it.
 */

import type {
  ContentBlock,
  Diff,
  PlanEntry as AcpPlanEntry,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate as AcpToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk"

import type { DomainSessionEvent, PlanEntry, ToolCallDiff, ToolCallKind, ToolCallUpdate } from "../core/types.ts"

/**
 * Translate one ACP `SessionUpdate` into a domain event, or `null` for variants
 * Kitten does not surface in V1 (thoughts, plan deltas, mode/command/config/usage
 * notifications). Returning `null` keeps the caller's dispatch loop trivial.
 */
export function translateSessionUpdate(update: SessionUpdate): DomainSessionEvent | null {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const text = extractText(update.content)
      if (text === null) return null
      return { kind: "user_message", messageId: messageIdOf(update.messageId), text }
    }
    case "agent_message_chunk": {
      const text = extractText(update.content)
      if (text === null) return null
      return { kind: "agent_message", messageId: messageIdOf(update.messageId), textDelta: text }
    }
    case "tool_call":
    case "tool_call_update":
      return { kind: "tool_call", call: translateToolCall(update) }
    case "plan":
      return { kind: "plan", entries: update.entries.map(translatePlanEntry) }
    // Deliberately not surfaced in V1 (documented in the module header).
    case "agent_thought_chunk":
    case "plan_update":
    case "plan_removed":
    case "available_commands_update":
    case "current_mode_update":
    case "config_option_update":
    case "session_info_update":
    case "usage_update":
      return null
    default:
      // A new ACP update variant appeared; ignore it rather than leak it upward.
      return null
  }
}

/**
 * Translate an ACP `ToolCall` (new) or `ToolCallUpdate` (delta) into the domain
 * {@link ToolCallUpdate} partial the reducer upserts by `toolCallId`.
 *
 * Field semantics mirror the reducer's merge rules: an absent field is omitted so
 * the reducer preserves the prior value; a provided `content` array without a diff
 * block clears the stored diff via an explicit `null`.
 */
export function translateToolCall(tc: ToolCall | AcpToolCallUpdate): ToolCallUpdate {
  const call: ToolCallUpdate = { toolCallId: tc.toolCallId }
  if (tc.kind != null) call.kind = mapKind(tc.kind)
  if (tc.title != null) call.title = tc.title
  if (tc.status != null) call.status = tc.status
  if (tc.locations != null) call.locations = tc.locations.map((l) => l.path)
  const diff = translateDiff(tc.content)
  if (diff !== undefined) call.diff = diff
  return call
}

/** Map an ACP `ToolKind` onto the narrower domain {@link ToolCallKind}. */
function mapKind(kind: ToolKind): ToolCallKind {
  // ACP adds `switch_mode`, which has no domain analogue; everything else is 1:1.
  return kind === "switch_mode" ? "other" : kind
}

function translatePlanEntry(entry: AcpPlanEntry): PlanEntry {
  return { content: entry.content, priority: entry.priority, status: entry.status }
}

/**
 * Extract a domain diff from an ACP tool-call `content` collection.
 *
 * - `undefined` when `content` is absent: the update does not touch the diff.
 * - `null` when `content` is present but carries no diff block: clear the diff.
 * - a {@link ToolCallDiff} for the first diff block present.
 *
 * V1 collapses a multi-file edit to its first diff; the tool call's `locations`
 * still capture every touched path.
 */
function translateDiff(content: Array<ToolCallContent> | null | undefined): ToolCallDiff | null | undefined {
  if (content == null) return undefined
  const diff = content.find((c): c is Diff & { type: "diff" } => c.type === "diff")
  if (diff === undefined) return null
  return { path: diff.path, unified: toUnifiedDiff(diff.path, diff.oldText ?? null, diff.newText) }
}

/** Read the text out of a content block, or `null` for non-text content. */
function extractText(content: ContentBlock): string | null {
  return content.type === "text" ? content.text : null
}

/** ACP messages carry an optional `messageId`; fall back to a stable empty key. */
function messageIdOf(messageId: string | null | undefined): string {
  return messageId ?? ""
}

/**
 * Render a line-based unified diff from an ACP structured diff. ACP ships
 * `oldText`/`newText`, but the domain (and the hand-off bundle) store a single
 * `unified` string, so the adapter synthesizes one with a minimal LCS diff.
 */
export function toUnifiedDiff(path: string, oldText: string | null, newText: string): string {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const ops = diffLines(oldLines, newLines)

  const removed = ops.reduce((n, op) => (op.tag === "+" ? n : n + 1), 0)
  const added = ops.reduce((n, op) => (op.tag === "-" ? n : n + 1), 0)
  const oldStart = removed === 0 ? 0 : 1
  const newStart = added === 0 ? 0 : 1

  const header = [`--- a/${path}`, `+++ b/${path}`, `@@ -${oldStart},${removed} +${newStart},${added} @@`]
  const body = ops.map((op) => `${op.tag}${op.text}`)
  return [...header, ...body].join("\n")
}

/** `""` is zero lines; otherwise split on newlines (a trailing "\n" yields a final "" line). */
function splitLines(text: string | null): string[] {
  if (text === null || text === "") return []
  return text.split("\n")
}

interface DiffOp {
  tag: " " | "-" | "+"
  text: string
}

/**
 * Classify each line as context (` `), removal (`-`), or addition (`+`) using a
 * longest-common-subsequence backtrace, so unchanged lines are shared rather than
 * shown as a delete-then-add of the whole file.
 */
function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length
  const width = m + 1
  const lcs = new Int32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (oldLines[i] === newLines[j]) {
        lcs[idx] = lcs[(i + 1) * width + (j + 1)]! + 1
      } else {
        lcs[idx] = Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + (j + 1)]!)
      }
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ tag: " ", text: oldLines[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + (j + 1)]!) {
      ops.push({ tag: "-", text: oldLines[i]! })
      i++
    } else {
      ops.push({ tag: "+", text: newLines[j]! })
      j++
    }
  }
  while (i < n) ops.push({ tag: "-", text: oldLines[i++]! })
  while (j < m) ops.push({ tag: "+", text: newLines[j++]! })
  return ops
}
