import { describe, expect, test } from "bun:test";
import type { LocalConfigurationFileSystem } from "./localConfiguration.ts";
import {
  defaultProjectSkillRoots,
  defaultUserSkillRoots,
  discoverAcpProviders,
  discoverDesktopAcpRuntimeProfiles,
} from "./localConfiguration.ts";

function fakeFileSystem(options: {
  readonly directories?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly commands?: Readonly<Record<string, string>>;
} = {}): LocalConfigurationFileSystem {
  const directories = new Set(options.directories ?? []);
  const files = new Map(Object.entries(options.files ?? {}));
  const commands = new Map(Object.entries(options.commands ?? {}));
  return {
    exists: (path) => directories.has(path) || files.has(path),
    isDirectory: (path) => directories.has(path),
    readText: (path) => files.get(path) ?? "",
    which: (command) => commands.get(command) ?? null,
  };
}

describe("local desktop configuration discovery", () => {
  test("loads only Skill roots that exist for the selected project and current user", () => {
    const fileSystem = fakeFileSystem({
      directories: [
        "/repo/.agents/skills",
        "/home/name/.claude/skills",
        "/home/name/.codex/skills",
      ],
    });

    expect(defaultProjectSkillRoots("/repo", fileSystem)).toEqual(["/repo/.agents/skills"]);
    expect(defaultUserSkillRoots("/home/name", fileSystem)).toEqual([
      "/home/name/.claude/skills",
      "/home/name/.codex/skills",
    ]);
  });

  test("combines Kitten defaults, local config overrides, and machine command detection", () => {
    const fileSystem = fakeFileSystem({
      files: {
        "/config/kitten.json": JSON.stringify({
          providers: {
            codex: { command: "/opt/acp/codex-acp" },
            cursor: { args: ["acp"] },
            custom_agent: { command: "custom-acp" },
          },
          providerDefaults: {
            "claude-code": { model: "opus", effort: "high" },
            codex: { model: "gpt-5.6-terra", effort: "xhigh" },
          },
        }),
        "/home/name/.codex/config.toml": 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n',
        "/home/name/.codex/models_cache.json": JSON.stringify({
          models: [
            { slug: "gpt-5.6-sol", visibility: "list" },
            { slug: "gpt-5.6-luna", visibility: "list" },
            { slug: "gpt-5.5", visibility: "list" },
            { slug: "gpt-5.3-codex-spark", visibility: "list" },
            { slug: "codex-auto-review", visibility: "hide" },
          ],
        }),
        "/opt/acp/codex-acp": "",
      },
      commands: {
        claude: "/usr/local/bin/claude",
        "custom-acp": "/usr/local/bin/custom-acp",
      },
    });

    const providers = discoverAcpProviders({
      homePath: "/home/name",
      environment: { KITTEN_CONFIG: "/config/kitten.json" },
      fileSystem,
    });

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: "claude-code",
        configuredBy: "kitten_default",
        configuredCommand: "npx",
        detectedCommands: ["claude"],
        models: ["opus", "default", "sonnet", "haiku"],
        efforts: ["high", "default", "low", "medium"],
        availability: "available",
      }),
      expect.objectContaining({
        providerId: "codex",
        configuredBy: "kitten_config",
        configuredCommand: "codex-acp",
        detectedCommands: ["codex-acp"],
        models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.5", "gpt-5.3-codex-spark", "default"],
        efforts: ["xhigh", "medium", "default", "low", "high"],
        availability: "available",
      }),
      expect.objectContaining({
        providerId: "cursor",
        configuredBy: "kitten_config",
        configuredCommand: "agent",
        detectedCommands: [],
        availability: "not_detected",
      }),
      expect.objectContaining({
        providerId: "custom_agent",
        displayName: "Custom Agent",
        configuredBy: "kitten_config",
        configuredCommand: "custom-acp",
        detectedCommands: ["custom-acp"],
        availability: "available",
      }),
    ]);
    expect(JSON.stringify(providers)).not.toContain("/opt/acp");
    expect(JSON.stringify(providers)).not.toContain("/usr/local/bin");
  });

  test("ignores malformed local provider configuration", () => {
    const fileSystem = fakeFileSystem({ files: { "/config/kitten.json": "not json" } });
    const providers = discoverAcpProviders({
      homePath: "/home/name",
      environment: { KITTEN_CONFIG: "/config/kitten.json" },
      fileSystem,
    });

    expect(providers.map(({ providerId }) => providerId)).toEqual(["claude-code", "codex", "cursor"]);
    expect(providers.every(({ configuredBy }) => configuredBy === "kitten_default")).toBeTrue();
  });

  test("ignores a malformed Codex model cache", () => {
    const fileSystem = fakeFileSystem({
      files: { "/home/name/.codex/models_cache.json": "not json" },
    });

    const codex = discoverAcpProviders({ homePath: "/home/name", fileSystem })
      .find(({ providerId }) => providerId === "codex");

    expect(codex?.models).toEqual(["default"]);
  });

  test("creates ready runtime profiles only for detected reviewed ACP recipes", () => {
    const fileSystem = fakeFileSystem({
      commands: { claude: "/bin/claude", codex: "/bin/codex", agent: "/bin/agent" },
    });

    const profiles = discoverDesktopAcpRuntimeProfiles({ homePath: "/home/name", fileSystem });
    expect(profiles.find(({ profile }) => profile.provider === "codex")).toMatchObject({
      command: "npx",
      args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
      env: { INITIAL_AGENT_MODE: "agent-full-access" },
      profile: {
        readiness: { ready: true, protocolVersion: 1 },
        certification: { recipeId: "codex-acp", adapterVersion: "1.1.2" },
      },
    });
    expect(profiles.find(({ profile }) => profile.provider === "cursor")?.profile.readiness).toMatchObject({
      ready: false,
      reason: "uncertified_recipe",
    });
  });
});
