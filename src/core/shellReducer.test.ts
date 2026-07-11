import { describe, expect, it } from "bun:test"

import { MAX_SHELL_COMMANDS, createShellState, shellReducer } from "./shellReducer.ts"
import type { ShellEvent, ShellState } from "./types.ts"

// Suite: pure shell reducer
// Invariant: valid shell events produce immutable, bounded semantic shell state transitions.
// Boundary IN: ShellState factories and ShellEvent sequence reduction.
// Boundary OUT: PTY I/O, terminal emulation, store wiring, and hand-off assembly.

const fold = (events: ShellEvent[], start: ShellState = createShellState()): ShellState =>
  events.reduce(shellReducer, start)

describe("createShellState", () => {
  it("starts empty and idle", () => {
    expect(createShellState()).toEqual({
      status: "idle",
      cwd: "",
      commands: [],
      renderRev: 0,
    })
  })
})

describe("command events", () => {
  it("opens a command record and marks the shell running", () => {
    const state = shellReducer(createShellState(), {
      kind: "command_started",
      id: "cmd-1",
      command: "bun test",
    })

    expect(state.status).toBe("running")
    expect(state.commands).toEqual([
      { id: "cmd-1", command: "bun test", output: "", exitCode: null },
    ])
  })

  it("closes only the matching command record and marks the shell idle", () => {
    const running = fold([
      { kind: "command_started", id: "cmd-1", command: "first" },
      { kind: "command_started", id: "cmd-2", command: "second" },
    ])

    const state = shellReducer(running, {
      kind: "command_finished",
      id: "cmd-2",
      exitCode: 7,
      output: "failed\n",
    })

    expect(state.status).toBe("idle")
    expect(state.commands).toEqual([
      { id: "cmd-1", command: "first", output: "", exitCode: null },
      { id: "cmd-2", command: "second", output: "failed\n", exitCode: 7 },
    ])
  })

  it("drops the oldest command after the fixed ring cap is exceeded", () => {
    const events: ShellEvent[] = Array.from({ length: MAX_SHELL_COMMANDS + 1 }, (_, index) => ({
      kind: "command_started",
      id: `cmd-${index}`,
      command: `command ${index}`,
    }))

    const state = fold(events)

    expect(state.commands).toHaveLength(MAX_SHELL_COMMANDS)
    expect(state.commands[0]?.id).toBe("cmd-1")
    expect(state.commands.at(-1)?.id).toBe(`cmd-${MAX_SHELL_COMMANDS}`)
  })
})

describe("cwd and screen events", () => {
  it("updates cwd without replacing command records", () => {
    const before = fold([{ kind: "command_started", id: "cmd-1", command: "pwd" }])

    const state = shellReducer(before, { kind: "cwd_changed", cwd: "/workspace/kitten" })

    expect(state.cwd).toBe("/workspace/kitten")
    expect(state.commands).toBe(before.commands)
    expect(state.status).toBe(before.status)
    expect(state.renderRev).toBe(before.renderRev)
  })

  it("updates renderRev without touching other shell state", () => {
    const before: ShellState = {
      status: "running",
      cwd: "/workspace/kitten",
      commands: [{ id: "cmd-1", command: "bun test", output: "running", exitCode: null }],
      renderRev: 3,
    }

    const state = shellReducer(before, { kind: "screen", rev: 4 })

    expect(state.renderRev).toBe(4)
    expect(state.status).toBe(before.status)
    expect(state.cwd).toBe(before.cwd)
    expect(state.commands).toBe(before.commands)
  })
})

describe("purity", () => {
  it("returns a new object without mutating the input state or command records", () => {
    const command = Object.freeze({
      id: "cmd-1",
      command: "false",
      output: "",
      exitCode: null,
    })
    const commands = Object.freeze([command])
    const before = Object.freeze({
      status: "running" as const,
      cwd: "/workspace",
      commands: commands as unknown as ShellState["commands"],
      renderRev: 0,
    })

    const state = shellReducer(before, {
      kind: "command_finished",
      id: "cmd-1",
      exitCode: 1,
      output: "boom\n",
    })

    expect(state).not.toBe(before)
    expect(state.commands).not.toBe(before.commands)
    expect(state.commands[0]).not.toBe(command)
    expect(before.commands[0]?.exitCode).toBeNull()
  })
})

describe("exhaustiveness guard", () => {
  it("rejects an unexpected runtime event kind", () => {
    const invalidEvent = { kind: "unexpected" } as unknown as ShellEvent

    expect(() => shellReducer(createShellState(), invalidEvent)).toThrow("Unhandled shell event")
  })
})

describe("integration: folding a realistic shell sequence", () => {
  it("retains cwd and two closed commands with their exit codes", () => {
    const state = fold([
      { kind: "command_started", id: "cmd-1", command: "bun test" },
      { kind: "command_finished", id: "cmd-1", exitCode: 0, output: "ok\n" },
      { kind: "cwd_changed", cwd: "/workspace/kitten/src" },
      { kind: "command_started", id: "cmd-2", command: "git status --short" },
      { kind: "command_finished", id: "cmd-2", exitCode: 2, output: "bad\n" },
    ])

    expect(state.cwd).toBe("/workspace/kitten/src")
    expect(state.status).toBe("idle")
    expect(state.commands).toEqual([
      { id: "cmd-1", command: "bun test", output: "ok\n", exitCode: 0 },
      { id: "cmd-2", command: "git status --short", output: "bad\n", exitCode: 2 },
    ])
  })
})
