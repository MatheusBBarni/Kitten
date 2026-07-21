/**
 * Telemetry heuristics: pure predicates over session activity (ADR-003).
 *
 * These live in the domain core, not the recorder, because they are the honest
 * definitions the PRD kill-or-scale gate is measured against and they must be
 * unit-testable without any I/O. They take counts and event shapes and return
 * counts and booleans - never prompt or code text - so a recorder built on them is
 * content-free by construction (TechSpec "Monitoring and Observability", PRD privacy
 * stance).
 *
 * The re-explanation heuristic is a flagged prototype (TechSpec "Known Risks"): the
 * threshold below is a starting point to tune against real usage, and the whole
 * measure is biased to under-count (like the redactor) so a hand-off is credited
 * with eliminating re-explanation only when the evidence is clear.
 */

/**
 * Coarse character buckets, ascending. A measured count is reported as the largest
 * boundary it reaches, so the stored value is always one of these fixed numbers and
 * never the exact length of anything the developer typed.
 */
export const CHAR_BUCKETS: readonly number[] = [0, 50, 100, 250, 500, 1000, 2500, 5000]

/**
 * Map an exact character count to its coarse bucket: the largest {@link CHAR_BUCKETS}
 * boundary that is `<= count`. This is the content-free quantization every stored
 * char metric passes through - a count of 137 is stored as 100, never as 137.
 */
export function bucketChars(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  let bucket = CHAR_BUCKETS[0]!
  for (const boundary of CHAR_BUCKETS) {
    if (count < boundary) break
    bucket = boundary
  }
  return bucket
}

/**
 * The size of the changed region between two strings, as a plain count (never the
 * text itself). The common prefix and suffix are trimmed and the larger of the two
 * remaining middles is returned, so a same-length rewrite still registers as an edit
 * where a raw length delta would report zero. Used to gauge how much a developer
 * reworked the hand-off bundle summary in the preview.
 */
export function editedCharCount(before: string, after: string): number {
  if (before === after) return 0
  const min = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < min && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < min - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const beforeMiddle = before.length - prefix - suffix
  const afterMiddle = after.length - prefix - suffix
  return Math.max(beforeMiddle, afterMiddle)
}

/**
 * The prototype length threshold above which a developer's first message to a
 * freshly-handed target reads as context restatement rather than a next instruction.
 * Flagged for tuning against early real usage (TechSpec "Known Risks"); treat the
 * resulting metric as directional, not exact.
 */
export const REEXPLANATION_CHAR_THRESHOLD = 280

/**
 * One event on the target agent's timeline after a hand-off, as the heuristic sees
 * it. Content-free: a developer message is reduced to its length before it ever
 * reaches this predicate.
 */
export type PostHandoffEvent =
  | { kind: "developer_message"; charCount: number }
  /** The target's first tool call or edit - proof it started acting on the bundle. */
  | { kind: "target_action" }

/** The outcome of the re-explanation predicate: the flag and a coarse char bucket. */
export interface ReexplanationResult {
  detected: boolean
  charBucket: number
}

/**
 * Did the developer re-explain the task to a freshly-handed target agent?
 *
 * The signal is the developer's FIRST message to the target after the hand-off. If it
 * arrives before the target's first tool call or edit and is long enough to look like
 * context restatement, the bundle failed to carry the context and re-explanation was
 * NOT eliminated (`detected: true`). If the target starts acting first, or the first
 * message is short, it counts as eliminated. Only the boolean and a coarse char
 * bucket leave this function - never the message text.
 */
export function detectReexplanation(
  events: readonly PostHandoffEvent[],
  threshold: number = REEXPLANATION_CHAR_THRESHOLD,
): ReexplanationResult {
  for (const event of events) {
    // The target acted before the developer said anything: nothing to re-explain.
    if (event.kind === "target_action") return { detected: false, charBucket: 0 }
    // The developer's first message decides it, whatever comes after.
    return { detected: event.charCount >= threshold, charBucket: bucketChars(event.charCount) }
  }
  return { detected: false, charBucket: 0 }
}

/**
 * The content-free event stream for one confirmed effort change. The recorder starts
 * a stream with `effort_change`, appends another when that setting changes again, and
 * closes it with `next_turn` when the pane receives its next developer turn.
 */
export type EffortRetentionEvent =
  | { kind: "effort_change" }
  | { kind: "next_turn" }

/**
 * Did a confirmed effort change survive through the pane's next turn?
 *
 * The first `effort_change` arms the metric. A second one before `next_turn` means
 * the selected effort was changed (including a revert) before it could be used, so
 * the original change was not kept. The predicate intentionally receives no option
 * values, prompt text, or code content.
 */
export function effortChangeKept(events: readonly EffortRetentionEvent[]): boolean {
  let armed = false
  for (const event of events) {
    if (event.kind === "effort_change") {
      if (armed) return false
      armed = true
      continue
    }
    if (armed) return true
  }
  return false
}
