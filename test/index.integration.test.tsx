import { describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import type { AgentConnection, PromptBlock } from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { DomainSessionEvent, ProviderKind } from "../src/core/types.ts"
import { createCockpitRenderer, createCockpitSession, main, wireKeyboardCapability } from "../src/index.ts"
import type { PersistedRunRecordV1 } from "../src/persistence/runRecord.ts"
import { createRunStore, type RunStore } from "../src/persistence/runStore.ts"
import { createInMemoryShellRuntimeFactory } from "../src/shell/shellRuntime.ts"
import { createTelemetryRecorder } from "../src/telemetry/recorder.ts"
import { EMPTY_TRANSCRIPT_HINT } from "../src/ui/ConversationView.tsx"
import { KEYMAP_HINT } from "../src/ui/keymap.ts"
import { WELCOME_GREETING, WELCOME_KITTEN, WELCOME_ON_RAMP } from "../src/ui/WelcomeBanner.tsx"
import { createFakeController, type FakeController } from "./fakeController.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

function resumableFakeConnection(
  id: ProviderKind,
  generation: number,
  freshStarts: Array<{ id: ProviderKind; cwd: string; generation: number }>,
  prompts: Array<{ id: ProviderKind; sessionId: string; blocks: PromptBlock[] }> = [],
): AgentConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  return {
    id,
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
    async newSession(cwd) {
      freshStarts.push({ id, cwd, generation })
      return `${id}-fresh-${generation}`
    },
    async loadSession(sessionId) {
      const event: DomainSessionEvent = {
        kind: "agent_message",
        messageId: `${id}-restored`,
        textDelta: `restored ${id} from ${sessionId}`,
      }
      for (const subscriber of subscribers) subscriber(event)
    },
    async prompt(sessionId, blocks) {
      prompts.push({ id, sessionId, blocks })
      return { stopReason: "end_turn" }
    },
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    onPermission() {},
    onClarification: () => () => {},
    dispose: async () => {},
  }
}

function bootRun(cwd: string): PersistedRunRecordV1 {
  return {
    version: 1,
    runId: "boot-resume",
    cwd,
    gitBranch: "feat/session-resume",
    focusedAgentId: "codex",
    createdAt: 1_000,
    updatedAt: 9_000,
    agents: {
      "claude-code": { sessionId: "stored-claude", lastPrompt: "continue", messageCount: 1, status: "finished" },
      codex: { sessionId: "stored-codex", lastPrompt: "continue", messageCount: 1, status: "finished" },
    },
    handoffBundle: null,
  }
}

/**
 * Integration: boot the cockpit against an in-memory ("main-screen", memory
 * output) test renderer so nothing touches the real terminal, then confirm it
 * tears down cleanly - renderer destroyed, agents disposed, exit handler run.
 */
describe("cockpit entry integration (non-TTY test renderer)", () => {
  it("starts configured opening tasks instead of restoring a saved run", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-index-opening-task-"))
    const cwd = process.cwd()
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "codex" as const, cwd, title: "Worker", task: "start the build" }],
      persistenceEnabled: true,
      shell: { ...defaultAppConfig().shell, enabled: false },
    }
    const runStore = createRunStore({ enabled: true, path: base })
    const record = bootRun(cwd)
    record.agents = {
      codex: { sessionId: "stored-codex", lastPrompt: "continue", messageCount: 1, status: "finished" },
    }
    runStore.save(record)
    const freshStarts: Array<{ id: ProviderKind; cwd: string; generation: number }> = []
    const prompts: Array<{ id: ProviderKind; sessionId: string; blocks: PromptBlock[] }> = []
    const generations: Record<ProviderKind, number> = { "claude-code": 0, codex: 0, cursor: 0 }
    let session: Awaited<ReturnType<typeof createCockpitSession>> | undefined

    try {
      session = await createCockpitSession({
        config,
        cwd,
        createRunStore: () => runStore,
        buildController: (options) => createSessionController({
          ...options,
          createConnection: (agentConfig) => resumableFakeConnection(
            agentConfig.id,
            generations[agentConfig.id]++,
            freshStarts,
            prompts,
          ),
          readBranch: async () => null,
        }),
        persistConfig: async () => {},
        watchConfig: () => ({ close() {} }),
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(prompts).toEqual([
        { id: "codex", sessionId: "codex-fresh-0", blocks: [{ type: "text", text: "start the build" }] },
      ])
      expect(session.controller.store.getState().sessions.codex!.turns).toEqual([
        expect.objectContaining({ kind: "user", text: "start the build" }),
      ])
    } finally {
      await session?.controller.dispose()
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("starts a fresh cockpit when persisted-run storage is unavailable", async () => {
    const cwd = process.cwd()
    const config = {
      ...defaultAppConfig(),
      persistenceEnabled: true,
      shell: { ...defaultAppConfig().shell, enabled: false },
    }
    const freshStarts: Array<{ id: ProviderKind; cwd: string; generation: number }> = []
    const generations: Record<ProviderKind, number> = { "claude-code": 0, codex: 0, cursor: 0 }
    const unavailableStore: RunStore = {
      save() {},
      list() {
        throw new Error("state directory is unreadable")
      },
      load() {
        throw new Error("state directory is unreadable")
      },
      delete() {},
      deleteAll() {},
      flush() {},
    }
    let session: Awaited<ReturnType<typeof createCockpitSession>> | undefined

    try {
      session = await createCockpitSession({
        config,
        cwd,
        createRunStore: () => unavailableStore,
        buildController: (options) => createSessionController({
          ...options,
          createConnection: (agentConfig) => resumableFakeConnection(
            agentConfig.id,
            generations[agentConfig.id]++,
            freshStarts,
          ),
          readBranch: async () => null,
        }),
        persistConfig: async () => {},
        watchConfig: () => ({ close() {} }),
      })

      expect(session.controller.runtimes().every((runtime) => runtime.ready)).toBe(true)
      expect(freshStarts).toHaveLength(3)
    } finally {
      await session?.controller.dispose()
    }
  })

  it("boots fresh agents even when the project has a saved run", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-index-resume-"))
    const setup = await createTestRenderer({ width: 100, height: 24 })
    const cwd = process.cwd()
    const config = {
      ...defaultAppConfig(),
      persistenceEnabled: true,
      shell: { ...defaultAppConfig().shell, enabled: false },
    }
    const runStore = createRunStore({ enabled: true, path: base })
    runStore.save(bootRun(cwd))
    const generations: Record<ProviderKind, number> = { "claude-code": 0, codex: 0, cursor: 0 }
    const freshStarts: Array<{ id: ProviderKind; cwd: string; generation: number }> = []
    let booted: Awaited<ReturnType<typeof main>> | undefined

    try {
      await actAsync(async () => {
        booted = await main({
          cwd,
          createRenderer: async () => setup.renderer,
          loadConfig: async () => config,
          createSession: () => createCockpitSession({
            config,
            cwd,
            createRunStore: () => runStore,
            buildController: (options) => createSessionController({
              ...options,
              createConnection: (agentConfig) => {
                const generation = generations[agentConfig.id]++
                return resumableFakeConnection(agentConfig.id, generation, freshStarts)
              },
              readBranch: async () => null,
            }),
            persistConfig: async () => {},
            watchConfig: () => ({ close() {} }),
          }),
          readFirstRunSeen: () => true,
          onExit: () => {},
          wireNotifier: () => {},
        })
      })

      const fresh = await setup.waitForFrame((frame) => frame.includes(KEYMAP_HINT))
      expect(fresh).not.toContain("restored codex from stored-codex")
      expect(freshStarts).toEqual([
        { id: "codex", cwd, generation: 0 },
        { id: "claude-code", cwd, generation: 0 },
        { id: "cursor", cwd, generation: 0 },
      ])
      expect(booted?.controller.store.getState().workspace.order).toHaveLength(3)
    } finally {
      if (!setup.renderer.isDestroyed) await destroyMounted(setup.renderer)
      await booted?.closed
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("renders the cockpit and destroys the renderer without leaking", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await testRender(<CockpitApp controller={controller} />, {
      width: 80,
      height: 24,
    })

    const frame = await waitForFrame((f) => f.includes(WELCOME_GREETING))
    expect(frame).toContain("Kitten")
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
        loadConfig: async () => defaultAppConfig(),
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

  it("agent-focused Ctrl+C runs the existing renderer teardown path", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false, kittyKeyboard: true })
    const controller = createFakeController()
    const exitOrder: string[] = []
    let booted: Awaited<ReturnType<typeof main>> | undefined

    await actAsync(async () => {
      booted = await main({
        createRenderer: async () => setup.renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        onExit: () => exitOrder.push("exit"),
        wireNotifier: () => {},
      })
    })
    await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING))

    await actAsync(() => {
      setup.mockInput.pressCtrlC()
    })
    await booted!.closed

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(controller.calls.dispose).toBe(1)
    expect(exitOrder).toEqual(["exit"])
  })

  it("shell-focused Ctrl+C reaches the PTY path and leaves the app running", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false, kittyKeyboard: true })
    const shell = createInMemoryShellRuntimeFactory()
    const runtime = shell.factory({ cwd: process.cwd() })
    const controller = createFakeController({ shell: { ready: true, runtime } })
    let booted: Awaited<ReturnType<typeof main>> | undefined

    try {
      await actAsync(async () => {
        booted = await main({
          createRenderer: async () => setup.renderer,
          createController: async () => controller,
          loadConfig: async () => defaultAppConfig(),
          onExit: () => {},
          wireNotifier: () => {},
        })
      })
      await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING))

      await actAsync(() => {
        setup.mockInput.pressKey("`", { ctrl: true })
      })
      await setup.waitForFrame((frame) => frame.includes("Shell · focused"))
      await actAsync(() => {
        setup.mockInput.pressCtrlC()
      })
      await setup.waitFor(() => shell.writes.length === 1)

      expect(shell.writes.flatMap((bytes) => [...bytes])).toEqual([0x03])
      expect(setup.renderer.isDestroyed).toBe(false)
      expect(controller.calls.dispose).toBe(0)
    } finally {
      if (!setup.renderer.isDestroyed) await destroyMounted(setup.renderer)
      await booted?.closed
      await runtime.dispose()
    }
  })

  it("promotes Kitty capability on the first mounted chord and navigates only on the next event", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, exitOnCtrlC: false, kittyKeyboard: true })
    const controller = createFakeController()
    let booted: Awaited<ReturnType<typeof main>> | undefined

    try {
      await actAsync(async () => {
        booted = await main({
          createRenderer: async () => setup.renderer,
          createController: async () => controller,
          loadConfig: async () => defaultAppConfig(),
          onExit: () => {},
          wireNotifier: () => {},
        })
      })
      await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING))

      await actAsync(() => setup.mockInput.pressKey("l", { ctrl: true }))
      expect(controller.store.getState().keyboardCapability).toBe("kittyConfirmed")
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      await actAsync(() => setup.mockInput.pressKey("l", { ctrl: true }))
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    } finally {
      if (!setup.renderer.isDestroyed) await destroyMounted(setup.renderer)
      await booted?.closed
    }
  })

  it("mounts boot feedback before preparing the tree-sitter worker", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const order: string[] = []
    let releaseWorker: () => void = () => {}
    const workerReleased = new Promise<void>((resolve) => {
      releaseWorker = resolve
    })
    let signalWorkerStarted: () => void = () => {}
    const workerStarted = new Promise<void>((resolve) => {
      signalWorkerStarted = resolve
    })
    let bootPromise: ReturnType<typeof main> | undefined

    await actAsync(async () => {
      bootPromise = main({
        createRenderer: async () => setup.renderer,
        createController: async () => {
          order.push("controller")
          return controller
        },
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => true,
        configureTreeSitterWorker: async () => {
          order.push("worker")
          signalWorkerStarted()
          await workerReleased
          return null
        },
        onExit: () => {},
        wireNotifier: () => {},
      })
      await workerStarted
    })

    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain(WELCOME_GREETING)
    // The boot root is already visible while independent startup work overlaps.
    expect(order).toEqual(["worker", "controller"])

    let booted: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      releaseWorker()
      booted = await bootPromise
    })

    await destroyMounted(setup.renderer)
    await booted?.closed
  })

  it("paints connecting agents during a delayed handshake, then swaps to the cockpit", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    let releaseController: (controller: FakeController) => void = () => {}
    const delayedController = new Promise<FakeController>((resolve) => {
      releaseController = resolve
    })
    let signalHandshakeStarted: () => void = () => {}
    const handshakeStarted = new Promise<void>((resolve) => {
      signalHandshakeStarted = resolve
    })
    let markCalls = 0
    let bootPromise: ReturnType<typeof main> | undefined
    let connectingFrame = ""

    await actAsync(async () => {
      bootPromise = main({
        createRenderer: async () => setup.renderer,
        createController: async () => {
          signalHandshakeStarted()
          return delayedController
        },
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => false,
        markFirstRunSeen: () => {
          markCalls++
        },
        onExit: () => {},
        wireNotifier: () => {},
      })
      await handshakeStarted
    })
    await setup.renderOnce()
    connectingFrame = setup.captureCharFrame()

    expect(connectingFrame).toContain("Agents: connecting · connecting")
    expect(connectingFrame).toContain(WELCOME_GREETING)
    expect(markCalls).toBe(0)

    let booted: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      releaseController(controller)
      booted = await bootPromise
    })

    const cockpitFrame = await setup.waitForFrame((frame) => frame.includes("Agents: ready · ready"))
    expect(cockpitFrame).toContain(WELCOME_GREETING)
    expect(cockpitFrame).toContain("Agents: ready · ready")
    expect(cockpitFrame).toContain(WELCOME_ON_RAMP)
    expect(markCalls).toBe(1)

    await destroyMounted(setup.renderer)
    await booted!.closed
  })

  it("keeps the compact ASCII kitten mascot when the first-run marker already exists", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    let markCalls = 0
    let booted: Awaited<ReturnType<typeof main>> | undefined

    await actAsync(async () => {
      booted = await main({
        createRenderer: async () => setup.renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => true,
        markFirstRunSeen: () => {
          markCalls++
        },
        onExit: () => {},
        wireNotifier: () => {},
      })
    })

    const frame = await setup.waitForFrame((candidate) => candidate.includes(WELCOME_GREETING))
    expect(frame).toContain(WELCOME_KITTEN[0])
    expect(frame).not.toContain("Agents:")
    expect(frame).not.toContain(WELCOME_ON_RAMP)
    expect(markCalls).toBe(0)

    await destroyMounted(setup.renderer)
    await booted!.closed
  })

  it("suppresses the idle welcome when config turns the banner off", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const config = { ...defaultAppConfig(), welcomeBanner: "off" as const }
    let booted: Awaited<ReturnType<typeof main>> | undefined

    await actAsync(async () => {
      booted = await main({
        createRenderer: async () => setup.renderer,
        createSession: async () => ({ controller, recorder: createTelemetryRecorder({ enabled: false }) }),
        loadConfig: async () => config,
        readFirstRunSeen: () => false,
        onExit: () => {},
        wireNotifier: () => {},
      })
    })

    const frame = await setup.waitForFrame((candidate) => candidate.includes(KEYMAP_HINT))
    expect(frame).not.toContain(WELCOME_GREETING)
    expect(frame).not.toContain(WELCOME_ON_RAMP)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(setup.renderer)
    await booted!.closed
  })

  it("main() defaults to a clean process exit once the cockpit has torn down", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const exitSpy = spyOn(process, "exit").mockImplementation((() => undefined) as never)

    try {
      let booted: Awaited<ReturnType<typeof main>> | undefined
      await actAsync(async () => {
        booted = await main({
          createRenderer: async () => renderer,
          createController: async () => controller,
          loadConfig: async () => defaultAppConfig(),
        })
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

    await actAsync(async () => {
      const boot = main({
        createRenderer: async () => renderer,
        createController: async () => {
          throw configError
        },
        loadConfig: async () => defaultAppConfig(),
      })
      await expect(boot).rejects.toThrow(configError)
    })
    expect(renderer.isDestroyed).toBe(true)
  })

  it("disposes a prepared dynamic controller when worker setup fails", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const workerError = new Error("tree-sitter worker setup failed")

    await actAsync(async () => {
      const boot = main({
        createRenderer: async () => renderer,
        createController: async () => controller,
        configureTreeSitterWorker: async () => {
          throw workerError
        },
        loadConfig: async () => defaultAppConfig(),
      })
      await expect(boot).rejects.toThrow(workerError)
    })

    expect(renderer.isDestroyed).toBe(true)
    expect(controller.calls.dispose).toBe(1)
  })

  it("createCockpitRenderer requests Kitty disambiguation and alternate keys while preserving renderer options", async () => {
    const { renderer } = await createTestRenderer({ width: 40, height: 10 })
    let seenConfig: {
      exitOnCtrlC?: boolean
      targetFps?: number
      useKittyKeyboard?: { disambiguate?: boolean; alternateKeys?: boolean } | null
    } | undefined

    const factory = (async (config: typeof seenConfig) => {
      seenConfig = config
      return renderer
    }) as unknown as Parameters<typeof createCockpitRenderer>[0]

    const result = await createCockpitRenderer(factory)

    expect(result).toBe(renderer)
    expect(seenConfig?.exitOnCtrlC).toBe(false)
    expect(seenConfig?.targetFps).toBe(30)
    expect(seenConfig?.useKittyKeyboard).toEqual({ disambiguate: true, alternateKeys: true })

    // No React root was mounted on this renderer, so a plain destroy is fine.
    renderer.destroy()
  })

  it("promotes capability only for Kitty-source renderer events and detaches cleanly", async () => {
    const kitty = await createTestRenderer({ width: 40, height: 10, kittyKeyboard: true })
    const raw = await createTestRenderer({ width: 40, height: 10, kittyKeyboard: false })
    let confirmations = 0
    const stopKitty = wireKeyboardCapability(kitty.renderer, () => confirmations++)
    wireKeyboardCapability(raw.renderer, () => confirmations++)

    raw.mockInput.pressKey("a")
    expect(confirmations).toBe(0)

    kitty.mockInput.pressKey("a")
    expect(confirmations).toBe(1)

    stopKitty()
    kitty.mockInput.pressKey("b")
    expect(confirmations).toBe(1)

    kitty.renderer.destroy()
    raw.renderer.destroy()
  })
})
