import { afterAll, describe, expect, it } from "bun:test"
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
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
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("replaces an existing config with an owner-only file", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({ theme: "light" }))
    await chmod(path, 0o644)

    await persistUserConfig({ theme: "dark" }, { path })

    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("leaves no temp or partial file after a successful replacement", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({ theme: "light" }))

    await persistUserConfig({ theme: "dark" }, { path })

    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("rejects a symlink target before reading it and leaves the referent unchanged", async () => {
    const dir = await makeTempDir()
    const referent = join(dir, "real-config.json")
    const path = join(dir, "config.json")
    const original = Buffer.from('{"theme":"light"}\n')
    await writeFile(referent, original)
    await symlink(referent, path)

    await expect(persistUserConfig({ theme: "dark" }, { path })).rejects.toThrow(/symbolic link/)

    expect(await readFile(referent)).toEqual(original)
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect((await readdir(dir)).sort()).toEqual(["config.json", "real-config.json"])
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

  it("preserves unrelated settings across acknowledgement-only and complete statusline writes", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const existing = {
      persistenceEnabled: false,
      telemetryEnabled: true,
      theme: "light",
      welcomeBanner: "off",
      providers: { codex: { command: "/opt/bin/codex-acp", args: ["--stdio"], env: { TOKEN: "private" } } },
      providerDefaults: { codex: { model: "gpt-5.4", effort: "high" } },
      sessions: [{ provider: "codex", cwd: dir, title: "Primary" }],
      mcpServers: { github: { type: "stdio", command: "github-mcp", args: ["serve"], env: { A: "1" } } },
      shell: { enabled: false, command: "/bin/fish", scrollback: 2_500 },
    }
    await writeFile(path, JSON.stringify(existing))

    await persistUserConfig({ statusline: { llmDisclosureAcknowledged: true } }, { path })
    await expect(loadAppConfig({ path })).resolves.toMatchObject({
      statusline: { llmDisclosureAcknowledged: true, layout: null },
    })

    await persistUserConfig({
      statusline: {
        llmDisclosureAcknowledged: true,
        separator: " · ",
        line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
      },
    }, { path })

    const written = JSON.parse(await readFile(path, "utf8"))
    expect(written).toEqual({
      ...existing,
      statusline: {
        llmDisclosureAcknowledged: true,
        separator: " · ",
        line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
      },
    })
    const loaded = await loadAppConfig({ path })
    expect(loaded.statusline).toEqual({
      llmDisclosureAcknowledged: true,
      layout: {
        separator: " · ",
        line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
      },
    })
    expect(loaded).toMatchObject({
      persistenceEnabled: false,
      telemetryEnabled: true,
      theme: "light",
      welcomeBanner: "off",
      providerDefaults: { codex: { model: "gpt-5.4", effort: "high" } },
      sessions: existing.sessions,
      shell: existing.shell,
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it("preserves a saved layout when a later patch changes acknowledgement only", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({
      statusline: { llmDisclosureAcknowledged: true, separator: " | ", line: ["BRANCH", "MODEL"] },
    }))

    await persistUserConfig({ statusline: { llmDisclosureAcknowledged: false } }, { path })

    expect(JSON.parse(await readFile(path, "utf8")).statusline).toEqual({
      llmDisclosureAcknowledged: false,
      separator: " | ",
      line: ["BRANCH", "MODEL"],
    })
  })
})
