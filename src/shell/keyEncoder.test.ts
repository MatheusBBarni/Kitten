// Suite: key-to-VT encoder
// Invariant: every supported structural key deterministically produces its standard terminal bytes
// Boundary IN: the pure key encoder and its structural key input
// Boundary OUT: OpenTUI event construction and runtime writes, owned by test/keyEncoder.integration.test.ts

import { describe, expect, it } from "bun:test"

import { encodeKey, type ShellKey } from "./keyEncoder.ts"

function key(name: string, modifiers: Partial<ShellKey> = {}): ShellKey {
  return { name, ctrl: false, shift: false, meta: false, ...modifiers }
}

function bytes(value: Uint8Array | undefined): number[] | undefined {
  return value ? [...value] : undefined
}

describe("encodeKey", () => {
  it.each([
    ["ASCII letter", key("a"), [0x61]],
    ["space", key(" "), [0x20]],
    ["shifted character as reported", key("A", { shift: true }), [0x41]],
    ["UTF-8 printable", key("é"), [0xc3, 0xa9]],
    ["astral UTF-8 printable", key("🐈"), [0xf0, 0x9f, 0x90, 0x88]],
  ] as const)("encodes the %s", (_label, input, expected) => {
    expect(bytes(encodeKey(input))).toEqual([...expected])
  })

  it.each([
    ["Enter", key("return"), [0x0d]],
    ["keypad Enter", key("kpenter"), [0x0d]],
    ["Tab", key("tab"), [0x09]],
    ["Backspace", key("backspace"), [0x7f]],
    ["Escape", key("escape"), [0x1b]],
  ] as const)("encodes %s", (_label, input, expected) => {
    expect(bytes(encodeKey(input))).toEqual([...expected])
  })

  it.each([
    ["ArrowUp", "up", "\u001b[A"],
    ["ArrowDown", "down", "\u001b[B"],
    ["ArrowRight", "right", "\u001b[C"],
    ["ArrowLeft", "left", "\u001b[D"],
    ["Home", "home", "\u001b[H"],
    ["End", "end", "\u001b[F"],
    ["PageUp", "pageup", "\u001b[5~"],
    ["PageDown", "pagedown", "\u001b[6~"],
  ] as const)("encodes %s as the xterm sequence", (_label, name, expected) => {
    expect(new TextDecoder().decode(encodeKey(key(name)))).toBe(expected)
  })

  it.each([
    ["F1", "f1", "\u001bOP"],
    ["F2", "f2", "\u001bOQ"],
    ["F3", "f3", "\u001bOR"],
    ["F4", "f4", "\u001bOS"],
    ["F5", "f5", "\u001b[15~"],
    ["F6", "f6", "\u001b[17~"],
    ["F7", "f7", "\u001b[18~"],
    ["F8", "f8", "\u001b[19~"],
    ["F9", "f9", "\u001b[20~"],
    ["F10", "f10", "\u001b[21~"],
    ["F11", "f11", "\u001b[23~"],
    ["F12", "f12", "\u001b[24~"],
  ] as const)("encodes %s as the xterm sequence", (_label, name, expected) => {
    expect(new TextDecoder().decode(encodeKey(key(name)))).toBe(expected)
  })

  it.each([
    ["Ctrl+A", "a", 0x01],
    ["Ctrl+C", "c", 0x03],
    ["Ctrl+D", "d", 0x04],
    ["Ctrl+Z", "z", 0x1a],
    ["Ctrl+Shift+C", "C", 0x03],
    ["Ctrl+@", "@", 0x00],
    ["Ctrl+[", "[", 0x1b],
    ["Ctrl+\\", "\\", 0x1c],
    ["Ctrl+]", "]", 0x1d],
    ["Ctrl+^", "^", 0x1e],
    ["Ctrl+_", "_", 0x1f],
  ] as const)("encodes %s as one control byte", (_label, name, expected) => {
    expect(bytes(encodeKey(key(name, { ctrl: true })))).toEqual([expected])
  })

  it.each([
    ["unknown named key", key("delete")],
    ["unsupported Ctrl chord", key("1", { ctrl: true })],
    ["Meta chord", key("a", { meta: true })],
    ["modified navigation", key("up", { ctrl: true })],
    ["empty name", key("")],
  ] as const)("returns undefined for an %s", (_label, input) => {
    expect(encodeKey(input)).toBeUndefined()
  })
})
