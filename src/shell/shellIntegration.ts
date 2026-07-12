/** Shell startup injection and OSC 133/7 parsing (integrated-shell ADR-004). */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import type { Terminal } from "@xterm/headless"

import type { ShellEvent } from "../core/types.ts"
import bashSnippet from "./assets/bashIntegration.bash" with { type: "text" }
import zshSnippet from "./assets/zshIntegration.zsh" with { type: "text" }

type ShellEnvironment = Record<string, string | undefined>

export interface PreparedShellSpawn {
  readonly cmd: string[]
  readonly env: ShellEnvironment
  readonly integrated: boolean
  dispose(): void
}

/** Prepare a shell-specific rc hook, or return the ordinary interactive command. */
export function prepareShellSpawn(
  command: string,
  env: ShellEnvironment,
  integrationEnabled: boolean,
): PreparedShellSpawn {
  const plain = (): PreparedShellSpawn => ({
    cmd: [command, "-i"],
    env,
    integrated: false,
    dispose() {},
  })

  if (!integrationEnabled) return plain()

  const shell = basename(command).replace(/^-/, "")
  if (shell !== "bash" && shell !== "zsh") return plain()

  const directory = mkdtempSync(join(tmpdir(), "kitten-shell-integration-"))
  const integrationPath = join(directory, shell === "bash" ? "integration.bash" : "integration.zsh")
  writeFileSync(integrationPath, shell === "bash" ? bashSnippet : zshSnippet, { mode: 0o600 })

  const preparedEnv: ShellEnvironment = {
    ...env,
    // A flag inherited by the Kitten process belongs to its parent PTY. The
    // newly spawned PTY needs its own hooks; nested shells will inherit the
    // flag again after the snippet exports it and correctly avoid duplication.
    KITTEN_SHELL_INTEGRATION_ACTIVE: undefined,
    KITTEN_SHELL_INTEGRATION_SCRIPT: integrationPath,
  }

  let cmd: string[]
  if (shell === "bash") {
    const userRc = env.HOME ? join(env.HOME, ".bashrc") : ""
    const wrapperPath = join(directory, "bashrc")
    writeFileSync(
      wrapperPath,
      'if [[ -n ${KITTEN_USER_BASH_RC:-} && -r $KITTEN_USER_BASH_RC ]]; then source "$KITTEN_USER_BASH_RC"; fi\n' +
        'KITTEN_EXISTING_BASH_DEBUG_TRAP=$(trap -p DEBUG)\n' +
        'source "$KITTEN_SHELL_INTEGRATION_SCRIPT"\n',
      { mode: 0o600 },
    )
    preparedEnv.KITTEN_USER_BASH_RC = userRc
    cmd = [command, "--rcfile", wrapperPath, "-i"]
  } else {
    const originalZdotdir = env.ZDOTDIR || env.HOME || ""
    writeFileSync(
      join(directory, ".zshenv"),
      'if [[ -n ${KITTEN_USER_ZDOTDIR:-} && -r $KITTEN_USER_ZDOTDIR/.zshenv ]]; then source "$KITTEN_USER_ZDOTDIR/.zshenv"; fi\n' +
        'export ZDOTDIR="$KITTEN_INTEGRATION_ZDOTDIR"\n',
      { mode: 0o600 },
    )
    writeFileSync(
      join(directory, ".zshrc"),
      'if [[ -n ${KITTEN_USER_ZDOTDIR:-} && -r $KITTEN_USER_ZDOTDIR/.zshrc ]]; then source "$KITTEN_USER_ZDOTDIR/.zshrc"; fi\n' +
        'source "$KITTEN_SHELL_INTEGRATION_SCRIPT"\n' +
        'export ZDOTDIR="$KITTEN_USER_ZDOTDIR"\n',
      { mode: 0o600 },
    )
    preparedEnv.KITTEN_USER_ZDOTDIR = originalZdotdir
    preparedEnv.KITTEN_INTEGRATION_ZDOTDIR = directory
    preparedEnv.ZDOTDIR = directory
    cmd = [command, "-i"]
  }

  return {
    cmd,
    env: preparedEnv,
    integrated: true,
    dispose() {
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch {
        // Runtime teardown remains best-effort.
      }
    },
  }
}

interface BufferPosition {
  readonly line: number
  readonly column: number
}

/** Register semantic-prompt handlers directly on xterm's OSC parser boundary. */
export function registerShellIntegration(
  terminal: Terminal,
  emit: (event: ShellEvent) => void,
): { dispose(): void } {
  let promptEnd: BufferPosition | null = null
  let activeCommand: { id: string; outputStart: BufferPosition } | null = null
  let nextCommandId = 1

  const semanticPrompt = terminal.parser.registerOscHandler(133, (data) => {
    const separator = data.indexOf(";")
    const marker = separator === -1 ? data : data.slice(0, separator)
    const payload = separator === -1 ? "" : data.slice(separator + 1)

    switch (marker) {
      case "A":
        promptEnd = null
        return true

      case "B":
        promptEnd = currentPosition(terminal)
        return true

      case "C": {
        if (activeCommand) return true
        const command = decodeValue(payload) ?? (promptEnd ? readBufferRange(terminal, promptEnd) : "")
        const id = `shell-command-${nextCommandId}`
        nextCommandId += 1
        activeCommand = { id, outputStart: currentPosition(terminal) }
        emit({ kind: "command_started", id, command: command.trim() })
        return true
      }

      case "D": {
        if (!activeCommand || !/^\d+$/.test(payload)) return true
        const { id, outputStart } = activeCommand
        activeCommand = null
        emit({
          kind: "command_finished",
          id,
          exitCode: Number.parseInt(payload, 10),
          output: readBufferRange(terminal, outputStart),
        })
        return true
      }

      default:
        return true
    }
  })

  const cwd = terminal.parser.registerOscHandler(7, (data) => {
    const nextCwd = parseFileCwd(data)
    if (nextCwd != null) emit({ kind: "cwd_changed", cwd: nextCwd })
    return true
  })

  return {
    dispose() {
      semanticPrompt.dispose()
      cwd.dispose()
    },
  }
}

function currentPosition(terminal: Terminal): BufferPosition {
  const buffer = terminal.buffer.active
  return { line: buffer.baseY + buffer.cursorY, column: buffer.cursorX }
}

function readBufferRange(terminal: Terminal, start: BufferPosition): string {
  const buffer = terminal.buffer.active
  const end = currentPosition(terminal)
  const firstLine = Math.max(start.line, 0)
  const lastLine = Math.max(firstLine, end.line)
  let output = ""

  for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex)
    if (!line) continue
    const startColumn = lineIndex === firstLine ? start.column : 0
    const endColumn = lineIndex === end.line ? end.column : undefined
    const text = line.translateToString(true, startColumn, endColumn)
    if (lineIndex > firstLine && !line.isWrapped) output += "\n"
    output += text
  }

  return output
}

function parseFileCwd(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "file:") return null
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}

function decodeValue(value: string): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
