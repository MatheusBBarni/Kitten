// Suite: pure prompt-local file completion
// Invariant: parsing, ranking, formatting, suppression, and correction tracking are deterministic.
// Boundary OUT: React, OpenTUI, controller I/O, filesystem reads, and telemetry recording.

import { describe, expect, it } from "bun:test"

import {
  clearPendingFileReferencesOnSubmit,
  fileTokenAt,
  formatFileReference,
  isFileTokenSuppressed,
  MAX_VISIBLE_FILE_MATCHES,
  rankFileMatches,
  suppressFileToken,
  updateFileTokenSuppression,
  updatePendingFileReferences,
  visibleFileMatches,
  type PendingFileReference,
} from "./fileCompletion.ts"

describe("fileTokenAt", () => {
  it("recognizes @ at offset zero and after whitespace", () => {
    expect(fileTokenAt("@", 1)).toEqual({ start: 0, end: 1, filter: "" })
    expect(fileTokenAt("review @src", 11)).toEqual({ start: 7, end: 11, filter: "src" })
  })

  it("rejects email addresses, embedded @ text, and quoted inserted references", () => {
    expect(fileTokenAt("name@example.com", 16)).toBeNull()
    expect(fileTokenAt("foo@bar", 7)).toBeNull()
    expect(fileTokenAt("@foo@bar", 8)).toBeNull()
    expect(fileTokenAt('@"src/My', 8)).toBeNull()
  })

  it("rejects a cursor outside the token while accepting one inside it", () => {
    expect(fileTokenAt("@source tail", 3)).toEqual({ start: 0, end: 7, filter: "source" })
    expect(fileTokenAt("@source tail", 7)).toEqual({ start: 0, end: 7, filter: "source" })
    expect(fileTokenAt("@source tail", 8)).toBeNull()
    expect(fileTokenAt("@source tail", 10)).toBeNull()
  })
})

describe("file path matching", () => {
  it("prioritizes basename prefixes over full-path substrings with deterministic lexical ties", () => {
    const paths = [
      "packages/parser-utils/index.ts",
      "src/zeta/Parser.ts",
      "docs/compare.md",
      "src/Alpha/parse.ts",
      "src/other.ts",
    ]

    expect(rankFileMatches(paths, "PAR")).toEqual([
      "src/Alpha/parse.ts",
      "src/zeta/Parser.ts",
      "docs/compare.md",
      "packages/parser-utils/index.ts",
    ])
    expect(paths).toEqual([
      "packages/parser-utils/index.ts",
      "src/zeta/Parser.ts",
      "docs/compare.md",
      "src/Alpha/parse.ts",
      "src/other.ts",
    ])
  })

  it("returns the first eight rows without mutating the complete ranked list", () => {
    const ranked = Array.from({ length: MAX_VISIBLE_FILE_MATCHES + 2 }, (_, index) => `src/file-${index}.ts`)
    const snapshot = [...ranked]

    expect(visibleFileMatches(ranked)).toEqual(ranked.slice(0, MAX_VISIBLE_FILE_MATCHES))
    expect(ranked).toEqual(snapshot)
    expect(ranked).toHaveLength(MAX_VISIBLE_FILE_MATCHES + 2)
  })
})

describe("formatFileReference", () => {
  it("keeps unambiguous paths plain", () => {
    expect(formatFileReference("src/ui/PromptEditor.tsx")).toBe("@src/ui/PromptEditor.tsx")
  })

  it("uses JSON-style quoting and escaping for whitespace, quotes, and backslashes", () => {
    expect(formatFileReference("src/My File.ts")).toBe('@"src/My File.ts"')
    expect(formatFileReference('src/a"b.ts')).toBe('@"src/a\\"b.ts"')
    expect(formatFileReference("src/a\\b.ts")).toBe('@"src/a\\\\b.ts"')
  })
})

describe("file token suppression", () => {
  it("persists while ordinary typing extends the same active token", () => {
    const dismissed = fileTokenAt("ask @sr", 7)!
    const suppression = suppressFileToken(dismissed)
    const continued = fileTokenAt("ask @src/ui", 11)

    expect(updateFileTokenSuppression(suppression, continued)).toBe(suppression)
    expect(isFileTokenSuppressed(suppression, continued)).toBe(true)
  })

  it("clears when the trigger is removed or the cursor leaves the token", () => {
    const suppression = suppressFileToken(fileTokenAt("ask @src", 8)!)

    expect(updateFileTokenSuppression(suppression, fileTokenAt("ask src", 7))).toBeNull()
    expect(updateFileTokenSuppression(suppression, fileTokenAt("ask @src tail", 9))).toBeNull()
  })

  it("clears when a different token begins or focus changes", () => {
    const suppression = suppressFileToken(fileTokenAt("ask @src", 8)!)
    const nextToken = fileTokenAt("ask @src then @test", 19)

    expect(updateFileTokenSuppression(suppression, nextToken)).toBeNull()
    expect(updateFileTokenSuppression(suppression, fileTokenAt("ask @src", 8), true)).toBeNull()
  })
})

function pendingReference(start = 4): PendingFileReference {
  return { text: "@src/a.ts", start, end: start + 9, sessionId: "session-a" }
}

describe("pending reference edit tracking", () => {
  it("shifts a pending range for an insertion before it", () => {
    const result = updatePendingFileReferences(
      "see @src/a.ts now",
      "Please see @src/a.ts now",
      [pendingReference()],
    )

    expect(result).toEqual({
      pending: [{ text: "@src/a.ts", start: 11, end: 20, sessionId: "session-a" }],
      corrected: false,
    })
  })

  it("retains a pending range for an edit after it", () => {
    const reference = pendingReference()
    const result = updatePendingFileReferences("see @src/a.ts now", "see @src/a.ts now!", [reference])

    expect(result.pending).toEqual([reference])
    expect(result.corrected).toBe(false)
  })

  it("reports one correction and removes the reference after an overlapping edit", () => {
    const first = updatePendingFileReferences("see @src/a.ts now", "see @src/b.ts now", [pendingReference()])
    const second = updatePendingFileReferences("see @src/b.ts now", "see @src/c.ts now", first.pending)

    expect(first).toEqual({ pending: [], corrected: true })
    expect(second).toEqual({ pending: [], corrected: false })
  })

  it("treats insertions at range boundaries as before or after, not overlap", () => {
    const atStart = updatePendingFileReferences("see @src/a.ts", "see !@src/a.ts", [pendingReference()])
    const atEnd = updatePendingFileReferences("see @src/a.ts", "see @src/a.ts!", [pendingReference()])

    expect(atStart).toEqual({
      pending: [{ text: "@src/a.ts", start: 5, end: 14, sessionId: "session-a" }],
      corrected: false,
    })
    expect(atEnd).toEqual({ pending: [pendingReference()], corrected: false })
  })

  it("clears pending references on submission without reporting a correction", () => {
    expect(clearPendingFileReferencesOnSubmit([pendingReference()])).toEqual({ pending: [], corrected: false })
  })
})

describe("minimal prompt composition fixture", () => {
  it("maps a token and candidate list to the exact quoted visible draft reference", () => {
    const draft = "Review @file"
    const token = fileTokenAt(draft, draft.length)!
    const candidates = ["src/other.ts", "src/My File.ts", "docs/my-notes.md"]
    const selected = visibleFileMatches(rankFileMatches(candidates, token.filter))[0]!
    const reference = formatFileReference(selected)
    const composed = `${draft.slice(0, token.start)}${reference} ${draft.slice(token.end)}`

    expect(selected).toBe("src/My File.ts")
    expect(composed).toBe('Review @"src/My File.ts" ')
  })
})
