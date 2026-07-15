import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCockpitSession } from "../src/index.ts"
import { loadAppConfig } from "../src/config/configLoader.ts"
import { watchUserConfig } from "../src/config/configWatcher.ts"
import { persistUserConfig } from "../src/config/configWriter.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { selectStatuslinePreference, selectThemePreference } from "../src/store/selectors.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { SessionController } from "../src/app/controller.ts"
import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY, type ConfigOption } from "../src/core/types.ts"
import { readyRuntimes } from "./fakeController.ts"

const tempDirs: string[] = []
const CONNECTION_STUB = { prompt: async () => ({ stopReason: "end_turn" as const }), cancel: async () => {} } as unknown as AgentConnection

function controllerOver(store: ReturnType<typeof createAppStore>, connection = CONNECTION_STUB): SessionController {
  const runtimes = readyRuntimes()
  return {
    store,
    shell: { ready: false, error: "shell outside config-persistence test boundary" },
    actions: createControllerActions({
      store,
      getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection }),
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

function modelOption(currentValue: string): ConfigOption {
  return {
    id: "model",
    category: MODEL_CATEGORY,
    label: "Model",
    currentValue,
    options: [
      { value: "gpt-5.6-terra", name: "Terra" },
      { value: "gpt-5.6-luna", name: "Luna" },
    ],
  }
}

function effortOption(currentValue: string): ConfigOption {
  return {
    id: "thought_level",
    category: EFFORT_CATEGORY,
    label: "Reasoning effort",
    currentValue,
    options: [
      { value: "high", name: "High" },
      { value: "ultra", name: "Ultra" },
    ],
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
  it("saves confirmed model and reasoning per provider for a subsequent cockpit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-provider-defaults-config-"))
    tempDirs.push(dir)
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({
      theme: "light",
      providerDefaults: { "claude-code": { model: "claude-opus-4-1", effort: "high" } },
    }))

    let model = "gpt-5.6-terra"
    let effort = "high"
    const connection = {
      ...CONNECTION_STUB,
      async setSessionConfigOption(_sessionId: string, configId: string, value: string): Promise<ConfigOption[]> {
        if (configId === "model") model = value
        if (configId === "thought_level") effort = value
        return [modelOption(model), effortOption(effort)]
      },
    } as AgentConnection
    const first = await createCockpitSession({
      loadConfig: () => loadAppConfig({ path }),
      buildController: async (options) => controllerOver(options.store!, connection),
      persistProviderDefaultsConfig: (patch) => persistUserConfig({ providerDefaults: patch }, { path }),
      watchConfig: () => ({ close() {} }),
    })

    expect(await first.controller.actions.setSessionConfigOption("model", "gpt-5.6-luna", "codex")).toBe(true)
    expect(await first.controller.actions.setSessionConfigOption("thought_level", "ultra", "codex")).toBe(true)
    await first.controller.dispose()

    const persisted = JSON.parse(await readFile(path, "utf8"))
    expect(persisted.providerDefaults).toEqual({
      "claude-code": { model: "claude-opus-4-1", effort: "high" },
      codex: { model: "gpt-5.6-luna", effort: "ultra" },
    })

    let loadedDefaults: unknown
    const second = await createCockpitSession({
      loadConfig: () => loadAppConfig({ path }),
      buildController: async (options) => {
        loadedDefaults = options.config.providerDefaults
        return controllerOver(options.store!)
      },
      watchConfig: () => ({ close() {} }),
    })
    try {
      expect(loadedDefaults).toEqual(persisted.providerDefaults)
    } finally {
      await second.controller.dispose()
    }
  })

  it("round-trips a confirmed statusline into a fresh cockpit while preserving unrelated settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-statusline-config-"))
    tempDirs.push(dir)
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({
      theme: "light",
      telemetryEnabled: true,
      welcomeBanner: "always",
    }))
    const layout = { separator: " | ", line: ["FOLDER", "MODEL"] } as const

    const first = await createCockpitSession({
      loadConfig: () => loadAppConfig({ path }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: (patch) => persistUserConfig(patch, { path }),
      persistStatuslineConfig: (statusline) => persistUserConfig({ statusline }, { path }),
      watchConfig: () => ({ close() {} }),
    })
    expect(await first.controller.actions.confirmStatusline(layout)).toEqual({ outcome: "saved" })
    await first.controller.dispose()

    const persisted = JSON.parse(await readFile(path, "utf8"))
    expect(persisted).toMatchObject({
      theme: "light",
      telemetryEnabled: true,
      welcomeBanner: "always",
      statusline: {
        llmDisclosureAcknowledged: false,
        separator: " | ",
        line: ["FOLDER", "MODEL"],
      },
    })

    const second = await createCockpitSession({
      loadConfig: () => loadAppConfig({ path }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: (patch) => persistUserConfig(patch, { path }),
      persistStatuslineConfig: (statusline) => persistUserConfig({ statusline }, { path }),
      watchConfig: () => ({ close() {} }),
    })
    try {
      expect(selectStatuslinePreference(second.controller.store.getState())).toEqual({
        llmDisclosureAcknowledged: false,
        layout,
      })
      expect(selectThemePreference(second.controller.store.getState())).toBe("light")
    } finally {
      await second.controller.dispose()
    }
  })

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
