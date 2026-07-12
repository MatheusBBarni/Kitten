// Suite: ShellPane render bridge
// Invariant: only shell screen revisions read the imperative buffer, while styles,
// scrollback, and terminal dimensions cross into OpenTUI faithfully.
// Boundary IN: real AppStore selectors, cockpit context, React, and OpenTUI renderer.
// Boundary OUT: xterm parsing and native PTY behavior, covered by integration tests.

import { describe, expect, it } from "bun:test"

import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { ShellSnapshot } from "../core/types.ts"
import type { ShellBufferType, ShellRuntime, StyledLine, StyledRun } from "../shell/shellRuntime.ts"
import { selectSessionTurns } from "../store/selectors.ts"
import { CockpitProvider, useAppSelector } from "./cockpitContext.tsx"
import { ShellPane, SHELL_SCROLLBOX_ID } from "./ShellPane.tsx"

const EMPTY_SNAPSHOT: ShellSnapshot = { cwd: "/workspace", commands: [] }
const selectClaudeTurns = selectSessionTurns("claude-code")
let agentProbeRenders = 0

function AgentProbe() {
  useAppSelector(selectClaudeTurns)
  agentProbeRenders += 1
  return <text>agent-probe</text>
}

function styledRun(overrides: Partial<StyledRun> & Pick<StyledRun, "text">): StyledRun {
  return {
    bold: false,
    italic: false,
    dim: false,
    underline: false,
    blink: false,
    inverse: false,
    invisible: false,
    strikethrough: false,
    overline: false,
    ...overrides,
  }
}

function styledLine(text: string): StyledLine {
  return { runs: text === "" ? [] : [styledRun({ text })], isWrapped: false }
}

class StubShellRuntime implements ShellRuntime {
  lines: readonly StyledLine[]
  viewCalls = 0
  readonly resizes: { cols: number; rows: number }[] = []

  constructor(lines: readonly StyledLine[]) {
    this.lines = lines
  }

  onEvent(): () => void {
    return () => {}
  }

  onBufferChange(): () => void {
    return () => {}
  }

  bufferType(): ShellBufferType {
    return "normal"
  }

  write(): void {}

  interrupt(): void {}

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  view(): readonly StyledLine[] {
    this.viewCalls += 1
    return this.lines
  }

  snapshot(): ShellSnapshot {
    return EMPTY_SNAPSHOT
  }

  async dispose(): Promise<void> {}
}

async function renderPane(runtime: ShellRuntime, width = 24, height = 6) {
  const controller = createFakeController({ shell: { ready: true, runtime } })
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <ShellPane />
    </CockpitProvider>,
    { width, height },
  )
  await setup.waitForFrame((frame) => frame.trim().length > 0)
  return { controller, ...setup }
}

describe("ShellPane styled rendering", () => {
  it("renders indexed foreground, true-color background, and terminal attributes", async () => {
    const redRun = styledRun({
      text: "red ",
      foreground: { mode: "palette", value: 1 },
    })
    const backgroundRun = styledRun({
      text: "background ",
      background: { mode: "rgb", value: 0x123456 },
    })
    const attributedRun = styledRun({
      text: "styled",
      bold: true,
      italic: true,
      dim: true,
      underline: true,
      blink: true,
      inverse: true,
      invisible: true,
      strikethrough: true,
    })
    const runtime = new StubShellRuntime([{ runs: [redRun, backgroundRun, attributedRun], isWrapped: false }])
    const setup = await renderPane(runtime)
    const spans = setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
    const redSpan = spans.find((candidate) => candidate.text.includes("red"))
    const backgroundSpan = spans.find((candidate) => candidate.text.includes("background"))
    const attributedSpan = spans.find((candidate) => candidate.text.includes("styled"))

    expect(redSpan).toBeDefined()
    expect(redSpan!.fg.toInts()).toEqual(RGBA.fromIndex(1).toInts())
    expect(backgroundSpan).toBeDefined()
    expect(backgroundSpan!.bg.toInts()).toEqual([0x12, 0x34, 0x56, 0xff])
    expect(attributedSpan).toBeDefined()
    expect(attributedSpan!.attributes).toBe(
      TextAttributes.BOLD |
        TextAttributes.DIM |
        TextAttributes.ITALIC |
        TextAttributes.UNDERLINE |
        TextAttributes.BLINK |
        TextAttributes.INVERSE |
        TextAttributes.HIDDEN |
        TextAttributes.STRIKETHROUGH,
    )

    await destroyMounted(setup.renderer)
  })

  it("shows the controller's fail-soft shell error", async () => {
    const controller = createFakeController({ shell: { ready: false, error: "PTY unavailable" } })
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ShellPane />
      </CockpitProvider>,
      { width: 50, height: 4 },
    )

    expect(await setup.waitForFrame((frame) => frame.includes("PTY unavailable"))).toContain(
      "Shell unavailable: PTY unavailable",
    )
    await destroyMounted(setup.renderer)
  })

  it("maps the terminal cursor cell to an inverted visible span", async () => {
    const runtime = new StubShellRuntime([
      { runs: [styledRun({ text: "prompt>" }), styledRun({ text: " ", inverse: true })], isWrapped: false },
    ])
    const setup = await renderPane(runtime)
    const cursor = setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text === " ")

    expect(cursor).toBeDefined()
    expect(cursor!.attributes & TextAttributes.INVERSE).toBe(TextAttributes.INVERSE)

    await destroyMounted(setup.renderer)
  })
})

describe("ShellPane render isolation", () => {
  it("reads view once for a renderRev bump and not for an unrelated agent update", async () => {
    const runtime = new StubShellRuntime([styledLine("steady")])
    const controller = createFakeController({ shell: { ready: true, runtime } })
    agentProbeRenders = 0
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ShellPane />
        <AgentProbe />
      </CockpitProvider>,
      { width: 24, height: 6 },
    )
    await setup.waitForFrame((frame) => frame.includes("steady"))
    const initialCalls = runtime.viewCalls
    const initialAgentRenders = agentProbeRenders

    await actAsync(() => {
      controller.store.applyEvent("claude-code", {
        kind: "agent_message",
        messageId: "agent-update",
        textDelta: "working",
      })
    })
    await setup.waitFor(() => agentProbeRenders === initialAgentRenders + 1)
    expect(runtime.viewCalls).toBe(initialCalls)

    await actAsync(() => {
      controller.store.applyShellEvent({ kind: "screen", rev: 1 })
    })
    await setup.waitFor(() => runtime.viewCalls === initialCalls + 1)
    expect(runtime.viewCalls).toBe(initialCalls + 1)
    expect(agentProbeRenders).toBe(initialAgentRenders + 1)

    await destroyMounted(setup.renderer)
  })
})

describe("ShellPane scrollback and resize", () => {
  it("keeps output longer than the pane navigable in its scrollbox", async () => {
    const runtime = new StubShellRuntime(Array.from({ length: 12 }, (_, index) => styledLine(`line-${index}`)))
    const setup = await renderPane(runtime, 24, 5)
    const scrollbox = setup.renderer.root.getRenderable(SHELL_SCROLLBOX_ID) as ScrollBoxRenderable | undefined

    expect(scrollbox).toBeDefined()
    expect(scrollbox!.scrollHeight).toBeGreaterThan(5)
    expect(scrollbox!.scrollTop).toBeGreaterThan(0)
    expect(setup.captureCharFrame()).toContain("line-11")

    await actAsync(() => {
      scrollbox!.scrollTo(0)
    })
    expect(await setup.waitForFrame((frame) => frame.includes("line-0"))).toContain("line-0")

    await destroyMounted(setup.renderer)
  })

  it("resizes the runtime on mount and each live terminal resize", async () => {
    const runtime = new StubShellRuntime([styledLine("sized")])
    const setup = await renderPane(runtime, 20, 6)
    await setup.waitFor(() => runtime.resizes.length === 1)
    expect(runtime.resizes).toEqual([{ cols: 20, rows: 6 }])

    await actAsync(() => {
      setup.resize(42, 9)
    })
    await setup.waitFor(() => runtime.resizes.length === 2)
    expect(runtime.resizes.at(-1)).toEqual({ cols: 42, rows: 9 })

    await destroyMounted(setup.renderer)
  })
})
