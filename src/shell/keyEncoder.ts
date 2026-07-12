/**
 * Structural key input accepted by the shell encoder.
 *
 * This intentionally mirrors only the OpenTUI key fields the encoder needs, so
 * the shell boundary stays independent of OpenTUI and remains a pure function.
 */
export interface ShellKey {
  readonly name: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
}

const textEncoder = new TextEncoder()

const PLAIN_SEQUENCES: Readonly<Record<string, string>> = {
  space: " ",
  return: "\r",
  kpenter: "\r",
  tab: "\t",
  backspace: "\x7f",
  escape: "\x1b",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
}

const CONTROL_BYTES: Readonly<Record<string, number>> = {
  " ": 0x00,
  space: 0x00,
  "2": 0x00,
  "@": 0x00,
  "3": 0x1b,
  "[": 0x1b,
  "4": 0x1c,
  "\\": 0x1c,
  "5": 0x1d,
  "]": 0x1d,
  "6": 0x1e,
  "^": 0x1e,
  "7": 0x1f,
  "/": 0x1f,
  "_": 0x1f,
  "8": 0x7f,
  "?": 0x7f,
}

/** Encode one structural key event as the bytes a standard xterm expects. */
export function encodeKey(key: ShellKey): Uint8Array | undefined {
  if (key.meta) return undefined

  if (key.ctrl) {
    const controlByte = encodeControlByte(key.name)
    return controlByte === undefined ? undefined : Uint8Array.of(controlByte)
  }

  if (!key.shift) {
    const sequence = PLAIN_SEQUENCES[key.name]
    if (sequence !== undefined) return textEncoder.encode(sequence)
  }

  return isSinglePrintableCodePoint(key.name) ? textEncoder.encode(key.name) : undefined
}

function encodeControlByte(name: string): number | undefined {
  if (/^[a-z]$/i.test(name)) return name.toUpperCase().charCodeAt(0) - 0x40
  return CONTROL_BYTES[name]
}

function isSinglePrintableCodePoint(value: string): boolean {
  const codePoints = [...value]
  if (codePoints.length !== 1) return false
  const codePoint = codePoints[0]?.codePointAt(0)
  return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f
}
