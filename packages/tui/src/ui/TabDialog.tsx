/** Captured-target rename and close decisions for one workspace conversation. */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type { CloseChoice } from "../app/actions.ts"
import type { SessionId, SessionStatus } from "../core/types.ts"
import type { TabDialogOverlay } from "../store/appStore.ts"
import {
  selectDelegatedParentCloseSummary,
  selectIsApprovalOpen,
  selectTabDialogOverlay,
  type DelegatedParentCloseSummary,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import {
  matchTabDialogCommand,
  TAB_CLOSE_HINT,
  TAB_RENAME_HINT,
} from "./keymap.ts"
import { usePalette } from "./theme.ts"

export const RENAME_DIALOG_TITLE = "Rename conversation"
export const CLOSE_DIALOG_TITLE = "Close conversation"
export const EMPTY_RENAME_ERROR = "Enter a name with at least one non-space character."
export const IDLE_CLOSE_LABEL = "Close conversation"
export const BACKGROUND_LABEL = "Background"
export const CANCEL_DELIBERATELY_LABEL = "Cancel deliberately"
export const KEEP_OPEN_LABEL = "Keep open"
export const KEEP_WORKING_LABEL = "Keep working"
export const DELEGATED_CLOSE_PROMPT = "Closing this parent will cancel its active delegated work."

interface CloseOption {
  label: string
  consequence: string
  choice: CloseChoice
}

const IDLE_CLOSE_OPTIONS: readonly CloseOption[] = [
  {
    label: IDLE_CLOSE_LABEL,
    consequence: "Close it, stop retaining live work, and omit it from future restoration.",
    choice: "close",
  },
]

/** Mount the retained dialog state, even while approval temporarily paints over it. */
export function TabDialog(): ReactNode {
  const overlay = useAppSelector(selectTabDialogOverlay)
  if (!overlay) return null
  return <TabDialogBody key={`${overlay.kind}:${overlay.sessionId}`} overlay={overlay} />
}

function TabDialogBody({ overlay }: { overlay: TabDialogOverlay }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const conversationSelector = useMemo(
    () => (state: ReturnType<typeof controller.store.getState>) =>
      state.workspace.conversations[overlay.sessionId] ?? null,
    [controller, overlay.sessionId],
  )
  const statusSelector = useMemo(
    () => (state: ReturnType<typeof controller.store.getState>) =>
      state.sessions[overlay.sessionId]?.status ?? null,
    [controller, overlay.sessionId],
  )
  const conversation = useAppSelector(conversationSelector)
  const status = useAppSelector(statusSelector)
  const delegatedCloseSummarySelector = useMemo(
    () => selectDelegatedParentCloseSummary(overlay.sessionId),
    [overlay.sessionId],
  )
  const delegatedCloseSummary = useAppSelector(delegatedCloseSummarySelector)
  const [draft, setDraft] = useState(conversation?.displayName ?? "")
  const [renameError, setRenameError] = useState(false)
  const [selected, setSelected] = useState(0)
  const selectedRef = useRef(0)

  const stillOwnsSlot = useCallback(
    (): boolean => controller.store.getState().overlays.tabDialog === overlay,
    [controller, overlay],
  )

  const dismiss = useCallback((): void => {
    if (stillOwnsSlot()) controller.store.closeTabDialog()
  }, [controller, stillOwnsSlot])

  const confirmRename = useCallback((): void => {
    if (!stillOwnsSlot()) return
    const normalized = draft.trim()
    if (normalized.length === 0) {
      setRenameError(true)
      return
    }
    controller.actions.renameConversation(overlay.sessionId, normalized)
    controller.store.closeTabDialog()
  }, [controller, draft, overlay.sessionId, stillOwnsSlot])

  const closeOptions = useMemo(
    () => delegatedCloseSummary
      ? delegatedParentCloseOptions(delegatedCloseSummary.activeChildCount)
      : status === "idle" ? IDLE_CLOSE_OPTIONS : activeCloseOptions(status),
    [delegatedCloseSummary, status],
  )
  const clampedSelected = Math.min(selected, closeOptions.length - 1)
  const chooseClose = useCallback((): void => {
    if (!stillOwnsSlot()) return
    const option = closeOptions[Math.min(selectedRef.current, closeOptions.length - 1)]
    if (!option) return
    controller.store.closeTabDialog()
    void controller.actions.closeConversation(overlay.sessionId, option.choice)
  }, [closeOptions, controller, overlay.sessionId, stillOwnsSlot])

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // Approval is topmost. Do not even consume its keys; the retained component and
      // local rename draft resume after the permission request leaves the slot.
      if (approvalOpen) return

      const command = matchTabDialogCommand(key)
      if (overlay.kind === "rename") {
        if (command === "confirm") {
          key.preventDefault()
          confirmRename()
        } else if (command === "cancel") {
          key.preventDefault()
          dismiss()
        }
        // Printable text and cursor movement belong to the focused input.
        return
      }

      // A close decision is fully modal: every key stays out of the prompt and shell.
      key.preventDefault()
      switch (command) {
        case "prev-choice":
          selectedRef.current = Math.max(selectedRef.current - 1, 0)
          setSelected(selectedRef.current)
          return
        case "next-choice":
          selectedRef.current = Math.min(selectedRef.current + 1, closeOptions.length - 1)
          setSelected(selectedRef.current)
          return
        case "confirm":
          chooseClose()
          return
        case "cancel":
          dismiss()
          return
        default:
          return
      }
    },
    [approvalOpen, chooseClose, closeOptions.length, confirmRename, dismiss, overlay.kind],
  )
  useKeyboard(onKey)

  // Standing down means no visual surface, focusable input, or consumed key remains.
  // Keeping this component mounted preserves the captured target and rename draft.
  if (approvalOpen || !conversation || !status) return null

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        maxHeight: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={overlay.kind === "rename" ? RENAME_DIALOG_TITLE : CLOSE_DIALOG_TITLE}
      titleColor={palette.accent}
    >
      <text fg={palette.muted}>{`${conversation.displayName} · ${overlay.sessionId}`}</text>
      {overlay.kind === "rename" ? (
        <>
          <input
            focused
            value={draft}
            onInput={(value) => {
              setDraft(value)
              if (renameError) setRenameError(false)
            }}
            onSubmit={confirmRename}
            style={{ textColor: palette.text, cursorColor: palette.accent }}
          />
          {renameError ? <text fg={palette.status.error}>{EMPTY_RENAME_ERROR}</text> : null}
          <text fg={palette.muted}>{TAB_RENAME_HINT}</text>
        </>
      ) : (
        <>
          <text fg={palette.text}>
            {delegatedCloseSummary ? DELEGATED_CLOSE_PROMPT : closePrompt(status)}
          </text>
          {delegatedCloseSummary ? (
            <>
              <text fg={palette.text}>
                {`${delegatedCloseSummary.activeChildCount} active ${delegatedCloseSummary.activeChildCount === 1 ? "child task" : "child tasks"} affected:`}
              </text>
              <text fg={palette.muted}>
                {delegatedCloseSummary.statuses
                  .map(({ label, count }) => `${label} (${count})`)
                  .join(" · ")}
              </text>
            </>
          ) : null}
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            {closeOptions.map((option, index) => (
              <text key={option.choice}>
                <span fg={index === clampedSelected ? palette.accent : palette.muted}>
                  {index === clampedSelected ? "▸ " : "  "}
                </span>
                <span fg={index === clampedSelected ? palette.text : palette.muted}>{option.label}</span>
                <span fg={palette.muted}>{` — ${option.consequence}`}</span>
              </text>
            ))}
          </box>
          <text fg={palette.muted}>{TAB_CLOSE_HINT}</text>
        </>
      )}
    </box>
  )
}

function closePrompt(status: SessionStatus): string {
  return status === "idle"
    ? "This idle conversation will become Closed and will not be restored."
    : `This conversation is ${status.replaceAll("_", " ")}. Choose what happens to its work.`
}

function activeCloseOptions(status: SessionStatus | null): readonly CloseOption[] {
  const cancelConsequence = status === "working" || status === "awaiting_approval"
    ? "Stop the current work deliberately, then close this conversation."
    : "Close this conversation deliberately; no active turn will be cancelled."
  return [
    {
      label: BACKGROUND_LABEL,
      consequence: "Remove the tab while its work and attention remain live and reachable.",
      choice: "background",
    },
    {
      label: CANCEL_DELIBERATELY_LABEL,
      consequence: cancelConsequence,
      choice: "cancel",
    },
    {
      label: KEEP_OPEN_LABEL,
      consequence: "Leave the conversation visible and its lifecycle unchanged.",
      choice: "keep-open",
    },
  ]
}

function delegatedParentCloseOptions(activeChildCount: number): readonly CloseOption[] {
  const childTasks = activeChildCount === 1 ? "child task" : "child tasks"
  return [
    {
      label: `Cancel ${activeChildCount} ${childTasks} and close`,
      consequence: "Cancel the affected delegated work, then close this parent conversation.",
      choice: "cancel",
    },
    {
      label: KEEP_WORKING_LABEL,
      consequence: "Leave the parent and all delegated work unchanged.",
      choice: "keep-open",
    },
  ]
}
