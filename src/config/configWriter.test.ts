import { afterAll, describe, expect, it } from "bun:test"
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CONFIG_PATH_ENV_VAR,
  loadAppConfig,
  USER_CONFIG_SCHEMA,
} from "./configLoader.ts"
import { persistUserConfig, type UserConfigPatch } from "./configWriter.ts"

// Suite: Atomic user-config write-back
// Invariant: A persist either commits one schema-valid merged delta or leaves the prior target bytes unchanged.
// Boundary IN: config writer, strict user schema, path resolution, and the real local filesystem.
// Boundary OUT: watcher/store persistence wiring, owned by task_09 integration tests.

const tempDirs: string[] = []
const COLORED_STATUSLINE_PATCH = {
  statusline: {
    llmDisclosureAcknowledged: true,
    separator: " · ",
    line: [
      { kind: "FOLDER", color: "red" },
      { kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "#12abef" },
      "MODEL",
    ],
  },
} as unknown as UserConfigPatch

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

  it("preserves every unrelated config family while applying a whole editor patch", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const existing = {
      persistenceEnabled: false,
      telemetryEnabled: true,
      transcriptWindowingEnabled: true,
      theme: "catppuccin-mocha",
      welcomeBanner: "off",
      providers: { codex: { command: "/opt/bin/codex-acp", args: ["--stdio"], env: { TOKEN: "private" } } },
      providerDefaults: { codex: { model: "gpt-5.4", effort: "high" } },
      sessions: [{ provider: "codex", cwd: dir, title: "Primary" }],
      mcpServers: { github: { type: "stdio", command: "github-mcp", args: ["serve"], env: { A: "1" } } },
      shell: { enabled: false, command: "/bin/fish", scrollback: 2_500 },
      statusline: { llmDisclosureAcknowledged: true, separator: " | ", line: ["BRANCH", "MODEL"] },
    }
    const editor = { kind: "custom" as const, executable: "/opt/bin/code", args: ["--wait", "{file}"] }
    await writeFile(path, JSON.stringify(existing))

    await persistUserConfig({ editor }, { path })

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...existing, editor })
    const loaded = await loadAppConfig({ path })
    expect(loaded.editor).toEqual(editor)
    expect(loaded).toMatchObject({
      persistenceEnabled: false,
      telemetryEnabled: true,
      transcriptWindowingEnabled: true,
      theme: "catppuccin-mocha",
      welcomeBanner: "off",
      providerDefaults: existing.providerDefaults,
      sessions: existing.sessions,
      shell: existing.shell,
    })
    expect(loaded.providers.codex).toMatchObject(existing.providers.codex)
    expect(loaded.statusline).toEqual({
      llmDisclosureAcknowledged: true,
      layout: { separator: " | ", line: ["BRANCH", "MODEL"] },
    })
  })

  it("merges one provider's model or reasoning patch without replacing other saved defaults", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({
      providerDefaults: {
        "claude-code": { model: "opus", effort: "high" },
        codex: { model: "gpt-5.6-terra" },
      },
    }))

    await persistUserConfig({ providerDefaults: { codex: { effort: "ultra" } } }, { path })

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      providerDefaults: {
        "claude-code": { model: "opus", effort: "high" },
        codex: { model: "gpt-5.6-terra", effort: "ultra" },
      },
    })
  })

  it("writes bytes that re-parse through the strict schema and application loader", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")

    await persistUserConfig({ theme: "tokyo-night-storm", telemetryEnabled: true }, { path })

    const source = await readFile(path, "utf8")
    expect(USER_CONFIG_SCHEMA.safeParse(JSON.parse(source)).success).toBe(true)
    await expect(loadAppConfig({ path })).resolves.toMatchObject({
      theme: "tokyo-night-storm",
      telemetryEnabled: true,
    })
  })

  it("rejects an invalid patch without changing the original bytes", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{\n  "theme": "light",\n  "telemetryEnabled": false\n}\n')
    await writeFile(path, original)
    const invalidPatch = { theme: "neon" } as unknown as UserConfigPatch

    await expect(persistUserConfig(invalidPatch, { path })).rejects.toThrow(/theme/)

    expect(await readFile(path)).toEqual(original)
    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("rejects an invalid colored statusline patch without changing the original bytes", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{\n  "theme": "light",\n  "telemetryEnabled": false\n}\n')
    await writeFile(path, original)
    const invalidPatch = {
      statusline: {
        llmDisclosureAcknowledged: true,
        separator: " | ",
        line: [{ kind: "BRANCH", color: "#1234" }],
      },
    } as unknown as UserConfigPatch

    await expect(persistUserConfig(invalidPatch, { path })).rejects.toThrow(/statusline/)

    expect(await readFile(path)).toEqual(original)
    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("rejects invalid serialized editor data before creating a target or parent directory", async () => {
    const dir = await makeTempDir()
    const parent = join(dir, "nested")
    const path = join(parent, "config.json")
    const invalidPatch = {
      editor: { kind: "custom", executable: "code", args: ["--goto={file}"] },
    } as unknown as UserConfigPatch

    await expect(persistUserConfig(invalidPatch, { path })).rejects.toThrow(/editor\.args/)

    expect(await readdir(dir)).toEqual([])
  })

  it("rejects invalid serialized editor data before replacing an existing target", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{\n  "editor": { "kind": "system-default" },\n  "theme": "light"\n}\n')
    const invalidPatch = {
      editor: { kind: "custom", executable: "code", args: ["{file}", "{file}"] },
    } as unknown as UserConfigPatch
    await writeFile(path, original)

    await expect(persistUserConfig(invalidPatch, { path })).rejects.toThrow(/editor\.args/)

    expect(await readFile(path)).toEqual(original)
    expect(await readdir(dir)).toEqual(["config.json"])
  })

  it("rejects malformed existing JSON without replacing or supplementing the target", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const original = Buffer.from('{ "theme": "light"')
    await writeFile(path, original)

    await expect(persistUserConfig(COLORED_STATUSLINE_PATCH, { path })).rejects.toThrow(/not valid JSON/)

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

    await expect(persistUserConfig(COLORED_STATUSLINE_PATCH, { path })).rejects.toThrow(/symbolic link/)

    expect(await readFile(referent)).toEqual(original)
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect((await readdir(dir)).sort()).toEqual(["config.json", "real-config.json"])
  })
})

describe("writer-loader integration", () => {
  it("round-trips an atomic custom editor save as the same validated preference", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    const editor = { kind: "custom" as const, executable: "/opt/bin/code", args: ["--wait", "{file}"] }

    await persistUserConfig({ editor }, { path })

    expect((await loadAppConfig({ path })).editor).toEqual(editor)
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ editor })

    await persistUserConfig({ theme: "dark" }, { path })

    expect((await loadAppConfig({ path })).editor).toEqual(editor)
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ editor, theme: "dark" })
  })

  it.each([
    ["true", true],
    ["false", false],
  ])("round-trips transcript windowing %s and preserves it through an unrelated root patch", async (_label, value) => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")

    await persistUserConfig({ transcriptWindowingEnabled: value }, { path })
    expect((await loadAppConfig({ path })).transcriptWindowingEnabled).toBe(value)

    await persistUserConfig({ theme: "dark" }, { path })

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      transcriptWindowingEnabled: value,
      theme: "dark",
    })
    expect((await loadAppConfig({ path })).transcriptWindowingEnabled).toBe(value)
  })

  it("round-trips a theme delta through a real temp file", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")

    await persistUserConfig({ theme: "dracula" }, { path })
    const loaded = await loadAppConfig({ path })

    expect(loaded.theme).toBe("dracula")
  })

  it("canonicalizes colored statusline writes while preserving unrelated settings", async () => {
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

    await persistUserConfig(COLORED_STATUSLINE_PATCH, { path })

    const written = JSON.parse(await readFile(path, "utf8"))
    expect(written).toEqual({
      ...existing,
      statusline: {
        llmDisclosureAcknowledged: true,
        separator: " · ",
        line: [
          { kind: "FOLDER", color: "#FF0000" },
          { kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "#12ABEF" },
          "MODEL",
        ],
      },
    })
    const loaded = await loadAppConfig({ path })
    expect(loaded.statusline).toEqual({
      llmDisclosureAcknowledged: true,
      layout: {
        separator: " · ",
        line: [
          { kind: "FOLDER", color: "#FF0000" },
          { kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "#12ABEF" },
          "MODEL",
        ],
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
