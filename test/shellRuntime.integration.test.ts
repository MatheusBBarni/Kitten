import { expect, test } from "bun:test"

import { createShellRuntime, type ShellRuntime, type StyledLine } from "../src/shell/shellRuntime.ts"

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
