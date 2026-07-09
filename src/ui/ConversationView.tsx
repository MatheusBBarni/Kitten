/**
 * The focused agent's transcript.
 *
 * ADR-004 asks the UI to subscribe narrowly, and this is the view that makes it
 * matter: a token arriving for the unfocused agent must not repaint anything here.
 * So the view reads the focused agent's id, then subscribes to that agent's `turns`
 * array alone. The store shares structure across reductions, meaning `turns` keeps
 * its identity whenever an unrelated slice changes, and `useSyncExternalStore` skips
 * the render. Switching focus swaps the selector and the whole transcript with it.
 *
 * Within a render, each turn is keyed by its own stable identity - `messageId` for
 * messages, `toolCallId` for tool calls - so a streamed delta updates a message in
 * place instead of remounting the list below it. That, plus the store's per-frame
 * coalescing, is what keeps streaming flicker-free.
 */

import { useMemo, type ReactNode } from "react"

import type { Turn } from "../core/types.ts"
import { selectFocusedSessionId, selectSessionTurns } from "../store/selectors.ts"
import { useAppSelector } from "./cockpitContext.tsx"
import { MessageView } from "./MessageView.tsx"
import { ToolCallRow } from "./ToolCallRow.tsx"
import { usePalette } from "./theme.ts"

/** Shown while the focused agent's transcript is still empty. */
export const EMPTY_TRANSCRIPT_HINT = "No messages yet. Type a prompt to start the conversation."

/**
 * Hide the horizontal scrollbar outright rather than relying on `scrollX: false`.
 *
 * On @opentui/core 0.4.3 a scrollbox reserves the horizontal scrollbar's row even
 * when horizontal scrolling is off. That makes the content one row taller than it
 * draws, so `stickyStart: "bottom"` scrolls down by one and clips the first line of
 * the transcript whenever the conversation is shorter than the viewport - the newest
 * turn is fine, but the opening one silently disappears. Hiding the bar reclaims the
 * row and the sticky offset lands on zero.
 */
const HIDDEN_SCROLLBAR = { visible: false } as const

/** The scrollable transcript of whichever agent currently has focus. */
export function ConversationView(): ReactNode {
  const palette = usePalette()
  const focusedSessionId = useAppSelector(selectFocusedSessionId)

  // Curried selectors build a new function per call; memoize so the subscription
  // follows focus rather than tearing down and rebuilding on every render.
  const turnsSelector = useMemo(() => selectSessionTurns(focusedSessionId), [focusedSessionId])
  const turns = useAppSelector(turnsSelector)

  if (turns.length === 0) {
    return <text fg={palette.muted}>{EMPTY_TRANSCRIPT_HINT}</text>
  }

  return (
    <scrollbox
      style={{ flexGrow: 1, flexShrink: 1 }}
      stickyScroll
      stickyStart="bottom"
      scrollX={false}
      horizontalScrollbarOptions={HIDDEN_SCROLLBAR}
    >
      {turns.map((turn, index) => (
        <TurnView key={keyFor(turn, index)} turn={turn} />
      ))}
    </scrollbox>
  )
}

/** Dispatch one transcript entry to the view that knows how to draw it. */
function TurnView({ turn }: { turn: Turn }): ReactNode {
  switch (turn.kind) {
    case "user":
      return <MessageView role="user" text={turn.text} />
    case "agent":
      return <MessageView role="agent" text={turn.text} />
    case "tool_call":
      return <ToolCallRow record={turn.record} />
  }
}

/**
 * A turn's React key.
 *
 * `messageId` and `toolCallId` are the identities the reducer upserts by, so they
 * keep a turn's component mounted across updates. ACP allows an absent `messageId`
 * (the adapter substitutes `""`), which would collide across turns, so the index
 * disambiguates. Turns are only ever appended or updated in place, never reordered,
 * which makes the index stable for exactly the entries that need it.
 */
function keyFor(turn: Turn, index: number): string {
  const id = turn.kind === "tool_call" ? turn.record.toolCallId : turn.messageId
  return `${turn.kind}:${id}:${index}`
}
