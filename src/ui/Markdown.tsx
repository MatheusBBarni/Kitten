/**
 * The single leaf that names OpenTUI's Markdown renderer.
 *
 * Every prose surface routes through this component so syntax styling, live palette
 * changes, concealment, and the streaming compatibility pin cannot drift between
 * callers. Surface-specific layout and chrome belong in thin wrappers around it.
 */

import { type ReactNode } from "react"

import { usePalette, useSyntaxStyle } from "./theme.ts"

/**
 * `<markdown>` is mounted with `streaming` permanently enabled.
 *
 * On @opentui/core 0.4.3 a `MarkdownRenderable` paints nothing at all unless it is
 * streaming: constructing one with `streaming: false` yields an empty block, and
 * flipping the flag from true to false blanks any content with more than a single
 * top-level block. Since settled prose must keep painting, Kitten never finalizes.
 *
 * Revisit on every @opentui bump: drop this once a test proves that finalized
 * multi-block content still renders.
 */
export const MARKDOWN_STREAMING = true

const MARKDOWN_TABLE_OPTIONS = {
  widthMode: "full",
  columnFitter: "balanced",
  wrapMode: "word",
  selectable: true,
} as const

/**
 * Repair the small set of malformed/unsupported constructs OpenTUI 0.4.3 either
 * blanks or prints verbatim. Complete fenced source is never rewritten; an
 * unmatched opener is removed so the remaining source degrades to legible prose.
 */
function normalizeMarkdownForDisplay(content: string): string {
  const lines = content.split("\n")
  let openFence: { character: "`" | "~"; length: number; lineIndex: number } | null = null

  const normalized: string[] = []

  for (const [lineIndex, line] of lines.entries()) {
    const fence = /^(?: {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      const marker = fence[1]!
      const character = marker[0] as "`" | "~"
      const closesFence =
        openFence !== null &&
        character === openFence.character &&
        marker.length >= openFence.length &&
        fence[2]!.trim().length === 0

      if (closesFence) openFence = null
      else if (openFence === null) openFence = { character, length: marker.length, lineIndex }
      normalized.push(line)
      continue
    }

    if (openFence !== null) {
      normalized.push(line)
      continue
    }

    let displayLine = line.replace(
      /^(\s*[-+*]\s+)\[([ xX])\](?=\s)/,
      (_, prefix: string, checked: string) => `${prefix}${checked.toLowerCase() === "x" ? "☒" : "☐"}`,
    )
    displayLine = displayLine.replace(/^(\s*)\[\^([^\]]+)\]:\s*/, "$1Note $2: ")

    // Preserve inline-code source rather than interpreting marker-like text in it.
    if (!displayLine.includes("`")) {
      displayLine = displayLine.replace(/\[\^([^\]]+)\]/g, "($1)")
      let repairedMalformedInline = false
      for (const marker of ["**", "__", "~~"] as const) {
        if (displayLine.split(marker).length % 2 === 0) {
          const unmatched = displayLine.lastIndexOf(marker)
          displayLine = displayLine.slice(0, unmatched) + displayLine.slice(unmatched + marker.length)
          repairedMalformedInline = true
        }
      }
      if (repairedMalformedInline) displayLine = displayLine.replace(/^\s*>\s*(?:[-+*]\s+)?/, "")
    }

    normalized.push(displayLine)
  }

  // An unmatched fence remains unstable while OpenTUI's required streaming pin
  // is active. Drop only the opener so its body degrades to prose.
  if (openFence !== null) normalized[openFence.lineIndex] = ""
  return normalized.join("\n")
}

/** Props for the shared Markdown renderer. */
export interface MarkdownProps {
  /** Markdown source. Rendered with streaming permanently enabled. */
  content: string
  /** Foreground for unhighlighted text. Defaults to the active reading color. */
  fg?: string
}

/** Render theme-reactive, concealed Markdown with the compatibility pin enforced. */
export function Markdown({ content, fg }: MarkdownProps): ReactNode {
  const palette = usePalette()
  const syntaxStyle = useSyntaxStyle()
  return (
    <markdown
      content={normalizeMarkdownForDisplay(content)}
      syntaxStyle={syntaxStyle}
      streaming={MARKDOWN_STREAMING}
      conceal
      fg={fg ?? palette.text}
      tableOptions={MARKDOWN_TABLE_OPTIONS}
    />
  )
}
