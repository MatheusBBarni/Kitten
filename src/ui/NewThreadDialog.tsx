/** Explicit project/provider chooser for a new independently managed thread. */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import {
  PROVIDER_METADATA,
  type ProviderKind,
} from "../core/types.ts"
import {
  selectFocusedSessionId,
  selectIsApprovalOpen,
  selectIsClarificationOpen,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import {
  matchNewThreadCommand,
  NEW_THREAD_HINT,
} from "./keymap.ts"
import { usePalette } from "./theme.ts"

export const NEW_THREAD_DIALOG_TITLE = "New thread"
export const NEW_THREAD_PROJECT_LABEL = "Project directory *"
export const NEW_THREAD_PROVIDER_LABEL = "Provider"
export const NEW_THREAD_PROJECT_ERROR = "Enter a Git repository directory."
export const NEW_THREAD_PROVIDER_ERROR = "The selected provider is unavailable."
export const NEW_THREAD_PENDING = "Starting thread…"

export interface NewThreadDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function NewThreadDialog({ open, onClose }: NewThreadDialogProps): ReactNode {
  if (!open) return null
  return <NewThreadDialogBody onClose={onClose} />
}

function NewThreadDialogBody({ onClose }: { readonly onClose: () => void }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const selectedSessionId = useAppSelector(selectFocusedSessionId)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  const providers = useMemo(
    () => controller.providers?.() ?? [
      ...new Set(controller.runtimes().map((runtime) => runtime.providerKind)),
    ],
    [controller],
  )
  const selectedSession = selectedSessionId
    ? controller.store.getState().sessions[selectedSessionId]
    : undefined
  const initialProviderIndex = Math.max(
    0,
    providers.findIndex((provider) => provider === selectedSession?.providerKind),
  )
  const [cwd, setCwd] = useState(selectedSession?.cwd ?? "")
  const [providerIndex, setProviderIndex] = useState(initialProviderIndex)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const preempted = approvalOpen || clarificationOpen

  const dismiss = useCallback((): void => {
    if (!pendingRef.current) onClose()
  }, [onClose])

  const moveProvider = useCallback((delta: -1 | 1): void => {
    if (providers.length === 0 || pendingRef.current) return
    setProviderIndex((current) => (current + delta + providers.length) % providers.length)
    setError(null)
  }, [providers.length])

  const submit = useCallback(async (): Promise<void> => {
    if (pendingRef.current) return
    const projectCwd = cwd.trim()
    const providerKind = providers[providerIndex]
    if (!projectCwd) {
      setError(NEW_THREAD_PROJECT_ERROR)
      return
    }
    if (!providerKind) {
      setError(NEW_THREAD_PROVIDER_ERROR)
      return
    }

    pendingRef.current = true
    setPending(true)
    setError(null)
    const sessionId = await controller.actions.createConversation({
      cwd: projectCwd,
      providerKind,
    })
    pendingRef.current = false
    setPending(false)
    if (sessionId) {
      onClose()
      return
    }

    const notice = controller.store.getState().workspaceNotice
    setError(
      notice?.code === "no-provider-available"
        ? NEW_THREAD_PROVIDER_ERROR
        : NEW_THREAD_PROJECT_ERROR,
    )
  }, [controller, cwd, onClose, providerIndex, providers])

  const onKey = useCallback((key: KeyEvent): void => {
    if (preempted) return
    const command = matchNewThreadCommand(key)
    if (command === null && isTextInputKey(key)) return

    key.preventDefault()
    switch (command) {
      case "prev-provider":
        moveProvider(-1)
        return
      case "next-provider":
        moveProvider(1)
        return
      case "confirm":
        void submit()
        return
      case "cancel":
        dismiss()
        return
      default:
        return
    }
  }, [dismiss, moveProvider, preempted, submit])
  useKeyboard(onKey)

  if (preempted) return null

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
      title={NEW_THREAD_DIALOG_TITLE}
      titleColor={palette.accent}
    >
      <text fg={palette.text}>{NEW_THREAD_PROJECT_LABEL}</text>
      <input
        focused
        value={cwd}
        placeholder="/absolute/path/to/project"
        onInput={(value) => {
          setCwd(value)
          setError(null)
        }}
        onSubmit={() => { void submit() }}
        style={{ textColor: palette.text, cursorColor: palette.accent }}
      />
      <text fg={palette.text}>{NEW_THREAD_PROVIDER_LABEL}</text>
      <text>
        {providers.map((provider, index) => (
          <span
            key={provider}
            fg={index === providerIndex ? palette.accent : palette.muted}
          >
            {`${index === providerIndex ? "▸ " : "  "}${PROVIDER_METADATA[provider].displayName}  `}
          </span>
        ))}
      </text>
      {error ? <text fg={palette.status.error}>{error}</text> : null}
      {pending ? <text fg={palette.accent}>{NEW_THREAD_PENDING}</text> : null}
      <text fg={palette.muted}>{NEW_THREAD_HINT}</text>
    </box>
  )
}

function isTextInputKey(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) return false
  return key.name.length === 1 ||
    ["backspace", "delete", "left", "right", "home", "end"].includes(key.name)
}
