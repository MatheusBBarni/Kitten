/**
 * The prompt-local slash-command menu's presentation layer.
 *
 * It intentionally owns no state, store subscription, or agent access. PromptEditor
 * decides which rows are visible and invokes selections; this leaf only renders that
 * already-decided interaction state beside the active textarea.
 */

import type { MouseEvent } from "@opentui/core"
import type { ReactNode } from "react"

import type { CockpitCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** One command the non-modal slash menu can render. */
export type MenuRow =
  | {
      source: "cockpit"
      command: CockpitCommand
      label: string
      shortcut: string
    }
  | {
      source: "agent"
      name: string
      label: string
      hint?: string
    }

/** A named section of menu rows, kept in the order PromptEditor provides. */
export interface SlashMenuGroup {
  source: string
  rows: readonly MenuRow[]
}

export interface SlashMenuProps {
  groups: readonly SlashMenuGroup[]
  highlightedIndex: number
  /** Passed through by the owner so keyboard and future pointer activation share one action. */
  onSelect: (row: MenuRow) => void
}

/** Never leave a user staring at an empty border when their filter matches nothing. */
export const NO_COMMANDS_MATCH = "No commands match this filter."

/** Stable identity for the row keyboard activation currently targets. */
export const HIGHLIGHTED_COMMAND_ROW_ID = "slash-menu-highlighted-row"

/** A stateless grouped command list; PromptEditor handles all activation. */
export function SlashMenu({ groups, highlightedIndex, onSelect }: SlashMenuProps): ReactNode {
  const palette = usePalette()
  const rowCount = groups.reduce((count, group) => count + group.rows.length, 0)
  let offset = 0

  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "column",
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title="Commands"
      titleColor={palette.accent}
    >
      {rowCount === 0 ? (
        <text fg={palette.muted}>{NO_COMMANDS_MATCH}</text>
      ) : (
        groups.map((group) => {
          const groupOffset = offset
          offset += group.rows.length
          return (
            <SlashMenuGroupView
              key={group.source}
              group={group}
              highlightedIndex={highlightedIndex}
              offset={groupOffset}
              onSelect={onSelect}
            />
          )
        })
      )}
    </box>
  )
}

function SlashMenuGroupView({
  group,
  highlightedIndex,
  offset,
  onSelect,
}: {
  group: SlashMenuGroup
  highlightedIndex: number
  offset: number
  onSelect: (row: MenuRow) => void
}): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text fg={palette.accent}>{group.source}</text>
      {group.rows.map((row, index) => (
        <SlashMenuRow
          key={row.source === "cockpit" ? `cockpit:${row.command}` : `agent:${row.name}`}
          row={row}
          highlighted={offset + index === highlightedIndex}
          onSelect={onSelect}
        />
      ))}
    </box>
  )
}

function SlashMenuRow({
  row,
  highlighted,
  onSelect,
}: {
  row: MenuRow
  highlighted: boolean
  onSelect: (row: MenuRow) => void
}): ReactNode {
  const palette = usePalette()

  const activate = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(row)
  }

  return (
    <box style={{ height: 1, flexShrink: 0 }}>
      <text id={highlighted ? HIGHLIGHTED_COMMAND_ROW_ID : undefined} onMouseDown={activate}>
        <span fg={palette.accent}>{highlighted ? "▸" : " "}</span>
        <span fg={highlighted ? palette.text : palette.muted}>{` ${row.label}`}</span>
        {row.source === "cockpit" ? <span fg={palette.muted}>{`  ${row.shortcut}`}</span> : null}
        {row.source === "agent" && row.hint ? <span fg={palette.muted}>{`  ${row.hint}`}</span> : null}
      </text>
    </box>
  )
}
