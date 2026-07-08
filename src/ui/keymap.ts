/**
 * The cockpit's global keymap.
 *
 * These bindings are live wherever the user's cursor is, including inside the
 * prompt editor, so every one of them is either a control chord or a function key -
 * never a bare printable character that the composer would otherwise swallow.
 *
 * The table is the single source of truth for both dispatch and the help panel, so
 * a binding can never drift out of the documentation the user reads. The prompt
 * editor's own keys live here too: it is a focused renderable rather than a global
 * listener, so its bindings are declared (`PROMPT_KEY_BINDINGS`) and documented
 * (`EDITOR_KEYMAP`) side by side instead of being buried in the component.
 *
 * The approval overlay's keys (`APPROVAL_KEYMAP`) are the exception to the chord rule:
 * while that overlay is up it swallows every keypress, so plain arrows, Enter, and
 * digits are its to spend without ever reaching the composer.
 */

import type { KeyBinding as TextareaKeyBinding } from "@opentui/core"

/**
 * The subset of an OpenTUI `KeyEvent` a binding inspects.
 *
 * Declared structurally rather than importing `KeyEvent`, so a binding is a pure
 * predicate over a plain object and stays trivially testable.
 */
export interface CockpitKey {
  readonly name: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/** Every intent the shell itself handles. Overlays and the editor own their own keys. */
export type CockpitCommand = "switch-focus" | "toggle-help" | "close-help"

/** Every intent the approval overlay handles while it is on screen. */
export type ApprovalCommand = "prev-option" | "next-option" | "confirm" | "cancel"

/** One row of the help panel: the chord and what it does. */
export interface HelpEntry {
  /** How the chord is written in the help panel and the status strip hint. */
  readonly keys: string
  /** One line of prose for the help panel. */
  readonly description: string
}

/** One entry of a keymap: what it does, how it reads, and how it matches. */
export interface KeyBinding<Command extends string = CockpitCommand> extends HelpEntry {
  readonly command: Command
  readonly matches: (key: CockpitKey) => boolean
}

/** A plain, unmodified press of `name`. */
function plain(name: string): (key: CockpitKey) => boolean {
  return (key) => key.name === name && !key.ctrl && !key.meta && !key.shift
}

/** `Ctrl` plus `name`, with no other modifier. */
function ctrl(name: string): (key: CockpitKey) => boolean {
  return (key) => key.name === name && key.ctrl && !key.meta && !key.shift
}

/**
 * The bindings, in help-panel order.
 *
 * `close-help` is reported for Escape unconditionally; the shell acts on it only
 * while the help panel is open, leaving Escape free for the editor and overlays.
 */
export const COCKPIT_KEYMAP: readonly KeyBinding[] = [
  {
    command: "switch-focus",
    keys: "Ctrl+O",
    description: "Switch focus to the other agent",
    matches: ctrl("o"),
  },
  {
    command: "toggle-help",
    keys: "F1",
    description: "Show or hide this help panel",
    matches: plain("f1"),
  },
  {
    command: "close-help",
    keys: "Esc",
    description: "Close the help panel",
    matches: plain("escape"),
  },
]

/**
 * The prompt editor's textarea bindings, overriding OpenTUI's defaults.
 *
 * OpenTUI ships Enter as newline and Meta+Enter as submit. Power users of coding
 * agents expect the inverse, so Enter submits and Shift+Enter breaks the line - the
 * convention the PRD names. Both keypad variants are bound because a terminal may
 * report either. Escape is deliberately absent: the editor interrupts the agent
 * rather than editing the buffer, which the component handles as a key listener.
 *
 * Only a terminal speaking the Kitty keyboard protocol can distinguish Shift+Enter
 * from Enter. Elsewhere Enter submits and the user reaches for Alt+Enter, still
 * bound to `newline` by OpenTUI's defaults, which this table merges over.
 *
 * Typed mutable, not `readonly`, because that is the array type OpenTUI's `keyBindings`
 * prop accepts. It copies the bindings into a lookup map and never writes to them, so
 * one module-level array can be shared across renders without the textarea rebuilding
 * that map on every pass.
 */
export const PROMPT_KEY_BINDINGS: TextareaKeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "kpenter", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "kpenter", shift: true, action: "newline" },
]

/**
 * The editor's keys, for the help panel.
 *
 * They carry no `matches` predicate because the shell never dispatches them: the
 * focused textarea consumes Enter and Shift+Enter through `PROMPT_KEY_BINDINGS`, and
 * the editor claims Escape only while the focused agent is working.
 */
export const EDITOR_KEYMAP: readonly HelpEntry[] = [
  { keys: "Enter", description: "Send the prompt to the focused agent" },
  { keys: "Shift+Enter", description: "Insert a newline in the prompt" },
  { keys: "Esc", description: "Interrupt the agent while it is working" },
]

/**
 * The approval overlay's keys, live only while a permission request is on screen.
 *
 * The overlay is modal: it is the one place the user grants an agent write access to
 * their files, so it consumes every keypress and none of these bindings can collide
 * with the shell's or the editor's. Enter therefore means "choose", not "send", and
 * Escape means "decide nothing", not "interrupt", for exactly as long as the overlay
 * lives. Plain arrow keys and digits are safe here for the same reason.
 */
export const APPROVAL_KEYMAP: readonly KeyBinding<ApprovalCommand>[] = [
  {
    command: "prev-option",
    keys: "↑",
    description: "Highlight the previous permission option",
    matches: plain("up"),
  },
  {
    command: "next-option",
    keys: "↓",
    description: "Highlight the next permission option",
    matches: plain("down"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Answer the agent with the highlighted option",
    matches: (key) => (key.name === "return" || key.name === "kpenter") && !key.ctrl && !key.meta && !key.shift,
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Dismiss the request without deciding",
    matches: plain("escape"),
  },
]

/** How many options a digit can reach. Beyond this the user arrows to the option. */
const MAX_DIGIT_OPTIONS = 9

/**
 * Everything the help panel lists: the shell's chords, then the editor's.
 *
 * The approval overlay's keys are deliberately absent. It is modal, so F1 cannot open
 * this panel while those keys are live, and they do nothing while it is closed - a row
 * here would describe a binding that is never true when the reader can read it. The
 * overlay prints `APPROVAL_HINT` instead, in the one state where the keys work.
 */
export const HELP_ENTRIES: readonly HelpEntry[] = [...COCKPIT_KEYMAP, ...EDITOR_KEYMAP]

/** The always-visible hint in the status strip: the keys that matter right now. */
export const KEYMAP_HINT = "^O switch  F1 help"

/** The hint printed inside the approval overlay, where those keys are the only live ones. */
export const APPROVAL_HINT = `↑↓ move  Enter choose  1-${MAX_DIGIT_OPTIONS} pick  Esc cancel`

/** The command a keypress maps to, or `null` when the shell does not claim it. */
export function matchCommand(key: CockpitKey): CockpitCommand | null {
  return COCKPIT_KEYMAP.find((binding) => binding.matches(key))?.command ?? null
}

/** The overlay command a keypress maps to, or `null` when the overlay does not claim it. */
export function matchApprovalCommand(key: CockpitKey): ApprovalCommand | null {
  return APPROVAL_KEYMAP.find((binding) => binding.matches(key))?.command ?? null
}

/**
 * The zero-based option a digit key names, or `null` for any other key.
 *
 * `9` is the last reachable option; a tenth would need a second digit and a timeout,
 * which is not a trade worth making on a dialog this small.
 */
export function approvalOptionIndex(key: CockpitKey): number | null {
  if (key.ctrl || key.meta || key.shift || key.name.length !== 1) return null
  const digit = Number.parseInt(key.name, 10)
  if (!Number.isInteger(digit) || digit < 1 || digit > MAX_DIGIT_OPTIONS) return null
  return digit - 1
}
