/**
 * The prompt-local slash-command menu's presentation layer.
 *
 * It intentionally owns no state, store subscription, or agent access. PromptEditor
 * decides which rows are visible and invokes selections; this leaf only renders that
 * already-decided interaction state beside the active textarea.
 */

import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useRef, type ReactNode } from "react"

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
  /** A definite viewport cap supplied by the composer, so the menu never paints above the screen. */
  maxHeight: number
  /** Passed through by the owner so keyboard and future pointer activation share one action. */
  onSelect: (row: MenuRow) => void
}

/** Never leave a user staring at an empty border when their filter matches nothing. */
export const NO_COMMANDS_MATCH = "No commands match this filter."

/** Stable identity for the row keyboard activation currently targets. */
export const HIGHLIGHTED_COMMAND_ROW_ID = "slash-menu-highlighted-row"

/** Stable identity for the menu viewport, including its border. */
export const SLASH_MENU_ID = "slash-menu"

/** Stable identity for the constrained list viewport. */
export const SLASH_MENU_SCROLLBOX_ID = "slash-menu-list"

/** OpenTUI otherwise reserves a row for a horizontal scrollbar. */
const HIDDEN_HORIZONTAL_SCROLLBAR = { visible: false } as const

/** A stateless grouped command list; PromptEditor handles all activation. */
export function SlashMenu({ groups, highlightedIndex, maxHeight, onSelect }: SlashMenuProps): ReactNode {
  const palette = usePalette()
  const { height: terminalHeight } = useTerminalDimensions()
  const rowCount = groups.reduce((count, group) => count + group.rows.length, 0)
  const scrollbox = useRef<ScrollBoxRenderable | null>(null)
  // Group headings and the surrounding border are real rows. The definite height is
  // what turns the list into a viewport rather than letting absolute positioning draw
  // past the top of the terminal.
  const intrinsicHeight = rowCount === 0 ? 3 : rowCount + groups.length + 2
  const viewportHeight = Math.max(1, Math.min(intrinsicHeight, maxHeight, terminalHeight))
  const constrained = intrinsicHeight > viewportHeight
  let offset = 0
  const attachScrollbox = useCallback((node: ScrollBoxRenderable | null): void => {
    scrollbox.current = node
  }, [])

  useEffect(() => {
    // ScrollBox calculates child positions during its native layout pass. Deferring one
    // task makes the initial highlighted command visible as well as later arrow moves.
    const timer = setTimeout(() => scrollbox.current?.scrollChildIntoView(HIGHLIGHTED_COMMAND_ROW_ID), 0)
    return () => clearTimeout(timer)
  }, [highlightedIndex])

  return (
    <box
      id={SLASH_MENU_ID}
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
        // An absolutely positioned Yoga node with no height expands to its
        // containing layout. Always provide the content-derived viewport so a
        // short command list stays compact, while a long list remains capped.
        height: viewportHeight,
        overflow: "hidden",
      }}
      title="Commands"
      titleColor={palette.accent}
    >
      {rowCount === 0 ? (
        <text fg={palette.muted}>{NO_COMMANDS_MATCH}</text>
      ) : constrained ? (
        <scrollbox
          id={SLASH_MENU_SCROLLBOX_ID}
          ref={attachScrollbox}
          // `height: 100%` makes the ScrollBox viewport fill the bounded menu.
          // Keep ScrollBox's own row layout intact: it places the content wrapper
          // beside its vertical scrollbar. Overriding it to a column stacks the
          // scrollbar beneath the list instead.
          style={{ height: "100%", flexGrow: 1, flexShrink: 1 }}
          scrollX={false}
          horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}
        >
          {groups.map((group) => {
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
          })}
        </scrollbox>
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
    <box
      id={highlighted ? HIGHLIGHTED_COMMAND_ROW_ID : undefined}
      style={{ height: 1, flexShrink: 0 }}
      onMouseDown={activate}
    >
      <text>
        <span fg={palette.accent}>{highlighted ? "▸" : " "}</span>
        <span fg={highlighted ? palette.text : palette.muted}>{` ${row.label}`}</span>
        {row.source === "cockpit" ? <span fg={palette.muted}>{`  ${row.shortcut}`}</span> : null}
        {row.source === "agent" && row.hint ? <span fg={palette.muted}>{`  ${row.hint}`}</span> : null}
      </text>
    </box>
  )
}
