// Suite: pure configurable statusline domain
// Invariant: persisted layouts, proposals, previews, and consumers share one strict deterministic interpretation.
// Boundary IN: unknown layout data, sole fenced replies, selected-session context, grapheme budget
// Boundary OUT: config/store/UI integration, covered by their owning tasks

import { describe, expect, it } from "bun:test"

import {
  DEFAULT_STATUSLINE_SEPARATOR,
  normalizeStatuslineLayout,
  parseStatuslineProposalReply,
  renderStatusline,
  STATUSLINE_RECOVERY_PRESETS,
  statuslineText,
  type StatuslineLayout,
  type StatuslineProposalResult,
} from "./statusline.ts"

const layout = (line: StatuslineLayout["line"], separator = DEFAULT_STATUSLINE_SEPARATOR): StatuslineLayout => ({
  separator,
  line,
})

const validReply = (statusline: unknown): string => `\`\`\`json\n${JSON.stringify({ statusline })}\n\`\`\``

describe("normalizeStatuslineLayout", () => {
  it("normalizes every supported simple field and one bounded ellipsis branch", () => {
    const input = {
      separator: " | ",
      line: [
        "FOLDER",
        "FULL_PATH",
        "BRANCH",
        { kind: "ELLIPSIS_BRANCH", maxChars: 24 },
        "PROVIDER",
        "MODEL",
        "EFFORT",
        "HELP_TEXT",
        "CONTEXT",
      ],
    } as const satisfies StatuslineLayout

    expect(normalizeStatuslineLayout(input)).toEqual({ kind: "valid", layout: input })
  })

  it.each([
    [{ separator: " · ", line: ["COMMAND"] }, "supported field"],
    [{ separator: " · ", line: [""] }, "supported field"],
    [{ separator: " · ", line: ["MODEL", "MODEL"] }, "duplicate field MODEL"],
    [{ separator: " · ", line: ["CONTEXT", "CONTEXT"] }, "duplicate field CONTEXT"],
    [{ separator: " · ", line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 24 }, { kind: "ELLIPSIS_BRANCH", maxChars: 12 }] }, "duplicate field ELLIPSIS_BRANCH"],
    [{ separator: " · ", line: [] }, "at least one item"],
    [{ separator: "", line: ["MODEL"] }, "must not be empty"],
    [{ separator: "\u001b[31m", line: ["MODEL"] }, "printable single-line"],
    [{ separator: "\u202emodel", line: ["MODEL"] }, "printable single-line"],
    [{ separator: " · " }, "provided together"],
    [{ line: ["MODEL"] }, "provided together"],
    [{ separator: " · ", line: [null] }, "malformed"],
    [{ separator: " · ", line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 3 }] }, "integer from 4 to 80"],
    [{ separator: " · ", line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 81 }] }, "integer from 4 to 80"],
    [{ separator: " · ", line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 4.5 }] }, "integer from 4 to 80"],
    [{ separator: " · ", line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 12, command: "pwd" }] }, "unsupported fields"],
    [{ separator: " · ", line: ["MODEL"], command: "pwd" }, "unsupported fields"],
  ] as const)("rejects invalid or executable layout %#", (input, reason) => {
    const result = normalizeStatuslineLayout(input)
    expect(result.kind).toBe("invalid")
    if (result.kind === "invalid") expect(result.reason).toContain(reason)
  })

  it("bounds separators by grapheme clusters rather than code points", () => {
    expect(normalizeStatuslineLayout({ separator: "🙂".repeat(16), line: ["MODEL"] }).kind).toBe("valid")
    expect(normalizeStatuslineLayout({ separator: "🙂".repeat(17), line: ["MODEL"] })).toMatchObject({
      kind: "invalid",
      reason: expect.stringContaining("16 graphemes"),
    })
  })
})

describe("parseStatuslineProposalReply", () => {
  it("accepts exactly one complete fenced json proposal", () => {
    expect(parseStatuslineProposalReply(validReply({ separator: " · ", line: ["FOLDER", "MODEL", "CONTEXT"] }))).toEqual({
      kind: "proposal",
      layout: { separator: " · ", line: ["FOLDER", "MODEL", "CONTEXT"] },
    })
  })

  it.each([
    ["prose\n```json\n{}\n```", "only one fenced"],
    ["```json\n{}\n```\n```json\n{}\n```", "only one fenced"],
    ['{"statusline":{"separator":" · ","line":["MODEL"]}}', "only one fenced"],
    ["```json\n{nope}\n```", "not valid JSON"],
    [validReply({ separator: " · ", line: ["SHELL"] }), "supported field"],
    ["```JSON\n{}\n```", "only one fenced"],
  ])("rejects non-contract response %#", (reply, reason) => {
    const result = parseStatuslineProposalReply(reply)
    expect(result.kind).toBe("invalid-response")
    expect((result as Extract<StatuslineProposalResult, { kind: "invalid-response" }>).reason).toContain(reason)
  })

  it("classifies absent output as unavailable", () => {
    expect(parseStatuslineProposalReply("")).toEqual({
      kind: "unavailable",
      reason: "The agent returned no statusline proposal.",
    })
  })
})

describe("renderStatusline", () => {
  it("shortens a multicode-point grapheme branch without splitting its clusters", () => {
    const segments = renderStatusline(layout([{ kind: "ELLIPSIS_BRANCH", maxChars: 4 }]), {
      branch: "a👨‍👩‍👧‍👦bcdef",
    }, 80)

    expect(segments).toEqual([{ kind: "ELLIPSIS_BRANCH", text: "a👨‍👩‍👧‍👦b…", separatorBefore: "" }])
  })

  it("omits unavailable fields and their adjacent separators", () => {
    const segments = renderStatusline(
      layout(["FOLDER", "BRANCH", "MODEL", "EFFORT", "FULL_PATH", "HELP_TEXT"]),
      { cwd: null, branch: null, model: null, effort: undefined, helpText: "Ctrl+? help" },
      80,
    )

    expect(segments).toEqual([{ kind: "HELP_TEXT", text: "Ctrl+? help", separatorBefore: "" }])
    expect(statuslineText(segments)).toBe("Ctrl+? help")
  })

  it("omits control-bearing session values rather than emitting terminal instructions", () => {
    const segments = renderStatusline(layout(["BRANCH", "MODEL", "HELP_TEXT"]), {
      branch: "feature\nspoofed-row",
      model: "\u001b[31mred",
      helpText: "Ctrl+? help",
    }, 80)

    expect(statuslineText(segments)).toBe("Ctrl+? help")
  })

  it("derives folder and full path from context without I/O", () => {
    const segments = renderStatusline(layout(["FOLDER", "FULL_PATH"]), { cwd: "/work/kitten/" }, 80)

    expect(statuslineText(segments)).toBe("kitten · /work/kitten/")
  })

  it.each([38, 0, 100])("renders valid context headroom %d as a compact percentage", (contextHeadroom) => {
    const segments = renderStatusline(layout(["CONTEXT"]), { contextHeadroom }, 80)

    expect(segments).toEqual([{ kind: "CONTEXT", text: `ctx ${contextHeadroom}%`, separatorBefore: "" }])
  })

  it.each([
    ["missing", undefined],
    ["null", null],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["fractional", 38.5],
    ["below range", -1],
    ["above range", 101],
  ] as const)("omits %s context headroom and its adjacent separator", (_case, contextHeadroom) => {
    const segments = renderStatusline(
      layout(["FOLDER", "CONTEXT", "MODEL"]),
      { cwd: "/work/kitten", contextHeadroom, model: "gpt-5.4" },
      80,
    )

    expect(statuslineText(segments)).toBe("kitten · gpt-5.4")
    expect(segments.map(({ kind }) => kind)).toEqual(["FOLDER", "MODEL"])
  })

  it("drops trailing context while retaining the folder when the grapheme budget is narrow", () => {
    const chosen = layout(["FOLDER", "CONTEXT"])
    const context = { cwd: "/work/kitten", contextHeadroom: 38 }

    expect(statuslineText(renderStatusline(chosen, context, 16))).toBe("kitten · ctx 38%")
    expect(statuslineText(renderStatusline(chosen, context, 15))).toBe("kitten")
  })

  it("preserves order and removes trailing fields rather than shortening ordinary values", () => {
    const chosen = layout(["FOLDER", "MODEL", "EFFORT"], "|")
    const context = { cwd: "/work/kitten", model: "gpt-5.4", effort: "high" }

    expect(statuslineText(renderStatusline(chosen, context, 18))).toBe("kitten|gpt-5.4")
    expect(statuslineText(renderStatusline(chosen, context, 7))).toBe("kitten")
    expect(renderStatusline(chosen, context, 5)).toEqual([])
  })

  it("composes the saved Compact preset identically for 80 and 64 grapheme consumers", () => {
    const compact = STATUSLINE_RECOVERY_PRESETS.find(({ name }) => name === "Compact")
    expect(compact).toBeDefined()
    const context = {
      cwd: "/Users/dev/projects/kitten",
      branch: "feature/statusline-contract",
      provider: "Codex",
      model: "gpt-5.4",
      effort: "high",
      helpText: "Ctrl+? help",
    }

    const at80 = renderStatusline(compact!.layout, context, 80)
    const at64 = renderStatusline(compact!.layout, context, 64)
    const expected = "kitten · feature/statusline-cont… · gpt-5.4"
    expect(statuslineText(at80)).toBe(expected)
    expect(statuslineText(at64)).toBe(expected)
    expect(at64).toEqual(at80)
  })

  it("exports exactly the three schema-native recovery presets", () => {
    expect(STATUSLINE_RECOVERY_PRESETS).toEqual([
      { name: "Workspace", layout: layout(["FOLDER", "BRANCH"]) },
      { name: "Agent", layout: layout(["PROVIDER", "MODEL", "EFFORT"]) },
      {
        name: "Compact",
        layout: layout(["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"]),
      },
    ])
    for (const preset of STATUSLINE_RECOVERY_PRESETS) {
      expect(normalizeStatuslineLayout(preset.layout).kind).toBe("valid")
    }
  })
})
