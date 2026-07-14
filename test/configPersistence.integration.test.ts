import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCockpitSession } from "../src/index.ts"
import { loadAppConfig } from "../src/config/configLoader.ts"
import { watchUserConfig } from "../src/config/configWatcher.ts"
import { persistUserConfig } from "../src/config/configWriter.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { selectThemePreference } from "../src/store/selectors.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { SessionController } from "../src/app/controller.ts"
import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { readyRuntimes } from "./fakeController.ts"

const tempDirs: string[] = []
const CONNECTION_STUB = { prompt: async () => ({ stopReason: "end_turn" as const }), cancel: async () => {} } as unknown as AgentConnection

function controllerOver(store: ReturnType<typeof createAppStore>): SessionController {
  const runtimes = readyRuntimes()
  return {
    store,
    shell: { ready: false, error: "shell outside config-persistence test boundary" },
    actions: createControllerActions({
      store,
      getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection: CONNECTION_STUB }),
      resolvePermission: () => {},
    }),
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: () => true,
    updateProviderDefaults: () => {},
    closeConversation: async () => ({ outcome: "ignored" }),
    restore: async () => {},
    dispose: async () => {},
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`condition was not met within ${timeoutMs}ms`)
    await Bun.sleep(5)
  }
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("boot config persistence integration", () => {
  it("round-trips a store theme to disk and ignores the following self-write reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-boot-config-"))
    tempDirs.push(dir)
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({ theme: "light" }))

    let writeCalls = 0
    let watchEvents = 0
    const session = await createCockpitSession({
      loadConfig: () => loadAppConfig({ path }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async (patch) => {
        writeCalls += 1
        await persistUserConfig(patch, { path })
      },
      watchConfig: (onConfig) => watchUserConfig((config) => {
        watchEvents += 1
        onConfig(config)
      }, { path, debounceMs: 20 }),
      persistDebounceMs: 10,
    })

    try {
      expect(selectThemePreference(session.controller.store.getState())).toBe("light")
      session.controller.store.setThemePreference("catppuccin-mocha")

      await waitUntil(async () => JSON.parse(await readFile(path, "utf8")).theme === "catppuccin-mocha")
      await waitUntil(async () => watchEvents >= 1)
      await Bun.sleep(100)

      expect(selectThemePreference(session.controller.store.getState())).toBe("catppuccin-mocha")
      expect(writeCalls).toBe(1)
    } finally {
      await session.controller.dispose()
    }
  })
})
