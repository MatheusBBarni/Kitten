/**
 * One message in the transcript, rendered as Markdown.
 *
 * Both parties go through the shared `<Markdown>` leaf rather than only the agent. The agent's text
 * genuinely is Markdown, and routing the user's text through the same renderable keeps
 * one copy path: the PRD asks that a selection carry the words and nothing else, and
 * `MarkdownRenderable` reports exactly its text to `getSelectedText()`.
 *
 * The two turns are told apart without ever bordering either one, because a border
 * drags box-drawing characters into a copied selection:
 *
 * - The **agent** wears a small role label above its text - that is the whole of its
 *   chrome.
 * - The **user** drops the label and sits on a tinted band instead. The band is a
 *   `backgroundColor`, which is a cell attribute rather than a glyph, so it sets the
 *   user's turn apart while leaving a drag over the words to copy the words alone. A
 *   bright `text` foreground on the band gives the user's turn the prominence the label
 *   used to carry.
 *
 * The shared leaf owns the streaming pin, syntax style, and concealment.
 */

import { type ReactNode } from "react"

import { Markdown } from "./Markdown.tsx"
import { usePalette } from "./theme.ts"

/** Who said it. */
export type MessageRole = "user" | "agent"

/**
 * How the agent announces itself above its text.
 *
 * Only the agent is labelled now; the user's turn is set apart by its band instead of a
 * word. The map is keyed by role all the same, so a second labelled role would slot in
 * without reshaping callers.
 */
export const ROLE_LABELS: Readonly<Record<"agent", string>> = {
  agent: "Agent",
}

/** Props for {@link MessageView}. */
export interface MessageViewProps {
  role: MessageRole
  /** The message body. Markdown for the agent; plain prose, usually, for the user. */
  text: string
}

/** A message turn: a labelled agent block, or the user's block on its tinted band. */
export function MessageView({ role, text }: MessageViewProps): ReactNode {
  return role === "user" ? <UserMessage text={text} /> : <AgentMessage text={text} />
}

/**
 * The user's turn: no label, sitting on a tinted band.
 *
 * The band is a `backgroundColor` with one trailing row of vertical padding and one cell of
 * horizontal padding - no border - so even a short turn reads as a distinct block yet
 * never contributes a glyph to a copied selection. `text` (the brightest foreground)
 * rides the band for prominence; it clears contrast against `userMessageSurface` in
 * both the dark and light palettes.
 */
function UserMessage({ text }: { text: string }): ReactNode {
  const palette = usePalette()
  return (
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        marginBottom: 1,
        paddingTop: 0,
        paddingBottom: 1,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: palette.userMessageSurface,
      }}
    >
      <Markdown content={text} fg={palette.text} />
    </box>
  )
}

/** The agent's turn: its role label above its Markdown, no band. */
function AgentMessage({ text }: { text: string }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      <text fg={palette.muted}>{ROLE_LABELS.agent}</text>
      <Markdown content={text} fg={palette.text} />
    </box>
  )
}
