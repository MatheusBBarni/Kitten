// Suite: cockpit and modal keymaps
// Invariant: each documented key maps to exactly its intended command without stealing unmodified composer input
// Boundary IN: keymap tables, pure matchers, hint/help derivation, and a real OpenTUI KeyEvent
// Boundary OUT: shell dispatch and rendered overlay behavior, owned by their component suites

import { describe, expect, it } from "bun:test"
import { KeyEvent } from "@opentui/core"

import {
  APPROVAL_HINT,
  APPROVAL_KEYMAP,
  approvalOptionIndex,
  COCKPIT_COMMANDS,
  COCKPIT_KEYMAP,
  EDITOR_KEYMAP,
  HANDOFF_CONFIG_HINT,
  HANDOFF_EDIT_HINT,
  HANDOFF_HINT,
  HANDOFF_KEYMAP,
  HELP_ENTRIES,
  helpEntries,
  KEYMAP_HINT,
  matchApprovalCommand,
  matchCommand,
  matchHandoffCommand,
  matchMenuCommand,
  matchModelSelectCommand,
  matchSessionPickerCommand,
  matchSessionsCommand,
  matchSettingsCommand,
  MODEL_SELECT_CONFIRM_HINT,
  MODEL_SELECT_HINT,
  MODEL_SELECT_KEYMAP,
  MENU_KEYMAP,
  PROMPT_KEY_BINDINGS,
  SESSION_PICKER_HINT,
  SESSION_PICKER_KEYMAP,
  SESSIONS_HINT,
  SESSIONS_KEYMAP,
  SHELL_EXIT_HINT,
  SHELL_HINT,
  SETTINGS_HINT,
  SETTINGS_KEYMAP,
  tabNavigationHint,
  type CockpitKey,
} from "./keymap.ts"

/** A key event with no modifiers held. */
function key(name: string, modifiers: Partial<CockpitKey> = {}): CockpitKey {
  return { name, ctrl: false, shift: false, meta: false, ...modifiers }
}

describe("matchCommand", () => {
  it("maps Ctrl+` or F2 to the shell and Escape to the help-panel close action", () => {
    expect(matchCommand(key("`", { ctrl: true }))).toBe("toggle-shell")
    expect(matchCommand(key("grave", { ctrl: true }))).toBe("toggle-shell")
    expect(matchCommand(key("f2"))).toBe("toggle-shell")
    expect(matchCommand(key("escape"))).toBe("close-help")
  })

  it("maps Ctrl+T to the hand-off while leaving a bare t to the prompt", () => {
    expect(matchCommand(key("t", { ctrl: true }))).toBe("hand-off")
    expect(matchCommand(key("t"))).toBeNull()
  })

  it("leaves every retired cockpit action chord to the prompt", () => {
    for (const name of ["o", "s", "r", "n", "e", ","]) {
      expect(matchCommand(key(name, { ctrl: true }))).toBeNull()
    }
    for (const name of ["f1", "f3"]) {
      expect(matchCommand(key(name))).toBeNull()
    }
  })

  it("does not steal printable prompt input or modified shell chords", () => {
    for (const name of ["/", "o", "t", ",", "return", "tab"]) {
      expect(matchCommand(key(name))).toBeNull()
    }
    expect(matchCommand(key("`", { ctrl: true, shift: true }))).toBeNull()
    expect(matchCommand(key("`", { ctrl: true, meta: true }))).toBeNull()
    expect(matchCommand(key("escape", { meta: true }))).toBeNull()
  })

  it("matches adjacent-tab chords only after Kitty confirmation and on a current Kitty event", () => {
    const previous = key("h", { ctrl: true, source: "kitty" })
    const next = key("l", { ctrl: true, source: "kitty" })

    expect(matchCommand(previous, "unknown")).toBeNull()
    expect(matchCommand(next, "unknown")).toBeNull()
    expect(matchCommand(previous, "kittyConfirmed")).toBe("previous-tab")
    expect(matchCommand(next, "kittyConfirmed")).toBe("next-tab")
    expect(matchCommand(key("h", { ctrl: true, source: "raw" }), "kittyConfirmed")).toBeNull()
    expect(matchCommand(key("l", { ctrl: true, source: "raw" }), "kittyConfirmed")).toBeNull()
  })

  it("rejects printable, modified, and unrelated Kitty events for adjacent navigation", () => {
    for (const event of [
      key("h", { source: "kitty" }),
      key("l", { source: "kitty" }),
      key("h", { ctrl: true, shift: true, source: "kitty" }),
      key("l", { ctrl: true, meta: true, source: "kitty" }),
      key("j", { ctrl: true, source: "kitty" }),
    ]) {
      expect(matchCommand(event, "kittyConfirmed")).toBeNull()
    }
  })
})

describe("COCKPIT_KEYMAP", () => {
  it("registers each conditional tab chord plus the retained hand-off, shell, and help bindings once", () => {
    const commands = COCKPIT_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["previous-tab", "next-tab", "hand-off", "toggle-shell", "close-help"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("documents each retained global binding", () => {
    for (const binding of COCKPIT_KEYMAP) {
      expect(binding.keys.length).toBeGreaterThan(0)
      expect(binding.description.length).toBeGreaterThan(0)
    }
  })

  it("documents boundary-aware editor recall without claiming global arrows", () => {
    expect(EDITOR_KEYMAP).toContainEqual({
      keys: "↑ / ↓",
      description: "Recall prompts at multiline editing boundaries",
    })
    expect(COCKPIT_KEYMAP.some(({ keys }) => keys.includes("↑") || keys.includes("↓"))).toBeFalse()
  })

  it("keeps slash-first compact affordances derived from the command registry", () => {
    expect(KEYMAP_HINT).toContain("/help")
    expect(SHELL_HINT).toBe("/shell")
    expect(COCKPIT_KEYMAP.find((binding) => binding.command === "toggle-shell")?.keys).toBe("Ctrl+` / F2")
    expect(SHELL_EXIT_HINT).toBe("Ctrl+` / F2 exit shell")
  })
})

describe("COCKPIT_COMMANDS", () => {
  it("gives each user-facing cockpit action one unique slash name", () => {
    expect(COCKPIT_COMMANDS.map(({ command, name }) => [command, name])).toEqual([
      ["toggle-shell", "shell"],
      ["run-externally", "copy"],
      ["switch-focus", "switch"],
      ["hand-off", "handoff"],
      ["sessions", "sessions"],
      ["previous-tab", "previous-tab"],
      ["next-tab", "next-tab"],
      ["resume-session", "resume"],
      ["start-new-run", "new"],
      ["clear-run", "clear"],
      ["model-select", "model"],
      ["open-settings", "settings"],
      ["toggle-help", "help"],
    ])
    expect(new Set(COCKPIT_COMMANDS.map(({ name }) => name)).size).toBe(COCKPIT_COMMANDS.length)
  })

  it("keeps every command discoverable with concise explanatory copy", () => {
    for (const command of COCKPIT_COMMANDS) {
      expect(command.name).not.toContain("/")
      expect(command.description.length).toBeGreaterThan(0)
    }
  })
})

describe("integration - OpenTUI KeyEvent dispatch", () => {
  it("dispatches a synthesized Ctrl+` only to the shell", () => {
    const event = new KeyEvent({
      name: "grave",
      ctrl: true,
      shift: false,
      meta: false,
      option: false,
      sequence: "",
      number: false,
      raw: "",
      eventType: "press",
      source: "kitty",
    })

    expect(matchCommand(event)).toBe("toggle-shell")
    expect(COCKPIT_KEYMAP.filter((binding) => binding.matches(event)).map((binding) => binding.command)).toEqual([
      "toggle-shell",
    ])
  })
})

describe("matchMenuCommand", () => {
  it("maps arrows and Tab variants to slash-menu navigation", () => {
    expect(matchMenuCommand(key("up"))).toBe("prev-item")
    expect(matchMenuCommand(key("down"))).toBe("next-item")
    expect(matchMenuCommand(key("tab"))).toBe("next-item")
    expect(matchMenuCommand(key("tab", { shift: true }))).toBe("prev-item")
  })

  it("maps either Enter variant to run or insert the highlighted command", () => {
    expect(matchMenuCommand(key("return"))).toBe("confirm")
    expect(matchMenuCommand(key("kpenter"))).toBe("confirm")
    expect(matchMenuCommand(key("escape"))).toBe("dismiss")
  })

  it("does not consume prompt text or modified navigation keys", () => {
    expect(matchMenuCommand(key("m"))).toBeNull()
    expect(matchMenuCommand(key("tab", { ctrl: true }))).toBeNull()
    expect(matchMenuCommand(key("return", { shift: true }))).toBeNull()
  })
})

describe("MENU_KEYMAP", () => {
  it("binds each prompt-menu outcome exactly once", () => {
    const commands = MENU_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-item", "next-item", "confirm", "dismiss"])
    expect(new Set(commands).size).toBe(commands.length)
  })
})

describe("KEYMAP_HINT", () => {
  it("advertises the hand-off chord and slash menu on one line", () => {
    expect(KEYMAP_HINT).toContain("^T hand-off")
    expect(KEYMAP_HINT).toContain("/ menu")
    expect(KEYMAP_HINT).not.toContain("\n")
  })
})

describe("PROMPT_KEY_BINDINGS", () => {
  it("inverts OpenTUI's default so Enter submits and Shift+Enter breaks the line", () => {
    expect(PROMPT_KEY_BINDINGS).toContainEqual({ name: "return", action: "submit" })
    expect(PROMPT_KEY_BINDINGS).toContainEqual({ name: "return", shift: true, action: "newline" })
  })

  it("binds the keypad's Enter the same way as the main one", () => {
    for (const action of ["submit", "newline"] as const) {
      const named = PROMPT_KEY_BINDINGS.filter((binding) => binding.action === action)
      expect(named.map((binding) => binding.name).sort()).toEqual(["kpenter", "return"])
      // The two variants of a key must agree on their modifiers, or one terminal
      // would submit where another breaks the line.
      expect(new Set(named.map((binding) => binding.shift === true)).size).toBe(1)
    }
  })

  it("leaves Escape to the editor, which interrupts rather than edits", () => {
    expect(PROMPT_KEY_BINDINGS.some((binding) => binding.name === "escape")).toBe(false)
  })
})

describe("HELP_ENTRIES", () => {
  it("lists slash commands, the retained shell chord, then editor input", () => {
    expect(HELP_ENTRIES).toEqual([
      ...COCKPIT_COMMANDS.map(({ name, description }) => ({ keys: `/${name}`, description })),
      { keys: "Ctrl+` / F2", description: "Focus or leave the integrated shell" },
      ...EDITOR_KEYMAP,
    ])
  })

  it("documents every entry with a chord and a description", () => {
    for (const entry of HELP_ENTRIES) {
      expect(entry.keys.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it("gives each entry its own description, since the panel keys on it", () => {
    const descriptions = HELP_ENTRIES.map((entry) => entry.description)
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it("shows Kitty tab chords only after confirmation and otherwise advertises the sessions attention fallback", () => {
    const unknown = helpEntries("unknown").map((entry) => entry.keys)
    const confirmed = helpEntries("kittyConfirmed").map((entry) => entry.keys)

    expect(unknown).not.toContain("Ctrl+H")
    expect(unknown).not.toContain("Ctrl+L")
    expect(confirmed).toContain("Ctrl+H")
    expect(confirmed).toContain("Ctrl+L")
    expect(tabNavigationHint("unknown")).toBe("/sessions → n next attention")
    expect(tabNavigationHint("kittyConfirmed")).toBe("Ctrl+H/Ctrl+L tabs")
  })

  it("uses slash names for every cockpit action and leaves legacy chords absent", () => {
    const keys = HELP_ENTRIES.map((entry) => entry.keys)
    for (const command of COCKPIT_COMMANDS) {
      expect(keys).toContain(`/${command.name}`)
    }
    for (const legacy of ["Ctrl+O", "Ctrl+T", "Ctrl+S", "Ctrl+R", "Ctrl+N", "Ctrl+E", "Ctrl+,", "F1", "F2", "F3"]) {
      expect(keys).not.toContain(legacy)
    }
  })

  it("omits every overlay's keys, which are unreachable from the cockpit", () => {
    for (const binding of [
      ...APPROVAL_KEYMAP,
      ...HANDOFF_KEYMAP,
      ...SESSION_PICKER_KEYMAP,
      ...SESSIONS_KEYMAP,
      ...MODEL_SELECT_KEYMAP,
      ...SETTINGS_KEYMAP,
    ]) {
      expect(HELP_ENTRIES).not.toContainEqual(binding)
    }
  })
})

describe("matchApprovalCommand", () => {
  it("maps the arrows to the option the highlight moves to", () => {
    expect(matchApprovalCommand(key("up"))).toBe("prev-option")
    expect(matchApprovalCommand(key("down"))).toBe("next-option")
  })

  it("maps both Enter variants to confirm, since a terminal may report either", () => {
    expect(matchApprovalCommand(key("return"))).toBe("confirm")
    expect(matchApprovalCommand(key("kpenter"))).toBe("confirm")
  })

  it("maps Escape to cancel, outranking the editor's interrupt while the overlay is up", () => {
    expect(matchApprovalCommand(key("escape"))).toBe("cancel")
  })

  it("ignores a chord with modifiers held, so Shift+Enter cannot approve an edit", () => {
    expect(matchApprovalCommand(key("return", { shift: true }))).toBeNull()
    expect(matchApprovalCommand(key("up", { ctrl: true }))).toBeNull()
    expect(matchApprovalCommand(key("escape", { meta: true }))).toBeNull()
  })

  it("ignores keys the overlay does not claim", () => {
    expect(matchApprovalCommand(key("o", { ctrl: true }))).toBeNull()
    expect(matchApprovalCommand(key("f1"))).toBeNull()
  })
})

describe("APPROVAL_KEYMAP", () => {
  it("binds each command exactly once", () => {
    const commands = APPROVAL_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-option", "next-option", "confirm", "cancel"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("names every binding in the hint the overlay prints", () => {
    for (const binding of APPROVAL_KEYMAP) {
      expect(APPROVAL_HINT).toContain(binding.keys)
    }
    // The digit shortcut has no binding of its own, so pin it here.
    expect(APPROVAL_HINT).toContain("1-9")
  })
})

describe("matchHandoffCommand", () => {
  it("maps the arrows to the row the highlight moves to", () => {
    expect(matchHandoffCommand(key("up"))).toBe("prev-item")
    expect(matchHandoffCommand(key("down"))).toBe("next-item")
  })

  it("maps Space to keep/drop, m to target config, and e to the summary editor", () => {
    expect(matchHandoffCommand(key("space"))).toBe("toggle-item")
    expect(matchHandoffCommand(key("m"))).toBe("edit-target-config")
    expect(matchHandoffCommand(key("e"))).toBe("edit-summary")
  })

  it("maps both Enter variants to confirm, since a terminal may report either", () => {
    expect(matchHandoffCommand(key("return"))).toBe("confirm")
    expect(matchHandoffCommand(key("kpenter"))).toBe("confirm")
  })

  it("maps Escape to cancel, so one key leaves the preview and the summary editor alike", () => {
    expect(matchHandoffCommand(key("escape"))).toBe("cancel")
  })

  it("ignores a chord with modifiers held, so Shift+Enter cannot send a bundle", () => {
    expect(matchHandoffCommand(key("return", { shift: true }))).toBeNull()
    expect(matchHandoffCommand(key("e", { ctrl: true }))).toBeNull()
    expect(matchHandoffCommand(key("space", { meta: true }))).toBeNull()
  })

  it("ignores keys the preview does not claim", () => {
    expect(matchHandoffCommand(key("o", { ctrl: true }))).toBeNull()
    expect(matchHandoffCommand(key("f1"))).toBeNull()
    expect(matchHandoffCommand(key("a"))).toBeNull()
  })
})

describe("HANDOFF_KEYMAP", () => {
  it("binds each command exactly once", () => {
    const commands = HANDOFF_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-item", "next-item", "toggle-item", "edit-target-config", "edit-summary", "confirm", "cancel"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("names every binding in the hint the preview prints", () => {
    for (const binding of HANDOFF_KEYMAP) {
      expect(HANDOFF_HINT).toContain(binding.keys)
    }
  })

  it("promises only Escape while the summary editor holds the keyboard", () => {
    // Every other binding is plain text while editing, so the hint must not offer it.
    // (A bare `e` is not checked: it is a letter, and the hint is written in English.)
    expect(HANDOFF_EDIT_HINT).toContain("Esc")
    for (const keys of ["↑", "↓", "Space", "Enter"]) {
      expect(HANDOFF_EDIT_HINT).not.toContain(keys)
    }
  })

  it("gives the target-config picker its own selector-style navigation hint", () => {
    for (const keys of ["↑", "↓", "Enter", "Esc"]) {
      expect(HANDOFF_CONFIG_HINT).toContain(keys)
    }
  })
})

describe("matchSessionsCommand", () => {
  it("maps the arrows to the session the highlight moves to", () => {
    expect(matchSessionsCommand(key("up"))).toBe("prev-session")
    expect(matchSessionsCommand(key("down"))).toBe("next-session")
  })

  it("maps both Enter variants to jump-into, since a terminal may report either", () => {
    expect(matchSessionsCommand(key("return"))).toBe("jump-into")
    expect(matchSessionsCommand(key("kpenter"))).toBe("jump-into")
  })

  it("maps a bare n to the jump-to-next-needy shortcut", () => {
    expect(matchSessionsCommand(key("n"))).toBe("jump-next-needy")
  })

  it("maps Escape to cancel, dismissing the overview without switching", () => {
    expect(matchSessionsCommand(key("escape"))).toBe("cancel")
  })

  it("ignores a chord with modifiers held, so Ctrl+N cannot jump", () => {
    expect(matchSessionsCommand(key("n", { ctrl: true }))).toBeNull()
    expect(matchSessionsCommand(key("return", { shift: true }))).toBeNull()
    expect(matchSessionsCommand(key("up", { meta: true }))).toBeNull()
  })

  it("ignores keys the overview does not claim", () => {
    expect(matchSessionsCommand(key("s", { ctrl: true }))).toBeNull()
    expect(matchSessionsCommand(key("f1"))).toBeNull()
    expect(matchSessionsCommand(key("space"))).toBeNull()
  })
})

describe("SESSIONS_KEYMAP", () => {
  it("binds each command exactly once", () => {
    const commands = SESSIONS_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-session", "next-session", "jump-into", "jump-next-needy", "cancel"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("names every binding in the hint the overview prints", () => {
    for (const binding of SESSIONS_KEYMAP) {
      // The bare `n` is a letter and the hint is written in English, so pin its word.
      if (binding.command === "jump-next-needy") continue
      expect(SESSIONS_HINT).toContain(binding.keys)
    }
    expect(SESSIONS_HINT).toContain("n next attention")
  })
})

describe("SESSION_PICKER_KEYMAP", () => {
  it("maps navigation, restore, deletion, and cancel to picker outcomes", () => {
    expect(matchSessionPickerCommand(key("up"))).toBe("prev-run")
    expect(matchSessionPickerCommand(key("down"))).toBe("next-run")
    expect(matchSessionPickerCommand(key("space"))).toBe("preview")
    expect(matchSessionPickerCommand(key("return"))).toBe("restore")
    expect(matchSessionPickerCommand(key("kpenter"))).toBe("restore")
    expect(matchSessionPickerCommand(key("d", { ctrl: true }))).toBe("delete-run")
    expect(matchSessionPickerCommand(key("a", { ctrl: true }))).toBe("delete-all")
    expect(matchSessionPickerCommand(key("escape"))).toBe("cancel")
  })

  it("leaves filter text unclaimed and rejects modified outcomes", () => {
    expect(matchSessionPickerCommand(key("a"))).toBeNull()
    expect(matchSessionPickerCommand(key("return", { shift: true }))).toBeNull()
    expect(matchSessionPickerCommand(key("space", { ctrl: true }))).toBeNull()
  })

  it("binds each command once and names it in the modal hint", () => {
    const commands = SESSION_PICKER_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual([
      "prev-run",
      "next-run",
      "preview",
      "restore",
      "delete-run",
      "delete-all",
      "cancel",
    ])
    expect(new Set(commands).size).toBe(commands.length)
    for (const binding of SESSION_PICKER_KEYMAP) expect(SESSION_PICKER_HINT).toContain(binding.keys)
  })
})

describe("matchModelSelectCommand", () => {
  it("maps the arrows to the row the highlight moves to", () => {
    expect(matchModelSelectCommand(key("up"))).toBe("prev-option")
    expect(matchModelSelectCommand(key("down"))).toBe("next-option")
  })

  it("maps Tab and Shift+Tab between agent model-and-effort tabs", () => {
    expect(matchModelSelectCommand(key("tab"))).toBe("next-tab")
    expect(matchModelSelectCommand(key("tab", { shift: true }))).toBe("prev-tab")
  })

  it("maps both Enter variants to confirm, since a terminal may report either", () => {
    expect(matchModelSelectCommand(key("return"))).toBe("confirm")
    expect(matchModelSelectCommand(key("kpenter"))).toBe("confirm")
  })

  it("maps Escape to cancel, closing the selector without changing anything", () => {
    expect(matchModelSelectCommand(key("escape"))).toBe("cancel")
  })

  it("ignores a chord with modifiers held, so Shift+Enter cannot apply a switch", () => {
    expect(matchModelSelectCommand(key("return", { shift: true }))).toBeNull()
    expect(matchModelSelectCommand(key("up", { ctrl: true }))).toBeNull()
    expect(matchModelSelectCommand(key("tab", { ctrl: true }))).toBeNull()
    expect(matchModelSelectCommand(key("escape", { meta: true }))).toBeNull()
  })

  it("ignores keys the selector does not claim", () => {
    expect(matchModelSelectCommand(key("e", { ctrl: true }))).toBeNull()
    expect(matchModelSelectCommand(key("f1"))).toBeNull()
    expect(matchModelSelectCommand(key("space"))).toBeNull()
  })
})

describe("MODEL_SELECT_KEYMAP", () => {
  it("binds each command exactly once", () => {
    const commands = MODEL_SELECT_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-option", "next-option", "next-tab", "prev-tab", "confirm", "cancel"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("names every binding in the hint the selector prints", () => {
    for (const binding of MODEL_SELECT_KEYMAP) {
      expect(MODEL_SELECT_HINT).toContain(binding.keys)
    }
  })

  it("drives the inline confirm step with the same Enter/Escape pair", () => {
    // The confirm step reuses confirm/cancel, so its hint must name both keys.
    expect(MODEL_SELECT_CONFIRM_HINT).toContain("Enter")
    expect(MODEL_SELECT_CONFIRM_HINT).toContain("Esc")
  })
})

describe("matchSettingsCommand", () => {
  it("maps arrows to the previous and next setting options", () => {
    expect(matchSettingsCommand(key("up"))).toBe("prev-option")
    expect(matchSettingsCommand(key("down"))).toBe("next-option")
  })

  it("maps Tab to switch-tab and r to reset-to-default", () => {
    expect(matchSettingsCommand(key("tab"))).toBe("switch-tab")
    expect(matchSettingsCommand(key("r"))).toBe("reset-to-default")
  })

  it("maps Escape to close", () => {
    expect(matchSettingsCommand(key("escape"))).toBe("close")
  })

  it("rejects modified and unclaimed keys", () => {
    expect(matchSettingsCommand(key("tab", { shift: true }))).toBeNull()
    expect(matchSettingsCommand(key("r", { ctrl: true }))).toBeNull()
    expect(matchSettingsCommand(key("escape", { meta: true }))).toBeNull()
    expect(matchSettingsCommand(key("return"))).toBeNull()
  })
})

describe("SETTINGS_KEYMAP", () => {
  it("binds every settings command exactly once", () => {
    const commands = SETTINGS_KEYMAP.map((binding) => binding.command)
    expect(commands).toEqual(["prev-option", "next-option", "switch-tab", "reset-to-default", "close"])
    expect(new Set(commands).size).toBe(commands.length)
  })

  it("names every binding in the modal hint", () => {
    for (const binding of SETTINGS_KEYMAP.filter((entry) => entry.command !== "reset-to-default")) {
      expect(SETTINGS_HINT).toContain(binding.keys)
    }
    expect(SETTINGS_HINT).toContain("r reset")
  })
})

describe("approvalOptionIndex", () => {
  it("maps a digit to the zero-based option it names", () => {
    expect(approvalOptionIndex(key("1"))).toBe(0)
    expect(approvalOptionIndex(key("9"))).toBe(8)
  })

  it("rejects zero, which names no option", () => {
    expect(approvalOptionIndex(key("0"))).toBeNull()
  })

  it("rejects a digit with a modifier held, so Ctrl+1 stays free", () => {
    expect(approvalOptionIndex(key("1", { ctrl: true }))).toBeNull()
    expect(approvalOptionIndex(key("1", { meta: true }))).toBeNull()
    expect(approvalOptionIndex(key("1", { shift: true }))).toBeNull()
  })

  it("rejects a non-digit, including a multi-character key name", () => {
    expect(approvalOptionIndex(key("a"))).toBeNull()
    expect(approvalOptionIndex(key("f1"))).toBeNull()
    expect(approvalOptionIndex(key("escape"))).toBeNull()
    expect(approvalOptionIndex(key(""))).toBeNull()
  })
})
