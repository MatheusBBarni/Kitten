import { describe, expect, test } from "bun:test"

import type { FrameScheduler } from "../agent/agentConnection.ts"
import {
  createInMemoryShellRuntimeFactory,
  type ShellRuntime,
  type StyledLine,
} from "./shellRuntime.ts"
import { prepareShellSpawn } from "./shellIntegration.ts"
import type { ShellEvent } from "../core/types.ts"

// Suite: xterm-backed shell semantic integration
// Invariant: OSC-integrated output emits trustworthy command, output, exit-code, and cwd events.
// Boundary IN: ShellRuntime, real @xterm/headless parser, and shell spawn selection.
// Boundary OUT: Native PTY process behavior, owned by test/shellRuntime.integration.test.ts.

class ManualFrameScheduler implements FrameScheduler {
  scheduled = 0
  private pending: (() => void) | null = null

  schedule(flush: () => void): void {
    if (this.pending) return
    this.scheduled += 1
    this.pending = flush
  }

  flush(): void {
    const pending = this.pending
    this.pending = null
    pending?.()
  }

  dispose(): void {
    this.pending = null
  }
}

const lineText = (line: StyledLine): string => line.runs.map((run) => run.text).join("")

function setup(overrides: { scheduler?: FrameScheduler; cols?: number; rows?: number } = {}): {
  runtime: ShellRuntime
  harness: ReturnType<typeof createInMemoryShellRuntimeFactory>
} {
  const harness = createInMemoryShellRuntimeFactory()
  const runtime = harness.factory({
    cwd: "/workspace",
    cols: overrides.cols ?? 20,
    rows: overrides.rows ?? 4,
    scheduler: overrides.scheduler,
  })
  return { runtime, harness }
}

describe("ShellRuntime in-memory factory", () => {
  test("scripted bytes render visible rows as styled runs", async () => {
    const { runtime, harness } = setup()

    await harness.scriptOutput("plain\r\n\u001b[31;1mred\u001b[0m")

    const view = runtime.view()
    expect(view).toHaveLength(4)
    expect(lineText(view[0]!)).toBe("plain")
    expect(lineText(view[1]!)).toBe("red")
    expect(view[1]!.runs).toEqual([
      {
        text: "red",
        foreground: { mode: "palette", value: 1 },
        bold: true,
        italic: false,
        dim: false,
        underline: false,
        blink: false,
        inverse: false,
        invisible: false,
        strikethrough: false,
        overline: false,
      },
    ])

    await runtime.dispose()
  })

  test("interrupt writes only the Ctrl+C byte", async () => {
    const { runtime, harness } = setup()

    runtime.interrupt()

    expect(harness.writes).toHaveLength(1)
    expect([...harness.writes[0]!]).toEqual([0x03])
    await runtime.dispose()
  })

  test("resize forwards dimensions to the PTY and emulator", async () => {
    const { runtime, harness } = setup()

    runtime.resize(42, 7)

    expect(harness.resizes).toEqual([{ cols: 42, rows: 7 }])
    expect(runtime.view()).toHaveLength(7)
    await runtime.dispose()
  })

  test("multiple output chunks within one frame emit one screen event", async () => {
    const scheduler = new ManualFrameScheduler()
    const { runtime, harness } = setup({ scheduler })
    const screens: number[] = []
    runtime.onEvent((event) => {
      if (event.kind === "screen") screens.push(event.rev)
    })

    await harness.scriptOutput("one")
    await harness.scriptOutput("two")

    expect(scheduler.scheduled).toBe(1)
    expect(screens).toEqual([])
    scheduler.flush()
    expect(screens).toEqual([1])
    await runtime.dispose()
  })

  test("scripted semantic events update subscribers and the stable snapshot", async () => {
    const { runtime, harness } = setup()
    const kinds: string[] = []
    const unsubscribe = runtime.onEvent((event) => kinds.push(event.kind))

    harness.emit({ kind: "cwd_changed", cwd: "/workspace/next" })
    harness.emit({ kind: "command_started", id: "cmd-1", command: "pwd" })
    harness.emit({ kind: "command_finished", id: "cmd-1", exitCode: 0, output: "" })
    unsubscribe()

    expect(kinds).toEqual(["cwd_changed", "command_started", "command_finished"])
    expect(runtime.snapshot()).toEqual({
      cwd: "/workspace/next",
      commands: [{ id: "cmd-1", command: "pwd", output: "", exitCode: 0 }],
    })
    await runtime.dispose()
  })

  test("OSC 133 command boundaries emit a successful command with captured output", async () => {
    const { runtime, harness } = setup()
    const events: ShellEvent[] = []
    runtime.onEvent((event) => {
      if (event.kind !== "screen") events.push(event)
    })

    await harness.scriptOutput("\u001b]133;A\u0007\u001b]133;B\u0007\u001b]133;C;printf%20hello\u0007hel")
    await harness.scriptOutput("lo\r\n\u001b]133;D;")
    await harness.scriptOutput("0\u0007")

    expect(events).toEqual([
      { kind: "command_started", id: "shell-command-1", command: "printf hello" },
      {
        kind: "command_finished",
        id: "shell-command-1",
        exitCode: 0,
        output: "hello\n",
      },
    ])
    expect(runtime.snapshot().commands[0]).toEqual({
      id: "shell-command-1",
      command: "printf hello",
      output: "hello\n",
      exitCode: 0,
    })
    await runtime.dispose()
  })

  test("OSC 133 preserves a failing exit code", async () => {
    const { runtime, harness } = setup()
    const finished: Extract<ShellEvent, { kind: "command_finished" }>[] = []
    runtime.onEvent((event) => {
      if (event.kind === "command_finished") finished.push(event)
    })

    await harness.scriptOutput("\u001b]133;C;false\u0007\u001b]133;D;1\u0007")

    expect(finished).toEqual([
      { kind: "command_finished", id: "shell-command-1", exitCode: 1, output: "" },
    ])
    await runtime.dispose()
  })

  test("OSC 7 decodes a file URL cwd", async () => {
    const { runtime, harness } = setup()
    const cwdEvents: string[] = []
    runtime.onEvent((event) => {
      if (event.kind === "cwd_changed") cwdEvents.push(event.cwd)
    })

    await harness.scriptOutput("\u001b]7;file://host/tmp\u0007")

    expect(cwdEvents).toEqual(["/tmp"])
    expect(runtime.snapshot().cwd).toBe("/tmp")
    await runtime.dispose()
  })

  test("OSC 133 derives standard command text from the prompt buffer when C has no payload", async () => {
    const { runtime, harness } = setup()

    await harness.scriptOutput("\u001b]133;B\u0007echo ok\r\n\u001b]133;C\u0007ok\r\n\u001b]133;D;0\u0007")

    expect(runtime.snapshot().commands[0]?.command).toBe("echo ok")
    expect(runtime.snapshot().commands[0]?.output).toBe("ok\n")
    await runtime.dispose()
  })

  test("raw output and malformed integration sequences emit no semantic guesses", async () => {
    const { runtime, harness } = setup()
    const semanticEvents: ShellEvent[] = []
    runtime.onEvent((event) => {
      if (event.kind !== "screen") semanticEvents.push(event)
    })

    await harness.scriptOutput("plain output\r\n\u001b]7;https://example.com/tmp\u0007\u001b]133;D;oops\u0007")

    expect(semanticEvents).toEqual([])
    expect(runtime.snapshot()).toEqual({ cwd: "/workspace", commands: [] })
    expect(runtime.view().some((line) => lineText(line).includes("plain output"))).toBe(true)
    await runtime.dispose()
  })

  test("unsupported shells and an explicit disable skip injection", () => {
    const unsupported = prepareShellSpawn("/bin/fish", { HOME: "/tmp" }, true)
    const disabled = prepareShellSpawn("/bin/bash", { HOME: "/tmp" }, false)

    expect(unsupported.integrated).toBe(false)
    expect(unsupported.cmd).toEqual(["/bin/fish", "-i"])
    expect(disabled.integrated).toBe(false)
    expect(disabled.cmd).toEqual(["/bin/bash", "-i"])
  })

  test("dispose never throws and makes writes no-ops", async () => {
    const { runtime, harness } = setup()
    runtime.write(Uint8Array.of(1, 2))

    await expect(runtime.dispose()).resolves.toBeUndefined()
    await expect(runtime.dispose()).resolves.toBeUndefined()
    runtime.write(Uint8Array.of(3, 4))

    expect(harness.disposed).toBe(true)
    expect(harness.writes.map((bytes) => [...bytes])).toEqual([[1, 2]])
    expect(runtime.view()).toEqual([])
  })
})
