/**
 * One message in the transcript, rendered as Markdown.
 *
 * Both parties go through `<markdown>` rather than only the agent. The agent's
 * text genuinely is Markdown, and routing the user's text through the same
 * renderable keeps one copy path: the PRD asks that a selection carry the words
 * and nothing else, and `MarkdownRenderable` reports exactly its text to
 * `getSelectedText()`. Only the role label and the foreground color differ, which
 * is enough to tell the two apart at a glance without boxing either one (a border
 * would drag box-drawing characters into the user's clipboard).
 *
 * The `streaming` flag is pinned on, deliberately - see {@link MARKDOWN_STREAMING}.
 */

import { type ReactNode } from "react"

import { usePalette, useSyntaxStyle } from "./theme.ts"

/**
 * `<markdown>` is mounted with `streaming` permanently enabled.
 *
 * On @opentui/core 0.4.3 a `MarkdownRenderable` paints nothing at all unless it is
 * streaming: constructing one with `streaming: false` yields an empty block, and
 * flipping the flag from true to false blanks any content with more than a single
 * top-level block. Since a settled message must keep painting, Kitten never
 * finalizes. The cost is that the trailing block is re-parsed on each update, which
 * is exactly what a streaming transcript wants anyway.
 *
 * Revisit on every @opentui bump: drop this once a test proves that finalized
 * multi-block content still renders.
 */
export const MARKDOWN_STREAMING = true

/** Who said it. */
export type MessageRole = "user" | "agent"

/** How each role announces itself above its text. */
export const ROLE_LABELS: Readonly<Record<MessageRole, string>> = {
  user: "you",
  agent: "agent",
}

/** Props for {@link MessageView}. */
export interface MessageViewProps {
  role: MessageRole
  /** The message body. Markdown for the agent; plain prose, usually, for the user. */
  text: string
}

/** A labelled message. Re-renders only when its own `text` grows. */
export function MessageView({ role, text }: MessageViewProps): ReactNode {
  const palette = usePalette()
  const syntaxStyle = useSyntaxStyle()
  const fg = role === "user" ? palette.userMessage : palette.text

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      <text fg={palette.muted}>{ROLE_LABELS[role]}</text>
      <markdown content={text} syntaxStyle={syntaxStyle} streaming={MARKDOWN_STREAMING} fg={fg} />
    </box>
  )
}
