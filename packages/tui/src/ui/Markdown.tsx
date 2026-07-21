/**
 * The single leaf that names OpenTUI's Markdown renderer.
 *
 * Every prose surface routes through this component so syntax styling, live palette
 * changes, concealment, and the streaming compatibility pin cannot drift between
 * callers. Surface-specific layout and chrome belong in thin wrappers around it.
 */

import { type ReactNode } from "react"

import {
  registerSyntaxParsers,
  resolveSyntaxPresentation,
  type SyntaxDiagnosticReporter,
  type SyntaxParserStatusResolver,
} from "./syntaxParsers.ts"
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
  /** Optional content-free diagnostics sink. No telemetry is enabled by default. */
  diagnosticReporter?: SyntaxDiagnosticReporter
  /** Injectable capability outcome seam for deterministic fallback tests. */
  parserStatus?: SyntaxParserStatusResolver
}

interface MarkdownSourceSegment {
  readonly kind: "markdown"
  readonly content: string
}

interface MarkdownFallbackSegment {
  readonly kind: "fallback"
  readonly label: string
  readonly source: string
}

type MarkdownSegment = MarkdownSourceSegment | MarkdownFallbackSegment

/** Split only complete fallback fences; every source byte between their delimiters is retained. */
function splitFallbackFences(
  content: string,
  reporter: SyntaxDiagnosticReporter | undefined,
  parserStatus: SyntaxParserStatusResolver | undefined,
): readonly MarkdownSegment[] {
  const opener = /^(?: {0,3})(`{3,}|~{3,})([^\r\n]*)\r?\n/gm
  const segments: MarkdownSegment[] = []
  let outputStart = 0
  let scanStart = 0

  while (scanStart < content.length) {
    opener.lastIndex = scanStart
    const match = opener.exec(content)
    if (match === null) break
    const marker = match[1]!
    const label = match[2]!.trim()
    if (label.length === 0) {
      scanStart = opener.lastIndex
      continue
    }

    const presentation = resolveSyntaxPresentation(label, "markdown", reporter, parserStatus)
    const closing = new RegExp(`^(?: {0,3})${marker[0]}{${marker.length},}[ \\t]*(?:\\r?\\n|$)`, "gm")
    closing.lastIndex = opener.lastIndex
    const closingMatch = closing.exec(content)
    if (closingMatch === null) break

    if (!presentation.fallback) {
      scanStart = closing.lastIndex
      continue
    }

    if (match.index > outputStart) {
      segments.push({ kind: "markdown", content: content.slice(outputStart, match.index) })
    }
    const sourceWithDelimiter = content.slice(opener.lastIndex, closingMatch.index)
    const source = sourceWithDelimiter.replace(/\r?\n$/, "")
    segments.push({ kind: "fallback", label, source })
    outputStart = closing.lastIndex
    scanStart = closing.lastIndex
  }

  if (segments.length === 0) return [{ kind: "markdown", content }]
  if (outputStart < content.length) segments.push({ kind: "markdown", content: content.slice(outputStart) })
  return segments
}

function MarkdownLeaf({
  content,
  fg,
  syntaxStyle,
}: {
  content: string
  fg: string
  syntaxStyle: ReturnType<typeof useSyntaxStyle>
}): ReactNode {
  return (
    <markdown
      width="100%"
      content={normalizeMarkdownForDisplay(content)}
      syntaxStyle={syntaxStyle}
      streaming={MARKDOWN_STREAMING}
      conceal
      fg={fg}
      tableOptions={MARKDOWN_TABLE_OPTIONS}
    />
  )
}

/** Render theme-reactive, concealed Markdown with the compatibility pin enforced. */
export function Markdown({ content, fg, diagnosticReporter, parserStatus }: MarkdownProps): ReactNode {
  const palette = usePalette()
  const syntaxStyle = useSyntaxStyle()
  registerSyntaxParsers()
  const foreground = fg ?? palette.text
  const segments = splitFallbackFences(content, diagnosticReporter, parserStatus)
  if (segments.length === 1 && segments[0]?.kind === "markdown") {
    return <MarkdownLeaf content={segments[0].content} fg={foreground} syntaxStyle={syntaxStyle} />
  }
  return (
    <box style={{ width: "100%", flexDirection: "column", flexShrink: 0 }}>
      {segments.map((segment, index) =>
        segment.kind === "markdown" ? (
          <MarkdownLeaf key={`markdown-${index}`} content={segment.content} fg={foreground} syntaxStyle={syntaxStyle} />
        ) : (
          <box
            key={`fallback-${index}`}
            style={{ flexDirection: "column", flexShrink: 0, border: ["left"], paddingLeft: 1 }}
          >
            <text fg={palette.muted}>{segment.label}</text>
            <code
              content={segment.source}
              syntaxStyle={syntaxStyle}
              fg={foreground}
              conceal={false}
              drawUnstyledText
              streaming={false}
              width="100%"
            />
          </box>
        ),
      )}
    </box>
  )
}
