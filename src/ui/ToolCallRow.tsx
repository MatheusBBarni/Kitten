/**
 * One tool call in the transcript: what the agent did, and how it went.
 *
 * The header is a single line - a status bullet, the tool's name, and its argument in
 * parentheses - so a long run of reads and searches stays scannable. It borrows Claude
 * Code's own transcript shape: `● Read(src/app.ts)`, where the filled bullet's color
 * carries the status and there is no trailing status word to read. Anything the call
 * left behind - the paths it touched, or the diff an `edit` proposes - hangs underneath
 * on a `└ ` connector, the transcript's quiet "here's the detail" tone.
 *
 * The row is identified by `toolCallId` upstream, so React updates this component in
 * place as `tool_call_update`s arrive; nothing remounts when `in_progress` becomes
 * `completed`, and the diff below it does not flash - only the bullet's color changes.
 */

import { TextAttributes } from "@opentui/core"
import { type ReactNode } from "react"

import type { ToolCallDiff, ToolCallKind, ToolCallRecord } from "../core/types.ts"
import { usePalette, useSyntaxStyle } from "./theme.ts"

/**
 * How each kind is written as an inline tag - short, lowercase.
 *
 * Kept for the approval overlay, where the tag reads well beside a title on one line
 * (`edit Bump b`). The transcript header uses {@link TOOL_KIND_NAMES} instead.
 */
export const TOOL_KIND_LABELS: Readonly<Record<ToolCallKind, string>> = {
  read: "read",
  edit: "edit",
  delete: "delete",
  move: "move",
  search: "search",
  execute: "run",
  think: "think",
  fetch: "fetch",
  other: "tool",
}

/**
 * The capitalized display name each kind wears in a transcript header.
 *
 * Claude Code's tool actions read like proper nouns - `Write(...)`, `Read(...)` -
 * rather than lowercase log tags, so a row scans as a sentence. These ride the bold
 * header; the lowercase {@link TOOL_KIND_LABELS} stay for the approval overlay's
 * inline label. `execute` reads as "Run" and `other` as "Tool", the way an operator
 * would name them out loud.
 */
export const TOOL_KIND_NAMES: Readonly<Record<ToolCallKind, string>> = {
  read: "Read",
  edit: "Edit",
  delete: "Delete",
  move: "Move",
  search: "Search",
  execute: "Run",
  think: "Think",
  fetch: "Fetch",
  other: "Tool",
}

/**
 * The header's status bullet (U+25CF). Its color - not a trailing word - tells pending
 * from running from done from failed, mirroring Claude Code's transcript: a filled
 * circle reads as a status light. Dropping the status word frees the row's tail for the
 * argument in parentheses.
 */
export const STATUS_BULLET = "●"

/**
 * The connector that hangs sub-content off a header (U+2514 + a space).
 *
 * It sits outside the user's message copy path, so a box-drawing glyph here is safe:
 * unlike a border around a message, it never lands in `getSelectedText()` on a drag
 * over the words. That is why the connector aesthetic is welcome on tool rows but
 * forbidden around messages.
 */
export const CONNECTOR = "└ "

/**
 * The `filetype` hint that gives a diff its syntax highlighting.
 *
 * `<diff>` wants a bare extension (`ts`, `py`). A path with no extension, or a
 * dotfile whose only dot starts the basename (`.gitignore`), has nothing to offer,
 * so the diff renders unhighlighted rather than guessing.
 */
export function filetypeFor(path: string): string | undefined {
  const basename = path.split("/").pop() ?? ""
  const dot = basename.lastIndexOf(".")
  if (dot <= 0 || dot === basename.length - 1) return undefined
  return basename.slice(dot + 1)
}

/** Props for {@link ToolCallRow}. */
export interface ToolCallRowProps {
  record: ToolCallRecord
}

/** A tool call: its one-line header, plus the detail it left behind. */
export function ToolCallRow({ record }: ToolCallRowProps): ReactNode {
  const palette = usePalette()
  const { kind, title, status, locations, diff } = record

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      <text>
        <span fg={palette.tool[status]}>{`${STATUS_BULLET} `}</span>
        <span fg={palette.text} attributes={TextAttributes.BOLD}>
          {TOOL_KIND_NAMES[kind]}
        </span>
        <span fg={palette.muted}>{"("}</span>
        <span fg={palette.text}>{title}</span>
        <span fg={palette.muted}>{")"}</span>
      </text>

      {kind === "edit" && diff ? (
        <ToolCallDiffConnector diff={diff} />
      ) : (
        <ToolCallLocations title={title} locations={locations} />
      )}
    </box>
  )
}

/**
 * The connector line for a non-edit call: the paths it touched, but only when they add
 * something the header's title has not already said. A `read` whose title *is* the path
 * gains nothing from a `└ src/app.ts` echo, so the line is dropped when `locations`
 * collapses to the title; it earns a row only when it carries extra information.
 */
function ToolCallLocations({ title, locations }: { title: string; locations: string[] }): ReactNode {
  const palette = usePalette()
  const summary = locations.join(", ")
  if (summary.length === 0 || summary === title) return null
  return <text fg={palette.muted}>{`${CONNECTOR}${summary}`}</text>
}

/**
 * The proposed edit, hung off the header: the path on a `└ ` connector in muted, then
 * the diff body indented beneath it.
 *
 * The overlays keep their own accent-labelled {@link ToolCallDiffView}; only the diff
 * body ({@link ToolCallDiffBody}) is shared. Restyling the transcript row therefore
 * leaves the approval and hand-off previews pixel-for-pixel unchanged.
 */
function ToolCallDiffConnector({ diff }: { diff: ToolCallDiff }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text fg={palette.muted}>{`${CONNECTOR}${diff.path}`}</text>
      <box style={{ flexDirection: "column", flexShrink: 0, paddingLeft: CONNECTOR.length }}>
        <ToolCallDiffBody diff={diff} />
      </box>
    </box>
  )
}

/**
 * The proposed change's path and body, in unified view. Shared with the approval
 * overlay and the hand-off preview, which show the same diff a moment earlier - before
 * the user has agreed to it - and label its path in accent above the body.
 */
export function ToolCallDiffView({ diff }: { diff: ToolCallDiff }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text fg={palette.accent}>{diff.path}</text>
      <ToolCallDiffBody diff={diff} />
    </box>
  )
}

/**
 * The unified-diff body alone: syntax-highlighted, gutter on. Shared by the transcript
 * row and the overlays so both render a diff identically.
 *
 * The line-number gutter stays on. It carries the `+`/`-` signs as well as the numbers,
 * and OpenTUI marks the whole gutter unselectable - so a drag over the diff copies the
 * code and leaves the chrome behind, which is exactly what the PRD asks for. Turning the
 * gutter off would also drop the signs, leaving added and removed lines told apart by
 * background color alone.
 */
function ToolCallDiffBody({ diff }: { diff: ToolCallDiff }): ReactNode {
  const syntaxStyle = useSyntaxStyle()
  return <diff diff={diff.unified} view="unified" filetype={filetypeFor(diff.path)} syntaxStyle={syntaxStyle} />
}
