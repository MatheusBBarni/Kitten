/**
 * The Ctrl+S sessions overview: the fleet at a glance, and one key to the session
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

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useState, type ReactNode } from "react"

import { PROVIDER_DISPLAY_NAMES } from "../core/types.ts"
import { selectIsSessionsOpen, selectSessionList, type SessionListItem } from "../store/selectors.ts"
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

/** What the overview says when, impossibly, it has no session to list. Never blank. */
export const NO_SESSIONS = "No sessions."

/**
 * The overview, or nothing at all. The cockpit mounts it unconditionally and this
 * component decides, so its keyboard listener exists only while it is allowed to
 * swallow keys.
 */
export function SessionsOverlay(): ReactNode {
  const open = useAppSelector(selectIsSessionsOpen)
  if (!open) return null
  return <SessionsDialog />
}

/** The dialog proper. Mounted only while the overview is open. */
function SessionsDialog(): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const sessions = useAppSelector(selectSessionList)

  const [selected, setSelected] = useState(0)

  // The highlight is clamped to the list on every move, so it survives a session's
  // status changing beneath it without ever pointing off the end.
  const clamped = Math.min(selected, Math.max(sessions.length - 1, 0))

  const jumpInto = useCallback((): void => {
    const target = sessions[clamped]
    controller.store.closeSessions()
    if (target) controller.actions.switchFocus(target.id)
  }, [clamped, controller, sessions])

  const jumpNextNeedy = useCallback((): void => {
    controller.store.closeSessions()
    controller.actions.jumpToNextNeedy()
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
      title={SESSIONS_TITLE}
      titleColor={palette.accent}
    >
      <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden" }}>
        {sessions.length === 0 ? (
          <text fg={palette.muted}>{NO_SESSIONS}</text>
        ) : (
          sessions.map((session, index) => (
            <SessionCard key={session.id} session={session} highlighted={index === clamped} />
          ))
        )}
      </box>

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted}>
        {SESSIONS_HINT}
      </text>
    </box>
  )
}

/**
 * One session's card: the highlight marker, its title and provider, then its working
 * directory and state on the line below. A needs-you session is called out in the
 * state's own color and carries a `needs you` badge so it reads without color too.
 */
function SessionCard({ session, highlighted }: { session: SessionListItem; highlighted: boolean }): ReactNode {
  const palette = usePalette()
  const statusColor = palette.status[session.status]

  return (
    <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
      <text>
        <span fg={highlighted ? palette.accent : palette.muted}>{highlighted ? SESSION_MARKER : " "}</span>
        <span fg={highlighted ? palette.text : palette.muted}>{` ${session.title}`}</span>
        <span fg={palette.muted}>{`  (${PROVIDER_DISPLAY_NAMES[session.providerKind]})`}</span>
      </text>
      <text>
        <span fg={palette.muted}>{`   ${session.cwd}  `}</span>
        <span fg={statusColor}>{STATUS_LABELS[session.status]}</span>
        {session.needsAttention ? <span fg={statusColor}>{`  ${NEEDS_YOU_LABEL}`}</span> : null}
      </text>
    </box>
  )
}
