/**
 * Keyboard-only `/statusline` workflow.
 *
 * The transient phase is store-owned, proposal collection is delegated to the
 * app-layer StatuslineFlow, and persistence is requested only through controller
 * actions. The view never touches config, a connection, ACP, or telemetry.
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useState, type ReactNode } from "react"

import type { StatuslineFlow } from "../app/statuslineFlow.ts"
import {
  STATUSLINE_RECOVERY_PRESETS,
  renderStatusline,
  statuslineText,
  type StatuslineContext,
  type StatuslineLayout,
} from "../core/statusline.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, PROVIDER_METADATA, type ConfigOption } from "../core/types.ts"
import type { StatuslineOverlay as StatuslineOverlayState, StatuslinePresetName } from "../store/appStore.ts"
import {
  selectAgentConfigOptions,
  selectAgentEffort,
  selectAgentModel,
  selectIsApprovalOpen,
  selectIsClarificationOpen,
  selectSessionBranch,
  selectStatuslinePreference,
  selectStatuslineOverlay,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { KEYMAP_HINT, matchStatuslineCommand, STATUSLINE_HINT } from "./keymap.ts"
import { statuslineFooterBudget } from "./StatusStrip.tsx"
import { usePalette } from "./theme.ts"

export const STATUSLINE_TITLE = "Personal statusline"
export const STATUSLINE_DISCLOSURE =
  "Your request and the agent proposal will appear in the focused agent's normal transcript. Kitten sends no resolved status values and stores neither the request nor the reply as statusline data."
export const STATUSLINE_REQUEST_PROMPT = "Describe the fields, order, and compactness you want."
export const STATUSLINE_PREVIEW_LABEL = "Preview at current terminal width"
export const STATUSLINE_CONFIG_LABEL = "Exact personal config change"
export const STATUSLINE_WAITING_LABEL = "Waiting for the focused agent's proposal…"
export const STATUSLINE_SAVED_LABEL = "Save and apply"
export const STATUSLINE_CANCEL_LABEL = "Cancel"

/** Keep proposal review aligned with the active footer, including its fixed help affordance. */
export function statuslinePreviewBudget(width: number): number {
  return statuslineFooterBudget(width, KEYMAP_HINT)
}

interface StatuslineOverlayProps {
  readonly flow: StatuslineFlow
}

/** Mount point for the store-owned slot. Higher-priority interactions retain ownership. */
export function StatuslineOverlay({ flow }: StatuslineOverlayProps): ReactNode {
  const overlay = useAppSelector(selectStatuslineOverlay)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  if (!overlay || approvalOpen || clarificationOpen) return null
  const phaseKey = overlay.phase === "preview" ? `${overlay.phase}:${overlay.preset ?? "proposal"}` : overlay.phase
  return <StatuslineDialog key={`${overlay.sessionId}:${phaseKey}`} flow={flow} overlay={overlay} />
}

function StatuslineDialog({ flow, overlay }: { flow: StatuslineFlow; overlay: StatuslineOverlayState }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { width, height } = useTerminalDimensions()
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState(false)
  const sessionId = overlay.sessionId
  const runtime = controller.runtime(sessionId)
  const branch = useAppSelector(useMemo(() => selectSessionBranch(sessionId), [sessionId]))
  const model = useAppSelector(useMemo(() => selectAgentModel(sessionId), [sessionId]))
  const effort = useAppSelector(useMemo(() => selectAgentEffort(sessionId), [sessionId]))
  const configOptions = useAppSelector(useMemo(() => selectAgentConfigOptions(sessionId), [sessionId]))
  const statuslinePreference = useAppSelector(selectStatuslinePreference)

  const context = useMemo<StatuslineContext>(() => ({
    cwd: runtime?.cwd,
    branch,
    provider: runtime ? PROVIDER_METADATA[runtime.providerKind].compactLabel : null,
    model: displayOption(configOptions, MODEL_CATEGORY, model),
    effort: displayOption(configOptions, EFFORT_CATEGORY, effort),
    helpText: KEYMAP_HINT,
  }), [branch, configOptions, effort, model, runtime])

  const fail = useCallback((requestText: string, reason: string): void => {
    setBusy(false)
    controller.store.updateStatusline({ phase: "failure", requestText, reason })
  }, [controller.store])

  const acknowledge = useCallback((): void => {
    if (busy) return
    setBusy(true)
    void controller.actions.acknowledgeStatuslineDisclosure()
      .then((result) => {
        if (result.outcome === "saved") {
          controller.store.updateStatusline({ phase: "request", requestText: "" })
        } else {
          fail("", result.message)
        }
      })
      .catch(() => fail("", "The disclosure acknowledgement could not be saved."))
      .finally(() => setBusy(false))
  }, [busy, controller.actions, controller.store, fail])

  const requestProposal = useCallback((requestText: string): void => {
    const trimmed = requestText.trim()
    if (busy || trimmed.length === 0) return
    controller.store.updateStatusline({ phase: "waiting", requestText: trimmed })
    setBusy(true)
    void flow.request(trimmed, sessionId)
      .then((result) => {
        const current = controller.store.getState().overlays.statusline
        if (!current || current.sessionId !== sessionId || current.phase !== "waiting" || current.requestText !== trimmed) return
        if (result.kind === "proposal") {
          controller.store.updateStatusline({
            phase: "preview",
            requestText: trimmed,
            layout: result.layout,
            preset: null,
          })
          return
        }
        controller.store.updateStatusline({
          phase: "presets",
          requestText: trimmed,
          reason: result.reason,
          selectedPreset: null,
        })
      })
      .catch(() => {
        const current = controller.store.getState().overlays.statusline
        if (current?.sessionId === sessionId && current.phase === "waiting") {
          controller.store.updateStatusline({
            phase: "presets",
            requestText: trimmed,
            reason: "The statusline request failed. Choose a recovery layout or try again later.",
            selectedPreset: null,
          })
        }
      })
      .finally(() => setBusy(false))
  }, [busy, controller.store, flow, sessionId])

  const confirmLayout = useCallback((layout: StatuslineLayout, requestText: string): void => {
    if (busy) return
    setBusy(true)
    void controller.actions.confirmStatusline(layout)
      .then((result) => {
        if (result.outcome === "saved") controller.store.closeStatusline()
        else fail(requestText, result.message)
      })
      .catch(() => fail(requestText, "The statusline layout could not be saved."))
      .finally(() => setBusy(false))
  }, [busy, controller.actions, controller.store, fail])

  const onKey = useCallback((key: KeyEvent): void => {
    key.preventDefault()
    const command = matchStatuslineCommand(key)
    if (command === "cancel") {
      controller.store.closeStatusline()
      return
    }
    if ((busy && overlay.phase !== "failure") || overlay.phase === "waiting") return

    const optionCount = overlay.phase === "presets" ? STATUSLINE_RECOVERY_PRESETS.length : 2
    if (command === "prev-option") {
      const next = Math.max(0, selected - 1)
      setSelected(next)
      if (overlay.phase === "presets") controller.store.updateStatusline({
        phase: "presets",
        requestText: overlay.requestText,
        reason: overlay.reason,
        selectedPreset: STATUSLINE_RECOVERY_PRESETS[next]?.name ?? null,
      })
      return
    }
    if (command === "next-option") {
      const next = Math.min(selected + 1, optionCount - 1)
      setSelected(next)
      if (overlay.phase === "presets") controller.store.updateStatusline({
        phase: "presets",
        requestText: overlay.requestText,
        reason: overlay.reason,
        selectedPreset: STATUSLINE_RECOVERY_PRESETS[next]?.name ?? null,
      })
      return
    }
    if (command === "confirm") {
      switch (overlay.phase) {
        case "disclosure":
          if (selected === 0) acknowledge()
          else controller.store.updateStatusline({
            phase: "presets",
            requestText: "",
            reason: "You declined the agent request. Choose a local recovery layout.",
            selectedPreset: null,
          })
          return
        case "request":
          requestProposal(overlay.requestText)
          return
        case "preview":
          if (selected === 0) confirmLayout(overlay.layout, overlay.requestText)
          else controller.store.closeStatusline()
          return
        case "failure":
          if (selected === 0) {
            controller.store.updateStatusline({
              phase: "presets",
              requestText: overlay.requestText,
              reason: overlay.reason,
              selectedPreset: null,
            })
          } else {
            controller.store.closeStatusline()
          }
          return
        case "presets": {
          const preset = STATUSLINE_RECOVERY_PRESETS[selected]
          if (preset) controller.store.updateStatusline({
            phase: "preview",
            requestText: overlay.requestText,
            layout: preset.layout,
            preset: preset.name,
          })
          return
        }
      }
    }

    const current = controller.store.getState().overlays.statusline
    if (!current || current.sessionId !== sessionId || current.phase !== "request") return
    if (plainBackspace(key)) {
      controller.store.updateStatusline({ phase: "request", requestText: [...current.requestText].slice(0, -1).join("") })
      return
    }
    const text = printableText(key)
    if (text !== null) controller.store.updateStatusline({ phase: "request", requestText: `${current.requestText}${text}` })
  }, [acknowledge, busy, confirmLayout, controller.store, overlay, requestProposal, selected, sessionId])
  useKeyboard(onKey)

  const previewBudget = statuslinePreviewBudget(width)

  return (
    <box
      style={{
        position: "absolute",
        top: Math.max(1, Math.floor(height / 8)),
        left: 4,
        right: 4,
        maxHeight: Math.max(8, height - 4),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={STATUSLINE_TITLE}
      titleColor={palette.accent}
    >
      <StatuslinePhaseView
        overlay={overlay}
        selected={selected}
        busy={busy}
        context={context}
        previewBudget={previewBudget}
        llmDisclosureAcknowledged={statuslinePreference.llmDisclosureAcknowledged}
      />
      <text style={{ marginTop: 1, flexShrink: 0 }} fg={palette.muted}>{STATUSLINE_HINT}</text>
    </box>
  )
}

function StatuslinePhaseView({
  overlay,
  selected,
  busy,
  context,
  previewBudget,
  llmDisclosureAcknowledged,
}: {
  overlay: StatuslineOverlayState
  selected: number
  busy: boolean
  context: StatuslineContext
  previewBudget: number
  llmDisclosureAcknowledged: boolean
}): ReactNode {
  const palette = usePalette()
  switch (overlay.phase) {
    case "disclosure":
      return (
        <>
          <text fg={palette.text}>{STATUSLINE_DISCLOSURE}</text>
          <Choice label={busy ? "Saving acknowledgement…" : "Acknowledge and continue"} selected={selected === 0} />
          <Choice label="Decline and use presets" selected={selected === 1} />
        </>
      )
    case "request":
      return (
        <>
          <text fg={palette.text}>{STATUSLINE_REQUEST_PROMPT}</text>
          <text style={{ marginTop: 1 }} wrapMode="none">
            <span fg={palette.accent}>{"> "}</span>
            <span fg={palette.text}>{overlay.requestText}</span>
            <span fg={palette.accent}>▏</span>
          </text>
          <text fg={palette.muted}>Enter requests a proposal. Esc cancels.</text>
        </>
      )
    case "waiting":
      return <text fg={palette.muted}>{STATUSLINE_WAITING_LABEL}</text>
    case "preview":
      return <Preview
        layout={overlay.layout}
        preset={overlay.preset}
        context={context}
        previewBudget={previewBudget}
        llmDisclosureAcknowledged={llmDisclosureAcknowledged}
        selected={selected}
        busy={busy}
      />
    case "failure":
      return (
        <>
          <text fg={palette.status.error}>{overlay.reason}</text>
          <Choice label="Open recovery layouts" selected={selected === 0} />
          <Choice label={STATUSLINE_CANCEL_LABEL} selected={selected === 1} />
        </>
      )
    case "presets":
      return (
        <>
          <text fg={palette.status.awaiting_approval}>{overlay.reason}</text>
          {STATUSLINE_RECOVERY_PRESETS.map((preset, index) => (
            <Choice key={preset.name} label={preset.name} selected={selected === index} />
          ))}
        </>
      )
  }
}

function Preview({
  layout,
  preset,
  context,
  previewBudget,
  llmDisclosureAcknowledged,
  selected,
  busy,
}: {
  layout: StatuslineLayout
  preset: StatuslinePresetName | null
  context: StatuslineContext
  previewBudget: number
  llmDisclosureAcknowledged: boolean
  selected: number
  busy: boolean
}): ReactNode {
  const palette = usePalette()
  const preview = statuslineText(renderStatusline(layout, context, previewBudget))
  return (
    <>
      {preset ? <text fg={palette.accent}>{`${preset} recovery layout`}</text> : null}
      <text fg={palette.muted}>{STATUSLINE_PREVIEW_LABEL}</text>
      <text style={{ flexShrink: 0, overflow: "hidden" }} wrapMode="none" fg={palette.text}>{preview || "(no fields fit)"}</text>
      <text style={{ marginTop: 1 }} fg={palette.muted}>{STATUSLINE_CONFIG_LABEL}</text>
      <text fg={palette.text}>{statuslineConfigChange(layout, llmDisclosureAcknowledged)}</text>
      <Choice label={busy ? "Saving…" : STATUSLINE_SAVED_LABEL} selected={selected === 0} />
      <Choice label={STATUSLINE_CANCEL_LABEL} selected={selected === 1} />
    </>
  )
}

function Choice({ label, selected }: { label: string; selected: boolean }): ReactNode {
  const palette = usePalette()
  return (
    <text>
      <span fg={selected ? palette.accent : palette.muted}>{selected ? "▸" : " "}</span>
      <span fg={selected ? palette.text : palette.muted}>{` ${label}`}</span>
    </text>
  )
}

/** Exact nested value written by confirmation; unrelated root config remains untouched. */
export function statuslineConfigChange(layout: StatuslineLayout, llmDisclosureAcknowledged: boolean): string {
  return JSON.stringify({
    statusline: {
      llmDisclosureAcknowledged,
      separator: layout.separator,
      line: layout.line,
    },
  })
}

function displayOption(
  options: readonly ConfigOption[],
  category: typeof MODEL_CATEGORY | typeof EFFORT_CATEGORY,
  value: string | undefined,
): string | null {
  if (value === undefined) return null
  const option = options.find((candidate) => candidate.category === category)
  return option?.options.find((candidate) => candidate.value === value)?.name ?? value
}

function plainBackspace(key: KeyEvent): boolean {
  return (key.name === "backspace" || key.name === "delete") && !key.ctrl && !key.meta && !key.shift
}

function printableText(key: KeyEvent): string | null {
  if (key.ctrl || key.meta || key.name === "return" || key.name === "kpenter") return null
  if (key.name === "space") return " "
  const sequence = key.sequence
  if (sequence && !/[\p{Cc}\p{Cs}]/u.test(sequence)) return sequence
  return key.name.length === 1 ? key.name : null
}
