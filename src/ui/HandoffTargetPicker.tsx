/**
 * The hand-off target picker: choosing who receives the bundle across a fleet (task_06).
 *
 * Kitten's hand-off carries the focused session's work to *another* session. With only
 * one other session that could receive it, "the other agent" is unambiguous and the
 * flow opens the redacted preview straight away - the two-agent hand-off stays one
 * keystroke. With more than one possible recipient it is not, so `HandoffFlow.begin`
 * opens this picker first and the developer chooses; only then does the preview open
 * over the bundle assembled for that target.
 *
 * It is deliberately thin, and modeled on the `/sessions` overview it reuses
 * (`SessionCard`, `matchSessionsCommand`): a selectable list of the sessions that could
 * receive the hand-off - every ready session other than the source - with Enter to
 * choose and Escape to back out. It spawns nothing, sends nothing, and moves no focus;
 * choosing a target only trades this overlay for the preview, where nothing reaches an
 * agent until the developer confirms.
 *
 * It shares the overlays' three load-bearing properties:
 *
 * - **It is modal.** Every keypress is consumed while it is open, so plain arrows and
 *   Enter never reach the composer beneath it. Modality takes two halves: `preventDefault`
 *   here stops the focused textarea, and the shell stands its own chords down while any
 *   overlay is open (`selectHasOpenOverlay`, which now counts this slot).
 * - **It stands down for a permission request.** An approval blocks an agent mid-turn,
 *   so if one arrives while the picker is up, the picker hands the keyboard over whole,
 *   exactly as the hand-off preview does.
 * - **It draws itself from the store.** The candidate rows are `selectSessionList`
 *   filtered to the ready sessions other than the source, so it can never disagree with
 *   the overview or the status strip about what a session is doing.
 *
 * It renders as a conditional, absolutely-positioned box: the React binding ships no
 * Portal (ADR-004).
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useState, type ReactNode } from "react"

import type { HandoffFlow } from "../app/handoff.ts"
import type { HandoffTargetOverlay } from "../store/appStore.ts"
import { selectHandoffTarget, selectIsApprovalOpen, selectSessionList, type SessionListItem } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { HANDOFF_TARGET_HINT, matchSessionsCommand } from "./keymap.ts"
import { SessionCard } from "./SessionsOverlay.tsx"
import { usePalette } from "./theme.ts"

/** The overlay's frame title. The direction leads, as it does on the preview. */
export const HANDOFF_TARGET_TITLE = "Hand off - choose a target"

/** What the picker says when, impossibly, no session can receive the bundle. Never blank. */
export const NO_TARGETS = "No session can receive this hand-off."

/**
 * The picker, or nothing at all. The cockpit mounts it unconditionally and this
 * component decides, so its keyboard listener exists only while the picker is open.
 */
export function HandoffTargetPicker({ flow }: { flow: HandoffFlow }): ReactNode {
  const overlay = useAppSelector(selectHandoffTarget)
  if (!overlay) return null
  return <TargetDialog overlay={overlay} flow={flow} />
}

/** The dialog proper. Mounted only while the developer is choosing a recipient. */
function TargetDialog({ overlay, flow }: { overlay: HandoffTargetOverlay; flow: HandoffFlow }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const sessions = useAppSelector(selectSessionList)

  // The candidates are every ready session other than the source, in display order -
  // exactly the sessions `HandoffFlow.begin`/`chooseTarget` would accept as a target.
  const candidates: SessionListItem[] = sessions.filter(
    (session) => session.id !== overlay.sourceSessionId && controller.isReady(session.id),
  )

  const [selected, setSelected] = useState(0)
  // Clamp on every move so the highlight survives a candidate's status changing beneath
  // it without ever pointing off the end of the list.
  const clamped = Math.min(selected, Math.max(candidates.length - 1, 0))

  const choose = useCallback((): void => {
    const target = candidates[clamped]
    if (target) flow.chooseTarget(target.id)
  }, [candidates, clamped, flow])

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // A permission request blocks an agent mid-turn. It outranks a picker that is
      // waiting on nothing but the developer, so hand it the keyboard whole.
      if (approvalOpen) return

      // Modal: no key reaches the focused textarea while the picker is open, whether or
      // not this dialog claims it. The shell stands its own chords down separately.
      key.preventDefault()

      switch (matchSessionsCommand(key)) {
        case "prev-session":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "next-session":
          // `Math.max(..., 0)` guards the empty-list case: `length - 1` would otherwise
          // walk the highlight to -1.
          setSelected((index) => Math.min(index + 1, Math.max(candidates.length - 1, 0)))
          return
        case "jump-into":
          choose()
          return
        case "cancel":
          flow.cancel()
          return
        default:
          // `jump-next-needy` (n) and anything else are swallowed but do nothing here.
          return
      }
    },
    [approvalOpen, candidates.length, choose, flow],
  )
  useKeyboard(onKey)

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // Bound the dialog to the viewport so a long fleet has something to shrink
        // against rather than growing off the bottom and taking the hint with it.
        maxHeight: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={HANDOFF_TARGET_TITLE}
      titleColor={palette.accent}
    >
      <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden" }}>
        {candidates.length === 0 ? (
          <text fg={palette.muted}>{NO_TARGETS}</text>
        ) : (
          candidates.map((session, index) => (
            <SessionCard key={session.id} session={session} highlighted={index === clamped} />
          ))
        )}
      </box>

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted}>
        {HANDOFF_TARGET_HINT}
      </text>
    </box>
  )
}
