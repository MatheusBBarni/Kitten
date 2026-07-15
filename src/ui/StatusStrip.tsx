/**
 * Kitten's compact per-agent status and context-headroom bar.
 *
 * The first row keeps shared workspace and hand-off state visible. Its focused-agent
 * readout combines the provider, model, optional reasoning effort, and current run
 * state so the strip stays compact without a second status-only row.
 */

import { useTerminalDimensions } from "@opentui/react"
import { useMemo, type ReactNode } from "react"

import type { AgentRuntimeState } from "../app/controller.ts"
import {
  renderStatusline,
  statuslineText,
  type StatuslineContext,
  type StatuslineLayout,
} from "../core/statusline.ts"
import {
  EFFORT_CATEGORY,
  MODEL_CATEGORY,
  PROVIDER_METADATA,
  type ConfigOption,
  type DefaultApplyResult,
} from "../core/types.ts"
import type { Selector } from "../store/appStore.ts"
import {
  selectAgentConfigOptions,
  selectAgentEffort,
  selectAgentModel,
  selectBackgroundWork,
  selectFocusedSessionId,
  selectIsShellFocused,
  selectSessionDefaultApplyResult,
  selectSessionHeadroom,
  selectSessionBranch,
  selectSessionModel,
  selectStatuslinePreference,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { formatHeadroom } from "./headroom.ts"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import { usePalette, type StatusTone } from "./theme.ts"

/** User-facing run-state vocabulary for the compact session chips. */
export const STATUS_LABELS: Readonly<Record<StatusTone, string>> = {
  idle: "idle",
  working: "working",
  awaiting_clarification: "? clarification",
  awaiting_approval: "waiting",
  finished: "finished",
  error: "error",
  not_ready: "not ready",
}

/** The selected agent's marker; unfocused chips reserve the same single cell. */
export const FOCUS_MARKER = "▸"

/** Three cells keep both agent gauges inside the exact 80-column strip budget. */
const STATUS_STRIP_HEADROOM_CELLS = 3

/** Outer padding plus one readable cell between custom content and the fixed affordance. */
const CUSTOM_STATUSLINE_RESERVED_CELLS = 3

/** Match the fixed footer's custom-content space for statusline previews and rendering. */
export function statuslineFooterBudget(width: number, affordance: string): number {
  return Math.max(0, width - CUSTOM_STATUSLINE_RESERVED_CELLS - [...affordance].length)
}

/** Workspace-level status shown when no Visible conversation is selected. */
export const EMPTY_WORKSPACE_STATUS_LABEL = "workspace: no visible conversations"

/** Prefix for the count of live conversations kept outside the visible tab strip. */
export const BACKGROUND_STATUS_LABEL = "background"

/** Prefix for background conversations whose state still requires attention. */
export const BACKGROUND_ATTENTION_LABEL = "needs attention"

/** Compact label for the focused session's MCP provisioning result. */
export const MCP_STATUS_LABEL = "MCP"

/** Compact status-strip copy for reducer-confirmed provider-default outcomes. */
export const DEFAULT_APPLIED_STATUS_LABEL = "default applied"
export const DEFAULT_EFFORT_UNAVAILABLE_STATUS_LABEL = "effort unavailable"
export const DEFAULT_MODEL_UNAVAILABLE_STATUS_LABEL = "model unavailable"
export const DEFAULT_SESSION_UNAVAILABLE_STATUS_LABEL = "session unavailable"

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
  const { width } = useTerminalDimensions()
  const shellFocused = useAppSelector(selectIsShellFocused)
  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const statusline = useAppSelector(selectStatuslinePreference)
  const hint = shellFocused ? SHELL_EXIT_HINT : KEYMAP_HINT
  const customBudget = statuslineFooterBudget(width, hint)

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
          {statusline.layout !== null ? (
            <CustomStatusline
              layout={statusline.layout}
              sessionId={focusedSessionId}
              selectors={selectors}
              helpText={hint}
              columnBudget={customBudget}
            />
          ) : focusedSessionId === null ? (
            <WorkspaceStatusSummary />
          ) : (
            <SelectedAgentStatus sessionId={focusedSessionId} selectors={selectors} />
          )}
        </box>
        <box style={{ flexDirection: "row", flexShrink: 0, gap: 2, overflow: "hidden" }}>
          <text fg={palette.accent}>{hint}</text>
        </box>
      </box>
    </box>
  )
}

/** Render one saved layout from existing selected-session read models only. */
function CustomStatusline({
  layout,
  sessionId,
  selectors,
  helpText,
  columnBudget,
}: {
  layout: StatuslineLayout
  sessionId: string | null
  selectors: StatusSlotSelectors
  helpText: string
  columnBudget: number
}): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const runtime = sessionId === null ? undefined : controller.runtime(sessionId)
  const branchSelector = useMemo(
    () => sessionId === null ? (() => null) : selectSessionBranch(sessionId),
    [sessionId],
  )
  const modelSelector = useMemo(
    () => sessionId === null ? (() => null) : selectors.model(sessionId),
    [selectors.model, sessionId],
  )
  const effortSelector = useMemo(
    () => sessionId === null ? (() => undefined) : selectors.effort(sessionId),
    [selectors.effort, sessionId],
  )
  const configOptionsSelector = useMemo(() => selectAgentConfigOptions(sessionId), [sessionId])
  const branch = useAppSelector(branchSelector)
  const model = useAppSelector(modelSelector)
  const effort = useAppSelector(effortSelector)
  const configOptions = useAppSelector(configOptionsSelector)
  const context = useMemo<StatuslineContext>(() => ({
    cwd: runtime?.cwd,
    branch,
    provider: runtime ? PROVIDER_METADATA[runtime.providerKind].compactLabel : null,
    model: displayModelName(configOptions, model),
    effort: displayEffortName(configOptions, effort),
    helpText,
  }), [branch, configOptions, effort, helpText, model, runtime])
  const text = statuslineText(renderStatusline(layout, context, columnBudget))

  return (
    <text style={{ flexShrink: 1, overflow: "hidden" }} wrapMode="none" fg={palette.text}>
      {text}
    </text>
  )
}

/** Resolve only the selected runtime: other providers do not belong in the fixed footer. */
function SelectedAgentStatus({ sessionId, selectors }: { sessionId: string; selectors: StatusSlotSelectors }): ReactNode {
  const controller = useController()
  const runtime = controller.runtime(sessionId)
  return runtime ? <AgentStatusChip runtime={runtime} selectors={selectors} /> : null
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
  const defaultApplyResultSelector = useMemo(
    () => selectSessionDefaultApplyResult(runtime.sessionId),
    [runtime.sessionId],
  )
  const headroomSelector = useMemo(() => selectSessionHeadroom(runtime.sessionId), [runtime.sessionId])
  const model = useAppSelector(modelSelector)
  const effort = useAppSelector(effortSelector)
  const configOptions = useAppSelector(configOptionsSelector)
  const defaultApplyResult = useAppSelector(defaultApplyResultSelector)
  const selectedHeadroom = useAppSelector(headroomSelector)
  const displayModel = displayModelName(configOptions, model)
  const displayEffort = displayEffortName(configOptions, effort)
  const provider = PROVIDER_METADATA[runtime.providerKind].compactLabel
  const headroom = formatHeadroom(selectedHeadroom, STATUS_STRIP_HEADROOM_CELLS)

  return (
    <text style={{ flexShrink: 0 }} wrapMode="none">
      <span fg={palette.accent}>{FOCUS_MARKER}</span>
      <span fg={palette.text}> </span>
      <span fg={palette.accent}>{`${provider}:`}</span>
      <span fg={displayModel === null ? palette.muted : palette.text}>{displayModel ?? "—"}</span>
      {displayEffort === null ? null : <span fg={palette.muted}>{`:${displayEffort}`}</span>}
      <span fg={palette.text}>{` ${headroom.label}`}</span>
      {selectedHeadroom === null ? null : (
        <>
          <span fg={palette.text}>{` ${"█".repeat(headroom.filled)}`}</span>
          <span fg={palette.muted}>{"░".repeat(headroom.cells - headroom.filled)}</span>
        </>
      )}
      <DefaultApplyStatus result={defaultApplyResult} />
      <McpStatus runtime={runtime} />
    </text>
  )
}

/** Render only the terminal result; confirmed option values remain the spans above. */
function DefaultApplyStatus({ result }: { result: DefaultApplyResult | null }): ReactNode {
  const palette = usePalette()
  if (result === null || result.kind === "none") return null

  const label = result.kind === "applied"
    ? DEFAULT_APPLIED_STATUS_LABEL
    : result.kind === "partial"
      ? DEFAULT_EFFORT_UNAVAILABLE_STATUS_LABEL
      : result.unavailable === "model"
        ? DEFAULT_MODEL_UNAVAILABLE_STATUS_LABEL
        : result.unavailable === "effort"
          ? DEFAULT_EFFORT_UNAVAILABLE_STATUS_LABEL
          : DEFAULT_SESSION_UNAVAILABLE_STATUS_LABEL
  const color = result.kind === "applied"
    ? palette.tool.completed
    : result.kind === "partial"
      ? palette.status.awaiting_approval
      : palette.status.error

  return (
    <>
      <span fg={palette.muted}> · </span>
      <span fg={color}>{label}</span>
    </>
  )
}

/** Keep skipped declarations visible without exposing any resolved environment values. */
function McpStatus({ runtime }: { runtime: AgentRuntimeState }): ReactNode {
  const palette = usePalette()
  const mcp = runtime.mcp
  if (!mcp) return null
  const loaded = mcp.loaded.length > 0 ? `+${mcp.loaded.join(",")}` : ""
  const skipped = mcp.skipped.map(({ name, reason }) => `!${name} (${reason})`).join(", ")
  const askUser = mcp.askUser
  if (!loaded && !skipped && !askUser) return null

  const askUserStatus = askUser === "loading"
    ? "connecting"
    : askUser === "attached"
      ? "ready"
      : askUser === "unavailable"
        ? "unavailable"
        : null
  const askUserColor = askUser === "loading"
    ? palette.status.awaiting_approval
    : askUser === "attached"
      ? palette.status.finished
      : palette.status.error

  return (
    <>
      <span fg={palette.muted}>{` · ${MCP_STATUS_LABEL}: `}</span>
      {loaded ? <span fg={palette.status.finished}>{loaded}</span> : null}
      {loaded && skipped ? <span fg={palette.muted}>; </span> : null}
      {skipped ? <span fg={palette.status.error}>{skipped}</span> : null}
      {(loaded || skipped) && askUserStatus ? <span fg={palette.muted}>; </span> : null}
      {askUserStatus ? (
        <>
          <span fg={palette.text}>Ask User </span>
          <span fg={askUserColor}>{askUserStatus}</span>
        </>
      ) : null}
    </>
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
