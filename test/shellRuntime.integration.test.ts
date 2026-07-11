import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ShellEvent, ShellSnapshot } from "../src/core/types.ts"
import { createShellRuntime, type ShellRuntime, type StyledLine } from "../src/shell/shellRuntime.ts"

// Suite: real POSIX shell semantic integration
// Invariant: shipped bash/zsh hooks produce real cwd, command, output, and exit-code state.
// Boundary IN: Bun.Terminal, bash/zsh startup injection, xterm OSC parsing, and ShellRuntime.
// Boundary OUT: Controller/store wiring and hand-off assembly.

const encoder = new TextEncoder()

const lineText = (line: StyledLine): string => line.runs.map((run) => run.text).join("")

async function waitForView(runtime: ShellRuntime, predicate: (lines: readonly StyledLine[]) => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (predicate(runtime.view())) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for shell view:\n${runtime.view().map(lineText).join("\n")}`)
}

function waitForEvent(runtime: ShellRuntime, predicate: (event: ShellEvent) => boolean): Promise<ShellEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for shell event; snapshot: ${JSON.stringify(runtime.snapshot())}`))
    }, 3_000)
    const unsubscribe = runtime.onEvent((event) => {
      if (!predicate(event)) return
      clearTimeout(timeout)
      unsubscribe()
      resolve(event)
    })
  })
}

async function waitForSnapshot(
  runtime: ShellRuntime,
  predicate: (snapshot: ShellSnapshot) => boolean,
): Promise<ShellSnapshot> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const snapshot = runtime.snapshot()
    if (predicate(snapshot)) return snapshot
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for shell snapshot: ${JSON.stringify(runtime.snapshot())}`)
}

function createDefaultShellRuntimeForTest(): ShellRuntime {
  const originalShell = process.env.SHELL
  process.env.SHELL = "/bin/sh"
  try {
    return createShellRuntime({ cwd: process.cwd(), cols: 100, rows: 12 })
  } finally {
    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell
  }
}

test("real PTY shell renders echo output through xterm", async () => {
  // Exercise the default `$SHELL` selection without inheriting workstation rc files.
  const runtime = createDefaultShellRuntimeForTest()
  try {
    runtime.write(encoder.encode("echo hello\n"))

    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).trim() === "hello"))
    expect(runtime.view().map(lineText)).toContain("hello")
  } finally {
    await runtime.dispose()
  }
})

test("real PTY colored output preserves its ANSI foreground", async () => {
  const runtime = createShellRuntime({ cwd: process.cwd(), command: "/bin/sh", cols: 100, rows: 12 })
  try {
    runtime.write(encoder.encode("printf '\\033[31m__KITTEN_RED__\\033[0m\\n'\n"))

    await waitForView(runtime, (lines) =>
      lines.some((line) =>
        line.runs.some(
          (run) => run.text.includes("__KITTEN_RED__") && run.foreground?.mode === "palette" && run.foreground.value === 1,
        ),
      ),
    )

    const redRun = runtime
      .view()
      .flatMap((line) => line.runs)
      .find((run) => run.text.includes("__KITTEN_RED__") && run.foreground?.mode === "palette")
    expect(redRun?.foreground).toEqual({ mode: "palette", value: 1 })
  } finally {
    await runtime.dispose()
  }
})

test("bash integration reports cd cwd and a failing command", async () => {
  const home = mkdtempSync(join(tmpdir(), "kitten-bash-home-"))
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: "/bin/bash",
    env: { HOME: home },
    cols: 100,
    rows: 12,
  })
  try {
    await waitForEvent(runtime, (event) => event.kind === "cwd_changed")
    runtime.write(encoder.encode("printf '__KITTEN_BASH_PIPE__\\n' | cat\ncd /tmp\nfalse\n"))

    const snapshot = await waitForSnapshot(
      runtime,
      (value) => value.cwd === "/tmp" && value.commands.some((command) => command.exitCode === 1),
    )
    const piped = snapshot.commands.find((command) => command.command.includes("| cat"))
    const failed = snapshot.commands.find((command) => command.command === "false")
    expect(snapshot.cwd).toBe("/tmp")
    expect(piped?.command).toBe("printf '__KITTEN_BASH_PIPE__\\n' | cat")
    expect(piped?.output).toBe("__KITTEN_BASH_PIPE__\n")
    expect(failed).toEqual({
      id: expect.stringMatching(/^shell-command-/),
      command: "false",
      output: "",
      exitCode: 1,
    })
  } finally {
    await runtime.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test("zsh integration reports a successful command and its output", async () => {
  const zsh = Bun.which("zsh")
  if (!zsh) throw new Error("zsh is required for the shell integration contract test")

  const home = mkdtempSync(join(tmpdir(), "kitten-zsh-home-"))
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: zsh,
    env: { HOME: home, ZDOTDIR: undefined },
    cols: 100,
    rows: 12,
  })
  try {
    await waitForEvent(runtime, (event) => event.kind === "cwd_changed")
    runtime.write(encoder.encode("printf '__KITTEN_ZSH_OK__\\n'\n"))

    const snapshot = await waitForSnapshot(runtime, (value) =>
      value.commands.some((command) => command.exitCode === 0 && command.output.includes("__KITTEN_ZSH_OK__")),
    )
    const successful = snapshot.commands.find((command) => command.command.startsWith("printf "))
    expect(successful?.exitCode).toBe(0)
    expect(successful?.output).toBe("__KITTEN_ZSH_OK__\n")
  } finally {
    await runtime.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})

test("bash with an existing DEBUG integration keeps rendering without duplicate semantic events", async () => {
  const home = mkdtempSync(join(tmpdir(), "kitten-existing-bash-home-"))
  writeFileSync(join(home, ".bashrc"), "trap ':' DEBUG\nPS1='existing$ '\n")
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: "/bin/bash",
    env: { HOME: home },
    cols: 100,
    rows: 12,
  })
  const semanticEvents: ShellEvent[] = []
  runtime.onEvent((event) => {
    if (event.kind !== "screen") semanticEvents.push(event)
  })

  try {
    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).includes("existing$")))
    runtime.write(encoder.encode("echo __KITTEN_RAW_ONLY__\n"))
    await waitForView(runtime, (lines) =>
      lines.some((line) => lineText(line).trim() === "__KITTEN_RAW_ONLY__"),
    )

    expect(semanticEvents).toEqual([])
    expect(runtime.snapshot().commands).toEqual([])
  } finally {
    await runtime.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})
