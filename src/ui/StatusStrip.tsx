/**
 * The persistent status strip: both agents' state, at a glance, always on screen.
 *
 * Two sources feed it, and they answer different questions. `controller.runtimes()`
 * answers "did this agent ever come up?" - a boot-time fact that never changes for
 * the life of the run. The store's `selectSessionStatus` answers "what is it doing
 * right now?" - a fact that changes on every turn. A not-ready agent has no session
 * and therefore no meaningful status, so not-ready wins the display.
 *
 * Each chip subscribes only to its own agent's status, focus flag, model, and effort
 * (ADR-004), so a token streaming into one agent's transcript never re-renders the
 * other's chip.
 */

import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import { selectAgentEffort, selectAgentModel, selectIsFocused, selectSessionStatus } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { KEYMAP_HINT } from "./keymap.ts"
import { usePalette, type StatusTone } from "./theme.ts"

/** How each state is written in the strip. The words the acceptance tests look for. */
export const STATUS_LABELS: Readonly<Record<StatusTone, string>> = {
  idle: "idle",
  working: "working",
  awaiting_approval: "awaiting approval",
  finished: "finished",
  error: "error",
  not_ready: "not ready",
}

/** The focused agent's marker. The unfocused one gets a blank of the same width. */
export const FOCUS_MARKER = "▸"

/** The strip: one chip per agent, then the keymap hint pushed to the right edge when room allows. */
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
      <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, flexWrap: "wrap", gap: 2 }}>
        {controller.runtimes().map((runtime) => (
          <AgentStatusChip key={runtime.sessionId} runtime={runtime} />
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

/**
 * One agent: focus marker, session title, and the state it is in.
 *
 * The chip is labeled by the session's own `title`, not the provider display name:
 * two sessions of the same provider share a display name and would otherwise read
 * identically here (ADR-004). A session's title defaults to its working directory's
 * basename, so a same-provider fleet reads as distinct directories at a glance; the
 * full working directory - the absolute disambiguator - lives in the Ctrl+S overview
 * and on every approval prompt (task_07), which is where a decision actually lands.
 * The strip keeps each chip compact and wraps chips as needed on constrained terminals.
 */
export function AgentStatusChip({ runtime }: AgentStatusChipProps): ReactNode {
  const palette = usePalette()
  const { sessionId } = runtime

  // Curried selectors build a new function per call; memoize so the subscription
  // survives re-renders instead of tearing down and rebuilding on each one.
  const statusSelector = useMemo(() => selectSessionStatus(sessionId), [sessionId])
  const focusSelector = useMemo(() => selectIsFocused(sessionId), [sessionId])
  const modelSelector = useMemo(() => selectAgentModel(sessionId), [sessionId])
  const effortSelector = useMemo(() => selectAgentEffort(sessionId), [sessionId])
  const status = useAppSelector(statusSelector)
  const focused = useAppSelector(focusSelector)
  const model = useAppSelector(modelSelector)
  const effort = useAppSelector(effortSelector)

  const tone: StatusTone = runtime.ready ? status : "not_ready"
  const configuration = model && effort ? `${model} / ${effort}` : model ?? effort

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={focused ? palette.accent : palette.muted}>{focused ? FOCUS_MARKER : " "}</span>
      <span fg={focused ? palette.text : palette.muted}>{` ${runtime.title}: `}</span>
      <span fg={palette.status[tone]}>{STATUS_LABELS[tone]}</span>
      {configuration ? <span fg={palette.muted}>{` · ${configuration}`}</span> : null}
    </text>
  )
}
