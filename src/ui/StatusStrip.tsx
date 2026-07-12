/**
 * Kitten's focused-agent status bar.
 *
 * The first row keeps shared workspace and hand-off state visible. The second row
 * names only the active provider and its chosen model. The lower lozenges still
 * expose every agent's independent run state, so an unavailable peer remains
 * visible without making the current-model readout ambiguous.
 */

import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import { MODEL_CATEGORY, type ConfigOption } from "../core/types.ts"
import type { Selector } from "../store/appStore.ts"
import {
  selectAgentConfigOptions,
  selectAgentModel,
  selectFocusedSessionId,
  selectIsFocused,
  selectIsShellFocused,
  selectSessionModel,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
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

/** Selector factories consumed by the bar; injectable so delegated model slots can be exercised in isolation. */
export interface StatusSlotSelectors {
  model: typeof selectSessionModel
}

function selectAvailableModel(sessionId: string): Selector<string | null> {
  const delegated = selectSessionModel(sessionId)
  const advertised = selectAgentModel(sessionId)
  return (state) => delegated(state) ?? advertised(state) ?? null
}

const DEFAULT_SLOT_SELECTORS: StatusSlotSelectors = {
  // The task_08 contract remains nullable; the already-landed model seam is
  // the production source until that delegated selector owns the same value.
  model: selectAvailableModel,
}

export interface StatusStripProps {
  /** Defaults to the production slot contract; tests may supply already-typed selector factories. */
  selectors?: StatusSlotSelectors
}

/** Focused provider/model, followed by the multi-agent run-state row. */
export function StatusStrip({ selectors = DEFAULT_SLOT_SELECTORS }: StatusStripProps): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const runtimes = controller.runtimes()
  const resumed = useAppSelector(selectIsResumedRun)
  const shellFocused = useAppSelector(selectIsShellFocused)
  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const focusedRuntime = runtimes.find((runtime) => runtime.sessionId === focusedSessionId)

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
          {focusedRuntime ? <AgentModelSummary runtime={focusedRuntime} selectors={selectors} /> : null}
        </box>
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2, overflow: "hidden" }}>
          {resumed ? (
            <text style={{ flexShrink: 0 }}>
              <span fg={palette.status.finished}>{RESUMED_RUN_LABEL}</span>
            </text>
          ) : null}
          <text fg={palette.accent}>{shellFocused ? SHELL_EXIT_HINT : KEYMAP_HINT}</text>
        </box>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, flexWrap: "wrap", gap: 1, overflow: "hidden" }}>
        {runtimes.map((runtime) => (
          <AgentStatusLozenge
            key={runtime.sessionId}
            runtime={runtime}
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
}

/** The focused model names live in the compact upper row, not inside status chips. */
function AgentModelSummary({ runtime, selectors }: AgentModelSummaryProps): ReactNode {
  const palette = usePalette()
  const modelSelector = useMemo(() => selectors.model(runtime.sessionId), [selectors.model, runtime.sessionId])
  const configOptionsSelector = useMemo(() => selectAgentConfigOptions(runtime.sessionId), [runtime.sessionId])
  const model = useAppSelector(modelSelector)
  const configOptions = useAppSelector(configOptionsSelector)
  const displayModel = displayModelName(configOptions, model)
  const provider = runtime.providerKind === "claude-code" ? "claude" : "codex"

  return (
    <text style={{ flexShrink: 1, overflow: "hidden" }} wrapMode="none">
      <span fg={palette.accent}>{`${provider}:`}</span>
      <span fg={displayModel === null ? palette.muted : palette.text}>{displayModel ?? "—"}</span>
    </text>
  )
}

/** Render the agent's human label while preserving its opaque value for ACP writes. */
function displayModelName(configOptions: readonly ConfigOption[], value: string | null): string | null {
  if (value === null) return null
  const model = configOptions.find((option) => option.category === MODEL_CATEGORY && option.currentValue === value)
  return model?.options.find((option) => option.value === value)?.name ?? value
}

interface AgentStatusLozengeProps {
  runtime: AgentRuntimeState
  palette: CockpitPalette
}

/** Focus, state, and every nullable session slot for one agent. */
function AgentStatusLozenge({
  runtime,
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
