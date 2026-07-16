/**
 * The cockpit's global keymap.
 *
 * Global bindings are deliberately sparse: every cockpit operation is available as
 * a slash command in the prompt, and only the terminal-level shell toggle remains
 * a global chord. The prompt editor owns the printable `/` trigger, so composing
 * normal agent input remains predictable.
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
 */

import type { KeyBinding as TextareaKeyBinding } from "@opentui/core"

import type { KeyboardCapability } from "../store/appStore.ts"

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
  readonly super?: boolean
  readonly source?: "raw" | "kitty"
}

/** Clipboard intents intercepted before shell key encoding. */
export type ClipboardCommand = "copy" | "paste"

/** Platform families with distinct conventional terminal clipboard chords. */
export type ClipboardPlatform = "darwin" | "windows-linux"

/** Every intent the shell itself handles. Overlays and the editor own their own keys. */
export type CockpitCommand =
  | "toggle-shell"
  | "run-externally"
  | "hand-off"
  | "delegate"
  | "sessions"
  | "resume-session"
  | "start-new-run"
  | "clear-run"
  | "model-select"
  | "statusline"
  | "reveal-history"
  | "return-to-live"
  | "open-settings"
  | "toggle-help"
  | "close-help"
  | "previous-tab"
  | "next-tab"

/** Every intent the model/effort selector handles while it is on screen. */
export type ModelSelectCommand = "prev-option" | "next-option" | "prev-tab" | "next-tab" | "confirm" | "cancel"

/** Every intent the non-modal prompt slash menu handles while it is armed. */
export type MenuCommand = "prev-item" | "next-item" | "confirm" | "dismiss"

/** Every intent the approval overlay handles while it is on screen. */
export type ApprovalCommand = "prev-option" | "next-option" | "confirm" | "cancel"

/** Every intent the clarification dialog handles while it owns the keyboard. */
export type ClarificationCommand =
  | "prev-option"
  | "next-option"
  | "prev-field"
  | "next-field"
  | "toggle-option"
  | "confirm"
  | "skip"
  | "cancel"

/** Every intent the explicit delegation dialog handles while it owns input. */
export type DelegationCommand = "prev-field" | "next-field" | "confirm" | "cancel"

/** Every intent the rename/close tab dialog handles while it owns the modal slot. */
export type TabDialogCommand = "prev-choice" | "next-choice" | "confirm" | "cancel"

/** Every intent the settings overlay handles while it is on screen. */
export type SettingsCommand = "prev-option" | "next-option" | "switch-tab" | "reset-to-default" | "close"

/** Every intent shared by the `/statusline` disclosure, lists, and review screens. */
export type StatuslineCommand = "prev-option" | "next-option" | "confirm" | "cancel"

/** Every intent the hand-off preview handles while it is on screen. */
export type HandoffCommand =
  | "prev-item"
  | "next-item"
  | "toggle-item"
  | "edit-target-config"
  | "edit-summary"
  | "confirm"
  | "cancel"

/** Every intent the `/sessions` overview handles while it is on screen. */
export type SessionsCommand =
  | "prev-session"
  | "next-session"
  | "jump-into"
  | "jump-next-needy"
  | "close-session"
  | "review-worktree"
  | "cancel"

/** Intents live only inside one captured managed-worktree review. */
export type ManagedWorktreeReviewCommand = "request-cleanup" | "cancel"

/** Intents live only inside explicit cleanup confirmation. */
export type ManagedWorktreeCleanupCommand = "confirm-cleanup" | "cancel"

/** Every intent the `/resume` saved-run picker handles while it is on screen. */
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
  /** Persistent renderer confirmation required in addition to the current event predicate. */
  readonly requiresKittyConfirmation?: boolean
}

/** One visible, slash-first cockpit operation. */
export interface CockpitCommandDefinition {
  readonly command: Exclude<CockpitCommand, "close-help">
  /** Command text without its leading slash. */
  readonly name: string
  /** One concise explanation rendered by `/help` and the menu. */
  readonly description: string
}

/** A plain, unmodified press of any one of `names` - for a key a terminal may report under more than one name. */
function plainAny(...names: string[]): (key: CockpitKey) => boolean {
  return (key) => names.includes(key.name) && !key.ctrl && !key.meta && !key.shift
}

/** A plain, unmodified press of `name`. */
function plain(name: string): (key: CockpitKey) => boolean {
  return plainAny(name)
}

/** Shift plus `name`, with no other modifier. Used only by local overlays. */
function shiftPlain(name: string): (key: CockpitKey) => boolean {
  return (key) => key.name === name && key.shift && !key.ctrl && !key.meta
}

/** `Ctrl` plus `name`, with no other modifier. */
function ctrl(name: string): (key: CockpitKey) => boolean {
  return (key) => key.name === name && key.ctrl && !key.meta && !key.shift
}

/** A disambiguated Ctrl chord from the Kitty parser path, never legacy raw input. */
function kittyCtrl(name: string): (key: CockpitKey) => boolean {
  return (key) => key.source === "kitty" && ctrl(name)(key)
}

/** Match when any one of the supplied predicates claims the key. */
function any(...predicates: readonly ((key: CockpitKey) => boolean)[]): (key: CockpitKey) => boolean {
  return (key) => predicates.some((predicate) => predicate(key))
}

/**
 * Match the host clipboard chord without stealing Ctrl+C from the integrated PTY.
 * OpenTUI reports Command as `super`; `meta` is Alt/Option and must not be treated
 * as the macOS Command key.
 */
export function matchClipboardCommand(key: CockpitKey, platform: ClipboardPlatform): ClipboardCommand | null {
  const conventionalModifiers = platform === "darwin"
    ? key.super === true && !key.ctrl && !key.shift && !key.meta
    : key.ctrl && key.shift && !key.meta && key.super !== true
  if (!conventionalModifiers) return null
  if (key.name.toLowerCase() === "c") return "copy"
  if (key.name.toLowerCase() === "v") return "paste"
  return null
}

/**
 * The bindings, in help-panel order.
 *
 * `close-help` is reported for Escape unconditionally; the shell acts on it only
 * while the help panel is open, leaving Escape free for the editor and overlays.
 */
export const COCKPIT_COMMANDS: readonly CockpitCommandDefinition[] = [
  { command: "toggle-shell", name: "shell", description: "Focus the integrated shell" },
  { command: "run-externally", name: "copy", description: "Copy the latest shell command for an external terminal" },
  { command: "hand-off", name: "handoff", description: "Curate and send a hand-off to another agent" },
  { command: "delegate", name: "delegate", description: "Start child work without leaving this conversation" },
  { command: "sessions", name: "sessions", description: "Show every session and jump to one that needs you" },
  { command: "previous-tab", name: "previous-tab", description: "Select the previous visible conversation" },
  { command: "next-tab", name: "next-tab", description: "Select the next visible conversation" },
  { command: "resume-session", name: "resume", description: "Find and resume a saved run for this project" },
  { command: "start-new-run", name: "new", description: "Create a new conversation with the selected provider" },
  { command: "clear-run", name: "clear", description: "Clear this run and start fresh agent sessions" },
  { command: "model-select", name: "model", description: "Choose a provider, model, and reasoning effort" },
  { command: "statusline", name: "statusline", description: "Describe and review your personal statusline" },
  { command: "reveal-history", name: "history", description: "Load earlier history for this conversation" },
  { command: "return-to-live", name: "latest", description: "Return this conversation to live activity" },
  { command: "open-settings", name: "settings", description: "Open Kitten settings" },
  { command: "toggle-help", name: "help", description: "Show every Kitten command" },
]

/**
 * The only bindings that must remain global while a prompt is being composed.
 * F2 is the terminal-level fallback for keyboards that cannot report Ctrl+`.
 */
export const COCKPIT_KEYMAP: readonly KeyBinding[] = [
  {
    command: "previous-tab",
    keys: "Ctrl+H",
    description: "Move to the previous visible tab when Kitty input is confirmed",
    matches: kittyCtrl("h"),
    requiresKittyConfirmation: true,
  },
  {
    command: "next-tab",
    keys: "Ctrl+L",
    description: "Move to the next visible tab when Kitty input is confirmed",
    matches: kittyCtrl("l"),
    requiresKittyConfirmation: true,
  },
  {
    command: "hand-off",
    keys: "Ctrl+T",
    description: "Open the curated hand-off flow",
    matches: ctrl("t"),
  },
  {
    command: "delegate",
    keys: "Ctrl+G",
    description: "Delegate focused child work from the current conversation",
    matches: ctrl("g"),
  },
  {
    command: "toggle-shell",
    keys: "Ctrl+` / F2",
    description: "Focus or leave the shell; its keys route there and Ctrl+C interrupts",
    matches: any(ctrl("`"), ctrl("grave"), plain("f2")),
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
  { keys: "/", description: "Open and filter the command menu" },
  { keys: "@", description: "Find and insert a repository file reference" },
  { keys: "Enter", description: "Send the prompt to the focused agent" },
  { keys: "Shift+Enter", description: "Insert a newline in the prompt" },
  { keys: "↑ / ↓", description: "Recall prompts at multiline editing boundaries" },
  { keys: "Esc", description: "Interrupt the agent while it is working" },
]

/** Navigation captured only while the prompt-local slash menu is visible. */
export const MENU_KEYMAP: readonly KeyBinding<MenuCommand>[] = [
  {
    command: "prev-item",
    keys: "↑ / Shift+Tab",
    description: "Highlight the previous command",
    matches: any(plain("up"), shiftPlain("tab")),
  },
  {
    command: "next-item",
    keys: "↓ / Tab",
    description: "Highlight the next command",
    matches: any(plain("down"), plain("tab")),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Run or insert the highlighted command",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "dismiss",
    keys: "Esc",
    description: "Close the command menu",
    matches: plain("escape"),
  },
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

/** The clarification dialog's complete keyboard contract. */
export const CLARIFICATION_KEYMAP: readonly KeyBinding<ClarificationCommand>[] = [
  {
    command: "prev-option",
    keys: "↑",
    description: "Highlight the previous clarification option",
    matches: plain("up"),
  },
  {
    command: "next-option",
    keys: "↓",
    description: "Highlight the next clarification option",
    matches: plain("down"),
  },
  {
    command: "prev-field",
    keys: "Shift+Tab",
    description: "Focus the previous clarification field",
    matches: shiftPlain("tab"),
  },
  {
    command: "next-field",
    keys: "Tab",
    description: "Focus the next clarification field",
    matches: plain("tab"),
  },
  {
    command: "toggle-option",
    keys: "Space",
    description: "Toggle the highlighted multi-select option",
    matches: plain("space"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Submit the clarification response",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "skip",
    keys: "Ctrl+S",
    description: "Skip the whole clarification form",
    matches: ctrl("s"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Cancel the clarification request",
    matches: plain("escape"),
  },
]

/** Field navigation and decisions for the explicit delegation form. */
export const DELEGATION_KEYMAP: readonly KeyBinding<DelegationCommand>[] = [
  {
    command: "prev-field",
    keys: "Shift+Tab",
    description: "Focus the previous delegation field",
    matches: shiftPlain("tab"),
  },
  {
    command: "next-field",
    keys: "Tab",
    description: "Focus the next delegation field",
    matches: plain("tab"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Start the delegated child",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Cancel delegation without launching",
    matches: plain("escape"),
  },
]

/** Rename uses Enter/Escape; close-choice dialogs additionally use the arrow rows. */
export const TAB_DIALOG_KEYMAP: readonly KeyBinding<TabDialogCommand>[] = [
  {
    command: "prev-choice",
    keys: "↑",
    description: "Highlight the previous close choice",
    matches: plain("up"),
  },
  {
    command: "next-choice",
    keys: "↓",
    description: "Highlight the next close choice",
    matches: plain("down"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Confirm the rename or highlighted close choice",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Close the dialog without changing the conversation",
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
 * The sessions overview's keys, live only while the `/sessions` overview is on screen.
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
    description: "Jump to the next conversation needing attention",
    matches: plain("n"),
  },
  {
    command: "close-session",
    keys: "d",
    description: "Choose how to close the highlighted session",
    matches: plain("d"),
  },
  {
    command: "review-worktree",
    keys: "r",
    description: "Review the highlighted terminal managed worktree",
    matches: plain("r"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Dismiss the overview without switching",
    matches: plain("escape"),
  },
]

/** Keys for one captured terminal managed-worktree review. */
export const MANAGED_WORKTREE_REVIEW_KEYMAP: readonly KeyBinding<ManagedWorktreeReviewCommand>[] = [
  {
    command: "request-cleanup",
    keys: "c",
    description: "Review explicit cleanup confirmation",
    matches: plain("c"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Return to the sessions overview",
    matches: plain("escape"),
  },
]

/** Keys for the destructive boundary after a child target has been captured. */
export const MANAGED_WORKTREE_CLEANUP_KEYMAP: readonly KeyBinding<ManagedWorktreeCleanupCommand>[] = [
  {
    command: "confirm-cleanup",
    keys: "Enter",
    description: "Request cleanup for the captured managed worktree",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Keep the managed worktree and return to review",
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
    command: "next-tab",
    keys: "Tab",
    description: "Show the next agent session's model and effort choices",
    matches: plain("tab"),
  },
  {
    command: "prev-tab",
    keys: "Shift+Tab",
    description: "Show the previous agent session's model and effort choices",
    matches: shiftPlain("tab"),
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

/** Navigation and decisions shared by every non-text `/statusline` modal phase. */
export const STATUSLINE_KEYMAP: readonly KeyBinding<StatuslineCommand>[] = [
  {
    command: "prev-option",
    keys: "↑",
    description: "Highlight the previous statusline choice",
    matches: plain("up"),
  },
  {
    command: "next-option",
    keys: "↓",
    description: "Highlight the next statusline choice",
    matches: plain("down"),
  },
  {
    command: "confirm",
    keys: "Enter",
    description: "Choose the highlighted statusline action",
    matches: plainAny("return", "kpenter"),
  },
  {
    command: "cancel",
    keys: "Esc",
    description: "Cancel the statusline workflow",
    matches: plain("escape"),
  },
]

/**
 * Everything the help panel lists: the shell's chords, then the editor's.
 *
 * Neither overlay's keys appear. Both are modal, so no global command can open this panel while
 * their keys are live, and they do nothing while the overlay is closed - a row here
 * would describe a binding that is never true when the reader can read it. Each
 * overlay prints its own hint instead (`APPROVAL_HINT`, `HANDOFF_HINT`), in the one
 * state where its keys work.
 */
export function helpEntries(capability: KeyboardCapability): readonly HelpEntry[] {
  const directTabBindings = capability === "kittyConfirmed"
    ? COCKPIT_KEYMAP.filter((entry) => entry.command === "previous-tab" || entry.command === "next-tab")
    : []
  return [
    ...COCKPIT_COMMANDS.map(({ name, description }) => ({ keys: `/${name}`, description })),
    ...COCKPIT_KEYMAP.filter((entry) => entry.command === "delegate").map(({ keys, description }) => ({ keys, description })),
    ...directTabBindings.map(({ keys, description }) => ({ keys, description })),
    { keys: bindingKeys(COCKPIT_KEYMAP, "toggle-shell"), description: "Focus or leave the integrated shell" },
    ...EDITOR_KEYMAP,
  ]
}

/** Legacy-safe default retained for non-reactive consumers and tests. */
export const HELP_ENTRIES: readonly HelpEntry[] = helpEntries("unknown")

/** Read a display label from the same binding row dispatch uses. */
function bindingKeys<Command extends string>(keymap: readonly KeyBinding<Command>[], command: Command): string {
  const binding = keymap.find((entry) => entry.command === command)
  if (!binding) throw new Error(`Missing keymap binding for ${command}`)
  return binding.keys
}

/** Slash labels stay sourced from the same command registry as the menu and help. */
function commandSlash(command: Exclude<CockpitCommand, "close-help">): string {
  const definition = COCKPIT_COMMANDS.find((entry) => entry.command === command)
  if (!definition) throw new Error(`Missing slash command for ${command}`)
  return `/${definition.name}`
}

/** Start-fresh affordance shown for a restored run. */
export const NEW_RUN_KEY_HINT = commandSlash("start-new-run")

/** The one quiet, always-visible discovery affordance in the status strip. */
export const KEYMAP_HINT = commandSlash("toggle-help")

/** Direct-chord discovery after confirmation, otherwise the universal sessions/attention path. */
export function tabNavigationHint(capability: KeyboardCapability): string {
  return capability === "kittyConfirmed"
    ? `${bindingKeys(COCKPIT_KEYMAP, "previous-tab")}/${bindingKeys(COCKPIT_KEYMAP, "next-tab")} tabs`
    : `${commandSlash("sessions")} → n next attention`
}

/** The always-available way back from terminal ownership, shown while the shell has focus. */
export const SHELL_EXIT_HINT = `${bindingKeys(COCKPIT_KEYMAP, "toggle-shell")} exit shell`

/** Slash-first labels retained for focused view copy while that view transitions. */
export const HANDOFF_KEY_HINT = commandSlash("hand-off")
export const SHELL_HINT = commandSlash("toggle-shell")
export const RESUME_KEY_HINT = commandSlash("resume-session")

/** The hint printed inside the approval overlay, where those keys are the only live ones. */
export const APPROVAL_HINT = `↑↓ move  Enter choose  1-${MAX_DIGIT_OPTIONS} pick  Esc cancel`

/** The complete keyboard teaching surface shown only while clarification owns input. */
export const CLARIFICATION_HINT =
  `↑↓ move  Tab/Shift+Tab field/text  1-${MAX_DIGIT_OPTIONS} pick  Space toggle  Enter submit  Ctrl+S skip form  Esc cancel request`

/** The complete keyboard teaching surface for explicit delegation. */
export const DELEGATION_HINT = "Tab/Shift+Tab field  Enter launch  Esc cancel"

/** The hint printed while the rename input owns ordinary text keys. */
export const TAB_RENAME_HINT = "Enter rename  Esc keep current name"

/** The hint printed while an idle or active close decision owns the keyboard. */
export const TAB_CLOSE_HINT = "↑↓ move  Enter choose  Esc keep open"

/** The hint printed inside the hand-off preview while the developer curates the bundle. */
export const HANDOFF_HINT = "↑↓ move  Space keep/drop  m model/effort  e edit  Enter send  Esc cancel"

/** The hint printed while choosing the target's model/effort inside a hand-off preview. */
export const HANDOFF_CONFIG_HINT = "↑↓ move  Enter set target option  Esc back"

/** The hint printed inside the sessions overview, where those keys are the only live ones. */
export const SESSIONS_HINT = "↑↓ move  Enter jump  n next attention  d close  Esc close"

/** The contextual overview hint shown only for a review-eligible highlighted row. */
export const SESSIONS_REVIEW_HINT = `${SESSIONS_HINT}  r review worktree`

/** Detailed review hints reflect whether the selector presentation permits cleanup. */
export function managedWorktreeReviewHint(cleanupAvailable: boolean): string {
  return cleanupAvailable ? "c review cleanup  Esc back" : "Esc back"
}

/** Explicit cleanup remains a separate confirmation step. */
export const MANAGED_WORKTREE_CLEANUP_HINT = "Enter request cleanup  Esc keep worktree"

/** No further modal action is accepted while the controller request is pending. */
export const MANAGED_WORKTREE_CLEANUP_PENDING_HINT = "Cleanup request pending…"

/** The hint printed inside the saved-run picker while its filter owns text input. */
export const SESSION_PICKER_HINT =
  "Type filter  ↑↓ move  Space preview  Enter resume  Ctrl+D delete  Ctrl+A clear all  Esc cancel"

/** The hint printed inside the model/effort selector, where those keys are the only live ones. */
export const MODEL_SELECT_HINT = "↑↓ choose model  Tab/Shift+Tab choose provider  Enter apply  Esc close"

/** The hint printed inside settings, derived from the modal's binding table. */
export const SETTINGS_HINT = `${bindingKeys(SETTINGS_KEYMAP, "prev-option")}${bindingKeys(
  SETTINGS_KEYMAP,
  "next-option",
)} move  ${bindingKeys(SETTINGS_KEYMAP, "switch-tab")} switch tab  ${bindingKeys(
  SETTINGS_KEYMAP,
  "reset-to-default",
)} reset  ${bindingKeys(SETTINGS_KEYMAP, "close")} close`

/** The keyboard teaching surface shared by statusline choices and review. */
export const STATUSLINE_HINT = "↑↓ move  Enter choose  Esc cancel"

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
): (key: CockpitKey, capability?: KeyboardCapability) => Command | null {
  return (key, capability = "unknown") => keymap.find((binding) =>
    (!binding.requiresKittyConfirmation || capability === "kittyConfirmed") && binding.matches(key)
  )?.command ?? null
}

/** The command a keypress maps to, or `null` when the shell does not claim it. */
export const matchCommand = makeMatcher(COCKPIT_KEYMAP)

/** The prompt-local menu command a keypress names, or null while normal typing continues. */
export const matchMenuCommand = makeMatcher(MENU_KEYMAP)

/** The overlay command a keypress maps to, or `null` when the overlay does not claim it. */
export const matchApprovalCommand = makeMatcher(APPROVAL_KEYMAP)

/** The clarification command a keypress maps to, or null for focused text editing. */
export const matchClarificationCommand = makeMatcher(CLARIFICATION_KEYMAP)

/** The delegation dialog command a keypress maps to, or null for focused text editing. */
export const matchDelegationCommand = makeMatcher(DELEGATION_KEYMAP)

/** The rename/close dialog command a keypress maps to, or `null` for input text. */
export const matchTabDialogCommand = makeMatcher(TAB_DIALOG_KEYMAP)

/** The preview command a keypress maps to, or `null` when the preview does not claim it. */
export const matchHandoffCommand = makeMatcher(HANDOFF_KEYMAP)

/** The overview command a keypress maps to, or `null` when the overview does not claim it. */
export const matchSessionsCommand = makeMatcher(SESSIONS_KEYMAP)
export const matchManagedWorktreeReviewCommand = makeMatcher(MANAGED_WORKTREE_REVIEW_KEYMAP)
export const matchManagedWorktreeCleanupCommand = makeMatcher(MANAGED_WORKTREE_CLEANUP_KEYMAP)

/** The saved-run command a keypress maps to, or `null` when it belongs to filter text. */
export const matchSessionPickerCommand = makeMatcher(SESSION_PICKER_KEYMAP)

/** The selector command a keypress maps to, or `null` when the selector does not claim it. */
export const matchModelSelectCommand = makeMatcher(MODEL_SELECT_KEYMAP)

/** The settings command a keypress maps to, or `null` when the modal does not claim it. */
export const matchSettingsCommand = makeMatcher(SETTINGS_KEYMAP)

/** The `/statusline` modal command a keypress names. */
export const matchStatuslineCommand = makeMatcher(STATUSLINE_KEYMAP)

/**
 * The zero-based option a digit key names, or `null` for any other key.
 *
 * `9` is the last reachable option; a tenth would need a second digit and a timeout,
 * which is not a trade worth making on a dialog this small.
 */
export function approvalOptionIndex(key: CockpitKey): number | null {
  return directOptionIndex(key)
}

/** The zero-based clarification option named by a plain digit, or null. */
export function clarificationOptionIndex(key: CockpitKey): number | null {
  return directOptionIndex(key)
}

function directOptionIndex(key: CockpitKey): number | null {
  if (key.ctrl || key.meta || key.shift || key.name.length !== 1) return null
  const digit = Number.parseInt(key.name, 10)
  if (!Number.isInteger(digit) || digit < 1 || digit > MAX_DIGIT_OPTIONS) return null
  return digit - 1
}
