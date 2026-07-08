/**
 * The cockpit shell: the frame every other view mounts into.
 *
 * The layout is a focused pane, not a split. One agent owns the full-width
 * conversation region at a time and a single chord moves focus between them, which
 * keeps the transcript readable at 80 columns and keeps the mental model small.
 * Beneath it sit the prompt editor and the status strip, both always visible, the
 * one naming what the user is about to say and the other what both agents are doing.
 * Overlays (help and the approval prompt here, the hand-off preview in a later task)
 * are absolutely-positioned boxes, since the React binding ships no Portal (ADR-004).
 * The approval prompt is modal and swallows every key it sees, so the shell's own
 * chords simply never fire while a permission request is pending.
 *
 * The frame is sized from the live terminal dimensions rather than percentages, so
 * a resize re-lays the whole tree out in one pass and nothing is left painted
 * outside the new viewport.
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useState, type ReactNode } from "react"

import type { SessionController } from "../app/controller.ts"
import { selectFocusedAgentId, selectIsApprovalOpen } from "../store/selectors.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { CockpitProvider, useAppSelector, useController } from "./cockpitContext.tsx"
import { EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import { PromptEditor } from "./PromptEditor.tsx"
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
}

/** The cockpit root: provides the controller, then renders the frame. */
export function CockpitApp({ controller, children }: CockpitAppProps): ReactNode {
  return (
    <CockpitProvider controller={controller}>
      <CockpitFrame>{children}</CockpitFrame>
    </CockpitProvider>
  )
}

/** The frame itself: conversation region, status strip, and the help overlay. */
function CockpitFrame({ children }: { children?: ReactNode }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { width, height } = useTerminalDimensions()
  const [helpOpen, setHelpOpen] = useState(false)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)

  const onKey = useCallback(
    (key: KeyEvent) => {
      // A pending permission request owns the keyboard outright. Precedence is declared
      // here rather than left to the framework: global listeners fire in the order they
      // mounted, and this one mounts before the overlay that would otherwise outrank it.
      if (approvalOpen) return

      switch (matchCommand(key)) {
        case "switch-focus":
          controller.actions.switchFocus()
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
    [approvalOpen, controller, helpOpen],
  )
  useKeyboard(onKey)

  const focusedAgentId = useAppSelector(selectFocusedAgentId)
  const focused = controller.runtime(focusedAgentId)

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
        title={focused?.displayName ?? focusedAgentId}
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
