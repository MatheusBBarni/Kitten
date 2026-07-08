import { describe, expect, it } from "bun:test"

import {
  COCKPIT_KEYMAP,
  EDITOR_KEYMAP,
  HELP_ENTRIES,
  KEYMAP_HINT,
  matchCommand,
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

  it("maps F1 to toggle-help and Escape to close-help", () => {
    expect(matchCommand(key("f1"))).toBe("toggle-help")
    expect(matchCommand(key("escape"))).toBe("close-help")
  })

  it("ignores a bare letter so the prompt editor keeps every printable key", () => {
    expect(matchCommand(key("o"))).toBeNull()
    expect(matchCommand(key("f"))).toBeNull()
  })

  it("ignores a chord with extra modifiers held", () => {
    expect(matchCommand(key("o", { ctrl: true, shift: true }))).toBeNull()
    expect(matchCommand(key("o", { ctrl: true, meta: true }))).toBeNull()
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
    expect(commands).toEqual(["switch-focus", "toggle-help", "close-help"])
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
    expect(escapes.map((e) => e.index)).toEqual([2, 5])
  })
})
