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
import type { SessionId } from "../core/types.ts"
import type { Selector } from "../store/appStore.ts"
import {
  selectAgentEffort,
  selectAgentModel,
  selectIsFocused,
  selectSessionBranch,
  selectSessionContext,
  selectSessionModel,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { KEYMAP_HINT } from "./keymap.ts"
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
  effort: 71,
} as const

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
  const resumed = useAppSelector(selectIsResumedRun)

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
        <box style={{ flexDirection: "row", flexGrow: 1, flexShrink: 1, gap: 1, overflow: "hidden" }}>
          {runtimes.map((runtime) => (
            <AgentModelSummary key={runtime.sessionId} runtime={runtime} selectors={selectors} showEffort={showEffort} />
          ))}
        </box>
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2, overflow: "hidden" }}>
          {resumed ? (
            <text style={{ flexShrink: 0 }}>
              <span fg={palette.status.finished}>{RESUMED_RUN_LABEL}</span>
            </text>
          ) : null}
          <text fg={palette.accent}>{KEYMAP_HINT}</text>
        </box>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, flexWrap: "wrap", gap: 1, overflow: "hidden" }}>
        {runtimes.map((runtime) => (
          <AgentStatusLozenge
            key={runtime.sessionId}
            runtime={runtime}
            selectors={selectors}
            palette={palette}
          />
        ))}
      </box>
    </box>
  )
}

interface AgentModelSummaryProps {
  runtime: AgentRuntimeState
  selectors: StatusSlotSelectors
  showEffort: boolean
}

/** The focused model names live in the compact upper row, not inside status chips. */
function AgentModelSummary({ runtime, selectors, showEffort }: AgentModelSummaryProps): ReactNode {
  const palette = usePalette()
  const modelSelector = useMemo(() => selectors.model(runtime.sessionId), [selectors.model, runtime.sessionId])
  const effortSelector = useMemo(() => selectors.effort(runtime.sessionId), [selectors.effort, runtime.sessionId])
  const model = useAppSelector(modelSelector)
  const effort = useAppSelector(effortSelector)
  const provider = runtime.providerKind === "claude-code" ? "claude" : "codex"

  return (
    <text style={{ flexShrink: 1, overflow: "hidden" }} wrapMode="none">
      <span fg={palette.accent}>{`${provider}:`}</span>
      <span fg={model === null ? palette.muted : palette.text}>{model ?? "—"}</span>
      {showEffort && effort !== null ? <span fg={palette.muted}>{`/${effort}`}</span> : null}
    </text>
  )
}

interface AgentStatusLozengeProps {
  runtime: AgentRuntimeState
  selectors: StatusSlotSelectors
  palette: CockpitPalette
}

/** Focus, state, and every nullable session slot for one agent. */
function AgentStatusLozenge({
  runtime,
  selectors: _selectors,
  palette,
}: AgentStatusLozengeProps): ReactNode {
  const { sessionId } = runtime
  const statusSelector = useMemo(() => selectSessionStatus(sessionId), [sessionId])
  const focusSelector = useMemo(() => selectIsFocused(sessionId), [sessionId])
  const status = useAppSelector(statusSelector)
  const focused = useAppSelector(focusSelector)
  const tone: StatusTone = runtime.ready ? status : "not_ready"

  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={focused ? palette.accent : palette.muted}>[</span>
      {focused ? <span fg={palette.accent}>{`${FOCUS_MARKER} `}</span> : null}
      <span fg={palette.status[tone]}>{`${RUN_STATE_GLYPHS[tone]} `}</span>
      <span fg={palette.status[tone]}>{STATUS_LABELS[tone]}</span>
      <span fg={focused ? palette.accent : palette.muted}>]</span>
    </text>
  )
}
