import { describe, expect, it } from "bun:test"

import { COCKPIT_KEYMAP, KEYMAP_HINT, matchCommand, type CockpitKey } from "./keymap.ts"

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
