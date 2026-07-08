import { describe, expect, it, spyOn } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { createCockpitRenderer, main } from "../src/index.ts"
import { createFakeController } from "./fakeController.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

/**
 * Integration: boot the cockpit against an in-memory ("main-screen", memory
 * output) test renderer so nothing touches the real terminal, then confirm it
 * tears down cleanly - renderer destroyed, agents disposed, exit handler run.
 */
describe("cockpit entry integration (non-TTY test renderer)", () => {
  it("renders the cockpit and destroys the renderer without leaking", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await testRender(<CockpitApp controller={controller} />, {
      width: 80,
      height: 24,
    })

    const frame = await waitForFrame((f) => f.includes("Claude Code"))
    expect(frame).toContain("Claude Code")
    expect(renderer.isDestroyed).toBe(false)

    // Tearing down a mounted root triggers React unmount work, so flush it inside act.
    await destroyMounted(renderer)
    expect(renderer.isDestroyed).toBe(true)
  })

  it("main() mounts the cockpit and disposes the controller before the exit handler runs", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const exitOrder: string[] = []

    let booted: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      booted = await main({
        createRenderer: async () => renderer,
        createController: async () => controller,
        onExit: () => exitOrder.push("exit"),
      })
    })

    expect(booted?.renderer).toBe(renderer)
    expect(booted?.controller).toBe(controller)
    expect(exitOrder).toEqual([])

    // Ctrl+C in a real run calls renderer.destroy(); simulate that here.
    await destroyMounted(renderer)
    await booted!.closed

    expect(controller.calls.dispose).toBe(1)
    expect(exitOrder).toEqual(["exit"])
  })

  it("main() defaults to a clean process exit once the cockpit has torn down", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)

    try {
      let booted: Awaited<ReturnType<typeof main>> | undefined
      await actAsync(async () => {
        booted = await main({ createRenderer: async () => renderer, createController: async () => controller })
      })

      expect(exitSpy).not.toHaveBeenCalled()
      await destroyMounted(renderer)
      await booted!.closed
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      exitSpy.mockRestore()
    }
  })

  it("main() restores the terminal when the controller cannot be built", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const configError = new Error("kitten config is invalid")

    const boot = main({
      createRenderer: async () => renderer,
      createController: async () => {
        throw configError
      },
    })

    // No React root was mounted, so the failure path needs no act() wrapping.
    expect(boot).rejects.toThrow(configError)
    await boot.catch(() => {})
    expect(renderer.isDestroyed).toBe(true)
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
