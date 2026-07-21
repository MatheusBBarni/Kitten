/**
 * The OpenTUI bridge over the controller-owned shell emulator.
 *
 * Terminal cells stay imperative inside ShellRuntime. Only `renderRev` crosses the
 * store boundary, so semantic shell events and agent updates do not repaint this
 * pane. A render reads one immutable styled-line snapshot and maps it to OpenTUI's
 * rich-text spans; the surrounding scrollbox owns navigation through the runtime's
 * bounded active buffer.
 */

import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useCallback, type ReactNode } from "react"

import type { StyledColor, StyledLine, StyledRun } from "../shell/shellRuntime.ts"
import type { Selector } from "../store/appStore.ts"
import { useAppSelector, useShellRuntime } from "./cockpitContext.tsx"

/** Stable id used by tests and future focus routing to find the scrollable pane. */
export const SHELL_SCROLLBOX_ID = "shell-scrollback"

/** OpenTUI 0.4.3 reserves a row for this bar unless it is hidden explicitly. */
const HIDDEN_SCROLLBAR = { visible: false } as const

/** A scalar selector keeps non-screen shell and agent events from waking the pane. */
const selectShellRenderRev: Selector<number> = (state) => state.shell.renderRev

/** Render the controller-owned shell buffer into a scrollable OpenTUI region. */
export function ShellPane(): ReactNode {
  const shell = useShellRuntime()

  if (!shell.ready) {
    return (
      <box style={{ flexGrow: 1, flexShrink: 1, overflow: "hidden" }}>
        <text>{`Shell unavailable: ${shell.error}`}</text>
      </box>
    )
  }

  return <ReadyShellPane runtime={shell.runtime} />
}

function ReadyShellPane({
  runtime,
}: {
  runtime: Extract<ReturnType<typeof useShellRuntime>, { ready: true }>["runtime"]
}): ReactNode {
  useAppSelector(selectShellRenderRev)

  // The shell lives inside bordered cockpit chrome, so the root terminal dimensions
  // are larger than its real drawable area. Synchronize from the laid-out scrollbox
  // viewport to keep the PTY and emulator aligned in both normal and expanded modes.
  const resizeRuntime = useCallback(
    function resizeRuntime(this: ScrollBoxRenderable): void {
      runtime.resize(Math.max(1, this.width), Math.max(1, this.height))
    },
    [runtime],
  )

  const lines = runtime.view()

  return (
    <scrollbox
      id={SHELL_SCROLLBOX_ID}
      style={{ width: "100%", height: "100%", flexGrow: 1, flexShrink: 1 }}
      stickyScroll
      stickyStart="bottom"
      focused
      scrollX={false}
      onSizeChange={resizeRuntime}
      verticalScrollbarOptions={HIDDEN_SCROLLBAR}
      horizontalScrollbarOptions={HIDDEN_SCROLLBAR}
    >
      {lines.map((line, index) => (
        <ShellLine key={index} line={line} />
      ))}
    </scrollbox>
  )
}

function ShellLine({ line }: { line: StyledLine }): ReactNode {
  return (
    <text>
      {line.runs.length === 0
        ? " "
        : line.runs.map((run, index) => (
            <span
              key={index}
              fg={run.foreground ? toOpenTUIColor(run.foreground) : undefined}
              bg={run.background ? toOpenTUIColor(run.background) : undefined}
              attributes={toTextAttributes(run)}
            >
              {run.text}
            </span>
          ))}
    </text>
  )
}

/** Preserve palette intent for ANSI colors and exact channels for true-color runs. */
function toOpenTUIColor(color: StyledColor): RGBA {
  if (color.mode === "palette") return RGBA.fromIndex(color.value)
  return RGBA.fromInts((color.value >> 16) & 0xff, (color.value >> 8) & 0xff, color.value & 0xff)
}

/** Map every text attribute OpenTUI 0.4.3 can represent. */
function toTextAttributes(run: StyledRun): number {
  let attributes = TextAttributes.NONE
  if (run.bold) attributes |= TextAttributes.BOLD
  if (run.dim) attributes |= TextAttributes.DIM
  if (run.italic) attributes |= TextAttributes.ITALIC
  if (run.underline) attributes |= TextAttributes.UNDERLINE
  if (run.blink) attributes |= TextAttributes.BLINK
  if (run.inverse) attributes |= TextAttributes.INVERSE
  if (run.invisible) attributes |= TextAttributes.HIDDEN
  if (run.strikethrough) attributes |= TextAttributes.STRIKETHROUGH
  // OpenTUI 0.4.3 exposes no overline bit; preserve every attribute its text
  // buffer can encode without substituting a visually different decoration.
  return attributes
}
