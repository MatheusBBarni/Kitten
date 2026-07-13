/**
 * Kitten's compact per-agent status and context-headroom bar.
 *
 * The first row keeps shared workspace and hand-off state visible. Its focused-agent
 * readout combines the provider, model, optional reasoning effort, and current run
 * state so the strip stays compact without a second status-only row.
 */

import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption } from "../core/types.ts"
import type { Selector } from "../store/appStore.ts"
import {
  selectAgentConfigOptions,
  selectAgentEffort,
  selectAgentModel,
  selectBackgroundWork,
  selectFocusedSessionId,
  selectIsFocused,
  selectIsShellFocused,
  selectSessionHeadroom,
  selectSessionModel,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { formatHeadroom } from "./headroom.ts"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import { usePalette, type StatusTone } from "./theme.ts"

/** User-facing run-state vocabulary; awaiting approval is explicitly the user's turn. */
export const STATUS_LABELS: Readonly<Record<StatusTone, string>> = {
  idle: "idle",
  working: "working",
  awaiting_approval: "waiting",
  finished: "finished",
  error: "error",
  not_ready: "not ready",
}

/** Textual boot-state marker; color is deliberately not its only signal. */
export const RESUMED_RUN_LABEL = "resumed"

/** The selected agent's marker; unfocused chips reserve the same single cell. */
export const FOCUS_MARKER = "▸"

/** Three cells keep both agent gauges inside the exact 80-column strip budget. */
const STATUS_STRIP_HEADROOM_CELLS = 3

/** Workspace-level status shown when no Visible conversation is selected. */
export const EMPTY_WORKSPACE_STATUS_LABEL = "workspace: no visible conversations"

/** Prefix for the count of live conversations kept outside the visible tab strip. */
export const BACKGROUND_STATUS_LABEL = "background"

/** Prefix for background conversations whose state still requires attention. */
export const BACKGROUND_ATTENTION_LABEL = "needs attention"

const selectIsResumedRun: Selector<boolean> = (state) =>
  state.workspace.order.some((sessionId) => state.restoration[sessionId] !== null)

/** Selector factories consumed by the bar; injectable so delegated model slots can be exercised in isolation. */
export interface StatusSlotSelectors {
  model: typeof selectSessionModel
  effort: typeof selectAgentEffort
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
  effort: selectAgentEffort,
}

export interface StatusStripProps {
  /** Defaults to the production slot contract; tests may supply already-typed selector factories. */
  selectors?: StatusSlotSelectors
}

/** Focused provider, model, effort, and run state. */
export function StatusStrip({ selectors = DEFAULT_SLOT_SELECTORS }: StatusStripProps): ReactNode {
  const palette = usePalette()
  const resumed = useAppSelector(selectIsResumedRun)
  const shellFocused = useAppSelector(selectIsShellFocused)
  const focusedSessionId = useAppSelector(selectFocusedSessionId)

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
          {focusedSessionId === null ? (
            <WorkspaceStatusSummary />
          ) : (
            <AgentStatusSummaries selectors={selectors} />
          )}
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
    </box>
  )
}

/** Resolve runtime-bound chips only after workspace selection is known real. */
function AgentStatusSummaries({ selectors }: { selectors: StatusSlotSelectors }): ReactNode {
  const controller = useController()
  return controller.runtimes().map((runtime) => (
    <AgentStatusChip key={runtime.sessionId} runtime={runtime} selectors={selectors} />
  ))
}

/** Empty-workspace feedback that never reads model, effort, status, or runtime state. */
function WorkspaceStatusSummary(): ReactNode {
  const palette = usePalette()
  const background = useAppSelector(selectBackgroundWork)
  const needsAttention = background.filter((conversation) => conversation.needsAttention).length
  return (
    <text style={{ flexShrink: 1, overflow: "hidden" }} wrapMode="none">
      <span fg={palette.text}>{EMPTY_WORKSPACE_STATUS_LABEL}</span>
      <span fg={palette.muted}>{` · ${BACKGROUND_STATUS_LABEL}: ${background.length}`}</span>
      {needsAttention > 0 ? (
        <span fg={palette.status.awaiting_approval}>{` · ${BACKGROUND_ATTENTION_LABEL}: ${needsAttention}`}</span>
      ) : null}
    </text>
  )
}

export interface AgentStatusChipProps {
  runtime: AgentRuntimeState
  selectors: StatusSlotSelectors
}

/** One runtime's focus, identity, state, and honest context headroom. */
export function AgentStatusChip({ runtime, selectors }: AgentStatusChipProps): ReactNode {
  const palette = usePalette()
  const modelSelector = useMemo(() => selectors.model(runtime.sessionId), [selectors.model, runtime.sessionId])
  const effortSelector = useMemo(() => selectors.effort(runtime.sessionId), [selectors.effort, runtime.sessionId])
  const configOptionsSelector = useMemo(() => selectAgentConfigOptions(runtime.sessionId), [runtime.sessionId])
  const statusSelector = useMemo(() => selectSessionStatus(runtime.sessionId), [runtime.sessionId])
  const focusSelector = useMemo(() => selectIsFocused(runtime.sessionId), [runtime.sessionId])
  const headroomSelector = useMemo(() => selectSessionHeadroom(runtime.sessionId), [runtime.sessionId])
  const model = useAppSelector(modelSelector)
  const effort = useAppSelector(effortSelector)
  const configOptions = useAppSelector(configOptionsSelector)
  const status = useAppSelector(statusSelector)
  const focused = useAppSelector(focusSelector)
  const selectedHeadroom = useAppSelector(headroomSelector)
  // Keep the current session-tabs contract: detailed configuration belongs only
  // to the selected chip, while every chip still carries status and headroom.
  const displayModel = focused ? displayModelName(configOptions, model) : null
  const displayEffort = focused ? displayEffortName(configOptions, effort) : null
  const provider = runtime.providerKind === "claude-code" ? "claude" : "codex"
  const tone: StatusTone = runtime.ready ? status : "not_ready"
  const headroom = formatHeadroom(runtime.ready ? selectedHeadroom : null, STATUS_STRIP_HEADROOM_CELLS)

  return (
    <text style={{ flexShrink: 0 }} wrapMode="none">
      <span fg={focused ? palette.accent : palette.muted}>{focused ? FOCUS_MARKER : " "}</span>
      <span fg={focused ? palette.text : palette.muted}> </span>
      <span fg={palette.accent}>{`${provider}:`}</span>
      <span fg={displayModel === null ? palette.muted : palette.text}>{displayModel ?? "—"}</span>
      {displayEffort === null ? null : <span fg={palette.muted}>{`:${displayEffort}`}</span>}
      <span fg={palette.muted}> - </span>
      <span fg={palette.status[tone]}>{STATUS_LABELS[tone]}</span>
      <span fg={palette.text}>{` ${headroom.label}`}</span>
      {selectedHeadroom === null || !runtime.ready ? null : (
        <>
          <span fg={palette.text}>{` ${"█".repeat(headroom.filled)}`}</span>
          <span fg={palette.muted}>{"░".repeat(headroom.cells - headroom.filled)}</span>
        </>
      )}
    </text>
  )
}

/** Render the agent's human label while preserving its opaque value for ACP writes. */
function displayModelName(configOptions: readonly ConfigOption[], value: string | null): string | null {
  if (value === null) return null
  const model = configOptions.find((option) => option.category === MODEL_CATEGORY && option.currentValue === value)
  return model?.options.find((option) => option.value === value)?.name ?? value
}

/** Render the agent's advertised effort label while preserving its opaque ACP value for writes. */
function displayEffortName(configOptions: readonly ConfigOption[], value: string | undefined): string | null {
  if (value === undefined) return null
  const effort = configOptions.find((option) => option.category === EFFORT_CATEGORY && option.currentValue === value)
  return effort?.options.find((option) => option.value === value)?.name ?? value
}
