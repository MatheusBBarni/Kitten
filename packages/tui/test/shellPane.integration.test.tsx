// Suite: ShellPane frame integration
// Invariant: scripted xterm output crosses runtime -> store revision -> React bridge
// and reaches the OpenTUI frame with its terminal color intent intact.
// Boundary IN: in-memory xterm runtime, AppStore, cockpit context, React, OpenTUI.
// Boundary OUT: native PTY process behavior, covered by shellRuntime.integration.

import { expect, test } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { type FrameScheduler } from "../src/agent/agentConnection.ts"
import { createInMemoryShellRuntimeFactory } from "../src/shell/shellRuntime.ts"
import { CockpitProvider } from "../src/ui/cockpitContext.tsx"
import { ShellPane } from "../src/ui/ShellPane.tsx"
import { createFakeController } from "./fakeController.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

class ManualFrameScheduler implements FrameScheduler {
  private pending: (() => void) | null = null

  schedule(flush: () => void): void {
    this.pending ??= flush
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

test("multi-line colored runtime output paints the expected ShellPane frame", async () => {
  const scheduler = new ManualFrameScheduler()
  const harness = createInMemoryShellRuntimeFactory()
  const runtime = harness.factory({ cwd: "/workspace", cols: 20, rows: 5, scheduler })
  const controller = createFakeController({ shell: { ready: true, runtime } })
  const unsubscribe = runtime.onEvent((event) => controller.store.applyShellEvent(event))
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <ShellPane />
    </CockpitProvider>,
    { width: 20, height: 5 },
  )

  await actAsync(async () => {
    await harness.scriptOutput("first\r\n\u001b[31mred\u001b[0m\r\nthird")
    scheduler.flush()
  })
  const frame = await setup.waitForFrame((candidate) => candidate.includes("first") && candidate.includes("third"))
  const styledRows = setup
    .captureSpans()
    .lines.map((line) =>
      line.spans
        .filter((span) => span.text.trim().length > 0)
        .map((span) => ({ text: span.text.trimEnd(), rgba: span.fg.toInts() })),
    )
    .filter((line) => line.length > 0)

  expect(frame).toContain("first")
  expect(styledRows).toMatchInlineSnapshot(`
    [
      [
        {
          "rgba": [
            255,
            255,
            255,
            255,
          ],
          "text": "first",
        },
      ],
      [
        {
          "rgba": [
            128,
            0,
            0,
            255,
          ],
          "text": "red",
        },
      ],
      [
        {
          "rgba": [
            255,
            255,
            255,
            255,
          ],
          "text": "third",
        },
      ],
    ]
  `)

  unsubscribe()
  await destroyMounted(setup.renderer)
  await runtime.dispose()
})
