/**
 * The `/sessions` overview: the fleet at a glance, and one key to the session
 * that needs you.
 *
 * The overview is deliberately thin (ADR-001): it is a router, not a fleet manager.
 * It lists every session with its title, provider, working directory, and state, marks
 * the ones the developer must act on, and does exactly two things with a keypress -
 * jump focus into the highlighted session, or skip straight to the next one that needs
 * attention (`selectNextNeedy`, ADR-006). It spawns nothing, kills nothing, configures
 * nothing.
 *
 * It is modeled on the approval and hand-off overlays, and shares their three
 * load-bearing properties:
 *
 * - **It is modal.** Every keypress is consumed while it is open, so plain arrows, a
 *   bare `n`, and Enter never reach the composer beneath it. Modality takes two halves:
 *   `preventDefault` here stops the focused textarea, and the shell stands its own
 *   chords down while the slot is open (`selectHasOpenOverlay`), because global key
 *   listeners fire in mount order and the shell mounts first.
 * - **It owns no textarea**, so unlike the hand-off preview it never takes the
 *   terminal's single focused renderable from the composer - closing it simply lets the
 *   composer re-focus, restoring the cursor with no extra wiring.
 * - **It draws itself from the store.** The card list is `selectSessionList`, so it can
 *   never disagree with the status strip about what a session is doing.
 *
 * It renders as a conditional, absolutely-positioned box: the React binding ships no
 * Portal (ADR-004).
 */

import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { PROVIDER_DISPLAY_NAMES } from "../core/types.ts"
import {
  selectIsApprovalOpen,
  selectIsSessionsOpen,
  selectSessionList,
  type SessionListItem,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { matchSessionsCommand, SESSIONS_HINT } from "./keymap.ts"
import { STATUS_LABELS } from "./StatusStrip.tsx"
import { usePalette } from "./theme.ts"

/** The overlay's frame title. */
export const SESSIONS_TITLE = "Sessions"

/** The marker on the highlighted card. Matches the approval and hand-off overlays. */
export const SESSION_MARKER = "▸"

/** The badge a needs-you card carries, so it reads even without color. */
export const NEEDS_YOU_LABEL = "needs you"

/** Lifecycle labels stay visible without relying on the row's palette. */
export const VISIBLE_LABEL = "Visible"
export const BACKGROUND_LABEL = "Background"

/** The workspace-selected conversation gets a textual cue as well as the marker. */
export const SELECTED_LABEL = "selected"

/** Stable hook for the keyboard-following conversation list. */
export const SESSIONS_SCROLLBOX_ID = "sessions-overlay-list"

/** What the overview says when, impossibly, it has no session to list. Never blank. */
export const NO_SESSIONS = "No sessions."

/** Give each conversation a stable descendant id for scroll-to-selection behavior. */
export function sessionRowId(sessionId: string): string {
  return `sessions-overlay-row-${sessionId}`
}

/** OpenTUI otherwise reserves a row for a horizontal scrollbar. */
const HIDDEN_HORIZONTAL_SCROLLBAR = { visible: false } as const

/**
 * The overview, or nothing at all. The cockpit mounts it unconditionally and this
 * component decides, so its keyboard listener exists only while it is allowed to
 * swallow keys.
 */
export function SessionsOverlay(): ReactNode {
  const open = useAppSelector(selectIsSessionsOpen)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  // Approval is the top-most modal. Returning here unmounts this earlier listener
  // before it can consume Enter or arrows intended for the permission prompt.
  if (!open || approvalOpen) return null
  return <SessionsDialog />
}

/** The dialog proper. Mounted only while the overview is open. */
function SessionsDialog(): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const sessions = useAppSelector(selectSessionList)

  const [selected, setSelected] = useState(0)
  const sessionList = useRef<ScrollBoxRenderable | null>(null)

  // The highlight is clamped to the list on every move, so it survives a session's
  // status changing beneath it without ever pointing off the end.
  const clamped = Math.min(selected, Math.max(sessions.length - 1, 0))

  useEffect(() => {
    const target = sessions[clamped]
    if (target) sessionList.current?.scrollChildIntoView(sessionRowId(target.id))
  }, [clamped, sessions])

  const jumpInto = useCallback((): void => {
    const target = sessions[clamped]
    controller.store.closeSessions()
    if (!target) return
    // The universal fallback can reopen background work as well as select a visible tab.
    if (target.lifecycle === "background") {
      controller.actions.reopenConversation(target.id, { viaOverview: true })
    } else {
      controller.actions.selectConversation(target.id, { viaOverview: true })
    }
  }, [clamped, controller, sessions])

  const jumpNextNeedy = useCallback((): void => {
    controller.store.closeSessions()
    controller.actions.jumpToNextAttention()
  }, [controller])

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // Modal: no key reaches the focused textarea while the overview is open, whether
      // or not this dialog claims it. The shell stands its own chords down separately.
      key.preventDefault()

      switch (matchSessionsCommand(key)) {
        case "prev-session":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "next-session":
          // `Math.max(..., 0)` guards the empty-list case: `length - 1` would otherwise
          // walk the highlight to -1.
          setSelected((index) => Math.min(index + 1, Math.max(sessions.length - 1, 0)))
          return
        case "jump-into":
          jumpInto()
          return
        case "jump-next-needy":
          jumpNextNeedy()
          return
        case "cancel":
          controller.store.closeSessions()
          return
        default:
          return
      }
    },
    [controller, jumpInto, jumpNextNeedy, sessions.length],
  )
  useKeyboard(onKey)

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // A definite viewport lets the scrollbox keep both the selected row and the
        // footer reachable instead of clipping a long fleet below the terminal.
        height: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={SESSIONS_TITLE}
      titleColor={palette.accent}
    >
      <scrollbox
        id={SESSIONS_SCROLLBOX_ID}
        ref={sessionList}
        style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}
        scrollX={false}
        horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}
      >
        {sessions.length === 0 ? (
          <text fg={palette.muted}>{NO_SESSIONS}</text>
        ) : (
          sessions.map((session, index) => (
            <SessionCard
              key={session.id}
              rowId={sessionRowId(session.id)}
              session={session}
              highlighted={index === clamped}
            />
          ))
        )}
      </scrollbox>

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted} wrapMode="word">
        {SESSIONS_HINT}
      </text>
    </box>
  )
}

/**
 * One session's card: the highlight marker, its title and provider, then its working
 * directory and state on the line below. A needs-you session is called out in the
 * state's own color and carries a `needs you` badge so it reads without color too.
 *
 * Exported so the hand-off target picker (task_06) draws its candidate rows the same
 * way, and the two lists can never disagree about how a session reads.
 */
export function SessionCard({
  session,
  highlighted,
  rowId,
}: {
  session: SessionListItem
  highlighted: boolean
  rowId?: string
}): ReactNode {
  const palette = usePalette()
  const statusColor = palette.status[session.status]
  const lifecycleLabel = session.lifecycle === "background" ? BACKGROUND_LABEL : VISIBLE_LABEL

  return (
    <box id={rowId} style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
      <text>
        <span fg={highlighted ? palette.accent : palette.muted}>{highlighted ? SESSION_MARKER : " "}</span>
        <span fg={highlighted ? palette.text : palette.muted}>{` ${session.label}`}</span>
      </text>
      <text>
        <span fg={palette.muted}>{`   ${lifecycleLabel}`}</span>
        {session.selected ? <span fg={palette.accent}>{`  ${SELECTED_LABEL}`}</span> : null}
        <span fg={palette.muted}>{"  "}</span>
        <span fg={statusColor}>{STATUS_LABELS[session.status]}</span>
        {session.needsAttention && !session.attentionSeen ? (
          <span fg={statusColor}>{`  ${NEEDS_YOU_LABEL}`}</span>
        ) : null}
      </text>
      <text fg={palette.muted}>
        {`   ${PROVIDER_DISPLAY_NAMES[session.providerKind]}  ·  ${session.cwd}`}
      </text>
    </box>
  )
}
