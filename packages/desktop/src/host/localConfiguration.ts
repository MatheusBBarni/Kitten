import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProfileId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "../attempts/contracts.ts";
import type { DesktopAcpRuntimeProfile } from "../attempts/desktopAcpAdapter.ts";
import type { AcpProviderProjection } from "../shared/desktopRpc.ts";

interface KnownProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly configuredCommand: string;
  readonly machineCommands: readonly string[];
  readonly fallbackModels: readonly string[];
  readonly fallbackEfforts: readonly string[];
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly recipeId: string;
  readonly adapterVersion: string;
}

const KITTEN_PROVIDERS: readonly KnownProvider[] = [
  {
    providerId: "claude-code",
    displayName: "Claude Code",
    configuredCommand: "npx",
    machineCommands: ["claude", "claude-agent-acp"],
    fallbackModels: ["default", "sonnet", "opus", "haiku"],
    fallbackEfforts: ["default", "low", "medium", "high"],
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.57.0"],
    env: {},
    recipeId: "claude-agent-acp",
    adapterVersion: "0.57.0",
  },
  {
    providerId: "codex",
    displayName: "Codex",
    configuredCommand: "npx",
    machineCommands: ["codex", "codex-acp"],
    fallbackModels: ["default"],
    fallbackEfforts: ["default", "low", "medium", "high", "xhigh"],
    args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
    env: { INITIAL_AGENT_MODE: "agent-full-access" },
    recipeId: "codex-acp",
    adapterVersion: "1.1.2",
  },
  {
    providerId: "cursor",
    displayName: "Cursor",
    configuredCommand: "agent",
    machineCommands: ["agent", "cursor"],
    fallbackModels: ["default"],
    fallbackEfforts: ["default"],
    args: ["acp"],
    env: {},
    recipeId: "cursor-agent",
    adapterVersion: "unverified",
  },
];

export interface LocalConfigurationFileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  readText(path: string): string;
  which(command: string): string | null;
}

const localFileSystem: LocalConfigurationFileSystem = {
  exists: existsSync,
  isDirectory(path) {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  readText(path) {
    return readFileSync(path, "utf8");
  },
  which(command) {
    return Bun.which(command);
  },
};

function existingDirectories(
  candidates: readonly string[],
  fileSystem: LocalConfigurationFileSystem,
): readonly string[] {
  return candidates.filter((path) => fileSystem.exists(path) && fileSystem.isDirectory(path));
}

export function defaultProjectSkillRoots(
  repositoryPath: string,
  fileSystem: LocalConfigurationFileSystem = localFileSystem,
): readonly string[] {
  return existingDirectories([
    join(repositoryPath, ".agents", "skills"),
    join(repositoryPath, ".claude", "skills"),
  ], fileSystem);
}

export function defaultUserSkillRoots(
  homePath: string,
  fileSystem: LocalConfigurationFileSystem = localFileSystem,
): readonly string[] {
  return existingDirectories([
    join(homePath, ".agents", "skills"),
    join(homePath, ".claude", "skills"),
    join(homePath, ".codex", "skills"),
  ], fileSystem);
}

interface ConfiguredProviderOverride {
  readonly command?: string;
  readonly displayName?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

interface ProviderCapabilityDefault {
  readonly model?: string;
  readonly effort?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function configuredProviders(
  configPath: string,
  fileSystem: LocalConfigurationFileSystem,
): ReadonlyMap<string, ConfiguredProviderOverride> {
  if (!fileSystem.exists(configPath)) return new Map();
  try {
    const parsed = JSON.parse(fileSystem.readText(configPath)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const providers = (parsed as { readonly providers?: unknown; readonly agents?: unknown }).providers
      ?? (parsed as { readonly agents?: unknown }).agents;
    if (providers === null || typeof providers !== "object" || Array.isArray(providers)) return new Map();
    return new Map(Object.entries(providers).flatMap(([providerId, value]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const candidate = value as {
        readonly command?: unknown;
        readonly displayName?: unknown;
        readonly args?: unknown;
        readonly env?: unknown;
      };
      const command = typeof candidate.command === "string" && candidate.command.trim().length > 0
        ? candidate.command.trim()
        : undefined;
      const configuredDisplayName = typeof candidate.displayName === "string" && candidate.displayName.trim().length > 0
        ? candidate.displayName.trim()
        : undefined;
      const args = Array.isArray(candidate.args) && candidate.args.every((entry) => typeof entry === "string")
        ? candidate.args
        : undefined;
      const env = candidate.env !== null && typeof candidate.env === "object" && !Array.isArray(candidate.env)
        && Object.values(candidate.env).every((entry) => typeof entry === "string")
        ? candidate.env as Record<string, string>
        : undefined;
      return [[providerId, {
        ...(command === undefined ? {} : { command }),
        ...(configuredDisplayName === undefined ? {} : { displayName: configuredDisplayName }),
        ...(args === undefined ? {} : { args }),
        ...(env === undefined ? {} : { env }),
      }] as const];
    }));
  } catch {
    return new Map();
  }
}

function configuredProviderDefaults(
  configPath: string,
  fileSystem: LocalConfigurationFileSystem,
): ReadonlyMap<string, ProviderCapabilityDefault> {
  if (!fileSystem.exists(configPath)) return new Map();
  try {
    const parsed = JSON.parse(fileSystem.readText(configPath)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const defaults = (parsed as { readonly providerDefaults?: unknown }).providerDefaults;
    if (defaults === null || typeof defaults !== "object" || Array.isArray(defaults)) return new Map();
    return new Map(Object.entries(defaults).flatMap(([providerId, value]) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const candidate = value as { readonly model?: unknown; readonly effort?: unknown };
      const model = nonEmptyString(candidate.model);
      const effort = nonEmptyString(candidate.effort);
      return [[providerId, {
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
      }] as const];
    }));
  } catch {
    return new Map();
  }
}

function nativeProviderDefault(
  providerId: string,
  homePath: string,
  fileSystem: LocalConfigurationFileSystem,
): ProviderCapabilityDefault {
  if (providerId === "codex") {
    const path = join(homePath, ".codex", "config.toml");
    if (!fileSystem.exists(path)) return {};
    const source = fileSystem.readText(path);
    return {
      ...(source.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1] === undefined
        ? {}
        : { model: source.match(/^model\s*=\s*["']([^"']+)["']/m)![1] }),
      ...(source.match(/^model_reasoning_effort\s*=\s*["']([^"']+)["']/m)?.[1] === undefined
        ? {}
        : { effort: source.match(/^model_reasoning_effort\s*=\s*["']([^"']+)["']/m)![1] }),
    };
  }
  if (providerId === "claude-code") {
    const path = join(homePath, ".claude", "settings.json");
    if (!fileSystem.exists(path)) return {};
    try {
      const parsed = JSON.parse(fileSystem.readText(path)) as { readonly model?: unknown; readonly effortLevel?: unknown };
      return {
        ...(nonEmptyString(parsed.model) === undefined ? {} : { model: nonEmptyString(parsed.model) }),
        ...(nonEmptyString(parsed.effortLevel) === undefined ? {} : { effort: nonEmptyString(parsed.effortLevel) }),
      };
    } catch {
      return {};
    }
  }
  return {};
}

function nativeProviderModels(
  providerId: string,
  homePath: string,
  fileSystem: LocalConfigurationFileSystem,
): readonly string[] {
  if (providerId !== "codex") return [];
  const path = join(homePath, ".codex", "models_cache.json");
  if (!fileSystem.exists(path)) return [];
  try {
    const parsed = JSON.parse(fileSystem.readText(path)) as { readonly models?: unknown };
    if (!Array.isArray(parsed.models)) return [];
    return parsed.models.flatMap((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
      const model = value as { readonly slug?: unknown; readonly visibility?: unknown };
      const slug = nonEmptyString(model.slug);
      if (slug === undefined || model.visibility === "hide") return [];
      return [slug];
    });
  } catch {
    return [];
  }
}

function commandIsDetected(command: string, fileSystem: LocalConfigurationFileSystem): boolean {
  return command.includes("/")
    ? fileSystem.exists(command)
    : fileSystem.which(command) !== null;
}

function displayName(providerId: string): string {
  return KITTEN_PROVIDERS.find((provider) => provider.providerId === providerId)?.displayName
    ?? providerId.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

export function discoverAcpProviders(options: {
  readonly homePath: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fileSystem?: LocalConfigurationFileSystem;
}): readonly AcpProviderProjection[] {
  const fileSystem = options.fileSystem ?? localFileSystem;
  const environment = options.environment ?? process.env;
  const configPath = environment.KITTEN_CONFIG?.trim()
    || join(environment.XDG_CONFIG_HOME?.trim() || join(options.homePath, ".config"), "kitten", "config.json");
  const configured = configuredProviders(configPath, fileSystem);
  const configuredDefaults = configuredProviderDefaults(configPath, fileSystem);
  const providerIds = new Set([
    ...KITTEN_PROVIDERS.map(({ providerId }) => providerId),
    ...configured.keys(),
  ]);

  return [...providerIds].map((providerId) => {
    const known = KITTEN_PROVIDERS.find((provider) => provider.providerId === providerId);
    const configuredOverride = configured.get(providerId);
    const capabilityDefault = configuredDefaults.get(providerId) ?? {};
    const nativeDefault = nativeProviderDefault(providerId, options.homePath, fileSystem);
    const nativeModels = nativeProviderModels(providerId, options.homePath, fileSystem);
    const configuredCommand = configuredOverride?.command ?? known?.configuredCommand ?? providerId;
    const configuredCommandName = basename(configuredCommand);
    const candidates = new Set(known?.machineCommands ?? []);
    if (configuredCommandName !== "npx" && configuredCommandName !== "bunx") {
      candidates.add(configuredCommand);
    }
    const detectedCommands = [...candidates]
      .filter((command) => commandIsDetected(command, fileSystem))
      .map((command) => basename(command));
    return {
      providerId,
      displayName: configuredOverride?.displayName ?? displayName(providerId),
      configuredBy: configured.has(providerId) ? "kitten_config" : "kitten_default",
      configuredCommand: configuredCommandName,
      detectedCommands,
      models: [...new Set([
        ...(capabilityDefault.model === undefined ? [] : [capabilityDefault.model]),
        ...(nativeDefault.model === undefined ? [] : [nativeDefault.model]),
        ...nativeModels,
        ...(known?.fallbackModels ?? ["default"]),
      ])],
      efforts: [...new Set([
        ...(capabilityDefault.effort === undefined ? [] : [capabilityDefault.effort]),
        ...(nativeDefault.effort === undefined ? [] : [nativeDefault.effort]),
        ...(known?.fallbackEfforts ?? ["default"]),
      ])],
      availability: detectedCommands.length > 0 ? "available" : "not_detected",
    } satisfies AcpProviderProjection;
  });
}

export function discoverDesktopAcpRuntimeProfiles(options: {
  readonly homePath: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fileSystem?: LocalConfigurationFileSystem;
}): readonly DesktopAcpRuntimeProfile[] {
  const fileSystem = options.fileSystem ?? localFileSystem;
  const environment = options.environment ?? process.env;
  const configPath = environment.KITTEN_CONFIG?.trim()
    || join(environment.XDG_CONFIG_HOME?.trim() || join(options.homePath, ".config"), "kitten", "config.json");
  const configured = configuredProviders(configPath, fileSystem);
  const providers = discoverAcpProviders(options);
  return KITTEN_PROVIDERS.map((known) => {
    const override = configured.get(known.providerId);
    const command = override?.command ?? known.configuredCommand;
    const args = override?.args ?? known.args;
    const env = { ...known.env, ...(override?.env ?? {}) };
    const projection = providers.find(({ providerId }) => providerId === known.providerId)!;
    const certified = known.adapterVersion !== "unverified"
      && command === known.configuredCommand
      && sameStrings(args, known.args)
      && sameEnvironment(env, known.env);
    const profileId = `desktop:${known.providerId}` as ProfileId;
    const profile: CertifiedDirectAcpProfile = {
      profileId,
      provider: known.providerId,
      models: projection.models,
      efforts: projection.efforts,
      readiness: projection.availability !== "available"
        ? {
            profileId,
            ready: false,
            reason: "binary_not_found",
            message: `${known.displayName} is not available on this machine.`,
          }
        : !certified
          ? {
              profileId,
              ready: false,
              reason: "uncertified_recipe",
              message: `${known.displayName} uses an unreviewed ACP launch recipe.`,
            }
          : { profileId, ready: true, protocolVersion: 1 },
      certification: {
        recipeId: known.recipeId,
        adapterVersion: known.adapterVersion,
        checkedAt: Date.now(),
      },
    };
    return { profile, command, args, env };
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameEnvironment(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameStrings(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key]);
}
