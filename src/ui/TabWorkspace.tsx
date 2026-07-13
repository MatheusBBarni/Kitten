/** The single-row visible-conversation strip above the selected workspace. */

import type { MouseEvent } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useCallback, type ReactNode } from "react"

import type { SessionStatus } from "../core/types.ts"
import {
  selectBackgroundWork,
  selectVisibleTabs,
  type WorkspaceConversationView,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { usePalette } from "./theme.ts"

export const TAB_SELECTED_MARKER = "[selected]"
export const TAB_MARKER = "[tab]"
export const SHARED_WORKSPACE_LABEL = "shared"
export const TAB_OVERFLOW_LABEL = "Sessions"
export const NEW_TAB_LABEL = "+ New tab"

const STATUS_CUES: Readonly<Record<SessionStatus, string>> = {
  idle: "idle",
  working: "working",
  awaiting_clarification: "clarification",
  awaiting_approval: "approval",
  error: "error",
  finished: "finished",
}

/** A compact layout result kept pure so resize behavior is deterministic and cheap to test. */
export interface TabStripLayout {
  visible: WorkspaceConversationView[]
  hiddenCount: number
  overflowLabel: string | null
  newTabVisible: boolean
}

/** The exact monochrome-readable label painted by one tab item. */
export function tabItemLabel(tab: WorkspaceConversationView): string {
  const standing =
    tab.teardownState === "closing"
      ? "closing"
      : tab.availability.kind === "starting"
        ? "starting"
        : tab.availability.kind === "unavailable"
          ? "unavailable"
          : STATUS_CUES[tab.status]
  const shared = tab.sharedWorkspaceCount > 1
    ? ` · ${SHARED_WORKSPACE_LABEL}×${tab.sharedWorkspaceCount}`
    : ""
  return `${tab.selected ? TAB_SELECTED_MARKER : TAB_MARKER} ${tab.label} · ${standing}${shared}`
}

function overflowLabel(hiddenCount: number, backgroundCount: number): string | null {
  if (hiddenCount === 0 && backgroundCount === 0) return null
  const hidden = hiddenCount > 0 ? ` +${hiddenCount}` : ""
  const background = backgroundCount > 0 ? ` · bg ${backgroundCount}` : ""
  return `${TAB_OVERFLOW_LABEL}${hidden}${background}`
}

/**
 * Fit a stable subset without wrapping. The selected conversation is retained whenever
 * at least one tab fits; every omitted item remains reachable through SessionsOverlay.
 */
export function layoutTabStrip(
  tabs: readonly WorkspaceConversationView[],
  width: number,
  backgroundCount: number,
): TabStripLayout {
  const available = Math.max(width - 4, 1)
  let visible = [...tabs]
  let newTabVisible = true

  while (visible.length > 0) {
    const hiddenCount = tabs.length - visible.length
    const overflow = overflowLabel(hiddenCount, backgroundCount)
    const used = visible.reduce((total, tab) => total + tabItemLabel(tab).length, 0)
      + Math.max(visible.length - 1, 0)
      + (overflow ? overflow.length + (visible.length > 0 ? 1 : 0) : 0)
      + (newTabVisible ? NEW_TAB_LABEL.length + (visible.length > 0 || overflow ? 1 : 0) : 0)
    if (used <= available) return { visible, hiddenCount, overflowLabel: overflow, newTabVisible }

    const selected = tabs.find((tab) => tab.selected)
    // The direct creation affordance is additive: never hide a still-reachable
    // tab just to display it. `/new` stays available at every terminal width.
    if (newTabVisible) {
      newTabVisible = false
      continue
    }
    const removable = [...visible].reverse().find((tab) => tab.id !== selected?.id)
    if (removable) {
      visible = visible.filter((tab) => tab.id !== removable.id)
      continue
    }
    // At the tightest widths, keep the canonical reachability entry visible even
    // when the selected tab cannot coexist with it on one row.
    if (hiddenCount > 0 || backgroundCount > 0) visible = []
    break
  }

  const hiddenCount = tabs.length - visible.length
  return { visible, hiddenCount, overflowLabel: overflowLabel(hiddenCount, backgroundCount), newTabVisible }
}

export function TabWorkspace(): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { width } = useTerminalDimensions()
  const tabs = useAppSelector(selectVisibleTabs)
  const background = useAppSelector(selectBackgroundWork)
  const layout = layoutTabStrip(tabs, width, background.length)

  const openSessions = useCallback((event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    controller.store.openSessions()
  }, [controller])
  const createConversation = useCallback((event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    void controller.actions.createConversation()
  }, [controller])

  if (tabs.length === 0) return null

  return (
    <box
      style={{
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        gap: 1,
        overflow: "hidden",
      }}
    >
      {layout.visible.map((tab) => (
        <TabItem key={tab.id} tab={tab} />
      ))}
      {layout.newTabVisible ? (
        <box style={{ height: 1, flexShrink: 0 }} onMouseDown={createConversation}>
          <text fg={palette.accent} wrapMode="none">{NEW_TAB_LABEL}</text>
        </box>
      ) : null}
      {layout.overflowLabel ? (
        <box style={{ height: 1, flexShrink: 0 }} onMouseDown={openSessions}>
          <text fg={palette.accent} wrapMode="none">{layout.overflowLabel}</text>
        </box>
      ) : null}
    </box>
  )
}

function TabItem({ tab }: { tab: WorkspaceConversationView }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const onMouseDown = useCallback((event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    controller.actions.selectConversation(tab.id, { source: "mouse" })
  }, [controller, tab.id])

  return (
    <box style={{ height: 1, flexShrink: 0 }} onMouseDown={onMouseDown}>
      <text
        fg={tab.selected ? palette.accent : palette.status[tab.status]}
        attributes={tab.selected ? 1 : 0}
        wrapMode="none"
      >
        {tabItemLabel(tab)}
      </text>
    </box>
  )
}
