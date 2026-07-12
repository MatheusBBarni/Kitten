/**
 * The `/resume` saved-run picker.
 *
 * The gate is store-owned, while the rows come from the injected project RunStore.
 * Its focused input receives ordinary text; the modal listener intercepts only the
 * documented navigation keys. The cockpit shell stands down through
 * `selectHasOpenOverlay`, so no global chord can fire behind the picker.
 */

import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import {
  persistedConversationCount,
  persistedResumeAgent,
  persistedSelectedConversationId,
  type PersistedRunRecord,
  type PersistedRunSummary,
} from "../persistence/runRecord.ts"
import type { RunStore } from "../persistence/runStore.ts"
import { selectIsApprovalOpen, selectSessionPicker } from "../store/selectors.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { matchSessionPickerCommand, SESSION_PICKER_HINT } from "./keymap.ts"
import { usePalette } from "./theme.ts"

export const SESSION_PICKER_TITLE = "Resume saved run"
export const SESSION_PICKER_FILTER_PLACEHOLDER = "Filter project runs"
export const NO_SAVED_RUNS = "No saved runs for this project."
export const NO_MATCHING_RUNS = "No saved runs match this filter."
export const SESSION_HISTORY_UNAVAILABLE = "Saved-run history is unavailable."
export const PREVIEW_HEADING = "Preview"
export const RUN_MARKER = "▸"
/** Stable hook for the keyboard-following run list. */
export const SESSION_PICKER_SCROLLBOX_ID = "session-picker-runs"
export const DELETE_RUN_CONFIRMATION = "Press Ctrl+D again to delete this saved run."
export const DELETE_ALL_CONFIRMATION =
  "Press Ctrl+A again to delete all Kitten saved runs from every project."

type PendingDeletion =
  | { readonly kind: "run"; readonly runId: string }
  | { readonly kind: "all" }

/** Give each row a stable descendant id so selection can scroll it into view. */
function runRowId(runId: string): string {
  return `session-picker-run-${runId}`
}

/** OpenTUI reserves a horizontal-scrollbar row even when horizontal scrolling is off. */
const HIDDEN_HORIZONTAL_SCROLLBAR = { visible: false } as const

/** The persistence boundary and project identity the boot path gives the picker. */
export interface SessionPickerSource {
  readonly runStore: RunStore
  readonly cwd: string
  /** Clock seam for deterministic relative-time rendering. */
  readonly now?: () => number
}

/** The picker, or nothing at all. Its key listener exists only while the slot is open. */
export function SessionPicker({ source, recorder }: { source?: SessionPickerSource; recorder?: TelemetryRecorder }): ReactNode {
  const open = useAppSelector(selectSessionPicker)
  if (!open) return null
  return <SessionPickerDialog source={source} recorder={recorder} />
}

/** Format elapsed activity time compactly enough to share one metadata row. */
export function formatRelativeTime(updatedAt: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - updatedAt) / 1_000))
  if (elapsedSeconds < 60) return "now"
  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/** Case-insensitive subsequence matching, token by token, for forgiving live search. */
export function fuzzyMatches(query: string, candidate: string): boolean {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = candidate.toLocaleLowerCase()
  return tokens.every((token) => isSubsequence(token, haystack))
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index++
    if (index === needle.length) return true
  }
  return needle.length === 0
}

function SessionPickerDialog({ source, recorder }: { source?: SessionPickerSource; recorder?: TelemetryRecorder }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const selectedRef = useRef(0)
  const [preview, setPreview] = useState<PersistedRunRecord | null>(null)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [listVersion, setListVersion] = useState(0)
  const interactiveRecorded = useRef(false)
  const runList = useRef<ScrollBoxRenderable | null>(null)

  useEffect(() => {
    if (!recorder || interactiveRecorded.current) return
    interactiveRecorded.current = true
    recorder.resumePickerInteractive()
  }, [recorder])

  const listing = useMemo((): { runs: PersistedRunSummary[]; error: string | null } => {
    if (!source) return { runs: [], error: SESSION_HISTORY_UNAVAILABLE }
    try {
      return { runs: source.runStore.list(source.cwd), error: null }
    } catch {
      return { runs: [], error: SESSION_HISTORY_UNAVAILABLE }
    }
  }, [source, listVersion])

  const filteredRuns = useMemo(
    () =>
      listing.runs.filter((run) =>
        fuzzyMatches(query, `${run.lastPrompt} ${run.gitBranch ?? ""}`),
      ),
    [listing.runs, query],
  )
  const clampedSelected = Math.min(selected, Math.max(filteredRuns.length - 1, 0))

  // The filter retains focus for text input, so the list cannot rely on its own
  // keyboard handling. Keep the selected row visible whenever arrow navigation moves
  // beyond the viewport instead.
  useEffect(() => {
    const selectedRun = filteredRuns[clampedSelected]
    if (selectedRun) runList.current?.scrollChildIntoView(runRowId(selectedRun.runId))
  }, [clampedSelected, filteredRuns])

  const changeQuery = useCallback((value: string): void => {
    selectedRef.current = 0
    setSelected(0)
    setPreview(null)
    setInteractionError(null)
    setPendingDeletion(null)
    setQuery(value)
  }, [])

  const loadSelected = useCallback((): PersistedRunRecord | null => {
    const summary = filteredRuns[Math.min(selectedRef.current, Math.max(filteredRuns.length - 1, 0))]
    if (!summary || !source) return null
    try {
      const record = source.runStore.load(source.cwd, summary.runId)
      if (record === null) setInteractionError("This saved run is no longer available.")
      return record
    } catch {
      setInteractionError("This saved run could not be read.")
      return null
    }
  }, [filteredRuns, source])

  const previewSelected = useCallback((): void => {
    const record = loadSelected()
    if (record === null) return
    setInteractionError(null)
    setPreview((current) => current?.runId === record.runId ? null : record)
  }, [loadSelected])

  const restoreSelected = useCallback((): void => {
    const record = loadSelected()
    if (record === null) return
    controller.store.closeSessionPicker()
    // Controller restore is fail-soft by contract. Preserve that boundary even for
    // injected test doubles or future implementations that accidentally reject.
    void controller.restore(record, "picker").catch(() => {})
  }, [controller, loadSelected])

  const refreshList = useCallback((): void => {
    setPreview(null)
    setPendingDeletion(null)
    setListVersion((version) => version + 1)
  }, [])

  const deleteSelected = useCallback((): void => {
    const summary = filteredRuns[Math.min(selectedRef.current, Math.max(filteredRuns.length - 1, 0))]
    if (!summary || !source) return

    if (pendingDeletion?.kind !== "run" || pendingDeletion.runId !== summary.runId) {
      setInteractionError(null)
      setPendingDeletion({ kind: "run", runId: summary.runId })
      return
    }

    try {
      source.runStore.delete(source.cwd, summary.runId)
      selectedRef.current = Math.min(
        selectedRef.current,
        Math.max(filteredRuns.length - 2, 0),
      )
      setSelected(selectedRef.current)
      setInteractionError(null)
      refreshList()
    } catch {
      setPendingDeletion(null)
      setInteractionError("This saved run could not be deleted.")
    }
  }, [filteredRuns, pendingDeletion, refreshList, source])

  const deleteAll = useCallback((): void => {
    if (!source) return

    if (pendingDeletion?.kind !== "all") {
      setInteractionError(null)
      setPendingDeletion({ kind: "all" })
      return
    }

    try {
      source.runStore.deleteAll()
      selectedRef.current = 0
      setSelected(0)
      setInteractionError(null)
      refreshList()
    } catch {
      setPendingDeletion(null)
      setInteractionError("Saved runs could not be cleared.")
    }
  }, [pendingDeletion, refreshList, source])

  const onKey = useCallback(
    (key: KeyEvent): void => {
      if (approvalOpen) return
      const command = matchSessionPickerCommand(key)

      // Ordinary printable/editing keys belong to the focused filter. Modified and
      // unknown non-text keys are consumed so nothing beneath the modal can act.
      if (command === null) {
        if (key.ctrl || key.meta) key.preventDefault()
        return
      }
      key.preventDefault()

      switch (command) {
        case "prev-run": {
          setPendingDeletion(null)
          selectedRef.current = Math.max(selectedRef.current - 1, 0)
          setSelected(selectedRef.current)
          setPreview(null)
          return
        }
        case "next-run": {
          setPendingDeletion(null)
          selectedRef.current = Math.min(selectedRef.current + 1, Math.max(filteredRuns.length - 1, 0))
          setSelected(selectedRef.current)
          setPreview(null)
          return
        }
        case "preview":
          setPendingDeletion(null)
          previewSelected()
          return
        case "restore":
          setPendingDeletion(null)
          restoreSelected()
          return
        case "delete-run":
          deleteSelected()
          return
        case "delete-all":
          deleteAll()
          return
        case "cancel":
          if (pendingDeletion !== null) {
            setPendingDeletion(null)
            return
          }
          controller.store.closeSessionPicker()
          return
      }
    },
    [
      approvalOpen,
      controller,
      deleteAll,
      deleteSelected,
      filteredRuns.length,
      pendingDeletion,
      previewSelected,
      restoreSelected,
    ],
  )
  useKeyboard(onKey)

  const error = interactionError ?? listing.error
  const now = source?.now?.() ?? Date.now()

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // A scrollbox needs a definite viewport. `maxHeight` lets the dialog collapse
        // to its intrinsic rows, leaving no room for the list to scroll.
        height: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={SESSION_PICKER_TITLE}
      titleColor={palette.accent}
    >
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={palette.accent}>Filter: </text>
        <input
          focused={!approvalOpen}
          value={query}
          placeholder={SESSION_PICKER_FILTER_PLACEHOLDER}
          onInput={changeQuery}
          style={{ flexGrow: 1, textColor: palette.text, cursorColor: palette.accent }}
        />
      </box>

      <scrollbox
        id={SESSION_PICKER_SCROLLBOX_ID}
        ref={runList}
        style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, marginTop: 1 }}
        scrollX={false}
        horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}
      >
        {error ? (
          <text fg={palette.status.error}>{error}</text>
        ) : filteredRuns.length === 0 ? (
          <text fg={palette.muted}>{query.trim() ? NO_MATCHING_RUNS : NO_SAVED_RUNS}</text>
        ) : (
          filteredRuns.map((run, index) => (
            <RunRow
              key={run.runId}
              run={run}
              highlighted={index === clampedSelected}
              relativeTime={formatRelativeTime(run.updatedAt, now)}
            />
          ))
        )}
      </scrollbox>

      {preview ? <RunPreview record={preview} /> : null}

      {pendingDeletion ? (
        <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.context.warn}>
          {pendingDeletion.kind === "run" ? DELETE_RUN_CONFIRMATION : DELETE_ALL_CONFIRMATION}
        </text>
      ) : null}

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted}>
        {SESSION_PICKER_HINT}
      </text>
    </box>
  )
}

function RunRow({
  run,
  highlighted,
  relativeTime,
}: {
  run: PersistedRunSummary
  highlighted: boolean
  relativeTime: string
}): ReactNode {
  const palette = usePalette()
  const branch = run.gitBranch ?? "no branch"
  const messageLabel = `${run.messageCount} ${run.messageCount === 1 ? "msg" : "msgs"}`
  const label = run.lastPrompt.trim() || "Untitled run"

  return (
    <box id={runRowId(run.runId)} style={{ flexDirection: "column", flexShrink: 0 }}>
      <text>
        <span fg={highlighted ? palette.accent : palette.muted}>{highlighted ? RUN_MARKER : " "}</span>
        <span fg={highlighted ? palette.text : palette.muted}>{` ${label}`}</span>
      </text>
      <text fg={palette.muted}>{`   ${relativeTime}  ·  ${messageLabel}  ·  ${branch}`}</text>
    </box>
  )
}

function RunPreview({ record }: { record: PersistedRunRecord }): ReactNode {
  const palette = usePalette()
  const focusedAgentId = persistedSelectedConversationId(record)
  const focused = focusedAgentId === null ? undefined : persistedResumeAgent(record, focusedAgentId)
  const summary = record.handoffBundle?.summary.trim() || focused?.lastPrompt.trim() || "No run summary."
  const agentCount = persistedConversationCount(record)
  const focusedLabel = focusedAgentId ?? "none"

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
      <text fg={palette.accent}>{PREVIEW_HEADING}</text>
      <text fg={palette.text}>{summary}</text>
      <text fg={palette.muted}>{`Focused: ${focusedLabel}  ·  ${agentCount} ${agentCount === 1 ? "agent" : "agents"}`}</text>
    </box>
  )
}
