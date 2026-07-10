/**
 * The model / reasoning-effort selector: a single combined overlay for the setting
 * that decides which model, at which cost, is answering in the focused pane.
 *
 * It is driven entirely by agent-confirmed state (ADR-004). The overlay reads the
 * focused session's advertised config options, filters them to the model and effort
 * allowlist (`visibleConfigOptions`, so a `mode`/`bypassPermissions` toggle can never
 * surface here), and renders the `currentValue` the agent reports - never the value
 * the developer optimistically asked for. When a switch is requested but the agent has
 * not (yet) confirmed it, the section is marked `unverified` and keeps showing the last
 * confirmed value, so the cockpit can never misreport which model is live. That honesty
 * is what the hand-off's fidelity promise leans on.
 *
 * Two behaviors follow the other overlays' modal pattern (`ApprovalPrompt`,
 * `HandoffPreview`):
 *
 * - **It swallows every key** while it is open, so the composer beneath never sees them.
 *   As elsewhere that takes two halves: the shell stands its own chords down while an
 *   overlay is open (`selectHasOpenOverlay`), and `preventDefault` here stops the
 *   focused textarea.
 * - **The approval overlay outranks it.** A permission request blocks an agent mid-turn,
 *   so if one arrives while the selector is up the selector stands down exactly as the
 *   shell does for it.
 *
 * Applying a change inside an established conversation is gated: the same agent has
 * already been reasoning for this session, and switching mid-conversation can degrade
 * quality, so the overlay swaps into an inline confirm step warning the developer before
 * it applies. A fresh session - one with no turns yet - has nothing to lose, so the
 * confirm is skipped and the switch applies straight away.
 *
 * It renders as a conditional, absolutely-positioned box: the React binding ships no
 * Portal (ADR-004).
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useState, type ReactNode } from "react"

import {
  EFFORT_CATEGORY,
  MODEL_CATEGORY,
  visibleConfigOptions,
  type ConfigOption,
} from "../core/types.ts"
import type { ModelSelectOverlay } from "../store/appStore.ts"
import { selectAgentConfigOptions, selectIsApprovalOpen, selectModelSelectOverlay, selectSessionTurns } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { matchModelSelectCommand, MODEL_SELECT_CONFIRM_HINT, MODEL_SELECT_HINT } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** The overlay's frame title. The focused session's own name follows it. */
export const MODEL_SELECT_TITLE = "Model & reasoning effort"

/** Section headings, in the order the developer reads them. */
export const MODEL_HEADING = "Model"
export const EFFORT_HEADING = "Reasoning effort"

/** The marker on the highlighted row. Matches the approval and hand-off overlays. */
export const ROW_MARKER = "▸"

/** How the confirmed current value is set apart from the alternatives. */
export const CURRENT_MARK = "●"
export const OTHER_MARK = "○"
/** A value chosen for the target of a pending hand-off, not yet applied. */
export const TARGET_MARK = "→"

/** The tag a section carries when a requested switch has not been confirmed (ADR-004). */
export const UNVERIFIED_LABEL = "unverified"

/** Shown when the focused agent advertises no model or effort options at all. Never blank. */
export const NO_OPTIONS_NOTICE = "This agent advertises no model or reasoning-effort options."

/** The warning shown before a mid-conversation switch is applied. */
export const MID_SWITCH_WARNING =
  "This session was optimized for the current model and reasoning effort. Switching mid-conversation may reduce quality."

/** How the overlay titles itself for one session: the phrase the tests and the user read. */
export function modelSelectTitleFor(displayName: string): string {
  return `${MODEL_SELECT_TITLE} - ${displayName}`
}

/**
 * The selector, or nothing at all. The cockpit mounts it unconditionally and this
 * component decides, so its keyboard listener exists only while it is allowed to
 * swallow keys.
 */
export function ModelSelect(): ReactNode {
  const overlay = useAppSelector(selectModelSelectOverlay)
  if (!overlay) return null
  return <ModelSelectDialog overlay={overlay} />
}

/** One choosable row: which config option it belongs to and the value it names. */
export interface ModelEffortValueRow {
  option: ConfigOption
  value: string
  name: string
}

/**
 * Flatten the visible model/effort sections into the keyboard order both controls use.
 *
 * The hand-off preview deliberately uses this same row order as the live selector so
 * model and effort mean the same thing in either place. The caller supplies only
 * allowlisted options, but this function stays defensive and ignores everything else.
 */
export function modelEffortValueRows(options: ConfigOption[]): ModelEffortValueRow[] {
  const modelOption = options.find((option) => option.category === MODEL_CATEGORY)
  const effortOption = options.find((option) => option.category === EFFORT_CATEGORY)
  const rows: ModelEffortValueRow[] = []
  if (modelOption) for (const value of modelOption.options) rows.push({ option: modelOption, value: value.value, name: value.name })
  if (effortOption && effortOption.options.length > 0) {
    for (const value of effortOption.options) rows.push({ option: effortOption, value: value.value, name: value.name })
  }
  return rows
}

/** The dialog proper. Mounted only while the selector slot names a session. */
function ModelSelectDialog({ overlay }: { overlay: ModelSelectOverlay }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const { sessionId } = overlay
  const approvalOpen = useAppSelector(selectIsApprovalOpen)

  // The raw slice is referentially stable across unrelated updates; filter to the
  // allowlist here and memoize so a fresh array does not thrash the render.
  const rawOptions = useAppSelector(useMemo(() => selectAgentConfigOptions(sessionId), [sessionId]))
  const options = useMemo(() => visibleConfigOptions(rawOptions), [rawOptions])

  // The confirmed conversation length. A session with any turn is "established", so a
  // mid-conversation switch is gated behind the warning; a fresh one applies straight.
  const turns = useAppSelector(useMemo(() => selectSessionTurns(sessionId), [sessionId]))
  const established = turns.length > 0

  const rows = useMemo(() => modelEffortValueRows(options), [options])

  const [selected, setSelected] = useState(0)
  // What the developer last asked each config option to become. A section is
  // `unverified` while its requested value differs from the confirmed `currentValue`.
  const [requested, setRequested] = useState<ReadonlyMap<string, string>>(() => new Map())
  // The pending mid-conversation confirm, or null when the list is showing.
  const [confirming, setConfirming] = useState<ModelEffortValueRow | null>(null)

  const clamped = Math.min(selected, Math.max(rows.length - 1, 0))

  const apply = useCallback(
    (row: ModelEffortValueRow): void => {
      setRequested((prev) => new Map(prev).set(row.option.id, row.value))
      // The action never rejects (it routes a failed switch to `onError` and leaves the
      // last confirmed state in place), so a keypress can never reject into the tree.
      void controller.actions.setSessionConfigOption(row.option.id, row.value, sessionId)
    },
    [controller, sessionId],
  )

  const choose = useCallback(
    (row: ModelEffortValueRow | undefined): void => {
      // Choosing the value that is already live is a no-op: nothing to switch, and no
      // reason to raise the mid-conversation warning.
      if (!row || row.value === row.option.currentValue) return
      if (established) {
        setConfirming(row)
        return
      }
      apply(row)
    },
    [apply, established],
  )

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // A permission request blocks an agent mid-turn. It outranks a selector that is
      // waiting on nothing but the developer, so hand it the keyboard whole.
      if (approvalOpen) return

      // Modal: no key reaches the composer while the selector is open, whether or not
      // this dialog claims it. The shell stands its own chords down separately.
      key.preventDefault()

      if (confirming) {
        // The confirm step reuses Enter/Escape: proceed with the switch, or back out of
        // it and return to the list without applying anything.
        switch (matchModelSelectCommand(key)) {
          case "confirm":
            apply(confirming)
            setConfirming(null)
            return
          case "cancel":
            setConfirming(null)
            return
          default:
            return
        }
      }

      switch (matchModelSelectCommand(key)) {
        case "prev-option":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "next-option":
          // `Math.max(..., 0)` guards the empty-list case: `length - 1` would otherwise
          // walk the highlight to -1.
          setSelected((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)))
          return
        case "confirm":
          choose(rows[clamped])
          return
        case "cancel":
          controller.store.closeModelSelect()
          return
        default:
          return
      }
    },
    [approvalOpen, apply, choose, clamped, confirming, controller, rows],
  )
  useKeyboard(onKey)

  const displayName = controller.runtime(sessionId)?.displayName ?? sessionId
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
      title={modelSelectTitleFor(displayName)}
      titleColor={palette.accent}
    >
      {confirming ? (
        <ConfirmStep row={confirming} />
      ) : (
        <ModelEffortControl options={options} highlighted={clamped} requested={requested} />
      )}

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted}>
        {confirming ? MODEL_SELECT_CONFIRM_HINT : MODEL_SELECT_HINT}
      </text>
    </box>
  )
}

/**
 * The shared, confirmed-state model/effort control used by the live selector and the
 * hand-off preview. The latter may mark a locally selected outgoing value, but it
 * never changes the target session until the developer confirms the hand-off.
 */
export function ModelEffortControl({
  options,
  highlighted,
  requested,
  outgoing,
  emptyNotice = NO_OPTIONS_NOTICE,
}: {
  options: ConfigOption[]
  highlighted: number
  requested?: ReadonlyMap<string, string>
  outgoing?: ReadonlyMap<string, string>
  emptyNotice?: string
}): ReactNode {
  const palette = usePalette()
  const modelOption = options.find((option) => option.category === MODEL_CATEGORY)
  const effortOption = options.find((option) => option.category === EFFORT_CATEGORY)
  const showEffort = effortOption !== undefined && effortOption.options.length > 0
  const rows = modelEffortValueRows(options)

  if (rows.length === 0) {
    return (
      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {emptyNotice}
      </text>
    )
  }

  return (
    <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden" }}>
      {modelOption ? (
        <Section
          heading={MODEL_HEADING}
          option={modelOption}
          unverified={requested !== undefined && isUnverified(requested, modelOption)}
          outgoing={outgoing?.get(modelOption.id)}
          offset={0}
          highlighted={highlighted}
          first
        />
      ) : null}
      {showEffort && effortOption ? (
        <Section
          heading={EFFORT_HEADING}
          option={effortOption}
          unverified={requested !== undefined && isUnverified(requested, effortOption)}
          outgoing={outgoing?.get(effortOption.id)}
          offset={modelOption ? modelOption.options.length : 0}
          highlighted={highlighted}
          first={!modelOption}
        />
      ) : null}
    </box>
  )
}

/** Whether a section's option has an outstanding switch the agent has not confirmed. */
function isUnverified(requested: ReadonlyMap<string, string>, option: ConfigOption): boolean {
  const value = requested.get(option.id)
  return value !== undefined && value !== option.currentValue
}

/** One config option's section: its heading (with the unverified tag) and its values. */
function Section({
  heading,
  option,
  unverified,
  outgoing,
  offset,
  highlighted,
  first,
}: {
  heading: string
  option: ConfigOption
  unverified: boolean
  outgoing: string | undefined
  offset: number
  highlighted: number
  first: boolean
}): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      <text style={{ flexShrink: 0, marginTop: first ? 0 : 1 }}>
        <span fg={palette.accent}>{heading}</span>
        {unverified ? <span fg={palette.status.awaiting_approval}>{`  (${UNVERIFIED_LABEL})`}</span> : null}
      </text>
      {option.options.map((value, index) => (
        <ValueRowView
          key={value.value}
          name={value.name}
          current={value.value === option.currentValue}
          outgoing={value.value === outgoing}
          highlighted={highlighted === offset + index}
        />
      ))}
    </box>
  )
}

/** One value: the highlight marker, the current/other marker, and the value's name. */
function ValueRowView({
  name,
  current,
  outgoing,
  highlighted,
}: {
  name: string
  current: boolean
  outgoing: boolean
  highlighted: boolean
}): ReactNode {
  const palette = usePalette()
  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={palette.accent}>{highlighted ? ROW_MARKER : " "}</span>
      <span fg={current ? palette.tool.completed : outgoing ? palette.accent : palette.muted}>{` ${current ? CURRENT_MARK : outgoing ? TARGET_MARK : OTHER_MARK} `}</span>
      <span fg={current || outgoing || highlighted ? palette.text : palette.muted}>{name}</span>
    </text>
  )
}

/** The inline mid-conversation confirm step: the warning, what is about to change, the hint. */
function ConfirmStep({ row }: { row: ModelEffortValueRow }): ReactNode {
  const palette = usePalette()
  const label = row.option.category === EFFORT_CATEGORY ? EFFORT_HEADING : MODEL_HEADING
  return (
    <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden" }}>
      <text style={{ flexShrink: 0 }} fg={palette.status.awaiting_approval}>
        {MID_SWITCH_WARNING}
      </text>
      <text style={{ flexShrink: 0, marginTop: 1 }}>
        <span fg={palette.muted}>{`Switch ${label.toLowerCase()} to `}</span>
        <span fg={palette.text}>{row.name}</span>
        <span fg={palette.muted}>?</span>
      </text>
    </box>
  )
}
