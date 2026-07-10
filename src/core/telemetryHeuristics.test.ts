import { describe, expect, it } from "bun:test"

import {
  bucketChars,
  CHAR_BUCKETS,
  detectReexplanation,
  editedCharCount,
  effortChangeKept,
  REEXPLANATION_CHAR_THRESHOLD,
  type EffortRetentionEvent,
  type PostHandoffEvent,
} from "./telemetryHeuristics.ts"

describe("bucketChars", () => {
  it("floors to zero for empty, negative, or non-finite counts", () => {
    expect(bucketChars(0)).toBe(0)
    expect(bucketChars(-5)).toBe(0)
    expect(bucketChars(Number.NaN)).toBe(0)
    // A non-finite count is nonsensical for a stored metric; it floors rather than leaking.
    expect(bucketChars(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it("reports the largest bucket boundary at or below the count, never the exact count", () => {
    expect(bucketChars(137)).toBe(100)
    expect(bucketChars(49)).toBe(0)
    expect(bucketChars(50)).toBe(50)
    expect(bucketChars(999)).toBe(500)
    // Anything past the top boundary saturates rather than leaking a precise length.
    expect(bucketChars(99999)).toBe(5000)
  })

  it("returns each boundary exactly for a count sitting on it", () => {
    for (const boundary of CHAR_BUCKETS) expect(bucketChars(boundary)).toBe(boundary)
  })
})

describe("editedCharCount", () => {
  it("is zero for an untouched string", () => {
    expect(editedCharCount("same text", "same text")).toBe(0)
  })

  it("measures only the changed middle after trimming the common prefix and suffix", () => {
    expect(editedCharCount("abcdef", "abXYef")).toBe(2)
  })

  it("registers a same-length rewrite that a raw length delta would miss", () => {
    expect(editedCharCount("abc", "xyz")).toBe(3)
    expect(Math.abs("abc".length - "xyz".length)).toBe(0)
  })

  it("counts a pure append or a pure deletion", () => {
    expect(editedCharCount("abc", "abcdef")).toBe(3)
    expect(editedCharCount("abcdef", "abc")).toBe(3)
  })

  it("counts the whole of an emptied string", () => {
    expect(editedCharCount("hello", "")).toBe(5)
  })
})

describe("detectReexplanation", () => {
  const longMessage: PostHandoffEvent = { kind: "developer_message", charCount: REEXPLANATION_CHAR_THRESHOLD + 50 }
  const shortMessage: PostHandoffEvent = { kind: "developer_message", charCount: 40 }

  it("flags a long first message that precedes any target action", () => {
    const result = detectReexplanation([longMessage, { kind: "target_action" }])
    expect(result.detected).toBe(true)
    // The stored size is a coarse bucket, not the message's exact length.
    expect(result.charBucket).toBe(bucketChars(REEXPLANATION_CHAR_THRESHOLD + 50))
    expect(CHAR_BUCKETS).toContain(result.charBucket)
  })

  it("does not flag when the target acts before the developer says anything", () => {
    expect(detectReexplanation([{ kind: "target_action" }, longMessage])).toEqual({ detected: false, charBucket: 0 })
  })

  it("does not flag a short first message even when it comes first", () => {
    const result = detectReexplanation([shortMessage])
    expect(result.detected).toBe(false)
    expect(result.charBucket).toBe(bucketChars(40))
  })

  it("only the first developer message counts, whatever follows it", () => {
    expect(detectReexplanation([shortMessage, longMessage]).detected).toBe(false)
  })

  it("does not flag an empty timeline", () => {
    expect(detectReexplanation([])).toEqual({ detected: false, charBucket: 0 })
  })

  it("honours a caller-supplied threshold", () => {
    expect(detectReexplanation([{ kind: "developer_message", charCount: 100 }], 50).detected).toBe(true)
    expect(detectReexplanation([{ kind: "developer_message", charCount: 100 }], 500).detected).toBe(false)
  })
})

describe("effortChangeKept", () => {
  const changed: EffortRetentionEvent = { kind: "effort_change" }
  const nextTurn: EffortRetentionEvent = { kind: "next_turn" }

  it("fires when a confirmed effort change reaches the pane's next turn", () => {
    expect(effortChangeKept([changed, nextTurn])).toBe(true)
  })

  it("does not fire when the effort is changed again before the next turn", () => {
    expect(effortChangeKept([changed, changed, nextTurn])).toBe(false)
  })

  it("does not fire until a next turn exists", () => {
    expect(effortChangeKept([changed])).toBe(false)
    expect(effortChangeKept([])).toBe(false)
  })
})
