/**
 * Kitten's signature dual-agent status bar.
 *
 * The first row keeps shared workspace and hand-off state visible. The second row
 * carries one lozenge per agent: focus and run-state remain orthogonal, while
 * model, effort, and context slots disappear at zero width when their narrow
 * selectors have no value. Width collapse is deterministic: branch first, then
 * context, then effort.
 */

import { useTerminalDimensions } from "@opentui/react"
import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import type { HandoffBlockedReason } from "../app/handoff.ts"
import type { ContextUsage, SessionId } from "../core/types.ts"
import type { Selector } from "../store/appStore.ts"
import {
  selectAgentEffort,
  selectAgentModel,
  selectFocusedSessionId,
  selectHasOpenOverlay,
  selectIsFocused,
  selectSessionBranch,
  selectSessionContext,
  selectSessionModel,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { HANDOFF_KEY_HINT, KEYMAP_HINT, NEW_RUN_KEY_HINT } from "./keymap.ts"
import { usePalette, type CockpitPalette, type StatusTone } from "./theme.ts"

/** User-facing run-state vocabulary; awaiting approval is explicitly the user's turn. */
export const STATUS_LABELS: Readonly<Record<StatusTone, string>> = {
  idle: "idle",
  working: "working",
  awaiting_approval: "waiting",
  finished: "finished",
  error: "error",
  not_ready: "not ready",
}

/** Run-state is recognizable without color. */
export const RUN_STATE_GLYPHS: Readonly<Record<StatusTone, string>> = {
  idle: "○",
  working: "●",
  awaiting_approval: "!",
  finished: "✓",
  error: "×",
  not_ready: "×",
}

/** The focused agent's independent marker; the unfocused lozenge renders no placeholder. */
export const FOCUS_MARKER = "▸"

/** Textual boot-state marker; color is deliberately not its only signal. */
export const RESUMED_RUN_LABEL = "resumed"

const selectIsResumedRun: Selector<boolean> = (state) =>
  state.order.some((sessionId) => state.restoration[sessionId] !== null)

/** A slot is shed below its threshold; values encode the declared priority order. */
export const COLLAPSE_WIDTHS = {
  branch: 80,
  context: 79,
  effort: 71,
} as const

/** Concise reasons aligned one-for-one with `HandoffFlow.begin()`. */
export const HANDOFF_BLOCKED_LABELS: Readonly<Record<HandoffBlockedReason, string>> = {
  "overlay-open": "overlay open",
  "no-target": "no target ready",
  "empty-source": "nothing to hand off",
}

/** Selector factories consumed by the bar; injectable so nullable delegated slots can be exercised in isolation. */
export interface StatusSlotSelectors {
  branch: typeof selectSessionBranch
  model: typeof selectSessionModel
  context: typeof selectSessionContext
  effort: (sessionId: SessionId) => Selector<string | null>
}

function selectOptionalEffort(sessionId: SessionId): Selector<string | null> {
  const selector = selectAgentEffort(sessionId)
  return (state) => selector(state) ?? null
}

function selectAvailableModel(sessionId: SessionId): Selector<string | null> {
  const delegated = selectSessionModel(sessionId)
  const advertised = selectAgentModel(sessionId)
  return (state) => delegated(state) ?? advertised(state) ?? null
}

const DEFAULT_SLOT_SELECTORS: StatusSlotSelectors = {
  branch: selectSessionBranch,
  // The task_08 contract remains nullable; the already-landed model-effort seam is
  // the production source until that delegated selector owns the same value.
  model: selectAvailableModel,
  context: selectSessionContext,
  effort: selectOptionalEffort,
}

export interface StatusStripProps {
  /** Defaults to the production slot contract; tests may supply already-typed selector factories. */
  selectors?: StatusSlotSelectors
}

/** Shared workspace + hand-off, followed by the dual-agent lozenge row. */
export function StatusStrip({ selectors = DEFAULT_SLOT_SELECTORS }: StatusStripProps): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { width } = useTerminalDimensions()
  const runtimes = controller.runtimes()
  const workspaceRuntime = runtimes[0]
  const resumed = useAppSelector(selectIsResumedRun)

  const showBranch = width >= COLLAPSE_WIDTHS.branch
  const showContext = width >= COLLAPSE_WIDTHS.context
  const showEffort = width >= COLLAPSE_WIDTHS.effort

  return (
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: palette.surface,
        overflow: "hidden",
      }}
    >
      <box style={{ flexDirection: "row", justifyContent: "space-between", overflow: "hidden" }}>
        {workspaceRuntime ? (
          <SharedWorkspace
            runtime={workspaceRuntime}
            branchSelector={selectors.branch}
            showBranch={showBranch}
            palette={palette}
          />
        ) : null}
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2, overflow: "hidden" }}>
          {resumed ? (
            <text style={{ flexShrink: 0 }}>
              <span fg={palette.status.finished}>{RESUMED_RUN_LABEL}</span>
              <span fg={palette.muted}>{` · ${NEW_RUN_KEY_HINT} new run`}</span>
            </text>
          ) : null}
          <text fg={palette.accent}>{KEYMAP_HINT}</text>
          <HandoffAffordance runtimes={runtimes} palette={palette} />
        </box>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, flexWrap: "wrap", gap: 1, overflow: "hidden" }}>
        {runtimes.map((runtime) => (
          <AgentStatusLozenge
            key={runtime.sessionId}
            runtime={runtime}
            selectors={selectors}
            showContext={showContext}
            showEffort={showEffort}
            palette={palette}
          />
        ))}
      </box>
    </box>
  )
}

interface SharedWorkspaceProps {
  runtime: AgentRuntimeState
  branchSelector: typeof selectSessionBranch
  showBranch: boolean
  palette: CockpitPalette
}

/** One shared workspace segment; the optional branch delimiter vanishes with the branch. */
function SharedWorkspace({ runtime, branchSelector, showBranch, palette }: SharedWorkspaceProps): ReactNode {
  const selector = useMemo(() => branchSelector(runtime.sessionId), [branchSelector, runtime.sessionId])
  const branch = useAppSelector(selector)

  return (
    <text style={{ flexShrink: 1, overflow: "hidden" }} wrapMode="none" fg={palette.muted}>
      {displayCwd(runtime.cwd)}
      {showBranch && branch !== null ? <span fg={palette.text}>{` · ${branch}`}</span> : null}
    </text>
  )
}

interface AgentStatusLozengeProps {
  runtime: AgentRuntimeState
  selectors: StatusSlotSelectors
  showContext: boolean
  showEffort: boolean
  palette: CockpitPalette
}

/** Focus, state, and every nullable session slot for one agent. */
function AgentStatusLozenge({
  runtime,
  selectors,
  showContext,
  showEffort,
  palette,
}: AgentStatusLozengeProps): ReactNode {
  const { sessionId } = runtime
  const statusSelector = useMemo(() => selectSessionStatus(sessionId), [sessionId])
  const focusSelector = useMemo(() => selectIsFocused(sessionId), [sessionId])
  const modelSelector = useMemo(() => selectors.model(sessionId), [selectors.model, sessionId])
  const contextSelector = useMemo(() => selectors.context(sessionId), [selectors.context, sessionId])
  const effortSelector = useMemo(() => selectors.effort(sessionId), [selectors.effort, sessionId])
  const status = useAppSelector(statusSelector)
  const focused = useAppSelector(focusSelector)
  const model = useAppSelector(modelSelector)
  const context = useAppSelector(contextSelector)
  const effort = useAppSelector(effortSelector)
  const tone: StatusTone = runtime.ready ? status : "not_ready"

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={focused ? palette.accent : palette.muted}>[</span>
      {focused ? <span fg={palette.accent}>{`${FOCUS_MARKER} `}</span> : null}
      <span fg={palette.status[tone]}>{`${RUN_STATE_GLYPHS[tone]} `}</span>
      <span fg={focused ? palette.text : palette.muted}>{`${runtime.title}: `}</span>
      <span fg={palette.status[tone]}>{STATUS_LABELS[tone]}</span>
      {model !== null ? <span fg={palette.muted}>{` ${model}`}</span> : null}
      {showEffort && effort !== null ? <span fg={palette.muted}>{model === null ? ` ${effort}` : `/${effort}`}</span> : null}
      {showContext && context !== null ? (
        <span fg={contextColor(context, palette.context)}>{` ${Math.round(context.percent * 100)}%`}</span>
      ) : null}
      <span fg={focused ? palette.accent : palette.muted}>]</span>
    </text>
  )
}

function HandoffAffordance({
  runtimes,
  palette,
}: {
  runtimes: AgentRuntimeState[]
  palette: CockpitPalette
}): ReactNode {
  const controller = useController()
  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)
  const hasTurnsSelector = useMemo(
    (): Selector<boolean> => (state) => (state.sessions[focusedSessionId]?.turns.length ?? 0) > 0,
    [focusedSessionId],
  )
  const hasTurns = useAppSelector(hasTurnsSelector)
  const recipients = runtimes.filter(
    (runtime) => runtime.sessionId !== focusedSessionId && controller.isReady(runtime.sessionId),
  )
  const target = recipients.length === 1 ? recipients[0]!.title : recipients.length > 1 ? "choose target" : null
  const reason: HandoffBlockedReason | null = overlayOpen
    ? "overlay-open"
    : !hasTurns
      ? "empty-source"
      : target === null
        ? "no-target"
        : null
  const direction = target === null ? "" : ` -> ${target}`

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={palette.accent}>{HANDOFF_KEY_HINT}</span>
      <span fg={reason === null ? palette.text : palette.muted}>
        {` hand off${direction}${reason === null ? "" : ` — ${HANDOFF_BLOCKED_LABELS[reason]}`}`}
      </span>
    </text>
  )
}

function contextColor(context: ContextUsage, palette: { ok: string; warn: string; critical: string }): string {
  if (context.percent > 0.85) return palette.critical
  if (context.percent >= 0.7) return palette.warn
  return palette.ok
}

function displayCwd(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).at(-1) || cwd
}
