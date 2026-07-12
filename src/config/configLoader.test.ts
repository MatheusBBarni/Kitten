import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  CONFIG_PATH_ENV_VAR,
  ConfigError,
  DEFAULT_SESSION_PERSISTENCE_ENABLED,
  DEFAULT_SHELL_SCROLLBACK,
  MAX_SHELL_SCROLLBACK,
  defaultAppConfig,
  findAgentConfig,
  loadAppConfig,
  parseAppConfig,
  resolveConfigPath,
  resolveSessions,
} from "./configLoader.ts"

/**
 * Unit tests for `AppConfig` loading (ADR-005): the shipped default provider recipes,
 * per-provider override merging, theme, telemetry, and persistence preferences, session resolution
 * (zero-config default, per-session `cwd`/`title`/`task`, repeated-provider identities),
 * and the failure modes of an invalid config file. `loadAppConfig` is exercised against
 * real temp files so the missing-file and present-file paths are both covered end to end.
 */

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-config-"))
  tempDirs.push(dir)
  return dir
}

async function writeConfig(source: string): Promise<string> {
  const dir = await makeTempDir()
  const path = join(dir, "config.json")
  await Bun.write(path, source)
  return path
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("defaults", () => {
  it("Should return the two default provider recipes when no user config exists", async () => {
    const missing = join(tmpdir(), "kitten-does-not-exist", "config.json")
    const config = await loadAppConfig({ path: missing })

    expect(Object.keys(config.providers)).toEqual(["claude-code", "codex"])
    expect(config.sessions).toEqual([])
    expect(findAgentConfig(config, "claude-code")).toEqual({
      id: "claude-code",
      displayName: "Claude Code",
      command: "npx",
      args: ["-y", CLAUDE_CODE_ACP_PACKAGE],
      env: {},
    })
    expect(findAgentConfig(config, "codex")).toEqual({
      id: "codex",
      displayName: "Codex",
      command: "npx",
      args: ["-y", CODEX_ACP_PACKAGE],
      env: {},
    })
  })

  it("Should pin both ACP adapter packages to an exact version", () => {
    // ADR-005: an unpinned adapter can change its handshake beneath a running install.
    expect(CLAUDE_CODE_ACP_PACKAGE).toMatch(/@\d+\.\d+\.\d+$/)
    expect(CODEX_ACP_PACKAGE).toMatch(/@\d+\.\d+\.\d+$/)
  })

  it("Should hand out an isolated copy so a mutated config cannot poison the next load", () => {
    const first = defaultAppConfig()
    first.providers["claude-code"].args.push("--rogue")
    first.providers["claude-code"].env.ROGUE = "1"

    const second = defaultAppConfig()
    expect(second.providers["claude-code"].args).toEqual(["-y", CLAUDE_CODE_ACP_PACKAGE])
    expect(second.providers["claude-code"].env).toEqual({})
  })
})

describe("user overrides", () => {
  it("Should replace command and args for the overridden provider only", async () => {
    const path = await writeConfig(
      JSON.stringify({ providers: { codex: { command: "/opt/bin/codex-acp", args: ["--stdio"] } } }),
    )

    const config = await loadAppConfig({ path })

    const codex = findAgentConfig(config, "codex")
    expect(codex?.command).toBe("/opt/bin/codex-acp")
    expect(codex?.args).toEqual(["--stdio"])
    // The untouched provider keeps every default field.
    expect(findAgentConfig(config, "claude-code")).toEqual(findAgentConfig(defaultAppConfig(), "claude-code"))
  })

  it("Should leave unspecified fields of an overridden provider at their defaults", () => {
    const config = parseAppConfig(JSON.stringify({ providers: { "claude-code": { displayName: "Claude" } } }))

    const claude = findAgentConfig(config, "claude-code")
    expect(claude?.displayName).toBe("Claude")
    expect(claude?.command).toBe("npx")
    expect(claude?.args).toEqual(["-y", CLAUDE_CODE_ACP_PACKAGE])
  })

  it("Should shallow-merge a provider env override over the default recipe rather than replacing it", () => {
    // The default codex env is empty, so add a second key to prove the merge keeps both.
    const config = parseAppConfig(
      JSON.stringify({
        providers: {
          codex: { env: { CODEX_PATH: "/usr/bin/codex" } },
          "claude-code": { env: { CLAUDE_A: "1" } },
        },
      }),
    )
    // Merge a further override on top to show earlier keys survive alongside new ones.
    const merged = parseAppConfig(
      JSON.stringify({ providers: { "claude-code": { env: { CLAUDE_B: "2" } } } }),
    )

    expect(findAgentConfig(config, "codex")?.env).toEqual({ CODEX_PATH: "/usr/bin/codex" })
    expect(findAgentConfig(config, "claude-code")?.env).toEqual({ CLAUDE_A: "1" })
    expect(findAgentConfig(merged, "claude-code")?.env).toEqual({ CLAUDE_B: "2" })
  })

  it("Should accept the deprecated `agents` key as an alias for `providers`", () => {
    const config = parseAppConfig(JSON.stringify({ agents: { codex: { command: "/opt/bin/codex-acp" } } }))

    expect(findAgentConfig(config, "codex")?.command).toBe("/opt/bin/codex-acp")
  })
})

describe("shell config", () => {
  it("Should resolve shell defaults when the user omits the shell block", () => {
    expect(parseAppConfig("{}").shell).toEqual({
      enabled: true,
      command: process.env.SHELL || "/bin/sh",
      scrollback: DEFAULT_SHELL_SCROLLBACK,
    })
  })

  it("Should merge a command override while retaining the other shell defaults", () => {
    expect(parseAppConfig(JSON.stringify({ shell: { command: "/opt/bin/fish" } })).shell).toEqual({
      enabled: true,
      command: "/opt/bin/fish",
      scrollback: DEFAULT_SHELL_SCROLLBACK,
    })
  })

  it.each([
    ["a negative", -1],
    ["a value above the configured bound", MAX_SHELL_SCROLLBACK + 1],
    ["a fractional", 1.5],
    ["a non-numeric", "1000"],
  ])("Should reject %s scrollback value", (_case, scrollback) => {
    expect(() => parseAppConfig(JSON.stringify({ shell: { scrollback } }))).toThrow(ConfigError)
    expect(() => parseAppConfig(JSON.stringify({ shell: { scrollback } }))).toThrow(/shell\.scrollback/)
  })

  it("Should reject unknown keys inside the shell block", () => {
    expect(() => parseAppConfig(JSON.stringify({ shell: { enabled: true, history: 500 } }))).toThrow(ConfigError)
    expect(() => parseAppConfig(JSON.stringify({ shell: { enabled: true, history: 500 } }))).toThrow(/shell/)
  })

  it("Should load a partial shell block from a real file as a complete AppConfig", async () => {
    const path = await writeConfig(JSON.stringify({ shell: { enabled: false, scrollback: 2_500 } }))

    const config = await loadAppConfig({ path })

    expect(config.shell).toEqual({
      enabled: false,
      command: process.env.SHELL || "/bin/sh",
      scrollback: 2_500,
    })
    expect(config.providers).toEqual(defaultAppConfig().providers)
    expect(config.telemetryEnabled).toBe(false)
  })
})

describe("resolveSessions", () => {
  it("Should seed one session per configured provider in the launch directory when none are declared", () => {
    const config = defaultAppConfig()

    const resolved = resolveSessions(config, { launchCwd: "/launch/dir" })

    expect(resolved.map((session) => session.seed.id)).toEqual(["claude-code", "codex"])
    expect(resolved.map((session) => session.seed.providerKind)).toEqual(["claude-code", "codex"])
    expect(resolved.every((session) => session.seed.cwd === "/launch/dir")).toBe(true)
    // Preserve today's titles: the provider display name, not the launch-dir basename.
    expect(resolved.map((session) => session.seed.title)).toEqual(["Claude Code", "Codex"])
    // The resolved spawn recipe carries the provider's id for the connection factory.
    expect(resolved[0]!.spawn).toEqual(findAgentConfig(config, "claude-code")!)
  })

  it("Should resolve two sessions of the same provider into distinct ids, titles, and directories", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [
        { provider: "claude-code" as const, cwd: "/repos/api" },
        { provider: "claude-code" as const, cwd: "/repos/web" },
      ],
    }

    const resolved = resolveSessions(config, { launchCwd: "/launch/dir", dirExists: () => true })

    expect(resolved).toHaveLength(2)
    expect(resolved.map((session) => session.seed.id)).toEqual(["claude-code", "claude-code-2"])
    expect(resolved.map((session) => session.seed.cwd)).toEqual(["/repos/api", "/repos/web"])
    expect(resolved.map((session) => session.seed.title)).toEqual(["api", "web"])
    // Both sessions still spawn the same provider recipe.
    expect(resolved[0]!.spawn.id).toBe("claude-code")
    expect(resolved[1]!.spawn.id).toBe("claude-code")
  })

  it("Should default a session's title to the cwd basename when none is given", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "codex" as const, cwd: "/home/me/projects/payments" }],
    }

    const [session] = resolveSessions(config, { dirExists: () => true })

    expect(session!.seed.title).toBe("payments")
    expect(session!.seed.title).toBe(basename("/home/me/projects/payments"))
  })

  it("Should keep an explicit title and carry an optional first task through", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "codex" as const, cwd: "/home/me/api", title: "API service", task: "fix the flake" }],
    }

    const [session] = resolveSessions(config, { dirExists: () => true })

    expect(session!.seed.title).toBe("API service")
    expect(session!.seed.task).toBe("fix the flake")
  })

  it("Should resolve a relative session cwd against the launch directory", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "codex" as const, cwd: "../sibling" }],
    }

    const [session] = resolveSessions(config, { launchCwd: "/launch/dir", dirExists: () => true })

    expect(session!.seed.cwd).toBe("/launch/sibling")
  })

  it("Should reject a declared session whose cwd does not exist, naming the session and path", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "codex" as const, cwd: "/nowhere" }],
    }

    expect(() => resolveSessions(config, { dirExists: () => false })).toThrow(ConfigError)
    expect(() => resolveSessions(config, { dirExists: () => false })).toThrow(/sessions\.0\.cwd.*\/nowhere/)
  })
})

describe("telemetry opt-in", () => {
  it("Should default telemetry to off", async () => {
    expect(defaultAppConfig().telemetryEnabled).toBe(false)
    expect((await loadAppConfig({ path: join(tmpdir(), "kitten-absent.json") })).telemetryEnabled).toBe(false)
    expect(parseAppConfig("{}").telemetryEnabled).toBe(false)
  })

  it("Should honor telemetry when the user opts in", async () => {
    const path = await writeConfig(JSON.stringify({ telemetryEnabled: true }))

    expect((await loadAppConfig({ path })).telemetryEnabled).toBe(true)
  })

  it("Should honor an explicit telemetry opt-out", () => {
    expect(parseAppConfig(JSON.stringify({ telemetryEnabled: false })).telemetryEnabled).toBe(false)
  })
})

describe("session persistence", () => {
  it("Should default session persistence to on", () => {
    expect(DEFAULT_SESSION_PERSISTENCE_ENABLED).toBe(true)
    expect(defaultAppConfig().persistenceEnabled).toBe(true)
  })

  it("Should retain the enabled default when the user omits session persistence", () => {
    expect(parseAppConfig("{}").persistenceEnabled).toBe(true)
  })

  it.each([
    ["true", true],
    ["false", false],
  ])("Should honor an explicit session persistence value of %s", (_label, persistenceEnabled) => {
    expect(parseAppConfig(JSON.stringify({ persistenceEnabled })).persistenceEnabled).toBe(persistenceEnabled)
  })

  it("Should reject a non-boolean session persistence value and name the field", () => {
    expect(() => parseAppConfig('{"persistenceEnabled":"yes"}')).toThrow(ConfigError)
    expect(() => parseAppConfig('{"persistenceEnabled":"yes"}')).toThrow(/persistenceEnabled/)
  })

  it("Should load a disabled session persistence delta from a real config file", async () => {
    const path = await writeConfig('{"persistenceEnabled":false}')

    expect((await loadAppConfig({ path })).persistenceEnabled).toBe(false)
  })
})

describe("theme preference", () => {
  it("Should default the theme to auto", () => {
    expect(defaultAppConfig().theme).toBe("auto")
  })

  it("Should merge an omitted theme delta to auto", () => {
    expect(parseAppConfig("{}").theme).toBe("auto")
  })

  it("Should accept a valid named theme preference", () => {
    expect(parseAppConfig('{"theme":"catppuccin-mocha"}').theme).toBe("catppuccin-mocha")
  })

  it("Should load a theme delta from a real config file", async () => {
    const path = await writeConfig(JSON.stringify({ theme: "catppuccin-latte" }))

    const config = await loadAppConfig({ path })

    expect(config.theme).toBe("catppuccin-latte")
    expect(config.providers).toEqual(defaultAppConfig().providers)
  })
})

describe("welcome banner preference", () => {
  it("Should default the welcome banner to auto when no config exists", async () => {
    const path = join(await makeTempDir(), "missing-config.json")

    expect((await loadAppConfig({ path })).welcomeBanner).toBe("auto")
  })

  it("Should load an off preference from a real config file", async () => {
    const path = await writeConfig(JSON.stringify({ welcomeBanner: "off" }))

    expect((await loadAppConfig({ path })).welcomeBanner).toBe("off")
  })

  it("Should reject an unknown welcome banner preference", () => {
    expect(() => parseAppConfig('{"welcomeBanner":"sometimes"}')).toThrow(ConfigError)
    expect(() => parseAppConfig('{"welcomeBanner":"sometimes"}')).toThrow(/welcomeBanner/)
  })
})

describe("invalid config", () => {
  it("Should reject malformed JSON with the offending path", async () => {
    const path = await writeConfig("{ not json")

    await expect(loadAppConfig({ path })).rejects.toThrow(ConfigError)
    await expect(loadAppConfig({ path })).rejects.toThrow(/is not valid JSON/)
  })

  it("Should reject an unknown top-level key naming the offending field", () => {
    expect(() => parseAppConfig(JSON.stringify({ telemetry: true }))).toThrow(ConfigError)
    expect(() => parseAppConfig(JSON.stringify({ telemetry: true }))).toThrow(/telemetry/)
  })

  it("Should reject an invalid theme preference naming the offending field", () => {
    expect(() => parseAppConfig('{"theme":"neon"}')).toThrow(ConfigError)
    expect(() => parseAppConfig('{"theme":"neon"}')).toThrow(/theme/)
  })

  it("Should reject an unknown provider id", () => {
    expect(() => parseAppConfig(JSON.stringify({ providers: { gemini: { command: "gemini" } } }))).toThrow(ConfigError)
  })

  it("Should reject an unknown key inside a session descriptor", () => {
    expect(() =>
      parseAppConfig(JSON.stringify({ sessions: [{ provider: "codex", cwd: "/x", branch: "main" }] })),
    ).toThrow(/branch/)
  })

  it("Should reject a session with an unknown provider", () => {
    expect(() => parseAppConfig(JSON.stringify({ sessions: [{ provider: "gemini", cwd: "/x" }] }))).toThrow(ConfigError)
  })

  it("Should reject a session that is missing its cwd, naming the field", () => {
    expect(() => parseAppConfig(JSON.stringify({ sessions: [{ provider: "codex" }] }))).toThrow(/sessions\.0\.cwd/)
  })

  it("Should reject a wrongly-typed field and name it", () => {
    expect(() => parseAppConfig(JSON.stringify({ providers: { codex: { args: "--stdio" } } }))).toThrow(
      /providers\.codex\.args/,
    )
  })

  it("Should reject an empty command", () => {
    expect(() => parseAppConfig(JSON.stringify({ providers: { codex: { command: "" } } }))).toThrow(ConfigError)
  })
})

describe("loadAppConfig with a real sessions file", () => {
  it("Should resolve three declared sessions in order, each with its own directory", async () => {
    const dir = await makeTempDir()
    const path = join(dir, "config.json")
    await Bun.write(
      path,
      JSON.stringify({
        sessions: [
          { provider: "claude-code", cwd: dir },
          { provider: "codex", cwd: dir, title: "Codex on the same repo" },
          { provider: "claude-code", cwd: dir, task: "start on the parser" },
        ],
      }),
    )

    const config = await loadAppConfig({ path })
    const resolved = resolveSessions(config, { launchCwd: dir })

    expect(resolved).toHaveLength(3)
    expect(resolved.map((session) => session.seed.providerKind)).toEqual(["claude-code", "codex", "claude-code"])
    // Repeated providers get distinct identities while keeping declared order.
    expect(resolved.map((session) => session.seed.id)).toEqual(["claude-code", "codex", "claude-code-2"])
    expect(resolved.every((session) => session.seed.cwd === dir)).toBe(true)
    expect(resolved[1]!.seed.title).toBe("Codex on the same repo")
    expect(resolved[0]!.seed.title).toBe(basename(dir))
    expect(resolved[2]!.seed.task).toBe("start on the parser")
  })
})

describe("resolveConfigPath", () => {
  it("Should prefer an explicit KITTEN_CONFIG path", () => {
    const env = { [CONFIG_PATH_ENV_VAR]: "/custom/kitten.json", XDG_CONFIG_HOME: "/xdg" }
    expect(resolveConfigPath(env)).toBe("/custom/kitten.json")
  })

  it("Should fall back to XDG_CONFIG_HOME", () => {
    expect(resolveConfigPath({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/kitten/config.json")
  })

  it("Should fall back to ~/.config when no environment hints exist", () => {
    expect(resolveConfigPath({})).toMatch(/\.config\/kitten\/config\.json$/)
  })
})
