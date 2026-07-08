import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  CONFIG_PATH_ENV_VAR,
  ConfigError,
  defaultAppConfig,
  findAgentConfig,
  loadAppConfig,
  parseAppConfig,
  resolveConfigPath,
} from "./configLoader.ts"

/**
 * Unit tests for `AppConfig` loading: the shipped defaults for the two V1 agents,
 * per-agent override merging, the telemetry opt-in, and the failure modes of an
 * invalid config file. `loadAppConfig` is exercised against real temp files so the
 * missing-file and present-file paths are both covered end to end.
 */

const tempDirs: string[] = []

async function writeConfig(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-config-"))
  tempDirs.push(dir)
  const path = join(dir, "config.json")
  await Bun.write(path, source)
  return path
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("defaults", () => {
  it("Should return the two default agent configs when no user config exists", async () => {
    const missing = join(tmpdir(), "kitten-does-not-exist", "config.json")
    const config = await loadAppConfig({ path: missing })

    expect(config.agents.map((agent) => agent.id)).toEqual(["claude-code", "codex"])
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
    first.agents[0]!.args.push("--rogue")
    first.agents[0]!.env.ROGUE = "1"

    const second = defaultAppConfig()
    expect(second.agents[0]!.args).toEqual(["-y", CLAUDE_CODE_ACP_PACKAGE])
    expect(second.agents[0]!.env).toEqual({})
  })

  it("Should return undefined for an agent the config does not define", () => {
    expect(findAgentConfig({ agents: [], telemetryEnabled: false }, "codex")).toBeUndefined()
  })
})

describe("user overrides", () => {
  it("Should replace command and args for the overridden agent only", async () => {
    const path = await writeConfig(
      JSON.stringify({ agents: { codex: { command: "/opt/bin/codex-acp", args: ["--stdio"] } } }),
    )

    const config = await loadAppConfig({ path })

    const codex = findAgentConfig(config, "codex")
    expect(codex?.command).toBe("/opt/bin/codex-acp")
    expect(codex?.args).toEqual(["--stdio"])
    // The untouched agent keeps every default field.
    expect(findAgentConfig(config, "claude-code")).toEqual(defaultAppConfig().agents[0]!)
  })

  it("Should leave unspecified fields of an overridden agent at their defaults", () => {
    const config = parseAppConfig(JSON.stringify({ agents: { "claude-code": { displayName: "Claude" } } }))

    const claude = findAgentConfig(config, "claude-code")
    expect(claude?.displayName).toBe("Claude")
    expect(claude?.command).toBe("npx")
    expect(claude?.args).toEqual(["-y", CLAUDE_CODE_ACP_PACKAGE])
  })

  it("Should merge env over the agent's default env", () => {
    const config = parseAppConfig(JSON.stringify({ agents: { codex: { env: { CODEX_PATH: "/usr/bin/codex" } } } }))

    expect(findAgentConfig(config, "codex")?.env).toEqual({ CODEX_PATH: "/usr/bin/codex" })
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

describe("invalid config", () => {
  it("Should reject malformed JSON with the offending path", async () => {
    const path = await writeConfig("{ not json")

    await expect(loadAppConfig({ path })).rejects.toThrow(ConfigError)
    await expect(loadAppConfig({ path })).rejects.toThrow(/is not valid JSON/)
  })

  it("Should reject an unknown top-level key rather than silently ignoring a typo", () => {
    expect(() => parseAppConfig(JSON.stringify({ telemetry: true }))).toThrow(ConfigError)
  })

  it("Should reject an unknown agent id", () => {
    expect(() => parseAppConfig(JSON.stringify({ agents: { gemini: { command: "gemini" } } }))).toThrow(ConfigError)
  })

  it("Should reject a wrongly-typed field and name it", () => {
    expect(() => parseAppConfig(JSON.stringify({ agents: { codex: { args: "--stdio" } } }))).toThrow(
      /agents\.codex\.args/,
    )
  })

  it("Should reject an empty command", () => {
    expect(() => parseAppConfig(JSON.stringify({ agents: { codex: { command: "" } } }))).toThrow(ConfigError)
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
