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
 * The overlays' keys (`APPROVAL_KEYMAP`, `HANDOFF_KEYMAP`, `SETTINGS_KEYMAP`, and
 * the other modal keymaps below) are the exception to the chord rule: while an
 * overlay is up it swallows every keypress, so plain arrows, Enter, Space, digits,
 * and even a bare letter are its to spend without ever reaching the composer.
 *
 * `Ctrl+,` follows the familiar settings convention, but a legacy terminal cannot
 * deliver that chord distinctly. It reaches Kitten only when the terminal speaks
 * the Kitty keyboard protocol; the help and status hint still document the binding.
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
export type CockpitCommand =
  | "toggle-shell"
  | "run-externally"
  | "switch-focus"
  | "hand-off"
  | "sessions"
  | "resume-session"
  | "start-new-run"
  | "model-select"
  | "open-settings"
  | "toggle-help"
  | "close-help"

/** Every intent the model/effort selector handles while it is on screen. */
export type ModelSelectCommand = "prev-option" | "next-option" | "confirm" | "cancel"

/** Every intent the approval overlay handles while it is on screen. */
export type ApprovalCommand = "prev-option" | "next-option" | "confirm" | "cancel"

/** Every intent the settings overlay handles while it is on screen. */
export type SettingsCommand = "prev-option" | "next-option" | "switch-tab" | "reset-to-default" | "close"

/** Every intent the hand-off preview handles while it is on screen. */
export type HandoffCommand =
  | "prev-item"
  | "next-item"
  | "toggle-item"
  | "edit-target-config"
  | "edit-summary"
  | "confirm"
  | "cancel"

/** Every intent the Ctrl+S sessions overview handles while it is on screen. */
export type SessionsCommand = "prev-session" | "next-session" | "jump-into" | "jump-next-needy" | "cancel"

/** Every intent the Ctrl+R saved-run picker handles while it is on screen. */
export type SessionPickerCommand =
  | "prev-run"
  | "next-run"
  | "preview"
  | "restore"
  | "delete-run"
  | "delete-all"
  | "cancel"

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

/** A plain, unmodified press of any one of `names` - for a key a terminal may report under more than one name. */
function plainAny(...names: string[]): (key: CockpitKey) => boolean {
  return (key) => names.includes(key.name) && !key.ctrl && !key.meta && !key.shift
}

/** A plain, unmodified press of `name`. */
function plain(name: string): (key: CockpitKey) => boolean {
  return plainAny(name)
}

/** `Ctrl` plus `name`, with no other modifier. */
function ctrl(name: string): (key: CockpitKey) => boolean {
  return (key) => key.name === name && key.ctrl && !key.meta && !key.shift
}

/** Match when any one of the supplied predicates claims the key. */
function any(...predicates: readonly ((key: CockpitKey) => boolean)[]): (key: CockpitKey) => boolean {
  return (key) => predicates.some((predicate) => predicate(key))
}

/**
 * The bindings, in help-panel order.
 *
 * `close-help` is reported for Escape unconditionally; the shell acts on it only
 * while the help panel is open, leaving Escape free for the editor and overlays.
 */
export const COCKPIT_KEYMAP: readonly KeyBinding[] = [
  {
    // Legacy terminals collapse Ctrl+` into the same NUL byte as Ctrl+Space/Ctrl+@,
    // so F2 is the documented fallback when the Kitty keyboard protocol is absent.
    command: "toggle-shell",
    keys: "Ctrl+` / F2",
    description: "Focus the shell; its keys route there and Ctrl+C interrupts",
    matches: any(ctrl("`"), ctrl("grave"), plain("f2")),
  },
  {
    command: "run-externally",
    keys: "F3",
    description: "Copy the latest shell command for an external terminal",
    matches: plain("f3"),
  },
  {
    command: "switch-focus",
    keys: "Ctrl+O",
    description: "Switch focus to the other agent",
    matches: ctrl("o"),
  },
  {
    // Ctrl+T for "transfer". The obvious mnemonic, Ctrl+H, is the ASCII backspace a
    // terminal sends for the Backspace key, so binding it would eat a correction in
    // the composer on every terminal that does not speak the Kitty protocol.
    command: "hand-off",
    keys: "Ctrl+T",
    description: "Curate shell cwd/commands in hand-off preview with Space",
    matches: ctrl("t"),
  },
  {
    command: "sessions",
    keys: "Ctrl+S",
    description: "Show every session and jump to the one that needs you",
    matches: ctrl("s"),
  },
  {
    command: "resume-session",
    keys: "Ctrl+R",
    description: "Find and resume a saved run for this project",
    matches: ctrl("r"),
  },
  {
    command: "start-new-run",
    keys: "Ctrl+N",
    description: "Start a new run with fresh agent sessions",
    matches: ctrl("n"),
  },
  {
    // Ctrl+E for "effort" - and the model that composes with it. Ctrl+M is unusable
    // (a terminal sends it for carriage return, so it would fire on every Enter), and
    // Ctrl+O/Ctrl+T/Ctrl+S are already spoken for; Ctrl+E is free of both the reserved
    // ASCII control codes and the shell's other chords.
    command: "model-select",
    keys: "Ctrl+E",
    description: "Choose the model and reasoning effort for the focused agent",
    matches: ctrl("e"),
  },
  {
    // Unlike alphabetic Ctrl chords, Ctrl+, has no legacy control-byte encoding.
    // OpenTUI can deliver it only through the Kitty keyboard protocol.
    command: "open-settings",
    keys: "Ctrl+,",
    description: "Open settings",
    matches: ctrl(","),
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
    matches: plainAny("return", "kpenter"),
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
 * The hand-off preview's keys, live only while the preview is on screen.
 *
 * Like the approval overlay, the preview is modal, so plain keys are safe: nothing
 * reaches the composer while a bundle is waiting to be sent. That buys `Space` for
 * keep/drop and a bare `e` for opening the summary editor, which are the two things
 * the developer does most.
 *
 * `edit-summary` is the one binding that changes what the rest of them mean. Inside
 * the summary editor every key is text - the developer is writing the brief - so the
 * preview hands the keyboard to the textarea and keeps only Escape, which is how they
 * come back out. That is why Escape is bound to `cancel` here and interpreted as
 * "leave the editor" while editing: one key, one way out, whichever layer is on top.
 */
export const HANDOFF_KEYMAP: readonly KeyBinding<HandoffCommand>[] = [
  {
    command: "prev-item",
    keys: "↑",
    description: "Highlight the previous file or diff",
    matches: plain("up"),
  },
  {
    command: "next-item",
    keys: "↓",
    description: "Highlight the next file or diff",
    matches: plain("down"),
  },
  {
    command: "toggle-item",
    keys: "Space",
    description: "Keep or drop the highlighted file or diff",
    matches: plain("space"),
  },
  {
    command: "edit-target-config",
    keys: "m",
    description: "Choose the target model and reasoning effort",
    matches: plain("m"),
  },
  {
    command: "edit-summary",
    keys: "e",
    description: "Edit the summary the target agent will read",
    matches: plain("e"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Send the bundle and switch focus to the target agent",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Discard the hand-off without sending anything",
    matches: plain("escape"),
  },
]

/**
 * The sessions overview's keys, live only while the Ctrl+S overview is on screen.
 *
 * Like the approval and hand-off overlays, the overview is modal, so plain keys are
 * safe: nothing reaches the composer while the fleet list is up. Enter jumps focus
 * into the highlighted session; a bare `n` skips straight to the next session that
 * needs the developer (`selectNextNeedy`), which is the whole reason the overview
 * exists; Escape dismisses it without moving focus.
 */
export const SESSIONS_KEYMAP: readonly KeyBinding<SessionsCommand>[] = [
  {
    command: "prev-session",
    keys: "↑",
    description: "Highlight the previous session",
    matches: plain("up"),
  },
  {
    command: "next-session",
    keys: "↓",
    description: "Highlight the next session",
    matches: plain("down"),
  },
  {
    command: "jump-into",
    keys: "Enter",
    description: "Jump focus into the highlighted session",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "jump-next-needy",
    keys: "n",
    description: "Jump to the next session that needs you",
    matches: plain("n"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Dismiss the overview without switching",
    matches: plain("escape"),
  },
]

/**
 * The saved-run picker's keys. Printable input belongs to its focused filter field;
 * navigation remains plain, while destructive actions use control chords so a
 * search term can contain every printable character.
 */
export const SESSION_PICKER_KEYMAP: readonly KeyBinding<SessionPickerCommand>[] = [
  {
    command: "prev-run",
    keys: "↑",
    description: "Highlight the previous saved run",
    matches: plain("up"),
  },
  {
    command: "next-run",
    keys: "↓",
    description: "Highlight the next saved run",
    matches: plain("down"),
  },
  {
    command: "preview",
    keys: "Space",
    description: "Preview the highlighted run without restoring it",
    matches: plain("space"),
  },
  {
    command: "restore",
    keys: "Enter",
    description: "Restore the highlighted run",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "delete-run",
    keys: "Ctrl+D",
    description: "Delete the highlighted Kitten run after confirmation",
    matches: ctrl("d"),
  },
  {
    command: "delete-all",
    keys: "Ctrl+A",
    description: "Delete all Kitten runs after confirmation",
    matches: ctrl("a"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Close the picker without restoring",
    matches: plain("escape"),
  },
]

/**
 * The model/effort selector's keys, live only while the selector is on screen.
 *
 * Like the other overlays it is modal, so plain arrows and Enter are safe: nothing
 * reaches the composer while the picker is up. Enter here means "choose the
 * highlighted model or effort", and the same Enter/Escape pair drives the inline
 * mid-conversation confirm step - Enter proceeds with the switch, Escape backs out of
 * it - so the confirm step needs no keys of its own.
 */
export const MODEL_SELECT_KEYMAP: readonly KeyBinding<ModelSelectCommand>[] = [
  {
    command: "prev-option",
    keys: "↑",
    description: "Highlight the previous model or effort",
    matches: plain("up"),
  },
  {
    command: "next-option",
    keys: "↓",
    description: "Highlight the next model or effort",
    matches: plain("down"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Apply the highlighted model or effort to the focused agent",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Close the selector without changing anything",
    matches: plain("escape"),
  },
]

/**
 * The settings overlay's keys, live only while the modal is on screen.
 *
 * The modal consumes every keypress, so arrows, Tab, and a bare `r` cannot reach
 * the composer. Navigation applies the highlighted setting immediately; reset and
 * close therefore need no confirmation binding.
 */
export const SETTINGS_KEYMAP: readonly KeyBinding<SettingsCommand>[] = [
  {
    command: "prev-option",
    keys: "↑",
    description: "Highlight the previous setting option",
    matches: plain("up"),
  },
  {
    command: "next-option",
    keys: "↓",
    description: "Highlight the next setting option",
    matches: plain("down"),
  },
  {
    command: "switch-tab",
    keys: "Tab",
    description: "Switch to the next settings tab",
    matches: plain("tab"),
  },
  {
    command: "reset-to-default",
    keys: "r",
    description: "Reset the highlighted setting to its default",
    matches: plain("r"),
  },
  {
    command: "close",
    keys: "Esc",
    description: "Close settings",
    matches: plain("escape"),
  },
]

/**
 * Everything the help panel lists: the shell's chords, then the editor's.
 *
 * Neither overlay's keys appear. Both are modal, so F1 cannot open this panel while
 * their keys are live, and they do nothing while the overlay is closed - a row here
 * would describe a binding that is never true when the reader can read it. Each
 * overlay prints its own hint instead (`APPROVAL_HINT`, `HANDOFF_HINT`), in the one
 * state where its keys work.
 */
export const HELP_ENTRIES: readonly HelpEntry[] = [...COCKPIT_KEYMAP, ...EDITOR_KEYMAP]

/** Read a display label from the same binding row dispatch uses. */
function bindingKeys<Command extends string>(keymap: readonly KeyBinding<Command>[], command: Command): string {
  const binding = keymap.find((entry) => entry.command === command)
  if (!binding) throw new Error(`Missing keymap binding for ${command}`)
  return binding.keys
}

/** Use the status strip's compact caret notation for a Ctrl chord. */
function compactChord(keys: string): string {
  return keys.replace(/^Ctrl\+/, "^")
}

/** The primary chord only; documented fallbacks remain visible in the full help row. */
function primaryChord(keys: string): string {
  return keys.split(" / ", 1)[0]!
}

/** Compact chord shown by the status bar's always-visible hand-off affordance. */
export const HANDOFF_KEY_HINT = compactChord(bindingKeys(COCKPIT_KEYMAP, "hand-off"))

/** Start-fresh chord shown only while the status strip marks a resumed run. */
export const NEW_RUN_KEY_HINT = compactChord(bindingKeys(COCKPIT_KEYMAP, "start-new-run"))

/** Shell discovery hint kept compact enough to coexist with the hand-off affordance. */
export const SHELL_HINT = `${compactChord(primaryChord(bindingKeys(COCKPIT_KEYMAP, "toggle-shell")))} shell`

/** Saved-run discovery hint, derived from the same row dispatch and help consume. */
export const RESUME_KEY_HINT = `${compactChord(bindingKeys(COCKPIT_KEYMAP, "resume-session"))} resume`

/** The always-visible status hint keeps shell focus and saved-run resume discoverable. */
export const KEYMAP_HINT = `${SHELL_HINT}  ${RESUME_KEY_HINT}`

/** The hint printed inside the approval overlay, where those keys are the only live ones. */
export const APPROVAL_HINT = `↑↓ move  Enter choose  1-${MAX_DIGIT_OPTIONS} pick  Esc cancel`

/** The hint printed inside the hand-off preview while the developer curates the bundle. */
export const HANDOFF_HINT = "↑↓ move  Space keep/drop  m model/effort  e edit  Enter send  Esc cancel"

/** The hint printed while choosing the target's model/effort inside a hand-off preview. */
export const HANDOFF_CONFIG_HINT = "↑↓ move  Enter set target option  Esc back"

/** The hint printed inside the sessions overview, where those keys are the only live ones. */
export const SESSIONS_HINT = "↑↓ move  Enter jump  n next needy  Esc close"

/** The hint printed inside the saved-run picker while its filter owns text input. */
export const SESSION_PICKER_HINT =
  "Type filter  ↑↓ move  Space preview  Enter resume  Ctrl+D delete  Ctrl+A clear all  Esc cancel"

/** The hint printed inside the model/effort selector, where those keys are the only live ones. */
export const MODEL_SELECT_HINT = "↑↓ move  Enter apply  Esc close"

/** The hint printed inside settings, derived from the modal's binding table. */
export const SETTINGS_HINT = `${bindingKeys(SETTINGS_KEYMAP, "prev-option")}${bindingKeys(
  SETTINGS_KEYMAP,
  "next-option",
)} move  ${bindingKeys(SETTINGS_KEYMAP, "switch-tab")} switch tab  ${bindingKeys(
  SETTINGS_KEYMAP,
  "reset-to-default",
)} reset  ${bindingKeys(SETTINGS_KEYMAP, "close")} close`

/** The hint printed inside the selector's inline mid-conversation confirm step. */
export const MODEL_SELECT_CONFIRM_HINT = "Enter switch anyway  Esc keep current"

/**
 * The hint printed inside the hand-off target picker (task_06), where the developer
 * chooses which session receives the bundle before the redacted preview opens. It
 * reuses the sessions overview's navigation (`SESSIONS_KEYMAP`), so Enter here means
 * "choose this target" rather than "jump into"; the `n` shortcut is not offered.
 */
export const HANDOFF_TARGET_HINT = "↑↓ move  Enter choose target  Esc cancel"

/** The hint printed while the summary editor holds the keyboard, where only Escape is ours. */
export const HANDOFF_EDIT_HINT = "Esc returns to the bundle"

/** Build the "first binding whose predicate matches, else null" lookup a keymap needs. */
function makeMatcher<Command extends string>(
  keymap: readonly KeyBinding<Command>[],
): (key: CockpitKey) => Command | null {
  return (key) => keymap.find((binding) => binding.matches(key))?.command ?? null
}

/** The command a keypress maps to, or `null` when the shell does not claim it. */
export const matchCommand = makeMatcher(COCKPIT_KEYMAP)

/** The overlay command a keypress maps to, or `null` when the overlay does not claim it. */
export const matchApprovalCommand = makeMatcher(APPROVAL_KEYMAP)

/** The preview command a keypress maps to, or `null` when the preview does not claim it. */
export const matchHandoffCommand = makeMatcher(HANDOFF_KEYMAP)

/** The overview command a keypress maps to, or `null` when the overview does not claim it. */
export const matchSessionsCommand = makeMatcher(SESSIONS_KEYMAP)

/** The saved-run command a keypress maps to, or `null` when it belongs to filter text. */
export const matchSessionPickerCommand = makeMatcher(SESSION_PICKER_KEYMAP)

/** The selector command a keypress maps to, or `null` when the selector does not claim it. */
export const matchModelSelectCommand = makeMatcher(MODEL_SELECT_KEYMAP)

/** The settings command a keypress maps to, or `null` when the modal does not claim it. */
export const matchSettingsCommand = makeMatcher(SETTINGS_KEYMAP)

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
