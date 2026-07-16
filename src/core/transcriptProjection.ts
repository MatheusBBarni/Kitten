import type { Turn } from "./types.ts"

/** Inputs that identify transcript rows which must remain visible. */
export interface TranscriptProtection {
  /** Number of authoritative turns retained at the live edge before expansion. */
  readonly tailTurnCount: number
  /** Agent message currently receiving streamed deltas, when one exists. */
  readonly activeStreamingMessageId: string | null
  /** Tool identities the caller currently owns as pending or in progress. */
  readonly activeToolCallIds: readonly string[]
  /** Tool identity owned by the active approval overlay, when one exists. */
  readonly approvalToolCallId: string | null
}

/** Complete immutable input to the pure transcript projection. */
export interface TranscriptProjectionInput {
  readonly turns: readonly Turn[]
  readonly enabled: boolean
  /** Additional turns to reveal immediately before the configured live tail. */
  readonly revealedTurnCount: number
  readonly protection: TranscriptProtection
}

/** One retained authoritative transcript turn with its absolute source identity. */
export interface TranscriptTurnRow {
  readonly kind: "turn"
  readonly key: string
  readonly turn: Turn
}

/** The single optional row representing the exact collapsed absolute range. */
export interface TranscriptHistoryMarkerRow {
  readonly kind: "history_marker"
  readonly key: string
  readonly hiddenTurnCount: number
}

export type TranscriptProjectionRow = TranscriptTurnRow | TranscriptHistoryMarkerRow

/** Bounded presentation rows and the exact number of omitted authoritative turns. */
export interface TranscriptProjection {
  readonly rows: readonly TranscriptProjectionRow[]
  readonly hiddenTurnCount: number
}

/**
 * Project the authoritative transcript into one optional marker and a contiguous
 * retained suffix. The function holds no cache and never mutates or copies a turn.
 */
export function projectTranscript(input: TranscriptProjectionInput): TranscriptProjection {
  const { turns } = input
  if (turns.length === 0) return { rows: [], hiddenTurnCount: 0 }

  if (!input.enabled) return fullProjection(turns)

  const tailTurnCount = boundedCount(input.protection.tailTurnCount, turns.length)
  const revealedTurnCount = boundedCount(input.revealedTurnCount, turns.length)
  const tailStart = turns.length - tailTurnCount
  let retainedStart = Math.max(0, tailStart - revealedTurnCount)

  const activeToolCallIds = new Set(input.protection.activeToolCallIds)
  for (let index = 0; index < retainedStart; index += 1) {
    const turn = turns[index]
    if (turn && isProtected(turn, input.protection, activeToolCallIds)) {
      retainedStart = index
      break
    }
  }

  return projectionFrom(turns, retainedStart)
}

function fullProjection(turns: readonly Turn[]): TranscriptProjection {
  return projectionFrom(turns, 0)
}

function projectionFrom(turns: readonly Turn[], retainedStart: number): TranscriptProjection {
  const rows: TranscriptProjectionRow[] = []
  if (retainedStart > 0) {
    rows.push({
      kind: "history_marker",
      key: `history:0-${retainedStart - 1}`,
      hiddenTurnCount: retainedStart,
    })
  }

  for (let index = retainedStart; index < turns.length; index += 1) {
    rows.push({ kind: "turn", key: `turn:${index}`, turn: turns[index]! })
  }

  return { rows, hiddenTurnCount: retainedStart }
}

function isProtected(
  turn: Turn,
  protection: TranscriptProtection,
  activeToolCallIds: ReadonlySet<string>,
): boolean {
  if (turn.kind === "agent") {
    return turn.messageId === protection.activeStreamingMessageId
  }
  if (turn.kind !== "tool_call") return false

  return (
    turn.record.status === "pending" ||
    turn.record.status === "in_progress" ||
    activeToolCallIds.has(turn.record.toolCallId) ||
    turn.record.toolCallId === protection.approvalToolCallId
  )
}

function boundedCount(value: number, upperBound: number): number {
  if (value === Number.POSITIVE_INFINITY) return upperBound
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), upperBound)
}
