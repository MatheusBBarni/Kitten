/**
 * The prompt-local slash-command menu's presentation layer.
 *
 * It intentionally owns no state, store subscription, or agent access. PromptEditor
 * decides which rows are visible and invokes selections; this leaf only renders that
 * already-decided interaction state beside the active textarea.
 */

import type { ReactNode } from "react"

import type { CockpitCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** One command the non-modal slash menu can render. */
export type MenuRow =
  | {
      source: "kitten"
      command: CockpitCommand
      name: string
      description: string
    }
  | {
      source: "agent"
      name: string
      description: string
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

/** A stateless grouped command list; PromptEditor handles all activation. */
export function SlashMenu({ groups, highlightedIndex, onSelect: _onSelect }: SlashMenuProps): ReactNode {
  const palette = usePalette()
  const rows = groups.flatMap((group) => group.rows)

  return (
    <box
      style={{
        width: "100%",
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
      {rows.length === 0 ? (
        <text fg={palette.muted}>{NO_COMMANDS_MATCH}</text>
      ) : (
        groups.map((group) => (
          <SlashMenuGroupView
            key={group.source}
            group={group}
            highlightedIndex={highlightedIndex}
            offset={offsetFor(groups, group.source)}
          />
        ))
      )}
    </box>
  )
}

function SlashMenuGroupView({
  group,
  highlightedIndex,
  offset,
}: {
  group: SlashMenuGroup
  highlightedIndex: number
  offset: number
}): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginTop: offset === 0 ? 0 : 1 }}>
      <text fg={palette.accent}>{group.source}</text>
      {group.rows.map((row, index) => (
        <SlashMenuRow key={`${row.source}:${row.name}`} row={row} highlighted={offset + index === highlightedIndex} />
      ))}
    </box>
  )
}

function SlashMenuRow({ row, highlighted }: { row: MenuRow; highlighted: boolean }): ReactNode {
  const palette = usePalette()
  const trailing = row.source === "kitten" ? row.description : row.hint ?? row.description

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={palette.accent}>{highlighted ? "▸" : " "}</span>
      <span fg={highlighted ? palette.text : palette.muted}>{` /${row.name}`}</span>
      <span fg={palette.muted}>{`  ${trailing}`}</span>
    </text>
  )
}

function offsetFor(groups: readonly SlashMenuGroup[], source: string): number {
  let offset = 0
  for (const group of groups) {
    if (group.source === source) return offset
    offset += group.rows.length
  }
  return offset
}
