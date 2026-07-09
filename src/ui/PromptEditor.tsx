/**
 * The composer: where the developer writes to whichever agent has focus.
 *
 * Everything the editor does reaches an agent through `controller.actions` and
 * nothing else (ADR-003). Submitting calls `sendPrompt`; Escape, while that agent is
 * mid-turn, calls `cancel`. The editor holds no draft in React state - the textarea's
 * own edit buffer is the draft, read once on submit - so a keystroke repaints the
 * renderable without waking the reconciler.
 *
 * Key precedence is the framework's, not ours. The shell's global `useKeyboard`
 * listeners run before any focused renderable sees a key, so the help overlay can
 * `preventDefault()` Escape and the editor never fires. What the shell leaves alone
 * reaches this textarea: printable characters, Enter and Shift+Enter (rebound in
 * `PROMPT_KEY_BINDINGS`), and Escape.
 *
 * The editor gives up the terminal's focus while a modal overlay is open, and takes it
 * back when the overlay closes. That is not merely cosmetic: the hand-off preview owns
 * a textarea of its own, and OpenTUI tracks exactly one focused renderable - so without
 * this the composer would keep the cursor while the preview's summary editor typed, and
 * would be left blurred once the preview unmounted. The draft survives, because the
 * draft is the textarea's buffer and blurring does not clear it.
 *
 * Bracketed paste never travels the keypress path at all. OpenTUI's stdin parser
 * accumulates everything between the paste markers - across as many stdin chunks as
 * a large paste takes - and hands the textarea one `PasteEvent`, which it inserts
 * whole after stripping ANSI. A pasted newline is therefore text, not a submit.
 */

import type { KeyEvent, TextareaRenderable } from "@opentui/core"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import { selectAgentStatus, selectFocusedAgentId, selectHasOpenOverlay } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { PROMPT_KEY_BINDINGS } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** The composer's frame title while the focused agent can accept a prompt. */
export const PROMPT_TITLE = "Prompt"

/** The composer's frame title while the focused agent cannot accept anything. */
export const PROMPT_DISABLED_TITLE = "Prompt (agent unavailable)"

/** The empty-editor hint while the focused agent is ready. */
export const PROMPT_PLACEHOLDER = "Enter sends, Shift+Enter adds a line, Esc interrupts"

/** The empty-editor hint while the focused agent is not ready. */
export const PROMPT_DISABLED_PLACEHOLDER = "Switch to a ready agent to send a prompt"

/**
 * How tall the editor is when empty.
 *
 * More than one row, because the height tracks *logical* lines: a single long
 * sentence wraps into several visual rows that the editor cannot count in time to
 * grow for them. `virtualLineCount` would say so, but it is only recomputed after the
 * view re-wraps, which happens a pass later than the content-change that would resize
 * it. A floor of three rows covers the ordinary wrapped prompt.
 */
export const MIN_EDITOR_ROWS = 3

/** How tall the editor may grow before it scrolls its own content. */
export const MAX_EDITOR_ROWS = 10

/** Clamp the editor's height to the lines its draft holds, within the budget. */
function editorRows(lines: number): number {
  return Math.min(Math.max(lines, MIN_EDITOR_ROWS), MAX_EDITOR_ROWS)
}

/** The multi-line prompt editor, bound to whichever agent currently has focus. */
export function PromptEditor(): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const focusedAgentId = useAppSelector(selectFocusedAgentId)

  // Curried selectors build a new function per call; memoize so the subscription
  // follows focus rather than tearing down and rebuilding on every render.
  const statusSelector = useMemo(() => selectAgentStatus(focusedAgentId), [focusedAgentId])
  const status = useAppSelector(statusSelector)

  // Readiness is a boot-time fact about the connection, not a store slice: an agent
  // whose handshake failed has no session, so nothing may be sent to it.
  const ready = controller.isReady(focusedAgentId)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)

  const textarea = useRef<TextareaRenderable | null>(null)
  const [rows, setRows] = useState(MIN_EDITOR_ROWS)

  const submit = useCallback((): void => {
    const editor = textarea.current
    if (!editor || !ready) return

    const text = editor.plainText
    // A stray Enter on an empty or whitespace-only buffer must not start a turn.
    if (text.trim().length === 0) return

    // Clear before awaiting: `sendPrompt` records the user's turn synchronously, so
    // the transcript already shows the message the composer just gave up.
    editor.clear()
    setRows(MIN_EDITOR_ROWS)
    void controller.actions.sendPrompt(text)
  }, [controller, ready])

  const onKeyDown = useCallback(
    (key: KeyEvent): void => {
      if (key.name !== "escape" || key.ctrl || key.meta || key.shift) return
      // Escape only means "interrupt" when there is a turn to interrupt. Idle, it
      // stays free for whatever the shell or a future overlay wants to do with it.
      if (status !== "working") return
      key.preventDefault()
      void controller.actions.cancel()
    },
    [controller, status],
  )

  // Grow with the draft, so a multi-line prompt is visible while it is written.
  const onContentChange = useCallback((): void => {
    const editor = textarea.current
    if (editor) setRows(editorRows(editor.lineCount))
  }, [])

  return (
    <box
      style={{
        flexShrink: 0,
        flexDirection: "column",
        border: true,
        borderColor: ready ? palette.border : palette.status.not_ready,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={ready ? PROMPT_TITLE : PROMPT_DISABLED_TITLE}
      titleColor={ready ? palette.accent : palette.status.not_ready}
    >
      <textarea
        ref={textarea}
        focused={!overlayOpen}
        style={{
          height: rows,
          wrapMode: "word",
          textColor: palette.text,
          cursorColor: palette.accent,
          placeholderColor: palette.muted,
        }}
        placeholder={ready ? PROMPT_PLACEHOLDER : PROMPT_DISABLED_PLACEHOLDER}
        keyBindings={PROMPT_KEY_BINDINGS}
        onSubmit={submit}
        onKeyDown={onKeyDown}
        onContentChange={onContentChange}
      />
    </box>
  )
}
