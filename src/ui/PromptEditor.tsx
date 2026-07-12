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
 * The editor gives up terminal focus while the shell or a modal overlay owns the
 * keyboard, and takes it back when the agent pane returns. That is not cosmetic:
 * OpenTUI tracks exactly one focused renderable, so the composer must not keep a cursor
 * while shell bytes or preview edits are routed elsewhere. Its draft survives because
 * blurring the textarea does not clear its edit buffer.
 *
 * Bracketed paste never travels the keypress path at all. OpenTUI's stdin parser
 * accumulates everything between the paste markers - across as many stdin chunks as
 * a large paste takes - and hands the textarea one `PasteEvent`, which it inserts
 * whole after stripping ANSI. A pasted newline is therefore text, not a submit.
 */

import type { EditBufferRenderable, KeyEvent, TextareaRenderable } from "@opentui/core"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type { AvailableCommand } from "../core/types.ts"
import {
  selectFocusedSessionId,
  selectHasOpenOverlay,
  selectIsShellFocused,
  selectSessionCommands,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import {
  COCKPIT_COMMANDS,
  matchMenuCommand,
  PROMPT_KEY_BINDINGS,
  type CockpitCommand,
} from "./keymap.ts"
import { SlashMenu, type MenuRow, type SlashMenuGroup } from "./SlashMenu.tsx"
import { usePalette } from "./theme.ts"

/** The composer's frame title while the focused agent can accept a prompt. */
export const PROMPT_TITLE = "Prompt"

/** The composer's frame title while the focused agent cannot accept anything. */
export const PROMPT_DISABLED_TITLE = "Prompt (agent unavailable)"

/** The empty-editor hint while the focused agent is ready. */
export const PROMPT_PLACEHOLDER = "Enter sends, Shift+Enter adds a line, Esc interrupts"

/** The empty-editor hint while the focused agent is not ready. */
export const PROMPT_DISABLED_PLACEHOLDER = "Switch to a ready agent to send a prompt"

/** The composer's visual prompt marker. */
export const PROMPT_CHEVRON = "❯"

const NOOP_RUN_COMMAND = (_command: CockpitCommand): void => {}

/**
 * How tall the editor is when empty.
 *
 * More than one row, because the height tracks *logical* lines: a single long
 * sentence wraps into several visual rows that the editor cannot count in time to
 * grow for them. `virtualLineCount` would say so, but it is only recomputed after the
 * view re-wraps, which happens a pass later than the content-change that would resize
 * it. A two-row floor leaves enough room for ordinary wrapping without making an
 * empty prompt look oversized.
 */
export const MIN_EDITOR_ROWS = 2

/** How tall the editor may grow before it scrolls its own content. */
export const MAX_EDITOR_ROWS = 8

/** Clamp the editor's height to the lines its draft holds, within the budget. */
function editorRows(lines: number): number {
  return Math.min(Math.max(lines, MIN_EDITOR_ROWS), MAX_EDITOR_ROWS)
}

/** A slash token that begins at a prompt token boundary and still owns the cursor. */
export interface SlashToken {
  start: number
  end: number
  filter: string
}

/**
 * Return the slash token at the cursor, never one embedded in a URL, path, or word.
 * A second slash disarms completion so `/usr/bin` stays ordinary prompt text.
 */
export function slashTokenAt(text: string, cursorOffset: number): SlashToken | null {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length))
  let start = cursor
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1
  let end = cursor
  while (end < text.length && !/\s/.test(text[end]!)) end += 1

  const token = text.slice(start, end)
  if (!token.startsWith("/") || token.indexOf("/", 1) !== -1) return null
  return { start, end, filter: token.slice(1) }
}

/** Build the deterministic cockpit-first command rows, filtering a slash token. */
export function slashMenuRows(filter: string, agentCommands: readonly AvailableCommand[]): MenuRow[] {
  const normalized = filter.trim().toLocaleLowerCase()
  const matches = (name: string, description: string): boolean =>
    normalized.length === 0 || name.toLocaleLowerCase().includes(normalized) || description.toLocaleLowerCase().includes(normalized)

  const cockpitRows: MenuRow[] = COCKPIT_COMMANDS
    .filter((command) => matches(command.name, command.description))
    .map((command) => ({
      source: "kitten" as const,
      command: command.command,
      name: command.name,
      description: command.description,
    }))
  const agentRows: MenuRow[] = agentCommands
    .map((command) => ({ ...command, name: command.name.replace(/^\/+/, "") }))
    .filter((command) => command.name.length > 0 && matches(command.name, command.description))
    .map((command) => ({
      source: "agent" as const,
      name: command.name,
      description: command.description,
      ...(command.hint ? { hint: command.hint } : {}),
    }))

  return [...cockpitRows, ...agentRows]
}

function menuGroups(rows: readonly MenuRow[]): SlashMenuGroup[] {
  const kitten = rows.filter((row): row is Extract<MenuRow, { source: "kitten" }> => row.source === "kitten")
  const agent = rows.filter((row): row is Extract<MenuRow, { source: "agent" }> => row.source === "agent")
  return [
    ...(kitten.length > 0 ? [{ source: "Kitten", rows: kitten }] : []),
    ...(agent.length > 0 ? [{ source: "Agent commands", rows: agent }] : []),
  ]
}

/** The multi-line prompt editor, bound to whichever agent currently has focus. */
export function PromptEditor({ onRunCommand = NOOP_RUN_COMMAND }: { onRunCommand?: (command: CockpitCommand) => void }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const focusedSessionId = useAppSelector(selectFocusedSessionId)

  // Curried selectors build a new function per call; memoize so the subscription
  // follows focus rather than tearing down and rebuilding on every render.
  const statusSelector = useMemo(() => selectSessionStatus(focusedSessionId), [focusedSessionId])
  const status = useAppSelector(statusSelector)
  const commandsSelector = useMemo(() => selectSessionCommands(focusedSessionId), [focusedSessionId])
  const agentCommands = useAppSelector(commandsSelector)

  // Readiness is a boot-time fact about the connection, not a store slice: a session
  // whose handshake failed has no ACP session, so nothing may be sent to it.
  const ready = controller.isReady(focusedSessionId)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)
  const isShellFocused = useAppSelector(selectIsShellFocused)

  const textarea = useRef<TextareaRenderable | null>(null)
  const [rows, setRows] = useState(MIN_EDITOR_ROWS)
  const [menu, setMenu] = useState<SlashToken & { selected: number } | null>(null)

  const matchingRows = useMemo(
    () => slashMenuRows(menu?.filter ?? "", agentCommands),
    [agentCommands, menu?.filter],
  )
  const armedMenu = menu !== null && matchingRows.length > 0 ? menu : null
  const highlighted = Math.min(armedMenu?.selected ?? 0, Math.max(matchingRows.length - 1, 0))

  const syncRows = useCallback((editor = textarea.current): void => {
    if (!editor) return
    const next = editorRows(Math.max(editor.lineCount, editor.virtualLineCount))
    setRows((current) => (current === next ? current : next))
  }, [])

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

  const selectMenuRow = useCallback((): void => {
    const editor = textarea.current
    if (!editor || !armedMenu) return
    const row = matchingRows[highlighted]
    if (!row) return

    if (row.source === "kitten") {
      editor.setSelection(armedMenu.start, armedMenu.end)
      editor.deleteSelection()
      setMenu(null)
      syncRows(editor)
      onRunCommand(row.command)
      return
    }

    editor.setSelection(armedMenu.start, armedMenu.end)
    editor.insertText(`/${row.name} `)
    setMenu(null)
    syncRows(editor)
  }, [armedMenu, highlighted, matchingRows, onRunCommand, syncRows])

  const onKeyDown = useCallback(
    (key: KeyEvent): void => {
      if (armedMenu) {
        const command = matchMenuCommand(key)
        if (command !== null) {
          key.preventDefault()
          switch (command) {
            case "prev-option":
              setMenu((current) => current ? { ...current, selected: Math.max(current.selected - 1, 0) } : current)
              return
            case "next-option":
              setMenu((current) => current ? { ...current, selected: Math.min(current.selected + 1, Math.max(matchingRows.length - 1, 0)) } : current)
              return
            case "confirm":
              selectMenuRow()
              return
            case "dismiss":
              setMenu(null)
              return
          }
        }
      }
      if (key.name !== "escape" || key.ctrl || key.meta || key.shift) return
      // Escape only means "interrupt" when there is a turn to interrupt. Idle, it
      // stays free for whatever the shell or a future overlay wants to do with it.
      if (status !== "working") return
      key.preventDefault()
      void controller.actions.cancel()
    },
    [armedMenu, controller, matchingRows.length, selectMenuRow, status],
  )

  // Keep visual and input height in sync after both content and layout changes. A
  // long word can occupy several virtual rows even though it is only one logical line.
  const onContentChange = useCallback((): void => {
    const editor = textarea.current
    if (!editor) return

    if (editor.plainText === "!" && editor.cursorOffset === 1) {
      editor.clear()
      setMenu(null)
      syncRows(editor)
      onRunCommand("toggle-shell")
      return
    }

    syncRows(editor)
    const token = slashTokenAt(editor.plainText, editor.cursorOffset)
    if (token === null || slashMenuRows(token.filter, agentCommands).length === 0) {
      setMenu(null)
      return
    }
    setMenu({ ...token, selected: 0 })
  }, [agentCommands, onRunCommand, syncRows])

  const onSizeChange = useCallback(
    function onSizeChange(this: EditBufferRenderable): void {
      const next = editorRows(Math.max(this.lineCount, this.virtualLineCount))
      setRows((current) => (current === next ? current : next))
    },
    [syncRows],
  )

  return (
    <box
      borderStyle="rounded"
      style={{
        position: "relative",
        flexShrink: 0,
        flexDirection: "row",
        gap: 1,
        border: true,
        borderColor: ready ? palette.border : palette.status.not_ready,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        overflow: "visible",
      }}
      title={ready ? PROMPT_TITLE : PROMPT_DISABLED_TITLE}
      titleColor={ready ? palette.accent : palette.status.not_ready}
    >
      {armedMenu ? (
        <box style={{ position: "absolute", left: 0, right: 0, bottom: rows + 2, zIndex: 1 }}>
          <SlashMenu groups={menuGroups(matchingRows)} highlightedIndex={highlighted} onSelect={selectMenuRow} />
        </box>
      ) : null}
      <text fg={ready ? palette.accent : palette.status.not_ready}>{PROMPT_CHEVRON}</text>
      <textarea
        ref={textarea}
        focused={!overlayOpen && !isShellFocused}
        style={{
          flexGrow: 1,
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
        onSizeChange={onSizeChange}
      />
    </box>
  )
}
