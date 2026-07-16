/**
 * The protocol-free clarification dialog.
 *
 * It mounts last in the cockpit, reads only the active store projection, and sends
 * one captured request identity through `ControllerActions.respondClarification`.
 * Printable keys are released only to this dialog's focused text input; every other
 * key is consumed while the projection is active.
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type {
  ClarificationAnswer,
  ClarificationField,
  ClarificationOutcome,
  ClarificationPayload,
} from "../core/types.ts"
import type { ClarificationOverlay } from "../store/appStore.ts"
import { selectClarificationOverlay } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import {
  CLARIFICATION_HINT,
  clarificationOptionIndex,
  matchClarificationCommand,
} from "./keymap.ts"
import { usePalette } from "./theme.ts"

export const CLARIFICATION_TITLE = "Clarification"
export const CLARIFICATION_SELECTION_MARKER = "▸"
export const CLARIFICATION_REQUIRED_ERROR = "Complete every required field before submitting."
/** Stable identity for the bounded clarification dialog viewport. */
export const CLARIFICATION_DIALOG_ID = "clarification-dialog"

export function clarificationTitleFor(displayName: string): string {
  return `${CLARIFICATION_TITLE} from ${displayName}`
}

/** Render the active projection, remounting local form state for each request identity. */
export function ClarificationPrompt(): ReactNode {
  const overlay = useAppSelector(selectClarificationOverlay)
  if (!overlay) return null
  return <ClarificationDialog key={`${overlay.requestId}:${overlay.generation}`} overlay={overlay} />
}

function ClarificationDialog({ overlay }: { overlay: ClarificationOverlay }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const fields = overlay.payload.fields
  const focusTargets = useMemo(() => fields.flatMap((field, fieldIndex) => {
    if (field.mode === "text") return [{ fieldIndex, kind: "text" as const }]
    return field.allowsCustom
      ? [{ fieldIndex, kind: "choice" as const }, { fieldIndex, kind: "text" as const }]
      : [{ fieldIndex, kind: "choice" as const }]
  }), [fields])
  const [activeTargetIndex, setActiveTargetIndex] = useState(0)
  const [optionIndices, setOptionIndices] = useState<Record<string, number>>({})
  const [multiValues, setMultiValues] = useState<Record<string, string[]>>({})
  const [textValues, setTextValues] = useState<Record<string, string>>({})
  const [validationError, setValidationError] = useState(false)
  const settled = useRef(false)

  const activeTarget = focusTargets[Math.min(activeTargetIndex, Math.max(focusTargets.length - 1, 0))]
  const activeField = activeTarget ? fields[activeTarget.fieldIndex] : undefined
  const editingText = activeTarget?.kind === "text"

  const answer = useCallback(
    (outcome: ClarificationOutcome): void => {
      if (settled.current) return
      const active = controller.store.getState().overlays.clarification
      if (
        active?.requestId !== overlay.requestId ||
        active.generation !== overlay.generation
      ) return
      settled.current = true
      controller.actions.respondClarification(overlay.requestId, overlay.generation, outcome)
    },
    [controller, overlay.generation, overlay.requestId],
  )

  const submit = useCallback((): void => {
    const answers = clarificationAnswers(overlay.payload, optionIndices, multiValues, textValues)
    if (answers === null) {
      setValidationError(true)
      return
    }
    answer({ kind: "submitted", answers })
  }, [answer, multiValues, optionIndices, overlay.payload, textValues])

  const moveFocus = useCallback((delta: -1 | 1): void => {
    if (focusTargets.length === 0) return
    setValidationError(false)
    setActiveTargetIndex((index) => (index + delta + focusTargets.length) % focusTargets.length)
  }, [focusTargets.length])

  const moveOption = useCallback((delta: -1 | 1): void => {
    if (!activeField || activeField.mode === "text" || editingText) return
    setValidationError(false)
    const index = optionIndices[activeField.id] ?? 0
    if (delta === 1 && index === activeField.options.length - 1 && activeField.allowsCustom) {
      const customTargetIndex = focusTargets.findIndex(
        (target) => target.fieldIndex === activeTarget?.fieldIndex && target.kind === "text",
      )
      if (customTargetIndex >= 0) setActiveTargetIndex(customTargetIndex)
      return
    }
    setOptionIndices((current) => ({
      ...current,
      [activeField.id]: Math.max(0, Math.min(index + delta, activeField.options.length - 1)),
    }))
  }, [activeField, activeTarget?.fieldIndex, editingText, focusTargets, optionIndices])

  const chooseDigit = useCallback((index: number): void => {
    if (!activeField || activeField.mode === "text" || editingText) return
    if (activeField.allowsCustom && index === activeField.options.length) {
      const customTargetIndex = focusTargets.findIndex(
        (target) => target.fieldIndex === activeTarget?.fieldIndex && target.kind === "text",
      )
      if (customTargetIndex >= 0) setActiveTargetIndex(customTargetIndex)
      return
    }
    if (!activeField.options[index]) return
    setValidationError(false)
    setOptionIndices((current) => ({ ...current, [activeField.id]: index }))
  }, [activeField, activeTarget?.fieldIndex, editingText, focusTargets])

  const toggleMulti = useCallback((): void => {
    if (!activeField || activeField.mode !== "multi" || editingText) return
    const option = activeField.options[optionIndices[activeField.id] ?? 0]
    if (!option) return
    setValidationError(false)
    setMultiValues((current) => {
      const selected = current[activeField.id] ?? []
      return {
        ...current,
        [activeField.id]: selected.includes(option.id)
          ? selected.filter((id) => id !== option.id)
          : [...selected, option.id],
      }
    })
  }, [activeField, editingText, optionIndices])

  const onKey = useCallback((key: KeyEvent): void => {
    const digit = clarificationOptionIndex(key)
    if (digit !== null && activeField?.mode !== "text" && !editingText) {
      key.preventDefault()
      chooseDigit(digit)
      return
    }

    const command = matchClarificationCommand(key)
    if (editingText) {
      if (command === "prev-option" && activeField?.mode !== "text") {
        key.preventDefault()
        moveFocus(-1)
        return
      }
      if (command === "toggle-option") return
      if (command === null && isTextInputKey(key)) return
      if (command === "prev-option" || command === "next-option") return
    }

    key.preventDefault()
    switch (command) {
      case "prev-option":
        moveOption(-1)
        return
      case "next-option":
        moveOption(1)
        return
      case "prev-field":
        moveFocus(-1)
        return
      case "next-field":
        moveFocus(1)
        return
      case "toggle-option":
        toggleMulti()
        return
      case "confirm":
        submit()
        return
      case "skip":
        answer({ kind: "skipped" })
        return
      case "cancel":
        answer({ kind: "cancelled" })
        return
      default:
        return
    }
  }, [activeField, answer, chooseDigit, editingText, moveFocus, moveOption, submit, toggleMulti])
  useKeyboard(onKey)

  const displayName = controller.runtime(overlay.sessionId)?.displayName ?? overlay.sessionId

  return (
    <box
      id={CLARIFICATION_DIALOG_ID}
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // Keep short questions compact. The cap still protects rich multi-field
        // requests from drawing beyond the terminal viewport.
        maxHeight: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.status.awaiting_clarification,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={clarificationTitleFor(displayName)}
      titleColor={palette.status.awaiting_clarification}
    >
      <text style={{ flexShrink: 0 }}>
        <span fg={palette.text}>{overlay.title}</span>
        <span fg={palette.muted}>{`  ${overlay.cwd}`}</span>
      </text>
      {overlay.payload.title ? (
        <text style={{ flexShrink: 0 }} fg={palette.text}>{overlay.payload.title}</text>
      ) : null}
      {overlay.payload.context ? (
        <text style={{ flexShrink: 0 }} fg={palette.muted}>{overlay.payload.context}</text>
      ) : null}
      <text style={{ flexShrink: 0 }} fg={palette.text}>{overlay.payload.prompt}</text>

      <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden", marginTop: 1 }}>
        {fields.map((field, fieldIndex) => (
          <ClarificationFieldView
            key={field.id}
            field={field}
            activeTarget={activeTarget?.fieldIndex === fieldIndex ? activeTarget.kind : null}
            optionIndex={optionIndices[field.id] ?? 0}
            selected={multiValues[field.id] ?? []}
            text={textValues[field.id] ?? ""}
            onText={(value) => {
              setValidationError(false)
              setTextValues((current) => ({ ...current, [field.id]: value }))
            }}
            onSubmit={submit}
          />
        ))}
      </box>

      {validationError ? (
        <text style={{ flexShrink: 0 }} fg={palette.status.error}>{CLARIFICATION_REQUIRED_ERROR}</text>
      ) : null}
      <text style={{ flexShrink: 0 }} fg={palette.muted}>{CLARIFICATION_HINT}</text>
    </box>
  )
}

function ClarificationFieldView({
  field,
  activeTarget,
  optionIndex,
  selected,
  text,
  onText,
  onSubmit,
}: {
  field: ClarificationField
  activeTarget: "choice" | "text" | null
  optionIndex: number
  selected: readonly string[]
  text: string
  onText: (value: string) => void
  onSubmit: () => void
}): ReactNode {
  const palette = usePalette()
  const fieldLabel = `${field.label}${field.required ? " *" : ""}`
  const active = activeTarget !== null
  const customActive = field.mode !== "text" && field.allowsCustom && activeTarget === "text"

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginBottom: 1 }}>
      <text>
        <span fg={active ? palette.status.awaiting_clarification : palette.muted}>
          {active ? `${CLARIFICATION_SELECTION_MARKER} ` : "  "}
        </span>
        <span fg={active ? palette.text : palette.muted}>{fieldLabel}</span>
      </text>
      {field.description ? <text fg={palette.muted}>{`  ${field.description}`}</text> : null}

      {field.mode !== "text" ? (
        field.options.map((option, index) => {
          const highlighted = activeTarget === "choice" && index === optionIndex
          const checked = field.mode === "multi" && selected.includes(option.id)
          return (
            <box
              key={option.id}
              style={{
                flexDirection: "column",
                paddingLeft: 2,
                backgroundColor: highlighted ? palette.selectionSurface : undefined,
              }}
            >
              <text>
                <span fg={highlighted ? palette.status.awaiting_clarification : palette.muted}>
                  {highlighted ? CLARIFICATION_SELECTION_MARKER : " "}
                </span>
                <span fg={palette.muted}>{field.mode === "multi" ? ` ${checked ? "[x]" : "[ ]"} ${index + 1}. ` : ` ${index + 1}. `}</span>
                <span fg={highlighted || checked ? palette.text : palette.muted}>{option.label}</span>
              </text>
              {option.description ? <text fg={palette.muted}>{`    ${option.description}`}</text> : null}
            </box>
          )
        })
      ) : null}
      {field.mode !== "text" && field.allowsCustom ? (
        <box
          style={{
            flexDirection: "row",
            paddingLeft: 2,
            backgroundColor: customActive ? palette.selectionSurface : undefined,
          }}
        >
          <text>
            <span fg={customActive ? palette.status.awaiting_clarification : palette.muted}>
              {customActive ? CLARIFICATION_SELECTION_MARKER : " "}
            </span>
            <span fg={palette.muted}>{` ${field.options.length + 1}. `}</span>
            <span fg={customActive ? palette.text : palette.muted}>Custom answer: </span>
          </text>
          <input
            focused={customActive}
            value={text}
            placeholder="Type a custom answer"
            onInput={onText}
            onSubmit={onSubmit}
            style={{
              flexGrow: 1,
              textColor: palette.text,
              cursorColor: palette.status.awaiting_clarification,
              backgroundColor: customActive ? palette.selectionSurface : palette.surface,
              focusedBackgroundColor: palette.selectionSurface,
            }}
          />
        </box>
      ) : null}
      {field.mode === "text" ? (
        <box style={{ flexDirection: "row", paddingLeft: 2 }}>
          <text fg={activeTarget === "text" ? palette.text : palette.muted}>Response: </text>
          <input
            focused={activeTarget === "text"}
            value={text}
            placeholder="Type a response"
            onInput={onText}
            onSubmit={onSubmit}
            style={{
              flexGrow: 1,
              textColor: palette.text,
              cursorColor: palette.status.awaiting_clarification,
              backgroundColor: palette.surface,
              focusedBackgroundColor: palette.selectionSurface,
            }}
          />
        </box>
      ) : null}
    </box>
  )
}

function clarificationAnswers(
  payload: ClarificationPayload,
  optionIndices: Readonly<Record<string, number>>,
  multiValues: Readonly<Record<string, readonly string[]>>,
  textValues: Readonly<Record<string, string>>,
): Record<string, ClarificationAnswer> | null {
  const answers: Record<string, ClarificationAnswer> = {}
  for (const field of payload.fields) {
    if (field.mode === "single") {
      const option = field.options[optionIndices[field.id] ?? 0]
      const customText = field.allowsCustom ? textValues[field.id] ?? "" : ""
      if (!option && customText.length === 0) {
        if (field.required) return null
        continue
      }
      answers[field.id] = {
        selectedOptionIds: option ? [option.id] : [],
        ...(customText.length === 0 ? {} : { customText }),
      }
      continue
    }
    if (field.mode === "multi") {
      const selected = multiValues[field.id] ?? []
      const customText = field.allowsCustom ? textValues[field.id] ?? "" : ""
      if (field.required && selected.length === 0 && customText.length === 0) return null
      if (selected.length > 0 || customText.length > 0) {
        answers[field.id] = {
          selectedOptionIds: [...selected],
          ...(customText.length === 0 ? {} : { customText }),
        }
      }
      continue
    }
    const text = textValues[field.id] ?? ""
    if (field.required && text.length === 0) return null
    if (text.length > 0) answers[field.id] = { selectedOptionIds: [], customText: text }
  }
  return answers
}

/** Keys the focused OpenTUI input may consume without escaping the modal. */
function isTextInputKey(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) return false
  return key.name.length === 1 || ["backspace", "delete", "left", "right", "home", "end"].includes(key.name)
}
