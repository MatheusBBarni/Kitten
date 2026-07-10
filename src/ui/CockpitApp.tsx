/**
 * The cockpit shell: the frame every other view mounts into.
 *
 * The layout is a focused pane, not a split. One agent owns the full-width
 * conversation region at a time and a single chord moves focus between them, which
 * keeps the transcript readable at 80 columns and keeps the mental model small.
 * Beneath it sit the prompt editor and the status strip, both always visible, the
 * one naming what the user is about to say and the other what both agents are doing.
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
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useMemo, useState, type ReactNode } from "react"

import type { SessionController } from "../app/controller.ts"
import { createHandoffFlow } from "../app/handoff.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import { selectFocusedSessionId, selectHasOpenOverlay } from "../store/selectors.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { CockpitProvider, useAppSelector, useController } from "./cockpitContext.tsx"
import { EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import { HandoffPreview } from "./HandoffPreview.tsx"
import { HandoffTargetPicker } from "./HandoffTargetPicker.tsx"
import { PromptEditor } from "./PromptEditor.tsx"
import { SessionsOverlay } from "./SessionsOverlay.tsx"
import { StatusStrip } from "./StatusStrip.tsx"
import { COCKPIT_KEYMAP, HELP_ENTRIES, matchCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** Bottom title of the help overlay; also the phrase the help toggle test looks for. */
export const HELP_TITLE = "Keyboard shortcuts"

/** Props for {@link CockpitApp}. */
export interface CockpitAppProps {
  /** The booted controller. The only channel through which the shell reaches an agent. */
  controller: SessionController
  /** The conversation region's contents - `<ConversationView>` in the real app. */
  children?: ReactNode
  /** Optional telemetry recorder; the hand-off flow records its metrics through it. */
  recorder?: TelemetryRecorder
}

/** The cockpit root: provides the controller, then renders the frame. */
export function CockpitApp({ controller, children, recorder }: CockpitAppProps): ReactNode {
  return (
    <CockpitProvider controller={controller}>
      <CockpitFrame recorder={recorder}>{children}</CockpitFrame>
    </CockpitProvider>
  )
}

/** The frame itself: conversation region, status strip, and the help overlay. */
function CockpitFrame({ children, recorder }: { children?: ReactNode; recorder?: TelemetryRecorder }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { width, height } = useTerminalDimensions()
  const [helpOpen, setHelpOpen] = useState(false)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)

  // One flow for the life of the controller: a hand-off and a later hand-back are the
  // same mechanism pointed the other way, and it derives its direction from focus.
  const handoff = useMemo(() => createHandoffFlow({ controller, recorder }), [controller, recorder])

  const onKey = useCallback(
    (key: KeyEvent) => {
      // A modal overlay owns the keyboard outright. Precedence is declared here rather
      // than left to the framework: global listeners fire in the order they mounted, and
      // this one mounts before the overlays that would otherwise outrank it.
      if (overlayOpen) return

      switch (matchCommand(key)) {
        case "switch-focus":
          controller.actions.switchFocus()
          return
        case "hand-off":
          // The panel would otherwise sit behind the preview with no key left to close
          // it, since the preview spends Escape on discarding the bundle.
          setHelpOpen(false)
          handoff.begin()
          return
        case "sessions":
          // Same reason as the hand-off: the overview is modal and spends Escape on
          // dismissing itself, so close the help panel before it opens.
          setHelpOpen(false)
          controller.store.openSessions()
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
    [controller, handoff, helpOpen, overlayOpen],
  )
  useKeyboard(onKey)

  const focusedSessionId = useAppSelector(selectFocusedSessionId)
  const focused = controller.runtime(focusedSessionId)

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
        title={focused?.displayName ?? focusedSessionId}
        titleColor={palette.accent}
      >
        {focused && !focused.ready ? (
          <NotReadyNotice error={focused.error} />
        ) : (
          (children ?? <text fg={palette.muted}>{EMPTY_TRANSCRIPT_HINT}</text>)
        )}
      </box>

      <PromptEditor />

      <StatusStrip />

      {helpOpen ? <HelpOverlay /> : null}

      <SessionsOverlay />

      <HandoffTargetPicker flow={handoff} />

      <HandoffPreview flow={handoff} />

      {/* Last, so a pending permission request paints over anything else on screen. */}
      <ApprovalPrompt />
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
