import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { AppConfig } from "../core/types.ts"
import { CONFIG_PATH_ENV_VAR } from "./configLoader.ts"
import { watchUserConfig } from "./configWatcher.ts"

// Suite: user config filesystem watcher
// Invariant: a settled external edit emits one freshly loaded valid config, while invalid states and closure emit none.
// Boundary IN: real fs.watch events, debounce timing, config loading, and watcher lifecycle
// Boundary OUT: store-level idempotence and boot wiring, owned by task 09

const DEBOUNCE_MS = 20
const EVENT_TIMEOUT_MS = 2_000
const QUIET_WINDOW_MS = DEBOUNCE_MS * 5
const tempDirs: string[] = []

async function makeConfigPath(initialTheme = "auto"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-config-watcher-"))
  tempDirs.push(dir)
  const path = join(dir, "config.json")
  await writeFile(path, JSON.stringify({ theme: initialTheme }))
  return path
}

async function makeMissingConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-config-watcher-"))
  tempDirs.push(dir)
  return join(dir, "missing", "config.json")
}

async function waitUntil(predicate: () => boolean, timeoutMs = EVENT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition was not met within ${timeoutMs}ms`)
    await Bun.sleep(5)
  }
}

async function expectConditionToRemain(predicate: () => boolean, durationMs = QUIET_WINDOW_MS): Promise<void> {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    expect(predicate()).toBe(true)
    await Bun.sleep(5)
  }
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("watchUserConfig", () => {
  it("Should emit exactly one freshly loaded config after a rapid external-write burst", async () => {
    const path = await makeConfigPath()
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), { path, debounceMs: DEBOUNCE_MS })

    try {
      await writeFile(path, '{"theme":"light"}')
      await writeFile(path, '{"theme":"dark"}')

      await waitUntil(() => configs.length === 1)
      expect(configs[0]?.theme).toBe("dark")
      await expectConditionToRemain(() => configs.length === 1)
    } finally {
      watcher.close()
    }
  })

  it("Should ignore invalid JSON and recover on the next valid write", async () => {
    const path = await makeConfigPath()
    const configs: AppConfig[] = []
    let retainedDefaults: AppConfig["providerDefaults"] = { codex: { model: "opus" } }
    const watcher = watchUserConfig((config) => {
      configs.push(config)
      retainedDefaults = config.providerDefaults
    }, { path, debounceMs: DEBOUNCE_MS })

    try {
      await writeFile(path, "{ partial")
      await expectConditionToRemain(() => configs.length === 0)
      expect(retainedDefaults).toEqual({ codex: { model: "opus" } })

      await writeFile(path, '{"theme":"catppuccin-mocha","providerDefaults":{"codex":{"model":"sonnet"}}}')
      await waitUntil(() => configs.length === 1)
      expect(configs[0]?.theme).toBe("catppuccin-mocha")
      expect(retainedDefaults).toEqual({ codex: { model: "sonnet" } })
    } finally {
      watcher.close()
    }
  })

  it("Should suppress a settled write that leaves the resolved config unchanged", async () => {
    const path = await makeConfigPath()
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), { path, debounceMs: DEBOUNCE_MS })

    try {
      await writeFile(path, '{"theme":"dark","providerDefaults":{"codex":{"model":"sonnet"}}}')
      await waitUntil(() => configs.length === 1)

      await writeFile(path, '{"providerDefaults":{"codex":{"model":"sonnet"}},"theme":"dark"}')
      await expectConditionToRemain(() => configs.length === 1)
      expect(configs[0]?.providerDefaults).toEqual({ codex: { model: "sonnet" } })
    } finally {
      watcher.close()
    }
  })

  it("Should cancel queued reloads and ignore later changes after close", async () => {
    const path = await makeConfigPath()
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), { path, debounceMs: DEBOUNCE_MS })

    await writeFile(path, '{"theme":"light"}')
    watcher.close()
    await writeFile(path, '{"theme":"dark"}')

    await expectConditionToRemain(() => configs.length === 0)
    watcher.close()
  })

  it("Should reload after a temp-file-plus-rename replacement", async () => {
    const path = await makeConfigPath()
    const replacementPath = join(dirname(path), "config.next.json")
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), { path, debounceMs: DEBOUNCE_MS })

    try {
      await writeFile(replacementPath, '{"theme":"catppuccin-latte"}')
      await rename(replacementPath, path)

      await waitUntil(() => configs.length === 1)
      expect(configs[0]?.theme).toBe("catppuccin-latte")

      await writeFile(path, '{"theme":"dark"}')
      await waitUntil(() => configs.length === 2)
      expect(configs[1]?.theme).toBe("dark")
    } finally {
      watcher.close()
    }
  })

  it("Should observe creation when the optional config directory does not exist yet", async () => {
    const path = await makeMissingConfigPath()
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), { path, debounceMs: DEBOUNCE_MS })

    try {
      await writeFile(path, '{"theme":"light"}')

      await waitUntil(() => configs.length === 1)
      expect(configs[0]?.theme).toBe("light")
    } finally {
      watcher.close()
    }
  })

  it("Should resolve KITTEN_CONFIG and surface an external theme change through onConfig", async () => {
    const path = await makeConfigPath()
    const configs: AppConfig[] = []
    const watcher = watchUserConfig((config) => configs.push(config), {
      env: { [CONFIG_PATH_ENV_VAR]: path },
      debounceMs: DEBOUNCE_MS,
    })

    try {
      await writeFile(path, '{"theme":"dark"}')

      await waitUntil(() => configs.length === 1)
      expect(configs[0]?.theme).toBe("dark")
    } finally {
      watcher.close()
    }
  })
})
