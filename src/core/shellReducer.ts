/**
 * The pure writer for the protocol-free semantic shell slice.
 *
 * High-frequency terminal cells stay in the imperative shell runtime; this
 * reducer stores only stable command, cwd, status, and render-revision state.
 * Every transition uses structural sharing and performs no I/O.
 */

import type { ShellEvent, ShellState } from "./types.ts"

/** Fixed semantic command-history bound; oldest records are evicted first. */
export const MAX_SHELL_COMMANDS = 50

/** Create the empty semantic state for the persistent shell. */
export function createShellState(): ShellState {
  return {
    status: "idle",
    cwd: "",
    commands: [],
    renderRev: 0,
  }
}

/** Fold one shell event into a new state without mutating the input. */
export function shellReducer(state: ShellState, event: ShellEvent): ShellState {
  switch (event.kind) {
    case "screen":
      return { ...state, renderRev: event.rev }

    case "command_started": {
      const commands = [
        ...state.commands,
        { id: event.id, command: event.command, output: "", exitCode: null },
      ].slice(-MAX_SHELL_COMMANDS)
      return { ...state, status: "running", commands }
    }

    case "command_finished":
      return {
        ...state,
        status: "idle",
        commands: state.commands.map((command) =>
          command.id === event.id
            ? { ...command, output: event.output, exitCode: event.exitCode }
            : command,
        ),
      }

    case "cwd_changed":
      return { ...state, cwd: event.cwd }

    default:
      return assertNever(event)
  }
}

/** Exhaustiveness guard: a compile error here means an event kind is unhandled. */
function assertNever(event: never): never {
  throw new Error(`Unhandled shell event: ${JSON.stringify(event)}`)
}
