import { afterAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import {
  THEME_PRESET_ALIASES,
  THEME_PRESET_IDS,
  type ThemePresetId,
} from "../core/themeCatalog.ts"
import { PROVIDER_KINDS } from "../core/types.ts"
import type {
  CertifiedHardStopContinuationRecipe,
  HardStopContinuationAdapterImplementation,
} from "./hardStopContinuationCapability.ts"

import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  CODEX_YOLO_MODE,
  CONFIG_PATH_ENV_VAR,
  ConfigError,
  DEFAULT_CLARIFICATION_TIMEOUT_SECONDS,
  DEFAULT_SESSION_PERSISTENCE_ENABLED,
  DEFAULT_SHELL_SCROLLBACK,
  MAX_SHELL_SCROLLBACK,
  MAX_CLARIFICATION_TIMEOUT_SECONDS,
  defaultAppConfig,
  findAgentConfig,
  loadAppConfig,
  matchCertifiedCursorRuntimeProfile,
  mergeAppConfig,
  parseAppConfig,
  resolveConfigPath,
  resolveProviderRuntimeProfile,
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
const README_PATH = join(import.meta.dir, "..", "..", "..", "..", "README.md")

async function readReadmeJsonExample(
  name: "mcp-config-example" | "mcp-remote-example" | "provider-defaults-example" | "transcript-windowing-example",
): Promise<string> {
  const readme = await Bun.file(README_PATH).text()
  const match = readme.match(new RegExp(`<!-- ${name}:start -->\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`\\s*<!-- ${name}:end -->`))
  if (!match?.[1]) throw new Error(`README example ${name} is missing`)
  return match[1]
}

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
  it("Should return the three default provider recipes when no user config exists", async () => {
    const missing = join(tmpdir(), "kitten-does-not-exist", "config.json")
    const config = await loadAppConfig({ path: missing })

    expect(Object.keys(config.providers)).toEqual(["claude-code", "codex", "cursor"])
    expect(config.providerDefaults).toEqual({})
    expect(config.sessions).toEqual([])
    expect(findAgentConfig(config, "claude-code")).toEqual({
      id: "claude-code",
      displayName: "Claude Code",
      command: "npx",
      args: ["-y", CLAUDE_CODE_ACP_PACKAGE],
      env: {},
      clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
      hardStopContinuationCapability: { status: "unavailable", reason: "unreviewed_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    })
    expect(findAgentConfig(config, "codex")).toEqual({
      id: "codex",
      displayName: "Codex",
      command: "npx",
      args: ["-y", CODEX_ACP_PACKAGE],
      env: { INITIAL_AGENT_MODE: CODEX_YOLO_MODE },
      clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
      hardStopContinuationCapability: { status: "unavailable", reason: "unreviewed_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    })
    expect(findAgentConfig(config, "cursor")).toEqual({
      id: "cursor",
      displayName: "Cursor",
      command: "agent",
      args: ["acp"],
      env: {},
      clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
      hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    })
  })

  it("Should pin both ACP adapter packages to an exact version", () => {
    // ADR-005: an unpinned adapter can change its handshake beneath a running install.
    expect(CLAUDE_CODE_ACP_PACKAGE).toMatch(/@\d+\.\d+\.\d+$/)
    expect(CODEX_ACP_PACKAGE).toMatch(/@\d+\.\d+\.\d+$/)
  })

  it("Should use the verified Codex ACP release that carries the current Codex runtime", () => {
    // The selector must receive the runtime's advertised model and effort options;
    // keep this exact pin intentional rather than silently falling back to 1.1.0.
    expect(CODEX_ACP_PACKAGE).toBe("@agentclientprotocol/codex-acp@1.1.2")
  })

  it("Should hand out an isolated copy so a mutated config cannot poison the next load", () => {
    const first = defaultAppConfig()
    first.providers["claude-code"].args.push("--rogue")
    first.providers["claude-code"].env.ROGUE = "1"
    first.providers.codex.env.INITIAL_AGENT_MODE = "agent"
    first.providers.cursor.args.push("--rogue")
    first.providers.cursor.env.ROGUE = "1"
    first.mcpServers.push({ name: "rogue", command: "rogue", args: [], env: {} })

    const second = defaultAppConfig()
    expect(second.providers["claude-code"].args).toEqual(["-y", CLAUDE_CODE_ACP_PACKAGE])
    expect(second.providers["claude-code"].env).toEqual({})
    expect(second.providers.codex.env).toEqual({ INITIAL_AGENT_MODE: CODEX_YOLO_MODE })
    expect(second.providers.cursor.args).toEqual(["acp"])
    expect(second.providers.cursor.env).toEqual({})
    expect(second.mcpServers).toEqual([])
    expect(second.providerDefaults).toEqual({})
    expect(second.statusline).toEqual({ llmDisclosureAcknowledged: false, layout: null })
  })
})

describe("editor preference", () => {
  it("Should resolve an absent editor block to a fresh system-default preference", async () => {
    expect(defaultAppConfig().editor).toEqual({ kind: "system-default" })
    expect(parseAppConfig("{}").editor).toEqual({ kind: "system-default" })
    expect(parseAppConfig('{"editor":{"kind":"system-default"}}').editor).toEqual({ kind: "system-default" })

    const path = join(await makeTempDir(), "missing.json")
    await expect(loadAppConfig({ path })).resolves.toMatchObject({
      editor: { kind: "system-default" },
    })
  })

  it("Should load a strict custom executable with exactly one full file placeholder", async () => {
    const editor = {
      kind: "custom" as const,
      executable: "/opt/bin/code",
      args: ["--wait", "{file}"],
    }
    const path = await writeConfig(JSON.stringify({ editor }))

    expect((await loadAppConfig({ path })).editor).toEqual(editor)
  })

  it("Should defensively copy custom arguments while resolving application config", () => {
    const editor = {
      kind: "custom" as const,
      executable: "/opt/bin/code",
      args: ["--wait", "{file}"],
    }

    const config = mergeAppConfig({ editor })

    expect(config.editor).toEqual(editor)
    expect(config.editor).not.toBe(editor)
    if (config.editor.kind !== "custom") throw new Error("expected custom editor preference")
    expect(config.editor.args).not.toBe(editor.args)
    editor.args[0] = "--mutated"
    expect(config.editor.args).toEqual(["--wait", "{file}"])
  })

  it.each([
    ["a missing placeholder", { kind: "custom", executable: "code", args: ["--wait"] }],
    ["repeated placeholders", { kind: "custom", executable: "code", args: ["{file}", "{file}"] }],
    ["a partial placeholder", { kind: "custom", executable: "code", args: ["--goto={file}"] }],
    ["a blank executable", { kind: "custom", executable: "   ", args: ["{file}"] }],
    ["an unknown custom key", { kind: "custom", executable: "code", args: ["{file}"], shell: true }],
    ["an unknown system-default key", { kind: "system-default", args: ["{file}"] }],
  ])("Should reject %s as a hard config error", (_case, editor) => {
    const parse = () => parseAppConfig(JSON.stringify({ editor }))

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/editor/)
  })
})

describe("statusline config", () => {
  it("Should preserve the legacy footer and require no disclosure acknowledgement when omitted", async () => {
    expect(defaultAppConfig().statusline).toEqual({ llmDisclosureAcknowledged: false, layout: null })
    expect(parseAppConfig("{}").statusline).toEqual({ llmDisclosureAcknowledged: false, layout: null })

    const path = join(await makeTempDir(), "missing.json")
    await expect(loadAppConfig({ path })).resolves.toMatchObject({
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    })
  })

  it("Should parse acknowledgement-only and complete layout deltas", () => {
    expect(
      parseAppConfig(JSON.stringify({ statusline: { llmDisclosureAcknowledged: true } })).statusline,
    ).toEqual({ llmDisclosureAcknowledged: true, layout: null })

    expect(
      parseAppConfig(JSON.stringify({
        statusline: {
          llmDisclosureAcknowledged: true,
          separator: " · ",
          line: [
            { kind: "FOLDER", color: "red" },
            { kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "#12abef" },
            "MODEL",
          ],
        },
      })).statusline,
    ).toEqual({
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
  })

  it.each([
    ["missing acknowledgement", { separator: " | ", line: ["FOLDER"] }],
    ["separator without line", { llmDisclosureAcknowledged: true, separator: " | " }],
    ["line without separator", { llmDisclosureAcknowledged: true, line: ["FOLDER"] }],
    ["unknown nested key", { llmDisclosureAcknowledged: true, request: "show my branch" }],
    ["invalid item", { llmDisclosureAcknowledged: true, separator: " | ", line: ["COST"] }],
    [
      "invalid item color",
      {
        llmDisclosureAcknowledged: true,
        separator: " | ",
        line: [{ kind: "FOLDER", color: "transparent" }],
      },
    ],
    [
      "unknown colored item key",
      {
        llmDisclosureAcknowledged: true,
        separator: " | ",
        line: [{ kind: "MODEL", color: "red", background: "#000000" }],
      },
    ],
    [
      "unknown item key",
      {
        llmDisclosureAcknowledged: true,
        separator: " | ",
        line: [{ kind: "ELLIPSIS_BRANCH", maxChars: 24, command: "git branch" }],
      },
    ],
    ["invalid separator", { llmDisclosureAcknowledged: true, separator: "\n", line: ["FOLDER"] }],
  ])("Should reject %s as a hard config error", (_name, statusline) => {
    const parse = () => parseAppConfig(JSON.stringify({ statusline }))
    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/statusline/)
  })

  it("Should merge statusline independently while retaining every unrelated config family", () => {
    const config = parseAppConfig(JSON.stringify({
      persistenceEnabled: false,
      telemetryEnabled: true,
      theme: "catppuccin-mocha",
      welcomeBanner: "off",
      providers: { codex: { command: "/opt/bin/codex-acp", env: { TOKEN: "private" } } },
      providerDefaults: { codex: { model: "gpt-5.4", effort: "high" } },
      sessions: [{ provider: "codex", cwd: "/workspace", title: "Primary" }],
      mcpServers: { github: { type: "stdio", command: "github-mcp", args: ["serve"], env: { A: "1" } } },
      shell: { enabled: false, command: "/bin/fish", scrollback: 2_500 },
      statusline: { llmDisclosureAcknowledged: true, separator: " | ", line: ["PROVIDER", "MODEL"] },
    }))

    expect(config.statusline).toEqual({
      llmDisclosureAcknowledged: true,
      layout: { separator: " | ", line: ["PROVIDER", "MODEL"] },
    })
    expect(config.persistenceEnabled).toBe(false)
    expect(config.telemetryEnabled).toBe(true)
    expect(config.theme).toBe("catppuccin-mocha")
    expect(config.welcomeBanner).toBe("off")
    expect(config.providers.codex).toMatchObject({ command: "/opt/bin/codex-acp", env: { TOKEN: "private" } })
    expect(config.providerDefaults).toEqual({ codex: { model: "gpt-5.4", effort: "high" } })
    expect(config.sessions).toEqual([{ provider: "codex", cwd: "/workspace", title: "Primary" }])
    expect(config.mcpServers).toEqual([{ name: "github", command: "github-mcp", args: ["serve"], env: { A: "1" } }])
    expect(config.shell).toEqual({ enabled: false, command: "/bin/fish", scrollback: 2_500 })
  })
})

describe("provider defaults", () => {
  it.each([...PROVIDER_KINDS])("Should parse model-only, effort-only, and combined defaults for %s", (provider) => {
    expect(parseAppConfig(JSON.stringify({ providerDefaults: { [provider]: { model: "model-id" } } })).providerDefaults).toEqual({
      [provider]: { model: "model-id" },
    })
    expect(parseAppConfig(JSON.stringify({ providerDefaults: { [provider]: { effort: "high" } } })).providerDefaults).toEqual({
      [provider]: { effort: "high" },
    })
    expect(
      parseAppConfig(JSON.stringify({ providerDefaults: { [provider]: { model: "model-id", effort: "high" } } }))
        .providerDefaults,
    ).toEqual({ [provider]: { model: "model-id", effort: "high" } })
  })

  it("Should resolve omission to an empty map and defensively copy merged preferences", () => {
    expect(parseAppConfig("{}").providerDefaults).toEqual({})

    const preference = { model: "gpt-5.4", effort: "high" }
    const user = { providerDefaults: { codex: preference } }
    const config = mergeAppConfig(user)

    expect(config.providerDefaults).toEqual({ codex: preference })
    expect(config.providerDefaults).not.toBe(user.providerDefaults)
    expect(config.providerDefaults?.codex).not.toBe(preference)
    preference.model = "mutated-input"
    expect(config.providerDefaults?.codex?.model).toBe("gpt-5.4")
  })

  it.each([
    ["unknown provider", { providerDefaults: { gemini: { model: "gemini-3" } } }, /providerDefaults.*gemini/],
    ["unknown nested key", { providerDefaults: { codex: { mode: "agent" } } }, /providerDefaults\.codex.*mode/],
    ["empty model", { providerDefaults: { codex: { model: "" } } }, /providerDefaults\.codex\.model/],
    ["empty effort", { providerDefaults: { codex: { effort: "" } } }, /providerDefaults\.codex\.effort/],
    ["wrong model type", { providerDefaults: { codex: { model: 42 } } }, /providerDefaults\.codex\.model/],
    ["wrong effort type", { providerDefaults: { codex: { effort: true } } }, /providerDefaults\.codex\.effort/],
    ["wrong provider map type", { providerDefaults: [] }, /providerDefaults/],
  ])("Should reject %s with a field-specific path", (_case, value, path) => {
    const parse = () => parseAppConfig(JSON.stringify(value))

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(path)
  })

  it("Should load the marked README example through the real loader", async () => {
    const path = await writeConfig(await readReadmeJsonExample("provider-defaults-example"))

    expect((await loadAppConfig({ path })).providerDefaults).toEqual({
      "claude-code": { model: "claude-opus-4-1", effort: "high" },
      codex: { model: "gpt-5.4", effort: "high" },
    })
  })
})

describe("MCP server config", () => {
  const namedServers = {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    },
    linear: {
      type: "stdio" as const,
      command: "/opt/bin/linear-mcp",
      args: ["--stdio"],
      env: {},
    },
  }

  it("Should normalize two name-keyed stdio servers into the domain list", () => {
    const config = parseAppConfig(JSON.stringify({ mcpServers: namedServers }))

    expect(config.mcpServers).toEqual([
      { name: "github", ...namedServers.github },
      {
        name: "linear",
        command: namedServers.linear.command,
        args: namedServers.linear.args,
        env: namedServers.linear.env,
      },
    ])
  })

  it.each([
    ["a url", { command: "remote", args: [], env: {}, url: "https://example.com/mcp" }],
    ["a non-stdio type", { type: "http", command: "remote", args: [], env: {} }],
  ])("Should reject %s transport and name the offending server", (_case, server) => {
    const parse = () => parseAppConfig(JSON.stringify({ mcpServers: { github: server } }))

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/mcpServers\.github/)
  })

  it("Should reject an unknown key inside a server entry", () => {
    const parse = () =>
      parseAppConfig(
        JSON.stringify({ mcpServers: { linear: { command: "linear-mcp", args: [], env: {}, enabled: true } } }),
      )

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/mcpServers\.linear.*enabled/)
  })

  it("Should default to an empty MCP server list when the field is omitted", () => {
    expect(parseAppConfig("{}").mcpServers).toEqual([])
  })

  it("Should keep and defensively copy user-provided MCP servers during merge", () => {
    const user = { mcpServers: namedServers }
    const config = mergeAppConfig(user)

    expect(config.mcpServers.map((server) => server.name)).toEqual(["github", "linear"])
    expect(config.mcpServers[0]!.args).not.toBe(namedServers.github.args)
    expect(config.mcpServers[0]!.env).not.toBe(namedServers.github.env)
  })

  it("Should load and normalize name-keyed MCP servers from a real config file", async () => {
    const path = await writeConfig(JSON.stringify({ mcpServers: namedServers }))

    const config = await loadAppConfig({ path })

    expect(config.mcpServers.map((server) => server.name)).toEqual(["github", "linear"])
    expect(config.mcpServers[0]).toEqual({ name: "github", ...namedServers.github })
  })

  it("Should load the documented stdio example and yield its documented server list", async () => {
    const path = await writeConfig(await readReadmeJsonExample("mcp-config-example"))

    const config = await loadAppConfig({ path })

    expect(config.mcpServers).toEqual([
      {
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
      },
    ])
  })

  it("Should reject the documented remote HTTP example", async () => {
    const path = await writeConfig(await readReadmeJsonExample("mcp-remote-example"))

    await expect(loadAppConfig({ path })).rejects.toThrow(ConfigError)
    await expect(loadAppConfig({ path })).rejects.toThrow(/mcpServers\.github-remote/)
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
    expect(claude?.clarificationCapability).toEqual({ status: "unsupported", reason: "unverified_recipe" })
  })

  it("Should classify capability after merging every identity-bearing override", () => {
    const command = parseAppConfig(JSON.stringify({ providers: { codex: { command: "/opt/bin/npx" } } }))
    const args = parseAppConfig(JSON.stringify({ providers: { codex: { args: ["-y", CODEX_ACP_PACKAGE, "--debug"] } } }))
    const env = parseAppConfig(JSON.stringify({ providers: { codex: { env: { CODEX_PATH: "/opt/codex" } } } }))

    expect(findAgentConfig(command, "codex")?.clarificationCapability.status).toBe("unsupported")
    expect(findAgentConfig(args, "codex")?.clarificationCapability.status).toBe("unsupported")
    expect(findAgentConfig(env, "codex")?.clarificationCapability.status).toBe("unsupported")
    expect(findAgentConfig(command, "codex")?.steeringCapability).toEqual({ status: "unavailable" })
    expect(findAgentConfig(args, "codex")?.steeringCapability).toEqual({ status: "unavailable" })
    expect(findAgentConfig(env, "codex")?.steeringCapability).toEqual({ status: "unavailable" })
    expect(findAgentConfig(command, "codex")?.hardStopContinuationCapability.status).toBe("unavailable")
    expect(findAgentConfig(args, "codex")?.hardStopContinuationCapability.status).toBe("unavailable")
    expect(findAgentConfig(env, "codex")?.hardStopContinuationCapability.status).toBe("unavailable")
  })

  it("Should classify Hard Stop continuation from the fully merged exact recipe", () => {
    const certification: CertifiedHardStopContinuationRecipe = {
      implementationId: "codex-acp-hard-stop-v1",
      providerKind: "codex",
      command: "npx",
      args: ["-y", CODEX_ACP_PACKAGE],
      env: { INITIAL_AGENT_MODE: CODEX_YOLO_MODE },
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
      reviewed: true,
    }
    const implementation: HardStopContinuationAdapterImplementation = {
      implementationId: certification.implementationId,
      providerKind: certification.providerKind,
      adapterPackage: certification.adapterPackage,
      adapterVersion: certification.adapterVersion,
      cancellationAccepted: true,
      terminalSettlement: true,
    }
    const evidence = {
      certifiedHardStopContinuationRecipes: [certification],
      hardStopContinuationImplementations: [implementation],
    }

    const production = findAgentConfig(defaultAppConfig(), "codex")!
    const ordinary = findAgentConfig(defaultAppConfig(), "codex", evidence)!
    expect(ordinary.hardStopContinuationCapability).toEqual({ status: "supported" })
    expect(ordinary).toMatchObject({
      id: "codex",
      displayName: "Codex",
      command: "npx",
      args: ["-y", CODEX_ACP_PACKAGE],
      env: { INITIAL_AGENT_MODE: CODEX_YOLO_MODE },
      runtimeProfile: { kind: "standard" },
    })
    const { hardStopContinuationCapability: _productionVerdict, ...productionRecipe } = production
    const { hardStopContinuationCapability: _injectedVerdict, ...injectedRecipe } = ordinary
    expect(injectedRecipe).toEqual(productionRecipe)

    const driftedConfigs = [
      parseAppConfig(JSON.stringify({ providers: { codex: { command: "/opt/bin/npx" } } })),
      parseAppConfig(JSON.stringify({ providers: { codex: { args: [CODEX_ACP_PACKAGE, "-y"] } } })),
      parseAppConfig(
        JSON.stringify({ providers: { codex: { args: ["-y", "@agentclientprotocol/codex-acp@1.1.3"] } } }),
      ),
      parseAppConfig(JSON.stringify({ providers: { codex: { env: { CODEX_HOME: "/tmp" } } } })),
    ]

    for (const config of driftedConfigs) {
      const resolved = findAgentConfig(config, "codex", evidence)!
      expect(resolved.hardStopContinuationCapability.status).toBe("unavailable")
      expect(resolved.id).toBe("codex")
      expect(resolved.displayName).toBe("Codex")
    }
  })

  it("Should shallow-merge a provider env override over the default recipe rather than replacing it", () => {
    // The Codex yolo default stays in place when a user adds a provider variable.
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

    expect(findAgentConfig(config, "codex")?.env).toEqual({
      INITIAL_AGENT_MODE: CODEX_YOLO_MODE,
      CODEX_PATH: "/usr/bin/codex",
    })
    expect(findAgentConfig(config, "claude-code")?.env).toEqual({ CLAUDE_A: "1" })
    expect(findAgentConfig(merged, "claude-code")?.env).toEqual({ CLAUDE_B: "2" })
  })

  it("Should accept the deprecated `agents` key as an alias for `providers`", () => {
    const config = parseAppConfig(JSON.stringify({ agents: { cursor: { command: "/opt/bin/agent" } } }))

    expect(findAgentConfig(config, "cursor")?.command).toBe("/opt/bin/agent")
  })

  it("Should merge Cursor recipe deltas per field while preserving isolated args and env", () => {
    const config = parseAppConfig(JSON.stringify({ providers: { cursor: { command: "/opt/bin/agent", env: { A: "1" } } } }))
    const cursor = findAgentConfig(config, "cursor")!

    expect(cursor).toMatchObject({ command: "/opt/bin/agent", args: ["acp"], env: { A: "1" } })
    expect(cursor.runtimeProfile).toEqual({ kind: "standard" })
    cursor.args.push("--mutated")
    cursor.env.B = "2"
    expect(findAgentConfig(defaultAppConfig(), "cursor")).toMatchObject({ args: ["acp"], env: {} })
  })

  it("Should derive certification from the final command, ordered args, and complete env only", () => {
    const certified = {
      kind: "cursor-certified" as const,
      command: "agent" as const,
      args: ["acp"] as const,
      env: {},
      certifiedVersion: "1.2.3",
      authenticationMethod: "cursor_login" as const,
    }
    const base = { id: "cursor" as const, command: "agent", args: ["acp"], env: {} }
    const renamed = { ...base, displayName: "Not a certification input" }

    expect(resolveProviderRuntimeProfile(base, [certified])).toEqual(certified)
    expect(resolveProviderRuntimeProfile(renamed, [certified])).toEqual(certified)
    expect(resolveProviderRuntimeProfile({ ...base, command: "/opt/bin/agent" }, [certified])).toEqual({ kind: "standard" })
    expect(resolveProviderRuntimeProfile({ ...base, args: ["acp", "--debug"] }, [certified])).toEqual({ kind: "standard" })
    expect(resolveProviderRuntimeProfile({ ...base, env: { CURSOR_HOME: "/tmp" } }, [certified])).toEqual({ kind: "standard" })
    expect(resolveProviderRuntimeProfile({ ...base, args: ["--debug", "acp"] }, [certified])).toEqual({ kind: "standard" })
    expect(resolveProviderRuntimeProfile(base, [{ ...certified, certifiedVersion: "not-semver" }])).toEqual({ kind: "standard" })
    expect(defaultAppConfig().providers.cursor).not.toHaveProperty("runtimeProfile")
  })

  it("Should match an observed version only to the exact complete certified Cursor profile", () => {
    const certified = {
      kind: "cursor-certified" as const,
      command: "agent" as const,
      args: ["acp"] as const,
      env: {},
      certifiedVersion: "1.2.3",
      authenticationMethod: "cursor_login" as const,
    }
    const native = { id: "cursor" as const, command: "agent", args: ["acp"], env: {} }

    expect(matchCertifiedCursorRuntimeProfile(native, "1.2.3", [certified])).toEqual(certified)
    expect(matchCertifiedCursorRuntimeProfile(native, "1.2.4", [certified])).toBeUndefined()
    expect(
      matchCertifiedCursorRuntimeProfile({ ...native, command: "/opt/bin/agent" }, "1.2.3", [certified]),
    ).toBeUndefined()
    expect(matchCertifiedCursorRuntimeProfile({ ...native, args: ["acp", "--debug"] }, "1.2.3", [certified])).toBeUndefined()
    expect(matchCertifiedCursorRuntimeProfile({ ...native, args: ["--debug", "acp"] }, "1.2.3", [certified])).toBeUndefined()
    expect(matchCertifiedCursorRuntimeProfile({ ...native, env: { CURSOR_HOME: "/tmp" } }, "1.2.3", [certified])).toBeUndefined()
    expect(matchCertifiedCursorRuntimeProfile(native, "not-semver", [{ ...certified, certifiedVersion: "not-semver" }])).toBeUndefined()
  })

  it("Should require every expected environment entry and reject every added entry", () => {
    const certified = {
      kind: "cursor-certified" as const,
      command: "agent" as const,
      args: ["acp"] as const,
      env: { CURSOR_CHANNEL: "stable", CURSOR_MODE: "local" },
      certifiedVersion: "1.2.3",
      authenticationMethod: "cursor_login" as const,
    }
    const exact = {
      id: "cursor" as const,
      command: "agent",
      args: ["acp"],
      env: { CURSOR_MODE: "local", CURSOR_CHANNEL: "stable" },
    }

    expect(matchCertifiedCursorRuntimeProfile(exact, "1.2.3", [certified])).toEqual(certified)
    expect(matchCertifiedCursorRuntimeProfile({ ...exact, env: { CURSOR_CHANNEL: "stable" } }, "1.2.3", [certified])).toBeUndefined()
    expect(
      matchCertifiedCursorRuntimeProfile(
        { ...exact, env: { ...exact.env, CURSOR_HOME: "/tmp" } },
        "1.2.3",
        [certified],
      ),
    ).toBeUndefined()
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

    expect(resolved.map((session) => session.seed.id)).toEqual(["codex", "claude-code", "cursor"])
    expect(resolved.map((session) => session.seed.providerKind)).toEqual(["codex", "claude-code", "cursor"])
    expect(resolved.every((session) => session.seed.cwd === "/launch/dir")).toBe(true)
    // Preserve today's titles: the provider display name, not the launch-dir basename.
    expect(resolved.map((session) => session.seed.title)).toEqual(["Codex", "Claude Code", "Cursor"])
    // The resolved spawn recipe carries the provider's id for the connection factory.
    expect(resolved[0]!.spawn).toEqual(findAgentConfig(config, "codex")!)
    expect(resolved.every((session) => session.spawn.clarificationCapability.status === "unsupported")).toBe(true)
    expect(resolved.every((session) => session.spawn.runtimeProfile.kind === "standard")).toBe(true)
  })

  it("Should resolve an explicit Cursor session through the ordinary per-session path", () => {
    const config = {
      ...defaultAppConfig(),
      sessions: [{ provider: "cursor" as const, cwd: "../cursor-repo", title: "Cursor task", task: "inspect it" }],
    }

    const [session] = resolveSessions(config, { launchCwd: "/launch/dir", dirExists: () => true })

    expect(session!.seed).toEqual({
      id: "cursor",
      providerKind: "cursor",
      cwd: "/launch/cursor-repo",
      title: "Cursor task",
      task: "inspect it",
    })
    expect(session!.spawn).toEqual(findAgentConfig(config, "cursor")!)
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

describe("transcript windowing experiment", () => {
  it("Should default to disabled when the config is absent or omits the field", async () => {
    const missing = join(await makeTempDir(), "missing.json")

    expect(defaultAppConfig().transcriptWindowingEnabled).toBe(false)
    expect(parseAppConfig("{}").transcriptWindowingEnabled).toBe(false)
    expect((await loadAppConfig({ path: missing })).transcriptWindowingEnabled).toBe(false)
  })

  it.each([
    ["true", true],
    ["false", false],
  ])("Should preserve an explicit %s through parsing, merging, and file loading", async (_label, value) => {
    const source = JSON.stringify({ transcriptWindowingEnabled: value })
    const path = await writeConfig(source)

    expect(parseAppConfig(source).transcriptWindowingEnabled).toBe(value)
    expect(mergeAppConfig({ transcriptWindowingEnabled: value }).transcriptWindowingEnabled).toBe(value)
    expect((await loadAppConfig({ path })).transcriptWindowingEnabled).toBe(value)
  })

  it.each([
    ["string", "true"],
    ["number", 1],
    ["null", null],
  ])("Should reject a %s value with a field-naming ConfigError", (_label, value) => {
    const parse = () => parseAppConfig(JSON.stringify({ transcriptWindowingEnabled: value }))

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/transcriptWindowingEnabled/)
  })

  it("Should load the documented JSON opt-in through the strict schema", async () => {
    expect(parseAppConfig(await readReadmeJsonExample("transcript-windowing-example")).transcriptWindowingEnabled)
      .toBe(true)
  })
})

describe("clarification timeout", () => {
  it("Should use the fixed five-minute default when configuration is absent or omitted", async () => {
    const missing = join(await makeTempDir(), "missing.json")

    expect(DEFAULT_CLARIFICATION_TIMEOUT_SECONDS).toBe(300)
    expect(defaultAppConfig().clarificationTimeoutSeconds).toBe(300)
    expect(parseAppConfig("{}").clarificationTimeoutSeconds).toBe(300)
    expect((await loadAppConfig({ path: missing })).clarificationTimeoutSeconds).toBe(300)
  })

  it.each([1, 45, 300, MAX_CLARIFICATION_TIMEOUT_SECONDS])(
    "Should accept the bounded integer timeout %i",
    (clarificationTimeoutSeconds) => {
      expect(parseAppConfig(JSON.stringify({ clarificationTimeoutSeconds })).clarificationTimeoutSeconds)
        .toBe(clarificationTimeoutSeconds)
    },
  )

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["non-numeric", "300"],
    ["above the maximum", MAX_CLARIFICATION_TIMEOUT_SECONDS + 1],
  ])("Should reject a %s clarification timeout", (_label, clarificationTimeoutSeconds) => {
    const parse = () => parseAppConfig(JSON.stringify({ clarificationTimeoutSeconds }))

    expect(parse).toThrow(ConfigError)
    expect(parse).toThrow(/clarificationTimeoutSeconds/)
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

  it.each([...THEME_PRESET_IDS])("Should accept canonical catalog theme %s", (theme) => {
    expect(parseAppConfig(JSON.stringify({ theme })).theme).toBe(theme)
  })

  it("Should resolve every declared compatibility alias to canonical application state", () => {
    const aliases = Object.entries(THEME_PRESET_ALIASES) as [string, ThemePresetId][]

    for (const [alias, canonical] of aliases) {
      expect(parseAppConfig(JSON.stringify({ theme: alias })).theme).toBe(canonical)
    }

    // The initial catalog intentionally has no historical rename. This assertion
    // keeps the table authoritative without inventing a compatibility input.
    expect(aliases).toEqual([])
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

  it.each(["role", "exploreSafety", "attestation", "eligibleProvider"])(
    "rejects user-authored explore authority field %s",
    (field) => {
      expect(() => parseAppConfig(JSON.stringify({ [field]: true }))).toThrow(ConfigError)
    },
  )

  it.each(["neon", "toString", "__proto__"])(
    "Should reject invalid or inherited theme value %s naming the offending field",
    (theme) => {
      const parse = () => parseAppConfig(JSON.stringify({ theme }))
      expect(parse).toThrow(ConfigError)
      expect(parse).toThrow(/theme/)
    },
  )

  it("Should reject an unknown provider id", () => {
    expect(() => parseAppConfig(JSON.stringify({ providers: { gemini: { command: "gemini" } } }))).toThrow(ConfigError)
  })

  it.each(["certifiedVersion", "authenticationMethod", "runtimeProfile", "version"])(
    "Should reject user-authored Cursor runtime field %s under providers and agents",
    (field) => {
      for (const root of ["providers", "agents"] as const) {
        const parse = () => parseAppConfig(JSON.stringify({ [root]: { cursor: { [field]: "forbidden" } } }))
        expect(parse).toThrow(ConfigError)
        expect(parse).toThrow(new RegExp(`${root}\\.cursor.*${field}`))
      }
    },
  )

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
