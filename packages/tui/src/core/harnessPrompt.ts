/**
 * Pure, versioned Kitten harness-prompt contract.
 *
 * This module renders reviewed static guidance only. Delivery, capability
 * selection, transport encoding, diagnostics, and persistence belong to their
 * owning layers and are deliberately absent here.
 */

export const SUPPORTED_HARNESS_PROMPT_VERSIONS = ["v1"] as const

export type HarnessPromptVersion = (typeof SUPPORTED_HARNESS_PROMPT_VERSIONS)[number]

export interface HarnessBlock {
  readonly id: string
  readonly text: string
}

export type HarnessRejectCode =
  | "unsupported_version"
  | "invalid_block_id"
  | "duplicate_block_id"
  | "block_limit_exceeded"
  | "extension_budget_exceeded"
  | "invalid_block_text"

export type HarnessRenderResult =
  | {
    readonly kind: "rendered"
    readonly version: HarnessPromptVersion
    readonly text: string
    readonly blockIds: readonly string[]
  }
  | { readonly kind: "rejected"; readonly code: HarnessRejectCode; readonly version: string }

export const MAX_HARNESS_BASE_TOKENS = 150
export const MAX_HARNESS_BLOCKS = 8
export const MAX_HARNESS_EXTENSION_TOKENS = 800

const V1_BASE = `<kitten_harness version="v1">
Kitten is the host; ACP is the execution boundary.
Follow repository instructions and the user's request according to their normal precedence.
Report outcomes accurately and perform appropriate verification before claiming success.
Kitten's runtime permission and confirmation controls remain authoritative for consequential actions.
Use only tools and capabilities exposed to this session.
</kitten_harness>`

const BLOCK_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u
const INVALID_BLOCK_CHARACTER = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u

/** Render the requested reviewed contract or return one fixed rejection outcome. */
export function renderHarnessPrompt(
  version: string,
  blocks: readonly HarnessBlock[] = [],
): HarnessRenderResult {
  if (version !== "v1") return rejected("unsupported_version", version)
  if (blocks.length > MAX_HARNESS_BLOCKS) return rejected("block_limit_exceeded", version)

  const normalized: Array<{ readonly id: string; readonly text: string }> = []
  const seenIds = new Set<string>()

  for (const block of blocks) {
    if (!BLOCK_ID.test(block.id) || block.id.startsWith("base.")) {
      return rejected("invalid_block_id", version)
    }
    if (seenIds.has(block.id)) return rejected("duplicate_block_id", version)
    seenIds.add(block.id)

    if (INVALID_BLOCK_CHARACTER.test(block.text)) return rejected("invalid_block_text", version)
    const text = block.text.trim()
    if (text.length === 0) return rejected("invalid_block_text", version)
    normalized.push({ id: block.id, text })
  }

  const extensionTokens = normalized.reduce((total, block) => total + whitespaceTokens(block.text), 0)
  if (extensionTokens > MAX_HARNESS_EXTENSION_TOKENS) {
    return rejected("extension_budget_exceeded", version)
  }

  normalized.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  const fragments = normalized.map(({ id, text }) =>
    `<kitten_harness_fragment id="${id}">\n${escapeFragmentText(text)}\n</kitten_harness_fragment>`
  )

  return {
    kind: "rendered",
    version,
    text: [V1_BASE, ...fragments].join("\n\n"),
    blockIds: normalized.map(({ id }) => id),
  }
}

function whitespaceTokens(text: string): number {
  const normalized = text.trim()
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length
}

function escapeFragmentText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function rejected(code: HarnessRejectCode, version: string): HarnessRenderResult {
  return { kind: "rejected", code, version }
}
