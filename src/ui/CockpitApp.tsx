/**
 * The cockpit shell: the frame every other view mounts into.
 *
 * The layout is a focused pane, not a split. One agent conversation or the integrated
 * shell owns the full-width main region at a time; slash commands move between
 * agents and toggle the shell without sacrificing the readable 80-column layout.
 * Beneath it sit the prompt editor and the status strip. An alternate-screen app
 * temporarily yields those rows to the shell pane, then restores them on exit.
 * Overlays (the help panel, the hand-off preview, and the approval prompt) are
 * absolutely-positioned boxes, since the React binding ships no Portal (ADR-004).
 * The hand-off preview and the approval prompt are modal and swallow every key they
 * see, so the shell's own chords simply never fire while one of them is up. Modality
 * takes both halves: global key listeners fire in mount order and the shell mounts
 * first, so it must stand down here rather than leaving it to an overlay's
 * `preventDefault`, which only reaches focused renderables.
 *
 * The hand-off is the product (PRD F3). Its slash command lives in the same registry as every
 * other cockpit action and does nothing but open the flow - a target picker when the fleet gives
 * a choice of recipient, the redacted preview otherwise. `HandoffFlow` owns everything
 * past that, and nothing sends without a confirm.
 *
 * The frame is sized from the live terminal dimensions rather than percentages, so
 * a resize re-lays the whole tree out in one pass and nothing is left painted
 * outside the new viewport.
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { SessionController } from "../app/controller.ts"
import { composeHandoffBlocks, createHandoffEdits, createHandoffFlow } from "../app/handoff.ts"
import { createStatuslineFlow } from "../app/statuslineFlow.ts"
import type { BannerVariant } from "../config/appState.ts"
import { encodeKey } from "../shell/keyEncoder.ts"
import type { KeyboardCapability, Selector } from "../store/appStore.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import {
  selectConversationAvailability,
  selectFocusedSessionId,
  selectHasOpenOverlay,
  selectIsShellFocused,
  selectKeyboardCapability,
  selectRestoration,
} from "../store/selectors.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { ClarificationPrompt } from "./ClarificationPrompt.tsx"
import { CockpitProvider, useAppSelector, useController, useShellBufferType } from "./cockpitContext.tsx"
import { ConversationView } from "./ConversationView.tsx"
import { ConversationActivity } from "./ConversationActivity.tsx"
import { EmptyWorkspace } from "./EmptyWorkspace.tsx"
import { HandoffPreview } from "./HandoffPreview.tsx"
import { HandoffTargetPicker } from "./HandoffTargetPicker.tsx"
import { ModelSelect } from "./ModelSelect.tsx"
import { PromptEditor } from "./PromptEditor.tsx"
import { SessionPicker, type SessionPickerSource } from "./SessionPicker.tsx"
import { ShellPane } from "./ShellPane.tsx"
import { SessionsOverlay } from "./SessionsOverlay.tsx"
import { SettingsView } from "./SettingsView.tsx"
import { StatusStrip } from "./StatusStrip.tsx"
import { StatuslineOverlay } from "./StatuslineOverlay.tsx"
import { TabDialog } from "./TabDialog.tsx"
import { helpEntries, matchCommand, type CockpitCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** Bottom title of the help overlay; also the phrase the help toggle test looks for. */
export const HELP_TITLE = "Commands"

/** Copy-result labels are exported so the rendered action stays an explicit UI contract. */
export const EXTERNAL_RUN_COPIED_PREFIX = "Copied for external terminal:"
export const EXTERNAL_RUN_FALLBACK_PREFIX = "Run externally:"
export const EXTERNAL_RUN_EMPTY = "No shell command is available to run externally."

interface ExternalRunNotice {
  readonly command: string | null
  readonly copied: boolean
}

/** Command count is the content-free signal that the shell was actually used. */
const selectShellCommandCount: Selector<number> = (state) => state.shell.commands.length

/** Props for {@link CockpitApp}. */
export interface CockpitAppProps {
  /** The booted controller. The only channel through which the shell reaches an agent. */
  controller: SessionController
  /** The conversation region's contents - `<ConversationView>` in the real app. */
  children?: ReactNode
  /** Welcome shape resolved once at boot from config and first-run state. */
  welcomeBannerVariant?: BannerVariant
  /** Optional telemetry recorder; the hand-off flow records its metrics through it. */
  recorder?: TelemetryRecorder
  /** Saved-run persistence boundary and project identity for the `/resume` picker. */
  sessionPicker?: SessionPickerSource
}

/** The cockpit root: provides the controller, then renders the frame. */
export function CockpitApp({ controller, children, welcomeBannerVariant = "full", recorder, sessionPicker }: CockpitAppProps): ReactNode {
  return (
    <CockpitProvider controller={controller}>
      <CockpitFrame recorder={recorder} sessionPicker={sessionPicker} welcomeBannerVariant={welcomeBannerVariant}>
        {children}
      </CockpitFrame>
    </CockpitProvider>
  )
}

/** The frame itself: conversation region, status strip, and the help overlay. */
function CockpitFrame({
  children,
  recorder,
  sessionPicker,
  welcomeBannerVariant,
}: {
  children?: ReactNode
  recorder?: TelemetryRecorder
  sessionPicker?: SessionPickerSource
  welcomeBannerVariant: BannerVariant
}): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const renderer = useRenderer()
  const { width, height } = useTerminalDimensions()
  const [helpOpen, setHelpOpen] = useState(false)
  const [externalRunNotice, setExternalRunNotice] = useState<ExternalRunNotice | null>(null)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)
  const isShellFocused = useAppSelector(selectIsShellFocused)
  const keyboardCapability = useAppSelector(selectKeyboardCapability)
  const shellBufferType = useShellBufferType()
  const shellCommandCount = useAppSelector(selectShellCommandCount)
  const shellActivationRecorded = useRef(false)

  useEffect(() => {
    if (shellCommandCount === 0 || shellActivationRecorded.current) return
    shellActivationRecorded.current = true
    recorder?.shellActivated()
  }, [recorder, shellCommandCount])

  // One flow for the life of the controller: a hand-off and a later hand-back are the
  // same mechanism pointed the other way, and it derives its direction from focus.
  const handoff = useMemo(() => createHandoffFlow({ controller, recorder }), [controller, recorder])
  const statusline = useMemo(() => createStatuslineFlow({ actions: controller.actions, store: controller.store }), [controller])

  /** One cockpit dispatch path shared by `/commands` and the remaining global chord. */
  const runCockpitCommand = useCallback(
    (command: CockpitCommand): void => {
      const state = controller.store.getState()

      switch (command) {
        case "toggle-shell":
          setHelpOpen(false)
          setExternalRunNotice(null)
          controller.store.setFocusedPane(
            state.focusedPane.kind === "shell"
              ? state.workspace.selectedVisibleId
                ? { kind: "agent", sessionId: state.workspace.selectedVisibleId }
                : { kind: "workspace" }
              : { kind: "shell" },
          )
          return
        case "run-externally": {
          const commandText = state.shell.commands.at(-1)?.command.trim() ?? ""
          if (commandText.length === 0) {
            setExternalRunNotice({ command: null, copied: false })
            return
          }
          let copied = false
          try {
            copied = renderer.copyToClipboardOSC52(commandText)
          } catch {
            // A terminal without OSC 52 support still gets the command in the pane.
          }
          setExternalRunNotice({ command: commandText, copied })
          recorder?.externalRun()
          return
        }
        case "hand-off":
          if (handoff.begin().ok) setHelpOpen(false)
          return
        case "sessions":
          setHelpOpen(false)
          controller.store.openSessions()
          return
        case "previous-tab":
          controller.actions.switchFocus(undefined, {
            direction: "previous",
            source: "kitty_chord",
          })
          return
        case "next-tab":
          controller.actions.switchFocus(undefined, {
            direction: "next",
            source: "kitty_chord",
          })
          return
        case "resume-session":
          setHelpOpen(false)
          recorder?.resumePickerOpened()
          controller.store.openSessionPicker()
          return
        case "start-new-run": {
          setHelpOpen(false)
          const sessionId = state.workspace.selectedVisibleId
          const restoration = sessionId ? state.restoration[sessionId] : null
          const bundle = state.restorationBundle
          if (sessionId && restoration === "unavailable" && bundle) {
            void controller.actions.startFreshFromContext(
              composeHandoffBlocks(bundle, createHandoffEdits(bundle)),
              sessionId,
            )
            return
          }
          void controller.actions.createConversation()
          return
        }
        case "clear-run":
          setHelpOpen(false)
          void controller.actions.startNewRun()
          return
        case "model-select":
          setHelpOpen(false)
          if (state.workspace.selectedVisibleId) {
            controller.store.openModelSelect({ sessionId: state.workspace.selectedVisibleId })
          }
          return
        case "statusline": {
          setHelpOpen(false)
          const sessionId = state.workspace.selectedVisibleId
          if (!sessionId) return
          controller.store.openStatusline(
            state.preferences.statusline.llmDisclosureAcknowledged
              ? { sessionId, phase: "request", requestText: "" }
              : { sessionId, phase: "disclosure" },
          )
          return
        }
        case "open-settings":
          setHelpOpen(false)
          controller.store.openSettings()
          recorder?.settingsOpened()
          return
        case "toggle-help":
          setHelpOpen((open) => !open)
          return
        case "close-help":
          if (helpOpen) setHelpOpen(false)
          return
      }
    },
    [controller, handoff, helpOpen, recorder, renderer],
  )

  const onKey = useCallback(
    (key: KeyEvent) => {
      if (overlayOpen) return

      const command = matchCommand(key, keyboardCapability)
      const shellFocusedNow = controller.store.getState().focusedPane.kind === "shell"

      if (command === "toggle-shell") {
        key.preventDefault()
        runCockpitCommand(command)
        return
      }
      if (command === "close-help" && helpOpen) {
        key.preventDefault()
        runCockpitCommand(command)
        return
      }

      // Once the explicit shell-toggle chord has been consumed, every encodable key
      // belongs to the PTY. This preserves real foreground Ctrl+C semantics.
      if (shellFocusedNow) {
        key.preventDefault()
        setExternalRunNotice(null)
        const bytes = encodeKey(key)
        if (!bytes || !controller.shell.ready) return
        controller.shell.runtime.write(bytes)
        return
      }

      if (command !== null && command !== "close-help") {
        key.preventDefault()
        runCockpitCommand(command)
      }
    },
    [controller, helpOpen, keyboardCapability, overlayOpen, runCockpitCommand],
  )
  useKeyboard(onKey)

  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  useEffect(() => {
    recorder?.tabSelectionSettled()
  }, [focusedSessionId, recorder])
  const focusedRestorationSelector = useMemo(
    () => selectRestoration(focusedSessionId),
    [focusedSessionId],
  )
  const focusedRestoration = useAppSelector(focusedRestorationSelector)
  const focusedAvailabilitySelector = useMemo(
    () => selectConversationAvailability(focusedSessionId),
    [focusedSessionId],
  )
  const focusedAvailability = useAppSelector(focusedAvailabilitySelector)
  const focused = focusedSessionId ? controller.runtime(focusedSessionId) : undefined
  // ConversationView keeps workspace navigation fixed above the transcript;
  // only the transient shell mode needs a fixed pane title here.
  const paneTitle = isShellFocused ? "Shell · focused" : undefined
  const shellFullHeight = isShellFocused && shellBufferType === "alternate"

  return (
    <box
      style={{
        width,
        height,
        position: "relative",
        flexDirection: "column",
        backgroundColor: palette.surface,
        overflow: "hidden",
      }}
    >
      <box
        style={{
          position: "relative",
          flexGrow: 1,
          flexShrink: 1,
          flexDirection: "column",
          border: true,
          borderColor: palette.border,
          backgroundColor: palette.surface,
          paddingLeft: 1,
          paddingRight: 1,
          overflow: "hidden",
        }}
        title={paneTitle}
        titleColor={palette.accent}
      >
        {isShellFocused ? (
          <ShellPane />
        ) : (
          <>
            <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "hidden" }}>
              {focusedSessionId === null ? (
                <EmptyWorkspace />
              ) : focusedAvailability !== null && focusedAvailability.kind !== "ready" && focusedRestoration !== "unavailable" ? (
                <NotReadyNotice error={focused?.ready === false ? focused.error : "Starting agent session…"} />
              ) : (
                (children ?? <ConversationView welcomeBannerVariant={welcomeBannerVariant} workspaceChrome />)
              )}
            </box>
            <ConversationActivity />
          </>
        )}
        {externalRunNotice ? <ExternalRunNoticeView notice={externalRunNotice} /> : null}
      </box>

      {shellFullHeight ? null : <PromptEditor onRunCommand={runCockpitCommand} />}

      {shellFullHeight ? null : <StatusStrip />}

      {helpOpen ? <HelpOverlay capability={keyboardCapability} /> : null}

      <SessionsOverlay />

      <SessionPicker source={sessionPicker} recorder={recorder} />

      <HandoffTargetPicker flow={handoff} />

      <HandoffPreview flow={handoff} />

      <ModelSelect />

      <SettingsView />

      <StatuslineOverlay flow={statusline} />

      <TabDialog />

      {/* Permission remains above ordinary cockpit overlays. */}
      <ApprovalPrompt />

      {/* Last: clarification is the product's top-priority interaction. */}
      <ClarificationPrompt />
    </box>
  )
}

/** A one-line, selectable fallback that overlays the shell without consuming a row. */
function ExternalRunNoticeView({ notice }: { notice: ExternalRunNotice }): ReactNode {
  const palette = usePalette()
  const prefix = notice.copied ? EXTERNAL_RUN_COPIED_PREFIX : EXTERNAL_RUN_FALLBACK_PREFIX
  return (
    <box
      style={{
        position: "absolute",
        left: 1,
        right: 1,
        bottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: palette.surface,
        overflow: "hidden",
      }}
    >
      <text fg={notice.command === null ? palette.muted : palette.text}>
        {notice.command === null ? EXTERNAL_RUN_EMPTY : `${prefix} ${notice.command}`}
      </text>
    </box>
  )
}

/** Why the focused agent is unusable, in the words `checkAgentReadiness` chose. */
function NotReadyNotice({ error }: { error: string }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", gap: 1 }}>
      <text fg={palette.status.not_ready}>This agent is not ready.</text>
      <text fg={palette.text}>{error}</text>
      <text fg={palette.muted}>Use /model to choose another provider.</text>
    </box>
  )
}

/**
 * The help panel: an absolutely-positioned overlay rendered straight from the
 * keymap table, so it can never describe a binding the shell does not have.
 *
 * Escape appears twice, and in precedence order: while the panel is open it closes
 * the panel, and only once the panel is gone does it reach the editor.
 */
export function HelpOverlay({ capability = "unknown" }: { capability?: KeyboardCapability }): ReactNode {
  const palette = usePalette()
  const entries = helpEntries(capability)
  const keysColumnWidth = Math.max(...entries.map((entry) => entry.keys.length)) + 2
  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={HELP_TITLE}
      titleColor={palette.accent}
    >
      {entries.map((entry) => (
        <text key={entry.description}>
          <span fg={palette.accent}>{entry.keys.padEnd(keysColumnWidth)}</span>
          <span fg={palette.text}>{entry.description}</span>
        </text>
      ))}
    </box>
  )
}
