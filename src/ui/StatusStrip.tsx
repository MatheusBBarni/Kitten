/**
 * The persistent status strip: both agents' state, at a glance, always on screen.
 *
 * Two sources feed it, and they answer different questions. `controller.runtimes()`
 * answers "did this agent ever come up?" - a boot-time fact that never changes for
 * the life of the run. The store's `selectAgentStatus` answers "what is it doing
 * right now?" - a fact that changes on every turn. A not-ready agent has no session
 * and therefore no meaningful status, so not-ready wins the display.
 *
 * Each chip subscribes only to its own agent's status and focus flag (ADR-004), so
 * a token streaming into one agent's transcript never re-renders the other's chip.
 */

import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import { selectAgentStatus, selectIsFocused } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { KEYMAP_HINT } from "./keymap.ts"
import { usePalette, type StatusTone } from "./theme.ts"

/** How each state is written in the strip. The words the acceptance tests look for. */
export const STATUS_LABELS: Readonly<Record<StatusTone, string>> = {
  idle: "idle",
  working: "working",
  awaiting_approval: "awaiting approval",
  not_ready: "not ready",
}

/** The focused agent's marker. The unfocused one gets a blank of the same width. */
export const FOCUS_MARKER = "▸"

/** The strip: one chip per agent, then the keymap hint pushed to the right edge. */
export function StatusStrip(): ReactNode {
  const controller = useController()
  const palette = usePalette()

  return (
    <box
      style={{
        flexDirection: "row",
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: palette.surface,
        overflow: "hidden",
      }}
    >
      {/* The chips are the point of the strip; the hint yields its width first. */}
      <box style={{ flexDirection: "row", flexShrink: 0, gap: 2 }}>
        {controller.runtimes().map((runtime) => (
          <AgentStatusChip key={runtime.agentId} runtime={runtime} />
        ))}
      </box>
      <box style={{ flexGrow: 1 }} />
      <text style={{ flexShrink: 1 }} fg={palette.muted}>
        {KEYMAP_HINT}
      </text>
    </box>
  )
}

/** Props for {@link AgentStatusChip}. */
export interface AgentStatusChipProps {
  runtime: AgentRuntimeState
}

/** One agent: focus marker, display name, and the state it is in. */
export function AgentStatusChip({ runtime }: AgentStatusChipProps): ReactNode {
  const palette = usePalette()
  const { agentId } = runtime

  // Curried selectors build a new function per call; memoize so the subscription
  // survives re-renders instead of tearing down and rebuilding on each one.
  const statusSelector = useMemo(() => selectAgentStatus(agentId), [agentId])
  const focusSelector = useMemo(() => selectIsFocused(agentId), [agentId])
  const status = useAppSelector(statusSelector)
  const focused = useAppSelector(focusSelector)

  const tone: StatusTone = runtime.ready ? status : "not_ready"

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={focused ? palette.accent : palette.muted}>{focused ? FOCUS_MARKER : " "}</span>
      <span fg={focused ? palette.text : palette.muted}>{` ${runtime.displayName}: `}</span>
      <span fg={palette.status[tone]}>{STATUS_LABELS[tone]}</span>
    </text>
  )
}
