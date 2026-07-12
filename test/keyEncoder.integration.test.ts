// Suite: OpenTUI-to-shell key encoding integration
// Invariant: a typed command line reaches the shell runtime as the exact terminal byte stream
// Boundary IN: OpenTUI KeyEvent, encodeKey, and the in-memory ShellRuntime write boundary
// Boundary OUT: PTY line discipline and shell execution, owned by test/shellRuntime.integration.test.ts

import { expect, test } from "bun:test"
import { KeyEvent } from "@opentui/core"

import { encodeKey } from "../src/shell/keyEncoder.ts"
import { createInMemoryShellRuntimeFactory } from "../src/shell/shellRuntime.ts"

function openTuiKey(name: string, sequence: string): KeyEvent {
  return new KeyEvent({
    name,
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    sequence,
    number: false,
    raw: sequence,
    eventType: "press",
    source: "raw",
  })
}

test("a typed line reaches the shell runtime as exact ls carriage-return bytes", async () => {
  const harness = createInMemoryShellRuntimeFactory()
  const runtime = harness.factory({ cwd: process.cwd() })
  try {
    for (const event of [openTuiKey("l", "l"), openTuiKey("s", "s"), openTuiKey("return", "\r")]) {
      const encoded = encodeKey(event)
      if (encoded) runtime.write(encoded)
    }

    expect(harness.writes.flatMap((chunk) => [...chunk])).toEqual([0x6c, 0x73, 0x0d])
  } finally {
    await runtime.dispose()
  }
})
