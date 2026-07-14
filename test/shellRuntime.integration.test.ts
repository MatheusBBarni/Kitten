import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createSessionController, type SessionController } from "../src/app/controller.ts"
import type { AppConfig, ShellEvent, ShellSnapshot } from "../src/core/types.ts"
import {
  createShellRuntime,
  type ShellRuntime,
  type ShellSpawnOptions,
  type StyledLine,
} from "../src/shell/shellRuntime.ts"

// Suite: real POSIX shell and controller ownership integration
// Invariant: real PTY output becomes semantic store state and the controller reaps its shell.
// Boundary IN: Bun.Terminal, shell startup, xterm parsing, ShellRuntime, controller, and store.
// Boundary OUT: UI rendering and hand-off assembly.

const encoder = new TextEncoder()
const zsh = Bun.which("zsh")

const lineText = (line: StyledLine): string => line.runs.map((run) => run.text).join("")

const CONTROLLER_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
    codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
  } as unknown as AppConfig["providers"],
  sessions: [{ provider: "claude-code", cwd: process.cwd() }],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 2_500 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
  statusline: { llmDisclosureAcknowledged: false, layout: null },
}

function createReadyConnection(): AgentConnection {
  return {
    id: "claude-code",
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: false }),
    newSession: async () => "controller-shell-agent-session",
    loadSession: async () => {},
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate: () => () => {},
    onPermission() {},
    onClarification: () => () => {},
    dispose: async () => {},
  }
}

async function createControllerWithRealShell(
  cwd: string,
): Promise<{ controller: SessionController; spawnOptions: ShellSpawnOptions }> {
  let spawnOptions: ShellSpawnOptions | undefined
  const controller = await createSessionController({
    config: { ...CONTROLLER_CONFIG, sessions: [{ provider: "claude-code", cwd }] },
    cwd,
    createConnection: () => createReadyConnection(),
    createShellRuntime: (options) => {
      spawnOptions = options
      return createShellRuntime({ ...options, command: "/bin/sh", cols: 100, rows: 12 })
    },
    readBranch: async () => null,
  })
  if (!spawnOptions) throw new Error("controller did not invoke the real shell factory")
  return { controller, spawnOptions }
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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

test("Ctrl+C interrupts a foreground command and leaves the real shell usable", async () => {
  const runtime = createShellRuntime({ cwd: process.cwd(), command: "/bin/sh", cols: 100, rows: 12 })
  const started = "__KITTEN_RUNAWAY_STARTED__"
  const interrupted = "__KITTEN_INTERRUPTED__"
  const recovered = "__KITTEN_AFTER_INTERRUPT__"
  const scriptDirectory = mkdtempSync(join(tmpdir(), "kitten-interrupt-"))
  const script = join(scriptDirectory, "foreground-command.sh")
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `trap 'printf "${interrupted}\\n"; exit 130' INT`,
      `printf "${started}\\n"`,
      "while :; do sleep 30; done",
    ].join("\n"),
  )
  try {
    // The child installs its signal handler before publishing readiness. This makes
    // the observed marker a real foreground-process boundary rather than a guess
    // about when the shell has finished spawning `sleep`.
    runtime.write(encoder.encode(`/bin/sh ${JSON.stringify(script)}\n`))
    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).trim() === started))

    runtime.interrupt()
    // The terminal echoes Ctrl+C as `^C` immediately before the trap's output.
    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).includes(interrupted)))
    runtime.write(encoder.encode(`printf '${recovered}\\n'\n`))

    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).trim() === recovered))
    expect(runtime.view().map(lineText)).toContain(recovered)
  } finally {
    await runtime.dispose()
    rmSync(scriptDirectory, { recursive: true, force: true })
  }
})

test("real PTY alternate-screen script renders its buffer and returns to primary output", async () => {
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: "/bin/sh",
    cols: 80,
    rows: 12,
    shellIntegration: false,
  })
  const alternateMarker = "__KITTEN_ALT_SCREEN__"
  const restoredMarker = "__KITTEN_PRIMARY_RESTORED__"
  try {
    runtime.write(
      encoder.encode(
        `printf '\\033[?1049h\\033[2J\\033[H${alternateMarker}'; ` +
          `sleep 0.2; printf '\\033[?1049l${restoredMarker}\\n'\n`,
      ),
    )

    await waitForCondition(
      () => runtime.bufferType() === "alternate" && runtime.view().some((line) => lineText(line).includes(alternateMarker)),
      "alternate-screen content",
    )
    expect(runtime.bufferType()).toBe("alternate")
    expect(runtime.view().map(lineText).join("\n")).toContain(alternateMarker)

    await waitForCondition(
      () => runtime.bufferType() === "normal" && runtime.view().some((line) => lineText(line).includes(restoredMarker)),
      "primary buffer restore",
    )
    expect(runtime.bufferType()).toBe("normal")
    expect(runtime.view().map(lineText).join("\n")).toContain(restoredMarker)
  } finally {
    await runtime.dispose()
  }
})

test("real vi edit and quit restores the shell with cwd and env continuity", async () => {
  const editor = Bun.which("vi")
  if (!editor) throw new Error("vi is required for the interactive editor integration test")

  const cwd = mkdtempSync(join(tmpdir(), "kitten-interactive-editor-"))
  const shellCwd = realpathSync(cwd)
  const home = join(cwd, "home")
  mkdirSync(home)
  const file = join(cwd, "note.txt")
  const runtime = createShellRuntime({
    cwd,
    command: "/bin/sh",
    env: { HOME: home },
    cols: 200,
    rows: 20,
    shellIntegration: false,
  })
  const continuityMarker = "__KITTEN_CONTINUITY__"
  try {
    runtime.write(encoder.encode(`export KITTEN_APP_CONTINUITY=preserved; '${editor}' note.txt\n`))
    await waitForCondition(() => runtime.bufferType() === "alternate", "vi alternate screen")

    runtime.write(encoder.encode("ihello from kitten\u001b:wq\r"))
    await waitForCondition(
      () => runtime.bufferType() === "normal" && readFileSync(file, "utf8") === "hello from kitten\n",
      "vi save and primary-buffer restore",
    )

    runtime.write(
      encoder.encode(`printf '${continuityMarker}%s|%s\\n' "$PWD" "$KITTEN_APP_CONTINUITY"\n`),
    )
    await waitForView(runtime, (lines) =>
      lines.some((line) => lineText(line).includes(`${continuityMarker}${shellCwd}|preserved`)),
    )

    expect(runtime.bufferType()).toBe("normal")
    expect(readFileSync(file, "utf8")).toBe("hello from kitten\n")
    expect(runtime.view().map(lineText).join("\n")).toContain(`${continuityMarker}${shellCwd}|preserved`)
  } finally {
    await runtime.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("controller opens the real shell in cwd and routes echo semantics into the store", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kitten-controller-shell-"))
  const shellCwd = realpathSync(cwd)
  const { controller, spawnOptions } = await createControllerWithRealShell(cwd)
  try {
    expect(spawnOptions.cwd).toBe(cwd)
    expect(spawnOptions.command).toBe("/bin/sh")
    expect(spawnOptions.scrollback).toBe(2_500)
    if (!controller.shell.ready) throw new Error(controller.shell.error)
    const marker = "__KITTEN_CONTROLLER_ECHO__"
    controller.shell.runtime.write(
      encoder.encode(
        `printf '\\033]7;file://localhost%s\\007' "$PWD"; ` +
          `printf '\\033]133;C;echo%%20${marker}\\007'; ` +
          `echo '${marker}'; printf '\\033]133;D;0\\007'\n`,
      ),
    )

    await waitForCondition(() => {
      const shell = controller.store.getState().shell
      return shell.cwd === shellCwd && shell.commands.some((command) => command.output.includes(marker))
    }, "controller shell cwd and echo event")

    expect(controller.store.getState().shell).toMatchObject({ cwd: shellCwd, status: "idle" })
    expect(controller.store.getState().shell.commands.at(-1)).toMatchObject({
      command: `echo ${marker}`,
      output: expect.stringContaining(marker),
      exitCode: 0,
    })
  } finally {
    await controller.dispose()
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("controller disposal terminates the real shell process", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "kitten-controller-shell-dispose-"))
  const { controller } = await createControllerWithRealShell(cwd)
  let disposed = false
  try {
    if (!controller.shell.ready) throw new Error(controller.shell.error)
    const pidPrefix = "__KITTEN_CONTROLLER_PID__"
    controller.shell.runtime.write(encoder.encode(`printf '${pidPrefix}%s\\n' "$$"\n`))
    await waitForView(controller.shell.runtime, (lines) =>
      lines.some((line) => lineText(line).includes(pidPrefix) && new RegExp(`${pidPrefix}\\d+`).test(lineText(line))),
    )

    const output = controller.shell.runtime.view().map(lineText).join("\n")
    const pid = Number.parseInt(output.match(new RegExp(`${pidPrefix}(\\d+)`))?.[1] ?? "", 10)
    expect(Number.isSafeInteger(pid)).toBe(true)
    expect(isProcessRunning(pid)).toBe(true)

    await controller.dispose()
    disposed = true
    await waitForCondition(() => !isProcessRunning(pid), "controller-owned shell process to exit")
    expect(isProcessRunning(pid)).toBe(false)
  } finally {
    if (!disposed) await controller.dispose()
    rmSync(cwd, { recursive: true, force: true })
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
  writeFileSync(join(home, ".bashrc"), "PS1='__KITTEN_BASH_PROMPT__ '\n")
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: "/bin/bash",
    env: { HOME: home },
    cols: 100,
    rows: 12,
  })
  try {
    await waitForEvent(runtime, (event) => event.kind === "cwd_changed")
    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).includes("__KITTEN_BASH_PROMPT__")))
    expect(runtime.view().map(lineText).join("\n")).not.toContain("\\033]133;B\\007")
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

test.skipIf(!zsh)("zsh integration reports a successful command and its output", async () => {
  if (!zsh) return

  const home = mkdtempSync(join(tmpdir(), "kitten-zsh-home-"))
  writeFileSync(join(home, ".zshrc"), "PS1='__KITTEN_ZSH_PROMPT__ '\n")
  const runtime = createShellRuntime({
    cwd: process.cwd(),
    command: zsh,
    env: { HOME: home, ZDOTDIR: undefined },
    cols: 100,
    rows: 12,
  })
  try {
    await waitForEvent(runtime, (event) => event.kind === "cwd_changed")
    await waitForView(runtime, (lines) => lines.some((line) => lineText(line).includes("__KITTEN_ZSH_PROMPT__")))
    expect(runtime.view().map(lineText).join("\n")).not.toContain("\\033]133;B\\007")
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
