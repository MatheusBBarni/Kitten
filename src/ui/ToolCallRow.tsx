/**
 * One tool call in the transcript: what the agent did, and how it went.
 *
 * The row is a single line - kind, title, status - so a long run of reads and
 * searches stays scannable. An `edit` that carries a diff expands underneath into
 * OpenTUI's `<diff>`, which is the only place in the cockpit where a change to the
 * user's files is shown before they approve it.
 *
 * The row is identified by `toolCallId` upstream, so React updates this component in
 * place as `tool_call_update`s arrive; nothing remounts when `in_progress` becomes
 * `completed`, and the diff below it does not flash.
 */

import { type ReactNode } from "react"

import type { ToolCallKind, ToolCallRecord } from "../core/types.ts"
import { usePalette, useSyntaxStyle } from "./theme.ts"

/** How each kind is written in the row. Short, lowercase, fixed width when padded. */
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

/** The widest kind label, so every row's title starts at the same column. */
const KIND_WIDTH = Math.max(...Object.values(TOOL_KIND_LABELS).map((label) => label.length))

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

/** A tool call: its one-line summary, plus a diff when it proposes an edit. */
export function ToolCallRow({ record }: ToolCallRowProps): ReactNode {
  const palette = usePalette()
  const { kind, title, status, diff } = record

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      <text>
        <span fg={palette.muted}>{TOOL_KIND_LABELS[kind].padEnd(KIND_WIDTH)}</span>
        <span fg={palette.text}>{` ${title} `}</span>
        <span fg={palette.tool[status]}>{status}</span>
      </text>

      {kind === "edit" && diff ? <EditDiff path={diff.path} unified={diff.unified} /> : null}
    </box>
  )
}

/**
 * The proposed change, in unified view.
 *
 * The line-number gutter stays on. It carries the `+`/`-` signs as well as the
 * numbers, and OpenTUI marks the whole gutter unselectable - so a drag over the diff
 * copies the code and leaves the chrome behind, which is exactly what the PRD asks
 * for. Turning the gutter off would also drop the signs, leaving added and removed
 * lines told apart by background color alone.
 */
function EditDiff({ path, unified }: { path: string; unified: string }): ReactNode {
  const palette = usePalette()
  const syntaxStyle = useSyntaxStyle()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text fg={palette.accent}>{path}</text>
      <diff diff={unified} view="unified" filetype={filetypeFor(path)} syntaxStyle={syntaxStyle} />
    </box>
  )
}
