// Suite: pure versioned harness-prompt contract
// Invariant: reviewed guidance renders exactly or fails closed with a fixed content-free code.
// Boundary IN: requested version and caller-owned reviewed static blocks
// Boundary OUT: ACP delivery, capability selection, session state, configuration, and telemetry

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import {
  MAX_HARNESS_BASE_TOKENS,
  MAX_HARNESS_BLOCKS,
  MAX_HARNESS_EXTENSION_TOKENS,
  renderHarnessPrompt,
  SUPPORTED_HARNESS_PROMPT_VERSIONS,
  type HarnessBlock,
  type HarnessRejectCode,
  type HarnessRenderResult,
} from "./harnessPrompt.ts"

const V1_GOLDEN = `<kitten_harness version="v1">
Kitten is the host; ACP is the execution boundary.
Follow repository instructions and the user's request according to their normal precedence.
Report outcomes accurately and perform appropriate verification before claiming success.
Kitten's runtime permission and confirmation controls remain authoritative for consequential actions.
Use only tools and capabilities exposed to this session.
</kitten_harness>`

const whitespaceTokens = (text: string): number => {
  const normalized = text.trim()
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length
}

const rejection = (
  version: string,
  code: HarnessRejectCode,
): Extract<HarnessRenderResult, { kind: "rejected" }> => ({ kind: "rejected", code, version })

describe("renderHarnessPrompt base contract", () => {
  it("renders the sole supported version as the exact reviewed LF-only envelope", () => {
    expect(SUPPORTED_HARNESS_PROMPT_VERSIONS).toEqual(["v1"])
    expect(renderHarnessPrompt("v1")).toEqual({
      kind: "rendered",
      version: "v1",
      text: V1_GOLDEN,
      blockIds: [],
    })
    expect(V1_GOLDEN).not.toContain("\r")
    expect(V1_GOLDEN.endsWith("\n")).toBe(false)
  })

  it("states the five required truths and stays within the deterministic base budget", () => {
    expect(V1_GOLDEN).toContain("Kitten is the host; ACP is the execution boundary.")
    expect(V1_GOLDEN).toContain("repository instructions and the user's request according to their normal precedence")
    expect(V1_GOLDEN).toContain("Report outcomes accurately and perform appropriate verification before claiming success")
    expect(V1_GOLDEN).toContain("runtime permission and confirmation controls remain authoritative")
    expect(V1_GOLDEN).toContain("Use only tools and capabilities exposed to this session")
    expect(whitespaceTokens(V1_GOLDEN)).toBeLessThanOrEqual(MAX_HARNESS_BASE_TOKENS)
  })

  it("contains no provider, dynamic-content, authorization, or security-guarantee claims", () => {
    expect(V1_GOLDEN).not.toMatch(/Claude|Codex|OpenAI|Anthropic/i)
    expect(V1_GOLDEN).not.toMatch(/\{\{[^}]+\}\}|<user_content>|repository content|transcript|credential/i)
    expect(V1_GOLDEN).not.toMatch(/authorize|permission granted|guarantee|secure|prompt injection/i)
  })

  it.each(["v2", "", " V1 ", "V1", "v1.0", "not-a-version"]) (
    "rejects unsupported requested version %j without a fallback",
    (version) => {
      expect(renderHarnessPrompt(version)).toEqual(rejection(version, "unsupported_version"))
    },
  )
})

describe("renderHarnessPrompt block validation", () => {
  it("accepts lowercase dot-separated stable IDs", () => {
    expect(renderHarnessPrompt("v1", [{ id: "capability.shell.v1", text: "Use the exposed shell." }])).toMatchObject({
      kind: "rendered",
      blockIds: ["capability.shell.v1"],
    })
  })

  it.each(["", "capability", ".capability.v1", "capability..v1", "capability.shell.", "Capability.shell.v1", "capability.shell-v1", "capability shell.v1", "base.v1", "base.future.v1"]) (
    "rejects invalid or reserved block ID %j",
    (id) => {
      expect(renderHarnessPrompt("v1", [{ id, text: "Reviewed guidance." }])).toEqual(
        rejection("v1", "invalid_block_id"),
      )
    },
  )

  it("rejects duplicate IDs", () => {
    const blocks = [
      { id: "capability.shell.v1", text: "First." },
      { id: "capability.shell.v1", text: "Second." },
    ]
    expect(renderHarnessPrompt("v1", blocks)).toEqual(rejection("v1", "duplicate_block_id"))
  })

  it("accepts eight blocks and rejects nine", () => {
    const blocks = Array.from({ length: MAX_HARNESS_BLOCKS }, (_, index) => ({
      id: `capability.feature${index}.v1`,
      text: `Reviewed guidance ${index}.`,
    }))
    expect(renderHarnessPrompt("v1", blocks).kind).toBe("rendered")
    expect(renderHarnessPrompt("v1", [...blocks, { id: "capability.extra.v1", text: "Extra." }])).toEqual(
      rejection("v1", "block_limit_exceeded"),
    )
  })

  it("accepts exactly 800 extension tokens and rejects 801", () => {
    const atLimit = Array.from({ length: MAX_HARNESS_EXTENSION_TOKENS }, () => "word").join(" ")
    expect(renderHarnessPrompt("v1", [{ id: "capability.budget.v1", text: atLimit }]).kind).toBe("rendered")
    expect(renderHarnessPrompt("v1", [{ id: "capability.budget.v1", text: `${atLimit} excess` }])).toEqual(
      rejection("v1", "extension_budget_exceeded"),
    )
  })

  it.each([
    ["", "empty"],
    [" \n  ", "empty after trim"],
    ["line\rreturn", "carriage return"],
    ["tab\ttext", "tab"],
    ["nul\u0000text", "C0 control"],
    ["escape\u001btext", "escape control"],
    ["bidi\u202etext", "bidi override"],
    ["isolate\u2066text", "bidi isolate"],
  ])("rejects invalid block text containing %s (%s)", (text) => {
    expect(renderHarnessPrompt("v1", [{ id: "capability.text.v1", text }])).toEqual(
      rejection("v1", "invalid_block_text"),
    )
  })
})

describe("renderHarnessPrompt canonical composition", () => {
  it("normalizes outer whitespace, preserves internal LF, and escapes delimiter text", () => {
    const result = renderHarnessPrompt("v1", [{
      id: "capability.escape.v1",
      text: "  First & <tag>\nSecond > third.  \n",
    }])

    expect(result).toEqual({
      kind: "rendered",
      version: "v1",
      blockIds: ["capability.escape.v1"],
      text: `${V1_GOLDEN}\n\n<kitten_harness_fragment id="capability.escape.v1">\nFirst &amp; &lt;tag&gt;\nSecond &gt; third.\n</kitten_harness_fragment>`,
    })
  })

  it("renders lexical ID order independently of caller order", () => {
    const ascending: readonly HarnessBlock[] = [
      { id: "capability.alpha.v1", text: "Alpha." },
      { id: "capability.zeta.v1", text: "Zeta." },
    ]
    const descending = [...ascending].reverse()
    const first = renderHarnessPrompt("v1", ascending)
    const second = renderHarnessPrompt("v1", descending)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ kind: "rendered", blockIds: ["capability.alpha.v1", "capability.zeta.v1"] })
    if (first.kind === "rendered") {
      expect(first.text).toContain("</kitten_harness_fragment>\n\n<kitten_harness_fragment")
      expect(first.text.endsWith("\n")).toBe(false)
    }
  })

  it("does not mutate frozen caller arrays or blocks", () => {
    const zeta = Object.freeze({ id: "capability.zeta.v1", text: "  Zeta.  " })
    const alpha = Object.freeze({ id: "capability.alpha.v1", text: "Alpha." })
    const blocks = Object.freeze([zeta, alpha])
    const before = JSON.stringify(blocks)

    expect(() => renderHarnessPrompt("v1", blocks)).not.toThrow()
    expect(JSON.stringify(blocks)).toBe(before)
    expect(blocks).toEqual([zeta, alpha])
  })
})

describe("harness prompt source boundary", () => {
  it("keeps the production renderer protocol-free and pure", () => {
    const source = readFileSync(new URL("./harnessPrompt.ts", import.meta.url), "utf8")
    const imports = source.split("\n").filter((line) => /^\s*import\s/u.test(line)).join("\n")

    expect(imports).toBe("")
    expect(imports).not.toMatch(/@agentclientprotocol|agentConnection|acpTranslate|adapter/u)
    expect(imports).not.toMatch(/@opentui|react|telemetry|recorder|config|persistence|controller|ui/u)
    expect(source).not.toMatch(/\bBun\.|\bprocess\.|setTimeout\s*\(|setInterval\s*\(|queueMicrotask\s*\(/u)
  })
})
