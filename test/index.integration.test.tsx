import { describe, expect, it, spyOn } from "bun:test"

import { type CliRenderer } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"

import { CockpitApp, COCKPIT_TITLE, EXIT_HINT } from "../src/app/CockpitApp.tsx"
import { createCockpitRenderer, main } from "../src/index.ts"

/** Run a callback with React's act environment enabled, restoring the flag after. */
async function withActEnvironment(fn: () => Promise<void>): Promise<void> {
  const globalWithFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = globalWithFlag.IS_REACT_ACT_ENVIRONMENT
  globalWithFlag.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await fn()
  } finally {
    globalWithFlag.IS_REACT_ACT_ENVIRONMENT = previous
  }
}

/** Destroy a renderer that has a mounted React root, flushing teardown inside act. */
async function destroyMounted(renderer: CliRenderer): Promise<void> {
  await withActEnvironment(async () => {
    await act(async () => {
      renderer.destroy()
    })
  })
}

/**
 * Integration: boot the cockpit against an in-memory ("main-screen", memory
 * output) test renderer so nothing touches the real terminal, then confirm it
 * tears down cleanly without leaking terminal state.
 */
describe("cockpit entry integration (non-TTY test renderer)", () => {
  it("renders the placeholder cockpit and destroys the renderer without leaking", async () => {
    const { renderer, waitForFrame } = await testRender(<CockpitApp />, { width: 80, height: 24 })

    const frame = await waitForFrame((f) => f.includes(COCKPIT_TITLE))
    expect(frame).toContain(COCKPIT_TITLE)
    expect(frame).toContain(EXIT_HINT)
    expect(renderer.isDestroyed).toBe(false)

    // Tearing down a mounted root triggers React unmount work, so flush it inside act.
    await destroyMounted(renderer)
    expect(renderer.isDestroyed).toBe(true)
  })

  it("main() mounts the cockpit and runs the injected exit handler on renderer destroy", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    let exitCount = 0
    let returned: CliRenderer | undefined

    await withActEnvironment(async () => {
      await act(async () => {
        returned = await main({
          createRenderer: async () => renderer,
          onExit: () => {
            exitCount++
          },
        })
      })
    })

    expect(returned).toBe(renderer)
    expect(exitCount).toBe(0)

    // Ctrl+C in a real run calls renderer.destroy(); simulate that here.
    await destroyMounted(renderer)
    expect(exitCount).toBe(1)
  })

  it("main() defaults to a clean process exit when the renderer is destroyed", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)

    try {
      await withActEnvironment(async () => {
        await act(async () => {
          await main({ createRenderer: async () => renderer })
        })
      })

      expect(exitSpy).not.toHaveBeenCalled()
      await destroyMounted(renderer)
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      exitSpy.mockRestore()
    }
  })

  it("createCockpitRenderer forwards exitOnCtrlC through its factory", async () => {
    const { renderer } = await createTestRenderer({ width: 40, height: 10 })
    let seenConfig: { exitOnCtrlC?: boolean } | undefined

    const factory = (async (config: { exitOnCtrlC?: boolean }) => {
      seenConfig = config
      return renderer
    }) as unknown as Parameters<typeof createCockpitRenderer>[0]

    const result = await createCockpitRenderer(factory)

    expect(result).toBe(renderer)
    expect(seenConfig?.exitOnCtrlC).toBe(true)

    // No React root was mounted on this renderer, so a plain destroy is fine.
    renderer.destroy()
  })
})
