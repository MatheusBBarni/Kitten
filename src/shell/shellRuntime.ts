/**
 * Imperative PTY-backed shell runtime (integrated-shell ADR-003).
 *
 * The runtime quarantines Bun's native PTY and xterm's emulator behind a small,
 * injectable surface. High-frequency screen cells stay here; only coalesced
 * {@link ShellEvent}s cross into the immutable application store.
 */

import { Terminal } from "@xterm/headless"

import { createFrameScheduler, type FrameScheduler } from "../agent/agentConnection.ts"
import { createShellState, shellReducer } from "../core/shellReducer.ts"
import type { ShellEvent, ShellSnapshot, ShellState } from "../core/types.ts"
import { prepareShellSpawn, registerShellIntegration } from "./shellIntegration.ts"

type Unsubscribe = () => void

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_SCROLLBACK = 1_000

/** A terminal color, either an ANSI palette index or an exact 24-bit RGB value. */
export type StyledColor =
  | { readonly mode: "palette"; readonly value: number }
  | { readonly mode: "rgb"; readonly value: number }

/** One contiguous run of cells that share the same terminal attributes. */
export interface StyledRun {
  readonly text: string
  readonly foreground?: StyledColor
  readonly background?: StyledColor
  readonly bold: boolean
  readonly italic: boolean
  readonly dim: boolean
  readonly underline: boolean
  readonly blink: boolean
  readonly inverse: boolean
  readonly invisible: boolean
  readonly strikethrough: boolean
  readonly overline: boolean
}

/** One row from the active terminal buffer's visible viewport. */
export interface StyledLine {
  readonly runs: readonly StyledRun[]
  readonly isWrapped: boolean
}

/** Inputs needed to create a persistent interactive shell. */
export interface ShellSpawnOptions {
  readonly cwd: string
  readonly command?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cols?: number
  readonly rows?: number
  readonly scrollback?: number
  /** Disable semantic shell hooks while retaining the raw PTY and emulator. */
  readonly shellIntegration?: boolean
  /** Injectable frame boundary used by deterministic tests. */
  readonly scheduler?: FrameScheduler
}

/** Controller-owned shell boundary from the Integrated Shell TechSpec. */
export interface ShellRuntime {
  onEvent(cb: (event: ShellEvent) => void): Unsubscribe
  write(bytes: Uint8Array): void
  interrupt(): void
  resize(cols: number, rows: number): void
  view(): readonly StyledLine[]
  snapshot(): ShellSnapshot
  dispose(): Promise<void>
}

/** Injectable construction seam, analogous to `TransportFactory`. */
export type ShellRuntimeFactory = (options: ShellSpawnOptions) => ShellRuntime

interface ShellPty {
  write(bytes: Uint8Array): void
  resize(cols: number, rows: number): void
  dispose(): Promise<void>
}

type ShellPtyFactory = (onData: (data: Uint8Array) => void) => ShellPty

/** Spawn a real POSIX shell in Bun's native PTY. */
export const createShellRuntime: ShellRuntimeFactory = (options) => {
  if (process.platform === "win32") {
    throw new Error("The integrated shell is available on macOS and Linux only")
  }

  const cols = normalizeDimension(options.cols, DEFAULT_COLS)
  const rows = normalizeDimension(options.rows, DEFAULT_ROWS)
  const command = options.command ?? process.env.SHELL ?? "/bin/sh"

  return new ShellRuntimeImpl(
    { ...options, cols, rows },
    (onData) => createBunPty({ ...options, command, cols, rows }, onData),
  )
}

class ShellRuntimeImpl implements ShellRuntime {
  private readonly emulator: Terminal
  private readonly integration: { dispose(): void }
  private readonly pty: ShellPty
  private readonly scheduler: FrameScheduler
  private readonly subscribers = new Set<(event: ShellEvent) => void>()
  private shellState: ShellState
  private renderRev = 0
  private disposed = false

  constructor(options: ShellSpawnOptions, createPty: ShellPtyFactory) {
    const cols = normalizeDimension(options.cols, DEFAULT_COLS)
    const rows = normalizeDimension(options.rows, DEFAULT_ROWS)
    this.scheduler = options.scheduler ?? createFrameScheduler()
    this.shellState = { ...createShellState(), cwd: options.cwd }
    this.emulator = new Terminal({
      allowProposedApi: true,
      cols,
      rows,
      scrollback: Math.max(0, Math.trunc(options.scrollback ?? DEFAULT_SCROLLBACK)),
    })
    this.integration = registerShellIntegration(this.emulator, (event) => this.dispatch(event))

    try {
      this.pty = createPty((data) => {
        void this.receiveOutput(data)
      })
    } catch (error) {
      this.scheduler.dispose()
      this.integration.dispose()
      this.emulator.dispose()
      throw error
    }
  }

  onEvent(cb: (event: ShellEvent) => void): Unsubscribe {
    if (this.disposed) return () => {}
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  write(bytes: Uint8Array): void {
    if (this.disposed) return
    this.pty.write(bytes)
  }

  interrupt(): void {
    this.write(Uint8Array.of(0x03))
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    const nextCols = normalizeDimension(cols, DEFAULT_COLS)
    const nextRows = normalizeDimension(rows, DEFAULT_ROWS)
    this.pty.resize(nextCols, nextRows)
    this.emulator.resize(nextCols, nextRows)
    this.scheduleScreenEvent()
  }

  view(): readonly StyledLine[] {
    if (this.disposed) return []
    const buffer = this.emulator.buffer.active
    const lines: StyledLine[] = []
    for (let row = 0; row < this.emulator.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row)
      lines.push(line ? styledLine(line, this.emulator.cols) : { runs: [], isWrapped: false })
    }
    return lines
  }

  snapshot(): ShellSnapshot {
    return {
      cwd: this.shellState.cwd,
      commands: this.shellState.commands.map((command) => ({ ...command })),
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.dispose()
    this.subscribers.clear()

    try {
      await this.pty.dispose()
    } catch {
      // Teardown must never mask the controller's own shutdown path.
    }
    try {
      this.integration.dispose()
    } catch {
      // Parser handler disposal is best-effort.
    }
    try {
      this.emulator.dispose()
    } catch {
      // xterm disposal is best-effort for the same reason.
    }
  }

  /** Feed scripted or native PTY output through xterm and wait until it is parsed. */
  receiveOutput(data: Uint8Array): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return new Promise((resolve) => {
      this.emulator.write(data, () => {
        this.scheduleScreenEvent()
        resolve()
      })
    })
  }

  /** Test/integration seam for future semantic OSC events (task 04). */
  emitScriptedEvent(event: ShellEvent): void {
    if (this.disposed) return
    this.dispatch(event)
  }

  private scheduleScreenEvent(): void {
    this.scheduler.schedule(() => {
      if (this.disposed) return
      this.renderRev += 1
      this.dispatch({ kind: "screen", rev: this.renderRev })
    })
  }

  private dispatch(event: ShellEvent): void {
    if (event.kind === "screen") this.renderRev = Math.max(this.renderRev, event.rev)
    this.shellState = shellReducer(this.shellState, event)
    for (const subscriber of this.subscribers) subscriber(event)
  }
}

function createBunPty(
  options: ShellSpawnOptions & { command: string; cols: number; rows: number },
  onData: (data: Uint8Array) => void,
): ShellPty {
  const terminal = new Bun.Terminal({
    cols: options.cols,
    rows: options.rows,
    name: "xterm-256color",
    data(_terminal, data) {
      onData(data)
    },
  })

  let spawn: ReturnType<typeof prepareShellSpawn>
  try {
    spawn = prepareShellSpawn(
      options.command,
      { ...process.env, ...options.env, TERM: "xterm-256color" },
      options.shellIntegration !== false,
    )
  } catch (error) {
    terminal.close()
    throw error
  }

  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn({
      cmd: spawn.cmd,
      cwd: options.cwd,
      env: spawn.env,
      terminal,
    })
  } catch (error) {
    terminal.close()
    spawn.dispose()
    throw error
  }

  return {
    write(bytes) {
      terminal.write(bytes)
    },
    resize(cols, rows) {
      terminal.resize(cols, rows)
    },
    async dispose() {
      try {
        terminal.close()
      } catch {
        // Closing an already-closed PTY is harmless.
      }
      try {
        // An interactive shell can be blocked in a foreground child that ignores
        // SIGTERM. Closing the PTY sends the foreground group SIGHUP; SIGKILL then
        // guarantees the owned shell process is reaped instead of hanging teardown.
        proc.kill("SIGKILL")
      } catch {
        // The process may already have exited after the PTY closed.
      }
      try {
        await proc.exited
      } catch {
        // Disposal is deliberately no-throw.
      }
      spawn.dispose()
    },
  }
}

/** Observable test double returned by {@link createInMemoryShellRuntimeFactory}. */
export interface InMemoryShellRuntimeFactory {
  readonly factory: ShellRuntimeFactory
  readonly writes: readonly Uint8Array[]
  readonly resizes: readonly { cols: number; rows: number }[]
  readonly disposed: boolean
  scriptOutput(data: string | Uint8Array): Promise<void>
  emit(event: ShellEvent): void
}

/**
 * Build an in-memory factory plus its scripting/observation controls.
 *
 * The same xterm-backed implementation is used, but no subprocess or native PTY
 * is created. This keeps rendering and coalescing tests representative.
 */
export function createInMemoryShellRuntimeFactory(): InMemoryShellRuntimeFactory {
  const writes: Uint8Array[] = []
  const resizes: { cols: number; rows: number }[] = []
  let runtime: ShellRuntimeImpl | null = null
  let isDisposed = false

  const factory: ShellRuntimeFactory = (options) => {
    runtime = new ShellRuntimeImpl(options, () => ({
      write(bytes) {
        writes.push(bytes.slice())
      },
      resize(cols, rows) {
        resizes.push({ cols, rows })
      },
      async dispose() {
        isDisposed = true
      },
    }))
    return runtime
  }

  const requireRuntime = (): ShellRuntimeImpl => {
    if (!runtime) throw new Error("Create a runtime with `factory` before scripting it")
    return runtime
  }

  return {
    factory,
    get writes() {
      return writes
    },
    get resizes() {
      return resizes
    },
    get disposed() {
      return isDisposed
    },
    scriptOutput(data) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
      return requireRuntime().receiveOutput(bytes)
    },
    emit(event) {
      requireRuntime().emitScriptedEvent(event)
    },
  }
}

type XtermLine = NonNullable<ReturnType<Terminal["buffer"]["active"]["getLine"]>>
type XtermCell = NonNullable<ReturnType<XtermLine["getCell"]>>

function styledLine(line: XtermLine, cols: number): StyledLine {
  const cells: { text: string; style: Omit<StyledRun, "text"> }[] = []
  let lastSignificant = -1

  for (let col = 0; col < cols; col += 1) {
    const cell = line.getCell(col)
    if (!cell || cell.getWidth() === 0) continue
    const text = cell.getChars() || " "
    const style = cellStyle(cell)
    cells.push({ text, style })
    if (text !== " " || !cell.isAttributeDefault()) lastSignificant = cells.length - 1
  }

  const runs: StyledRun[] = []
  for (const cell of cells.slice(0, lastSignificant + 1)) {
    const previous = runs[runs.length - 1]
    if (previous && sameStyle(previous, cell.style)) {
      runs[runs.length - 1] = { ...previous, text: previous.text + cell.text }
    } else {
      runs.push({ text: cell.text, ...cell.style })
    }
  }
  return { runs, isWrapped: line.isWrapped }
}

function cellStyle(cell: XtermCell): Omit<StyledRun, "text"> {
  return {
    ...(cellColor(cell, "foreground") ? { foreground: cellColor(cell, "foreground") } : {}),
    ...(cellColor(cell, "background") ? { background: cellColor(cell, "background") } : {}),
    bold: Boolean(cell.isBold()),
    italic: Boolean(cell.isItalic()),
    dim: Boolean(cell.isDim()),
    underline: Boolean(cell.isUnderline()),
    blink: Boolean(cell.isBlink()),
    inverse: Boolean(cell.isInverse()),
    invisible: Boolean(cell.isInvisible()),
    strikethrough: Boolean(cell.isStrikethrough()),
    overline: Boolean(cell.isOverline()),
  }
}

function cellColor(cell: XtermCell, channel: "foreground" | "background"): StyledColor | undefined {
  const isRgb = channel === "foreground" ? cell.isFgRGB() : cell.isBgRGB()
  const isPalette = channel === "foreground" ? cell.isFgPalette() : cell.isBgPalette()
  const value = channel === "foreground" ? cell.getFgColor() : cell.getBgColor()
  if (isRgb) return { mode: "rgb", value }
  if (isPalette) return { mode: "palette", value }
  return undefined
}

function sameStyle(run: StyledRun, style: Omit<StyledRun, "text">): boolean {
  return (
    sameColor(run.foreground, style.foreground) &&
    sameColor(run.background, style.background) &&
    run.bold === style.bold &&
    run.italic === style.italic &&
    run.dim === style.dim &&
    run.underline === style.underline &&
    run.blink === style.blink &&
    run.inverse === style.inverse &&
    run.invisible === style.invisible &&
    run.strikethrough === style.strikethrough &&
    run.overline === style.overline
  )
}

function sameColor(left: StyledColor | undefined, right: StyledColor | undefined): boolean {
  return left === right || (left?.mode === right?.mode && left?.value === right?.value)
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
