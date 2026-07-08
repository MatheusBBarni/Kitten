/**
 * The cockpit's global keymap.
 *
 * These bindings are live wherever the user's cursor is, including inside the
 * prompt editor, so every one of them is either a control chord or a function key -
 * never a bare printable character that the composer would otherwise swallow.
 *
 * The table is the single source of truth for both dispatch and the help panel, so
 * a binding can never drift out of the documentation the user reads.
 */

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

/** One entry of the keymap: what it does, how it reads, and how it matches. */
export interface KeyBinding {
  readonly command: CockpitCommand
  /** How the chord is written in the help panel and the status strip hint. */
  readonly keys: string
  /** One line of prose for the help panel. */
  readonly description: string
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

/** The always-visible hint in the status strip: the keys that matter right now. */
export const KEYMAP_HINT = "^O switch  F1 help"

/** The command a keypress maps to, or `null` when the shell does not claim it. */
export function matchCommand(key: CockpitKey): CockpitCommand | null {
  return COCKPIT_KEYMAP.find((binding) => binding.matches(key))?.command ?? null
}
