/**
 * The cockpit shell: the frame every other view mounts into.
 *
 * The layout is a focused pane, not a split. One agent conversation or the integrated
 * shell owns the full-width main region at a time; dedicated chords move between
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
 * The hand-off is the product (PRD F3). Its keystroke lives in the same table as every
 * other chord and does nothing but open the flow - a target picker when the fleet gives
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
import type { BannerVariant } from "../config/appState.ts"
import { encodeKey } from "../shell/keyEncoder.ts"
import type { Selector } from "../store/appStore.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import {
  selectFocusedSessionId,
  selectHasOpenOverlay,
  selectIsShellFocused,
  selectRestoration,
} from "../store/selectors.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { CockpitProvider, useAppSelector, useController, useShellBufferType } from "./cockpitContext.tsx"
import { ConversationView } from "./ConversationView.tsx"
import { HandoffPreview } from "./HandoffPreview.tsx"
import { HandoffTargetPicker } from "./HandoffTargetPicker.tsx"
import { ModelSelect } from "./ModelSelect.tsx"
import { PromptEditor } from "./PromptEditor.tsx"
import { SessionPicker, type SessionPickerSource } from "./SessionPicker.tsx"
import { ShellPane } from "./ShellPane.tsx"
import { SessionsOverlay } from "./SessionsOverlay.tsx"
import { SettingsView } from "./SettingsView.tsx"
import { StatusStrip } from "./StatusStrip.tsx"
import { COCKPIT_KEYMAP, HELP_ENTRIES, matchCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** Bottom title of the help overlay; also the phrase the help toggle test looks for. */
export const HELP_TITLE = "Keyboard shortcuts"

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
  /** Saved-run persistence boundary and project identity for the Ctrl+R picker. */
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

  const onKey = useCallback(
    (key: KeyEvent) => {
      // A modal overlay owns the keyboard outright. Precedence is declared here rather
      // than left to the framework: global listeners fire in the order they mounted, and
      // this one mounts before the overlays that would otherwise outrank it.
      if (overlayOpen) return

      const command = matchCommand(key)
      const shellFocusedNow = controller.store.getState().focusedPane.kind === "shell"

      // The shell toggle stays Kitten-owned from either pane. Close local help before
      // moving focus so no agent-only overlay remains painted over the shell.
      if (command === "toggle-shell") {
        key.preventDefault()
        setHelpOpen(false)
        setExternalRunNotice(null)
        controller.store.setFocusedPane(
          shellFocusedNow
            ? { kind: "agent", agentId: controller.store.getState().focusedSessionId }
            : { kind: "shell" },
        )
        return
      }

      // F3 is Kitten-owned only while the shell is focused. Copying via OSC 52 keeps
      // command content local to the terminal; telemetry receives only the intent.
      if (command === "run-externally") {
        if (!shellFocusedNow) return
        key.preventDefault()
        const commandText = controller.store.getState().shell.commands.at(-1)?.command.trim() ?? ""
        if (commandText.length === 0) {
          setExternalRunNotice({ command: null, copied: false })
          return
        }
        let copied = false
        try {
          copied = renderer.copyToClipboardOSC52(commandText)
        } catch {
          // A terminal without a usable clipboard still gets the visible command.
        }
        setExternalRunNotice({ command: commandText, copied })
        recorder?.externalRun()
        return
      }

      // Shell focus is modal with respect to cockpit chords: after the reserved
      // toggle/external-run actions, every encodable key belongs to the PTY,
      // including Ctrl+C (0x03).
      if (shellFocusedNow) {
        key.preventDefault()
        setExternalRunNotice(null)
        const bytes = encodeKey(key)
        if (!bytes || !controller.shell.ready) return
        controller.shell.runtime.write(bytes)
        return
      }

      switch (command) {
        case "switch-focus":
          controller.actions.switchFocus()
          return
        case "hand-off":
          // The panel would otherwise sit behind the preview with no key left to close
          // it, since the preview spends Escape on discarding the bundle.
          if (handoff.begin().ok) setHelpOpen(false)
          return
        case "sessions":
          // Same reason as the hand-off: the overview is modal and spends Escape on
          // dismissing itself, so close the help panel before it opens.
          setHelpOpen(false)
          controller.store.openSessions()
          return
        case "resume-session":
          key.preventDefault()
          setHelpOpen(false)
          recorder?.resumePickerOpened()
          controller.store.openSessionPicker()
          return
        case "start-new-run":
          key.preventDefault()
          setHelpOpen(false)
          {
            const state = controller.store.getState()
            const sessionId = state.focusedSessionId
            const bundle = state.restorationBundle
            if (state.restoration[sessionId] === "unavailable" && bundle) {
              const blocks = composeHandoffBlocks(bundle, createHandoffEdits(bundle))
              void controller.actions.startFreshFromContext(blocks, sessionId)
            } else {
              void controller.actions.startNewRun()
            }
          }
          return
        case "model-select":
          // The selector is modal too and spends Escape on closing itself, so the help
          // panel must stand down first. It always opens for the focused pane; an agent
          // that advertises no visible options simply shows an empty selector.
          setHelpOpen(false)
          controller.store.openModelSelect({ sessionId: controller.store.getState().focusedSessionId })
          return
        case "open-settings":
          // Settings is modal and spends Escape on closing itself, so help cannot
          // remain open behind it. Record reach only after the store slot opens.
          setHelpOpen(false)
          controller.store.openSettings()
          recorder?.settingsOpened()
          return
        case "toggle-help":
          setHelpOpen((open) => !open)
          return
        case "close-help":
          // Escape belongs to the editor and the overlays unless help is showing.
          // Consuming it here stops the focused textarea from ever seeing the key,
          // so dismissing help cannot also interrupt a working agent.
          if (!helpOpen) return
          key.preventDefault()
          setHelpOpen(false)
          return
        default:
          return
      }
    },
    [controller, handoff, helpOpen, overlayOpen, recorder, renderer],
  )
  useKeyboard(onKey)

  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const focusedRestorationSelector = useMemo(
    () => selectRestoration(focusedSessionId),
    [focusedSessionId],
  )
  const focusedRestoration = useAppSelector(focusedRestorationSelector)
  const focused = controller.runtime(focusedSessionId)
  const paneTitle = isShellFocused ? "Shell · focused" : (focused?.displayName ?? focusedSessionId)
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
          <>
            <ShellPane />
            {externalRunNotice ? <ExternalRunNoticeView notice={externalRunNotice} /> : null}
          </>
        ) : focused && !focused.ready && focusedRestoration !== "unavailable" ? (
          <NotReadyNotice error={focused.error} />
        ) : (
          (children ?? <ConversationView welcomeBannerVariant={welcomeBannerVariant} />)
        )}
      </box>

      {shellFullHeight ? null : <PromptEditor />}

      {shellFullHeight ? null : <StatusStrip />}

      {helpOpen ? <HelpOverlay /> : null}

      <SessionsOverlay />

      <SessionPicker source={sessionPicker} recorder={recorder} />

      <HandoffTargetPicker flow={handoff} />

      <HandoffPreview flow={handoff} />

      <ModelSelect />

      <SettingsView />

      {/* Last, so a pending permission request paints over anything else on screen. */}
      <ApprovalPrompt />
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
      <text fg={palette.muted}>{`Press ${COCKPIT_KEYMAP[0]!.keys} to switch to the other agent.`}</text>
    </box>
  )
}

/** Widest chord in the table, so the description column lines up under any binding. */
const KEYS_COLUMN_WIDTH = Math.max(...HELP_ENTRIES.map((entry) => entry.keys.length)) + 2

/**
 * The help panel: an absolutely-positioned overlay rendered straight from the
 * keymap table, so it can never describe a binding the shell does not have.
 *
 * Escape appears twice, and in precedence order: while the panel is open it closes
 * the panel, and only once the panel is gone does it reach the editor.
 */
export function HelpOverlay(): ReactNode {
  const palette = usePalette()
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
      {HELP_ENTRIES.map((entry) => (
        <text key={entry.description}>
          <span fg={palette.accent}>{entry.keys.padEnd(KEYS_COLUMN_WIDTH)}</span>
          <span fg={palette.text}>{entry.description}</span>
        </text>
      ))}
    </box>
  )
}
