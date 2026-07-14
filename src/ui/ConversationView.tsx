/**
 * The focused agent's transcript.
 *
 * ADR-004 asks the UI to subscribe narrowly, and this is the view that makes it
 * matter: a token arriving for the unfocused agent must not repaint anything here.
 * So the view reads the focused agent's id, then subscribes to that agent's `turns`
 * and restoration status plus the persisted bundle used only by a degraded pane.
 * The store shares structure across reductions, meaning those slices keep their
 * identity whenever unrelated state changes and `useSyncExternalStore` skips the
 * render. Switching focus swaps the selectors and the whole transcript with them.
 *
 * Within a render, each turn is keyed by its own stable identity - `messageId` for
 * messages, `toolCallId` for tool calls - so a streamed delta updates a message in
 * place instead of remounting the list below it. That, plus the store's per-frame
 * coalescing, is what keeps streaming flicker-free.
 */

import { useMemo, type ReactNode } from "react"

import type { SessionController } from "../app/controller.ts"
import type { BannerVariant } from "../config/appState.ts"
import type { HandoffBundle, SessionId, Turn } from "../core/types.ts"
import {
  selectFocusedSessionId,
  selectRestoration,
  selectRestorationBundle,
  selectSessionTurns,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { NEW_RUN_KEY_HINT } from "./keymap.ts"
import { MessageView } from "./MessageView.tsx"
import { TabWorkspace } from "./TabWorkspace.tsx"
import { usePalette } from "./theme.ts"
import { ToolCallRow } from "./ToolCallRow.tsx"
import { WelcomeBanner } from "./WelcomeBanner.tsx"

/** Shown while the focused agent's transcript is still empty. */
export const EMPTY_TRANSCRIPT_HINT = "No messages yet. Type a prompt to start the conversation."

/** Text contracts for the honest degraded-restore state. */
export const RESTORATION_LIVE_LABEL = "history restored"
export const RESTORATION_UNAVAILABLE_LABEL = "history unavailable"
export const RESTORATION_FRESH_LABEL = "Previous history was unavailable — started a fresh session"
export const RESTORATION_CONTEXT_LABEL = "Persisted hand-off context"
export const START_FRESH_LABEL = "start fresh from this context"

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
export function ConversationView({
  welcomeBannerVariant = "full",
  workspaceChrome = false,
}: {
  welcomeBannerVariant?: BannerVariant
  /** Render tab navigation above the focused conversation. */
  workspaceChrome?: boolean
}): ReactNode {
  const controller = useController()
  const focusedSessionId = useAppSelector(selectFocusedSessionId)

  // Curried selectors build a new function per call; memoize so the subscription
  // follows focus rather than tearing down and rebuilding on every render.
  const turnsSelector = useMemo(() => selectSessionTurns(focusedSessionId), [focusedSessionId])
  const restorationSelector = useMemo(
    () => selectRestoration(focusedSessionId),
    [focusedSessionId],
  )
  const turns = useAppSelector(turnsSelector)
  const restoration = useAppSelector(restorationSelector)
  const bundle = useAppSelector(selectRestorationBundle)
  if (focusedSessionId === null) return null
  const chrome = workspaceChrome ? <TabWorkspace /> : null

  let content: ReactNode
  if (restoration === "unavailable") {
    // A provider that cannot restore at all stays on the explicit degraded pane.
    // But when we successfully opened a replacement ACP session (for example a
    // stale Codex rollout), keep the cockpit usable and surface that truth as a
    // compact notice above the normal fresh-session view.
    if (controller.isReady(focusedSessionId) && bundle === null) {
      content = renderConversationContent(
        controller,
        focusedSessionId,
        turns,
        welcomeBannerVariant,
        <FreshRestorationBadge />,
      )
    } else {
      content = <UnavailableRestoration bundle={bundle} />
    }
  } else if (restoration === null) {
    content = renderConversationContent(controller, focusedSessionId, turns, welcomeBannerVariant, null)
  } else {
    content = renderConversationContent(
      controller,
      focusedSessionId,
      turns,
      welcomeBannerVariant,
      <LiveRestorationBadge />,
    )
  }

  if (chrome === null) return content
  return (
    <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "hidden" }}>
      {chrome}
      {content}
    </box>
  )
}

function renderConversationContent(
  controller: SessionController,
  focusedSessionId: SessionId,
  turns: Turn[],
  welcomeBannerVariant: BannerVariant,
  notice: ReactNode,
): ReactNode {
  if (turns.length === 0) {
    if (welcomeBannerVariant === "none") {
      return notice ? (
        <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>{notice}</box>
      ) : null
    }

    const focused = controller.runtime(focusedSessionId)
    const agents = controller.runtimes().map((runtime) => ({
      displayName: runtime.displayName,
      state: runtime.ready ? ("ready" as const) : ("unavailable" as const),
    }))

    return (
      <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
        {notice}
        <WelcomeBanner
          variant={welcomeBannerVariant}
          agents={agents}
          cwd={focused?.cwd ?? controller.runtimes()[0]?.cwd ?? ""}
        />
      </box>
    )
  }

  return (
    <scrollbox
      style={{ flexGrow: 1, flexShrink: 1 }}
      stickyScroll
      stickyStart="bottom"
      scrollX={false}
    horizontalScrollbarOptions={HIDDEN_SCROLLBAR}
  >
      {notice}
      {turns.map((turn, index) => (
        <TurnView key={keyFor(turn, index)} turn={turn} />
      ))}
    </scrollbox>
  )
}

function LiveRestorationBadge(): ReactNode {
  const palette = usePalette()
  return (
    <text style={{ flexShrink: 0 }} fg={palette.muted}>
      {RESTORATION_LIVE_LABEL}
    </text>
  )
}

/** A successful fresh fallback is informative, not a terminal pane error. */
function FreshRestorationBadge(): ReactNode {
  const palette = usePalette()
  return (
    <text style={{ flexShrink: 0 }} fg={palette.muted}>
      {RESTORATION_FRESH_LABEL}
    </text>
  )
}

function UnavailableRestoration({ bundle }: { bundle: HandoffBundle | null }): ReactNode {
  const palette = usePalette()
  return (
    <scrollbox
      style={{ flexGrow: 1, flexShrink: 1 }}
      scrollX={false}
      horizontalScrollbarOptions={HIDDEN_SCROLLBAR}
  >
      <text style={{ marginTop: 1 }} fg={palette.status.error}>
        {RESTORATION_UNAVAILABLE_LABEL}
      </text>
      {bundle ? (
        <>
          <text style={{ marginTop: 1 }} fg={palette.muted}>
            {RESTORATION_CONTEXT_LABEL}
          </text>
          <text fg={palette.text}>{bundle.summary}</text>
          <text style={{ marginTop: 1 }}>
            <span fg={palette.accent}>{NEW_RUN_KEY_HINT}</span>
            <span fg={palette.text}>{` ${START_FRESH_LABEL}`}</span>
          </text>
        </>
      ) : null}
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
