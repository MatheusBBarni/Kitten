import { describe, expect, it } from "bun:test"

import {
  APPROVAL_HINT,
  APPROVAL_KEYMAP,
  approvalOptionIndex,
  COCKPIT_KEYMAP,
  EDITOR_KEYMAP,
  HANDOFF_EDIT_HINT,
  HANDOFF_HINT,
  HANDOFF_KEYMAP,
  HELP_ENTRIES,
  KEYMAP_HINT,
  matchApprovalCommand,
  matchCommand,
  matchHandoffCommand,
  PROMPT_KEY_BINDINGS,
  type CockpitKey,
} from "./keymap.ts"

/** A key event with no modifiers held. */
function key(name: string, modifiers: Partial<CockpitKey> = {}): CockpitKey {
  return { name, ctrl: false, shift: false, meta: false, ...modifiers }
}

describe("matchCommand", () => {
  it("maps Ctrl+O to switch-focus", () => {
    expect(matchCommand(key("o", { ctrl: true }))).toBe("switch-focus")
  })

  it("maps Ctrl+T to hand-off", () => {
    expect(matchCommand(key("t", { ctrl: true }))).toBe("hand-off")
  })

  it("maps F1 to toggle-help and Escape to close-help", () => {
    expect(matchCommand(key("f1"))).toBe("toggle-help")
    expect(matchCommand(key("escape"))).toBe("close-help")
  })

  it("ignores a bare letter so the prompt editor keeps every printable key", () => {
    expect(matchCommand(key("o"))).toBeNull()
    expect(matchCommand(key("f"))).toBeNull()
    expect(matchCommand(key("t"))).toBeNull()
  })

  it("ignores a chord with extra modifiers held", () => {
    expect(matchCommand(key("o", { ctrl: true, shift: true }))).toBeNull()
    expect(matchCommand(key("o", { ctrl: true, meta: true }))).toBeNull()
    expect(matchCommand(key("t", { ctrl: true, shift: true }))).toBeNull()
    expect(matchCommand(key("f1", { ctrl: true }))).toBeNull()
    expect(matchCommand(key("escape", { meta: true }))).toBeNull()
  })

  it("ignores keys the shell does not claim", () => {
    expect(matchCommand(key("return"))).toBeNull()
    expect(matchCommand(key("tab"))).toBeNull()
  })
})

describe("COCKPIT_KEYMAP", () => {
  it("binds each command exactly once", () => {
    const commands = COCKPIT_KEYMAP.map((binding) => binding.command)
    expect(new Set(commands).size).toBe(commands.length)
    expect(commands).toEqual(["switch-focus", "hand-off", "toggle-help", "close-help"])
  })

  it("keeps the hand-off chord clear of the ASCII control codes a terminal already sends", () => {
    // Backspace is Ctrl+H, Tab is Ctrl+I, Enter is Ctrl+M. A chord bound to one of them
    // would fire on an ordinary keystroke in the composer.
    const reserved = new Set(["h", "i", "j", "m", "c", "d", "z"])
    const handoff = COCKPIT_KEYMAP.find((binding) => binding.command === "hand-off")!
    for (const name of reserved) {
      expect(handoff.matches({ name, ctrl: true, shift: false, meta: false })).toBe(false)
    }
  })

  it("documents every binding for the help panel", () => {
    for (const binding of COCKPIT_KEYMAP) {
      expect(binding.keys.length).toBeGreaterThan(0)
      expect(binding.description.length).toBeGreaterThan(0)
    }
  })

  it("keeps the always-visible hint short enough for a narrow terminal", () => {
    expect(KEYMAP_HINT).toContain("F1")
    expect(KEYMAP_HINT.length).toBeLessThanOrEqual(20)
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
  it("lists the shell's chords first, then the editor's", () => {
    expect(HELP_ENTRIES).toEqual([...COCKPIT_KEYMAP, ...EDITOR_KEYMAP])
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

  it("names Escape twice, in the order the shell resolves it", () => {
    const escapes = HELP_ENTRIES.map((entry, index) => ({ index, keys: entry.keys })).filter((e) => e.keys === "Esc")
    // Help first: while the panel is open it consumes Escape, and only then does the
    // editor's interrupt become reachable.
    expect(escapes.map((e) => e.index)).toEqual([3, 6])
  })

  it("documents the hand-off, since its chord is the one the product turns on", () => {
    expect(HELP_ENTRIES.map((entry) => entry.keys)).toContain("Ctrl+T")
  })

  it("omits both overlays' keys, which are unreachable from the cockpit", () => {
    for (const binding of [...APPROVAL_KEYMAP, ...HANDOFF_KEYMAP]) {
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

  it("maps Space to keep/drop and a bare e to the summary editor", () => {
    expect(matchHandoffCommand(key("space"))).toBe("toggle-item")
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
    expect(commands).toEqual(["prev-item", "next-item", "toggle-item", "edit-summary", "confirm", "cancel"])
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
