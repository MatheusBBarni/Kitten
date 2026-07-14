/** A fixed, transcript-local signal for work still streaming from the selected provider. */

import { useEffect, useMemo, useState, type ReactNode } from "react"

import {
  selectFocusedSessionId,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector } from "./cockpitContext.tsx"
import { usePalette } from "./theme.ts"

/** Text remains explicit when the terminal cannot distinguish the spinner color. */
export const WORKING_ACTIVITY_LABEL = "working"

/** Braille frames stay compact at the bottom of the transcript. */
export const WORKING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

const SPINNER_INTERVAL_MS = 120

/** Reserve one stable transcript row; only a live turn paints activity into it. */
export function ConversationActivity(): ReactNode {
  const palette = usePalette()
  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const statusSelector = useMemo(() => selectSessionStatus(focusedSessionId), [focusedSessionId])
  const status = useAppSelector(statusSelector)
  const [frame, setFrame] = useState(0)
  const working = status === "working"

  useEffect(() => {
    if (!working) {
      setFrame(0)
      return
    }
    const interval = setInterval(() => {
      setFrame((current) => (current + 1) % WORKING_SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [working])

  return (
    <box style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
      {working ? (
        <text>
          <span fg={palette.status.working}>{WORKING_SPINNER_FRAMES[frame]}</span>
          <span fg={palette.status.working}>{` ${WORKING_ACTIVITY_LABEL}`}</span>
        </text>
      ) : null}
    </box>
  )
}
