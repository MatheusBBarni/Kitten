/** The valid no-selected-conversation workspace. */

import type { MouseEvent } from "@opentui/core"
import { useCallback, type ReactNode } from "react"

import { selectBackgroundWork, selectWorkspaceNotice } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { usePalette } from "./theme.ts"

export const EMPTY_WORKSPACE_TITLE = "No visible conversations"
export const NEW_CONVERSATION_LABEL = "New Conversation"
export const BACKGROUND_WORK_LABEL = "Background work"
export const NO_PROVIDER_NOTICE = "No provider is available to start a conversation."

export function EmptyWorkspace(): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const background = useAppSelector(selectBackgroundWork)
  const notice = useAppSelector(selectWorkspaceNotice)

  const createConversation = useCallback((event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    void controller.actions.createConversation()
  }, [controller])

  const openBackground = useCallback((event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    controller.store.openSessions()
  }, [controller])

  return (
    <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column", gap: 1, paddingTop: 1 }}>
      <text fg={palette.text}>{EMPTY_WORKSPACE_TITLE}</text>
      <box style={{ height: 1, flexShrink: 0 }} onMouseDown={createConversation}>
        <text fg={palette.accent}>{`[ ${NEW_CONVERSATION_LABEL} ]`}</text>
      </box>
      {background.length > 0 ? (
        <box style={{ height: 1, flexShrink: 0 }} onMouseDown={openBackground}>
          <text fg={palette.accent}>{`[ ${BACKGROUND_WORK_LABEL}: ${background.length} ]`}</text>
        </box>
      ) : null}
      {notice?.code === "no-provider-available" ? (
        <text fg={palette.status.error}>{NO_PROVIDER_NOTICE}</text>
      ) : null}
    </box>
  )
}
