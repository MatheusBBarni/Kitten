import type { SkillId } from "../workflow/workflowTypes.ts";

export type CatalogRootClass = "project" | "user";

export type CatalogDiagnosticCode =
  | "missing_root"
  | "unreadable_root"
  | "invalid_root"
  | "missing_skill_file"
  | "unreadable_skill_file"
  | "non_utf8_skill_file"
  | "empty_skill_file"
  | "malformed_skill_file"
  | "name_collision";

export interface CatalogDiagnostic {
  readonly diagnosticId: string;
  readonly code: CatalogDiagnosticCode;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly rootClass: CatalogRootClass;
  readonly configuredPath: string;
  readonly canonicalPath: string | null;
  readonly skillPath: string | null;
  readonly displayName: string | null;
  readonly relatedSkillIds: readonly SkillId[];
}

export interface CatalogRoot {
  readonly rootClass: CatalogRootClass;
  readonly configuredPath: string;
  readonly canonicalPath: string | null;
  readonly order: number;
  readonly valid: boolean;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly frontmatter: Readonly<Record<string, string>>;
}

export interface SkillCatalogEntry {
  readonly skillId: SkillId;
  readonly canonicalPath: string;
  readonly rootClass: CatalogRootClass;
  readonly rootPath: string;
  readonly digest: string;
  readonly metadata: SkillMetadata;
  readonly order: number;
  readonly hasNameCollision: boolean;
  readonly diagnostics: readonly CatalogDiagnostic[];
}

export interface ResolvedSkill {
  readonly entry: SkillCatalogEntry;
  readonly validatedContent: string;
}

export interface SkillCatalog {
  readonly roots: readonly CatalogRoot[];
  readonly entries: readonly SkillCatalogEntry[];
  readonly diagnostics: readonly CatalogDiagnostic[];
  /** Host-only validated bodies, indexed by stable identity rather than display name. */
  readonly resolvedSkills: ReadonlyMap<SkillId, ResolvedSkill>;
}

export interface SkillSnapshot {
  readonly snapshotId: SkillId;
  readonly skillId: SkillId;
  readonly canonicalPath: string;
  readonly rootClass: CatalogRootClass;
  readonly digest: string;
  readonly metadata: SkillMetadata;
  readonly content: string;
}

export interface DiscoverSkillCatalogInput {
  readonly projectRoots: readonly string[];
  readonly userRoots: readonly string[];
}

export class SkillSelectionError extends Error {
  constructor(readonly skillId: SkillId) {
    super(`Skill identity ${skillId} is not available in the validated catalog`);
    this.name = "SkillSelectionError";
  }
}
