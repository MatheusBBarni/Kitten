import { createHash } from "node:crypto";
import {
  constants,
  accessSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { join, resolve } from "node:path";
import type { SkillId } from "../workflow/workflowTypes.ts";
import type {
  CatalogDiagnostic,
  CatalogDiagnosticCode,
  CatalogRoot,
  CatalogRootClass,
  DiscoverSkillCatalogInput,
  ResolvedSkill,
  SkillCatalog,
  SkillCatalogEntry,
  SkillMetadata,
  SkillSnapshot,
} from "./contracts.ts";
import { SkillSelectionError } from "./contracts.ts";

export interface SkillCatalogFileSystem {
  realpath(path: string): string;
  access(path: string): void;
  readdir(path: string): readonly Dirent[];
  stat(path: string): { readonly isDirectory: () => boolean };
  readFile(path: string): Uint8Array;
}

const nodeFileSystem: SkillCatalogFileSystem = {
  realpath: realpathSync,
  access(path) {
    accessSync(path, constants.R_OK);
  },
  readdir(path) {
    return readdirSync(path, { withFileTypes: true });
  },
  stat: statSync,
  readFile(path) {
    return readFileSync(path);
  },
};

interface RootCandidate {
  readonly rootClass: CatalogRootClass;
  readonly configuredPath: string;
  readonly canonicalPath: string | null;
  readonly valid: boolean;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

interface EntryCandidate {
  readonly root: CatalogRoot;
  readonly canonicalPath: string;
  readonly metadata: SkillMetadata;
  readonly digest: string;
  readonly content: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function diagnostic(input: Omit<CatalogDiagnostic, "diagnosticId">): CatalogDiagnostic {
  const identity = JSON.stringify([
    input.code,
    input.rootClass,
    input.configuredPath,
    input.canonicalPath,
    input.skillPath,
    input.displayName,
    input.relatedSkillIds,
  ]);
  return Object.freeze({
    ...input,
    relatedSkillIds: Object.freeze([...input.relatedSkillIds]),
    diagnosticId: `diagnostic:${sha256(identity)}`,
  });
}

function filesystemCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function rootFailure(
  rootClass: CatalogRootClass,
  configuredPath: string,
  error: unknown,
): CatalogDiagnostic {
  const code = filesystemCode(error);
  const diagnosticCode: CatalogDiagnosticCode = code === "ENOENT"
    ? "missing_root"
    : code === "EACCES" || code === "EPERM"
      ? "unreadable_root"
      : "invalid_root";
  return diagnostic({
    code: diagnosticCode,
    severity: "error",
    message: diagnosticCode === "missing_root"
      ? `Catalog root does not exist: ${configuredPath}`
      : diagnosticCode === "unreadable_root"
        ? `Catalog root is not readable: ${configuredPath}`
        : `Catalog root is invalid: ${configuredPath}`,
    rootClass,
    configuredPath,
    canonicalPath: null,
    skillPath: null,
    displayName: null,
    relatedSkillIds: [],
  });
}

function resolveRoot(
  rootClass: CatalogRootClass,
  configuredRoot: string,
  fileSystem: SkillCatalogFileSystem,
): RootCandidate {
  const configuredPath = resolve(configuredRoot);
  try {
    const canonicalPath = fileSystem.realpath(configuredPath);
    fileSystem.access(canonicalPath);
    if (!fileSystem.stat(canonicalPath).isDirectory()) {
      throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    }
    fileSystem.readdir(canonicalPath);
    return { rootClass, configuredPath, canonicalPath, valid: true, diagnostics: [] };
  } catch (error) {
    const failure = rootFailure(rootClass, configuredPath, error);
    return {
      rootClass,
      configuredPath,
      canonicalPath: null,
      valid: false,
      diagnostics: [failure],
    };
  }
}

function rootRank(rootClass: CatalogRootClass): number {
  return rootClass === "project" ? 0 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRoots(left: RootCandidate, right: RootCandidate): number {
  return rootRank(left.rootClass) - rootRank(right.rootClass)
    || compareText(
      left.canonicalPath ?? left.configuredPath,
      right.canonicalPath ?? right.configuredPath,
    )
    || compareText(left.configuredPath, right.configuredPath);
}

function unquote(value: string): string {
  const quote = value[0];
  return value.length >= 2 && (quote === "\"" || quote === "'") && value.at(-1) === quote
    ? value.slice(1, -1)
    : value;
}

function parseMetadata(content: string): SkillMetadata {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.replace(/^\uFEFF/, "") !== "---") {
    throw new Error("missing opening frontmatter delimiter");
  }
  const end = lines.slice(1).findIndex((line) => line === "---");
  if (end < 0) throw new Error("missing closing frontmatter delimiter");

  const fields: Record<string, { value: string; style: "plain" | "folded" | "literal" }> = {};
  let currentKey: string | undefined;
  for (const line of lines.slice(1, end + 1)) {
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      if (currentKey === undefined) throw new Error("frontmatter continuation has no field");
      const field = fields[currentKey];
      if (field === undefined) throw new Error("frontmatter continuation is invalid");
      const separator = field.value.length === 0 ? "" : field.style === "literal" ? "\n" : " ";
      field.value += `${separator}${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new Error("frontmatter must contain key/value fields");
    }
    if (Object.hasOwn(fields, match[1])) throw new Error(`duplicate frontmatter field ${match[1]}`);
    const rawValue = unquote(match[2]).trim();
    fields[match[1]] = {
      value: rawValue === ">" || rawValue === "|" ? "" : rawValue,
      style: rawValue === ">" ? "folded" : rawValue === "|" ? "literal" : "plain",
    };
    currentKey = match[1];
  }

  const values = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
  const name = values.name?.trim() ?? "";
  const description = values.description?.trim() ?? "";
  if (name.length === 0) throw new Error("frontmatter name is required");
  if (description.length === 0) throw new Error("frontmatter description is required");
  return Object.freeze({
    name,
    description,
    frontmatter: Object.freeze({ ...values }),
  });
}

function fileFailure(
  code: CatalogDiagnosticCode,
  root: CatalogRoot,
  skillPath: string,
  message: string,
): CatalogDiagnostic {
  return diagnostic({
    code,
    severity: "error",
    message,
    rootClass: root.rootClass,
    configuredPath: root.configuredPath,
    canonicalPath: root.canonicalPath,
    skillPath,
    displayName: null,
    relatedSkillIds: [],
  });
}

function discoverEntry(
  root: CatalogRoot,
  child: Dirent,
  fileSystem: SkillCatalogFileSystem,
): EntryCandidate | CatalogDiagnostic | null {
  if (root.canonicalPath === null) return null;
  const location = join(root.canonicalPath, child.name);
  try {
    if (!fileSystem.stat(location).isDirectory()) return null;
  } catch {
    return null;
  }

  const configuredSkillPath = join(location, "SKILL.md");
  let canonicalPath: string;
  try {
    canonicalPath = fileSystem.realpath(configuredSkillPath);
  } catch (error) {
    return fileFailure(
      filesystemCode(error) === "ENOENT" ? "missing_skill_file" : "unreadable_skill_file",
      root,
      configuredSkillPath,
      filesystemCode(error) === "ENOENT"
        ? `Skill directory has no SKILL.md: ${location}`
        : `Skill file cannot be resolved: ${configuredSkillPath}`,
    );
  }

  let bytes: Uint8Array;
  try {
    fileSystem.access(canonicalPath);
    bytes = fileSystem.readFile(canonicalPath);
  } catch {
    return fileFailure(
      "unreadable_skill_file",
      root,
      canonicalPath,
      `Skill file is not readable: ${canonicalPath}`,
    );
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fileFailure(
      "non_utf8_skill_file",
      root,
      canonicalPath,
      `Skill file is not valid UTF-8: ${canonicalPath}`,
    );
  }
  if (content.trim().length === 0) {
    return fileFailure("empty_skill_file", root, canonicalPath, `Skill file is empty: ${canonicalPath}`);
  }

  let metadata: SkillMetadata;
  try {
    metadata = parseMetadata(content);
  } catch (error) {
    return fileFailure(
      "malformed_skill_file",
      root,
      canonicalPath,
      `Skill metadata is malformed at ${canonicalPath}: ${error instanceof Error ? error.message : "invalid metadata"}`,
    );
  }

  return {
    root,
    canonicalPath,
    metadata,
    digest: sha256(bytes),
    content,
  };
}

export function deriveSkillIdentity(canonicalPath: string, digest: string): SkillId {
  return `skill:${sha256(`skill\0${canonicalPath}\0${digest}`)}` as SkillId;
}

function freezeEntry(entry: SkillCatalogEntry): SkillCatalogEntry {
  return Object.freeze({ ...entry, diagnostics: Object.freeze([...entry.diagnostics]) });
}

function deduplicateDiagnostics(values: readonly CatalogDiagnostic[]): readonly CatalogDiagnostic[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.skillPath === null
      ? value.diagnosticId
      : `${value.code}:${value.skillPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function discoverSkillCatalog(
  input: DiscoverSkillCatalogInput,
  options: { readonly fileSystem?: SkillCatalogFileSystem } = {},
): SkillCatalog {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const rootCandidates = [
    ...input.projectRoots.map((path) => resolveRoot("project", path, fileSystem)),
    ...input.userRoots.map((path) => resolveRoot("user", path, fileSystem)),
  ].sort(compareRoots);

  const seenRoots = new Set<string>();
  const roots: CatalogRoot[] = [];
  for (const candidate of rootCandidates) {
    if (candidate.canonicalPath !== null && seenRoots.has(candidate.canonicalPath)) continue;
    if (candidate.canonicalPath !== null) seenRoots.add(candidate.canonicalPath);
    roots.push(Object.freeze({
      ...candidate,
      diagnostics: Object.freeze([...candidate.diagnostics]),
      order: roots.length,
    }));
  }

  const diagnostics: CatalogDiagnostic[] = roots.flatMap((root) => root.diagnostics);
  const candidates: EntryCandidate[] = [];
  const seenLocations = new Set<string>();
  for (const root of roots) {
    if (!root.valid || root.canonicalPath === null) continue;
    const children = [...fileSystem.readdir(root.canonicalPath)]
      .sort((left, right) => compareText(left.name, right.name));
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      const discovered = discoverEntry(root, child, fileSystem);
      if (discovered === null) continue;
      if ("code" in discovered) {
        diagnostics.push(discovered);
        continue;
      }
      if (seenLocations.has(discovered.canonicalPath)) continue;
      seenLocations.add(discovered.canonicalPath);
      candidates.push(discovered);
    }
  }

  const projectNames = new Set(
    candidates
      .filter(({ root }) => root.rootClass === "project")
      .map(({ metadata }) => metadata.name),
  );
  const activeCandidates = candidates.filter((candidate) => (
    candidate.root.rootClass === "project"
    || !projectNames.has(candidate.metadata.name)
  ));

  const provisional: { candidate: EntryCandidate; entry: SkillCatalogEntry }[] = activeCandidates.map(
    (candidate, order) => ({
      candidate,
      entry: {
        skillId: deriveSkillIdentity(candidate.canonicalPath, candidate.digest),
        canonicalPath: candidate.canonicalPath,
        rootClass: candidate.root.rootClass,
        rootPath: candidate.root.canonicalPath as string,
        digest: candidate.digest,
        metadata: candidate.metadata,
        order,
        hasNameCollision: false,
        diagnostics: [],
      },
    }),
  );

  const entriesByName = new Map<string, typeof provisional>();
  for (const value of provisional) {
    const existing = entriesByName.get(value.entry.metadata.name) ?? [];
    existing.push(value);
    entriesByName.set(value.entry.metadata.name, existing);
  }
  for (const [name, collisions] of entriesByName) {
    if (collisions.length < 2) continue;
    const relatedSkillIds = collisions.map(({ entry }) => entry.skillId);
    for (const collision of collisions) {
      const collisionDiagnostic = diagnostic({
        code: "name_collision",
        severity: "warning",
        message: `Skill name ${name} is ambiguous; select a stable Skill identity`,
        rootClass: collision.entry.rootClass,
        configuredPath: collision.candidate.root.configuredPath,
        canonicalPath: collision.candidate.root.canonicalPath,
        skillPath: collision.entry.canonicalPath,
        displayName: name,
        relatedSkillIds,
      });
      collision.entry = {
        ...collision.entry,
        hasNameCollision: true,
        diagnostics: [collisionDiagnostic],
      };
      diagnostics.push(collisionDiagnostic);
    }
  }

  const entries = provisional.map(({ entry }) => freezeEntry(entry));
  const resolvedSkills = new Map<SkillId, ResolvedSkill>();
  provisional.forEach(({ candidate }, index) => {
    const entry = entries[index];
    if (entry !== undefined) {
      resolvedSkills.set(entry.skillId, Object.freeze({ entry, validatedContent: candidate.content }));
    }
  });

  return Object.freeze({
    roots: Object.freeze(roots),
    entries: Object.freeze(entries),
    diagnostics: Object.freeze(deduplicateDiagnostics(diagnostics)),
    resolvedSkills,
  });
}

export function createSkillSnapshot(catalog: SkillCatalog, skillId: SkillId): SkillSnapshot {
  const resolved = catalog.resolvedSkills.get(skillId);
  if (resolved === undefined) throw new SkillSelectionError(skillId);
  const { entry, validatedContent } = resolved;
  return Object.freeze({
    snapshotId: entry.skillId,
    skillId: entry.skillId,
    canonicalPath: entry.canonicalPath,
    rootClass: entry.rootClass,
    digest: entry.digest,
    metadata: entry.metadata,
    content: validatedContent,
  });
}
