/** Explicit focused-parent delegation form with component-local draft state. */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type { ExploreDenialReason } from "../core/explorePolicy.ts"
import type { DelegationOverlay } from "../store/appStore.ts"
import {
  EXPLORE_DENIAL_LABELS,
  selectDelegationOverlay,
  selectExploreAvailabilityPresentation,
  selectIsApprovalOpen,
  selectIsClarificationOpen,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { DELEGATION_HINT, matchDelegationCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

export const DELEGATION_DIALOG_TITLE = "Delegate child work"
export const DELEGATION_TASK_LABEL = "Task *"
export const DELEGATION_OUTCOME_LABEL = "Desired outcome *"
export const DELEGATION_TASK_ERROR = "Enter a task with at least one non-space character."
export const DELEGATION_OUTCOME_ERROR = "Enter a desired outcome with at least one non-space character."
export const DELEGATION_PENDING = "Starting child…"
export const DELEGATION_DENIED_PREFIX = "Denied:"
export const DELEGATION_COMMITTED_BASE_DISCLOSURE =
  "Child starts from the parent committed HEAD. Uncommitted parent changes are excluded."

type DelegationField = "task" | "outcome"

/** Mount local drafts for one captured parent, even while a higher-priority interaction paints over them. */
export function DelegationDialog(): ReactNode {
  const overlay = useAppSelector(selectDelegationOverlay)
  if (!overlay) return null
  return <DelegationDialogBody key={overlay.parentId} overlay={overlay} />
}

function DelegationDialogBody({ overlay }: { overlay: DelegationOverlay }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  const advisory = useMemo(
    () => controller.actions.exploreAvailability(overlay.parentId),
    [controller, overlay.parentId],
  )
  const availabilitySelector = useMemo(
    () => selectExploreAvailabilityPresentation(advisory.kind === "available" ? null : advisory.reason),
    [advisory],
  )
  const availability = useAppSelector(availabilitySelector)
  const [field, setField] = useState<DelegationField>("task")
  const [task, setTask] = useState("")
  const [outcome, setOutcome] = useState("")
  const [taskError, setTaskError] = useState(false)
  const [outcomeError, setOutcomeError] = useState(false)
  const [launchDenial, setLaunchDenial] = useState<ExploreDenialReason | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const preempted = approvalOpen || clarificationOpen

  const stillOwnsSlot = useCallback(
    (): boolean => controller.store.getState().overlays.delegation?.parentId === overlay.parentId,
    [controller, overlay.parentId],
  )

  const dismiss = useCallback((): void => {
    if (!pendingRef.current && stillOwnsSlot()) controller.store.closeDelegation()
  }, [controller, stillOwnsSlot])

  const submit = useCallback(async (): Promise<void> => {
    if (pendingRef.current || !stillOwnsSlot()) return
    const normalizedTask = task.trim()
    const normalizedOutcome = outcome.trim()
    const missingTask = normalizedTask.length === 0
    const missingOutcome = normalizedOutcome.length === 0
    setTaskError(missingTask)
    setOutcomeError(missingOutcome)
    setLaunchDenial(null)
    if (missingTask || missingOutcome) {
      setField(missingTask ? "task" : "outcome")
      return
    }
    if (availability.kind === "unavailable") return

    pendingRef.current = true
    setPending(true)
    let denial: ExploreDenialReason | null = null
    try {
      const result = await controller.actions.startExploreChild({
        parentId: overlay.parentId,
        task: normalizedTask,
        desiredOutcome: normalizedOutcome,
      })
      if (result.kind === "started") {
        pendingRef.current = false
        setPending(false)
        if (stillOwnsSlot()) controller.store.closeDelegation()
        return
      }
      denial = result.reason
    } catch {
      denial = "startup-failed"
    }
    pendingRef.current = false
    setPending(false)
    if (!stillOwnsSlot()) return
    setLaunchDenial(denial)
  }, [availability.kind, controller, outcome, overlay.parentId, stillOwnsSlot, task])

  const onKey = useCallback((key: KeyEvent): void => {
    if (preempted) return
    const command = matchDelegationCommand(key)
    if (command === null && isTextInputKey(key)) return

    key.preventDefault()
    switch (command) {
      case "prev-field":
      case "next-field":
        if (!pendingRef.current) setField((current) => current === "task" ? "outcome" : "task")
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
  }, [dismiss, preempted, submit])
  useKeyboard(onKey)

  if (preempted) return null
  const displayName = controller.runtime(overlay.parentId)?.displayName ?? overlay.parentId

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
      title={DELEGATION_DIALOG_TITLE}
      titleColor={palette.accent}
    >
      <text fg={palette.muted}>{`Parent: ${displayName}`}</text>
      <text fg={palette.text}>{availability.roleLabel}</text>
      <text fg={palette.muted}>{availability.restrictionSummary}</text>
      <text fg={palette.muted}>{DELEGATION_COMMITTED_BASE_DISCLOSURE}</text>
      <text fg={launchDenial || availability.kind === "unavailable" ? palette.status.error : palette.accent}>
        {launchDenial
          ? `${DELEGATION_DENIED_PREFIX} ${EXPLORE_DENIAL_LABELS[launchDenial]}`
          : availability.statusLabel}
      </text>
      <text fg={palette.text}>{DELEGATION_TASK_LABEL}</text>
      <input
        focused={field === "task"}
        value={task}
        placeholder="A bounded piece of independent work"
        onInput={(value) => {
          setTask(value)
          setTaskError(false)
          setLaunchDenial(null)
        }}
        onSubmit={() => { void submit() }}
        style={{ textColor: palette.text, cursorColor: palette.accent }}
      />
      {taskError ? <text fg={palette.status.error}>{DELEGATION_TASK_ERROR}</text> : null}

      <text fg={palette.text}>{DELEGATION_OUTCOME_LABEL}</text>
      <input
        focused={field === "outcome"}
        value={outcome}
        placeholder="What a successful result should contain"
        onInput={(value) => {
          setOutcome(value)
          setOutcomeError(false)
          setLaunchDenial(null)
        }}
        onSubmit={() => { void submit() }}
        style={{ textColor: palette.text, cursorColor: palette.accent }}
      />
      {outcomeError ? <text fg={palette.status.error}>{DELEGATION_OUTCOME_ERROR}</text> : null}
      {pending ? <text fg={palette.accent}>{DELEGATION_PENDING}</text> : null}
      <text fg={palette.muted}>{DELEGATION_HINT}</text>
    </box>
  )
}

/** Keys the focused OpenTUI input may edit without escaping the modal. */
function isTextInputKey(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) return false
  return key.name.length === 1 || ["backspace", "delete", "left", "right", "home", "end"].includes(key.name)
}
