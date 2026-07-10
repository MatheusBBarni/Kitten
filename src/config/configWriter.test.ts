import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CONFIG_PATH_ENV_VAR,
  loadAppConfig,
  USER_CONFIG_SCHEMA,
  type UserConfig,
} from "./configLoader.ts"
import { persistUserConfig } from "./configWriter.ts"

// Suite: Atomic user-config write-back
// Invariant: A persist either commits one schema-valid merged delta or leaves the prior target bytes unchanged.
// Boundary IN: config writer, strict user schema, path resolution, and the real local filesystem.
// Boundary OUT: watcher/store persistence wiring, owned by task_09 integration tests.

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-config-writer-"))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("persistUserConfig", () => {
  it("preserves telemetry and provider deltas while applying a theme patch", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const existing = {
      telemetryEnabled: true,
      providers: { codex: { command: "/opt/bin/codex-acp", args: ["--stdio"] } },
    }
    await writeFile(path, JSON.stringify(existing))

    await persistUserConfig({ theme: "dark" }, { path })

    const written: unknown = JSON.parse(await readFile(path, "utf8"))
    expect(written).toEqual({ ...existing, theme: "dark" })
  })

  it("writes bytes that re-parse through the strict schema and application loader", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")

    await persistUserConfig({ theme: "catppuccin-mocha", telemetryEnabled: true }, { path })

    const source = await readFile(path, "utf8")
    expect(USER_CONFIG_SCHEMA.safeParse(JSON.parse(source)).success).toBe(true)
    await expect(loadAppConfig({ path })).resolves.toMatchObject({
      theme: "catppuccin-mocha",
      telemetryEnabled: true,
    })
  })

  it("rejects an invalid patch without changing the original bytes", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{\n  "theme": "light",\n  "telemetryEnabled": false\n}\n')
    await writeFile(path, original)
    const invalidPatch = { theme: "neon" } as unknown as Partial<UserConfig>

    await expect(persistUserConfig(invalidPatch, { path })).rejects.toThrow(/theme/)

    expect(await readFile(path)).toEqual(original)
    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("rejects malformed existing JSON without replacing or supplementing the target", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{ "theme": "light"')
    await writeFile(path, original)

    await expect(persistUserConfig({ theme: "dark" }, { path })).rejects.toThrow(/not valid JSON/)

    expect(await readFile(path)).toEqual(original)
    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("honors KITTEN_CONFIG and creates a missing parent directory", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "nested", "kitten", "config.json")

    await persistUserConfig(
      { theme: "dark" },
      { env: { [CONFIG_PATH_ENV_VAR]: path, XDG_CONFIG_HOME: join(dir, "ignored") } },
    )

    const config = await loadAppConfig({ path })
    expect(config.theme).toBe("dark")
  })

  it("leaves no temp or partial file after a successful replacement", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({ theme: "light" }))

    await persistUserConfig({ theme: "dark" }, { path })

    expect(await readdir(dir)).toEqual(["config.json"])
  })
})

describe("writer-loader integration", () => {
  it("round-trips a theme delta through a real temp file", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")

    await persistUserConfig({ theme: "catppuccin-latte" }, { path })
    const loaded = await loadAppConfig({ path })

    expect(loaded.theme).toBe("catppuccin-latte")
  })
})
