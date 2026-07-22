import { describe, expect, test } from "bun:test";
import {
  accessSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { SkillSelectionError } from "./contracts.ts";
import { createCatalogRoot, skillContent, withCatalogFixture, writeSkill } from "./fixtures.ts";
import {
  createSkillSnapshot,
  discoverSkillCatalog,
  type SkillCatalogFileSystem,
} from "./skillCatalog.ts";

const fileSystem: SkillCatalogFileSystem = {
  realpath: realpathSync,
  access: accessSync,
  readdir(path) {
    return readdirSync(path, { withFileTypes: true });
  },
  stat: statSync,
  readFile: readFileSync,
};

describe("deterministic Skill Catalog discovery", () => {
  test("lets a project Skill override a same-name user Skill", () => {
    withCatalogFixture((directory) => {
      const projectRoot = createCatalogRoot(directory, "z-project");
      const userRoot = createCatalogRoot(directory, "a-user");
      writeSkill(projectRoot, "refine-project", skillContent("refine", "Follow project instructions.", "Project instructions."));
      writeSkill(userRoot, "refine-user", skillContent("refine", "Follow user instructions.", "User instructions."));

      const catalog = discoverSkillCatalog({ projectRoots: [projectRoot], userRoots: [userRoot] });

      expect(catalog.entries).toHaveLength(1);
      expect(catalog.entries[0]).toMatchObject({ rootClass: "project", order: 0, hasNameCollision: false });
      expect(catalog.entries[0]?.metadata.description).toBe("Project instructions.");
      expect(catalog.diagnostics.filter(({ code }) => code === "name_collision")).toEqual([]);
    });
  });

  test("keeps same-class duplicate names ambiguous", () => {
    withCatalogFixture((directory) => {
      const firstRoot = createCatalogRoot(directory, "a-user");
      const secondRoot = createCatalogRoot(directory, "b-user");
      writeSkill(firstRoot, "refine-one", skillContent("refine", "First instructions."));
      writeSkill(secondRoot, "refine-two", skillContent("refine", "Second instructions."));

      const catalog = discoverSkillCatalog({ projectRoots: [], userRoots: [firstRoot, secondRoot] });

      expect(catalog.entries).toHaveLength(2);
      expect(catalog.entries.every(({ hasNameCollision }) => hasNameCollision)).toBe(true);
      expect(catalog.diagnostics.filter(({ code }) => code === "name_collision")).toHaveLength(2);
    });
  });

  test("ignores hidden root machinery that is not a user Skill", () => {
    withCatalogFixture((directory) => {
      const root = createCatalogRoot(directory, "user");
      mkdirSync(join(root, ".system"));
      writeSkill(root, "visible", skillContent("visible"));

      const catalog = discoverSkillCatalog({ projectRoots: [], userRoots: [root] });

      expect(catalog.entries.map(({ metadata }) => metadata.name)).toEqual(["visible"]);
      expect(catalog.diagnostics).toEqual([]);
    });
  });

  test("canonicalizes and deduplicates directory aliases to one SKILL.md", () => {
    withCatalogFixture((directory) => {
      const root = createCatalogRoot(directory, "project");
      const realDirectory = join(root, "real-skill");
      mkdirSync(realDirectory);
      writeFileSync(join(realDirectory, "SKILL.md"), skillContent("execute"));
      symlinkSync(realDirectory, join(root, "alias-skill"));

      const catalog = discoverSkillCatalog({ projectRoots: [root], userRoots: [] });

      expect(catalog.entries).toHaveLength(1);
      expect(catalog.entries[0]?.canonicalPath).toBe(realpathSync(join(realDirectory, "SKILL.md")));
      expect(catalog.diagnostics).toEqual([]);
    });
  });

  test("retains display metadata while accepting nested and folded valid frontmatter", () => {
    withCatalogFixture((directory) => {
      const root = createCatalogRoot(directory, "project");
      writeSkill(root, "rich", [
        "---",
        "name: rich-skill",
        "description: >",
        "  A folded",
        "  workflow description.",
        "metadata:",
        "  owner: local",
        "---",
        "Run the workflow.",
      ].join("\n"));

      const catalog = discoverSkillCatalog({ projectRoots: [root], userRoots: [] });

      expect(catalog.entries[0]?.metadata).toMatchObject({
        name: "rich-skill",
        description: "A folded workflow description.",
        frontmatter: { metadata: "owner: local" },
      });
    });
  });

  test("diagnoses invalid roots and missing, unreadable, malformed, non-UTF8, and empty files", () => {
    withCatalogFixture((directory) => {
      const root = createCatalogRoot(directory, "project");
      const missingRoot = join(directory, "missing-root");
      const invalidRoot = join(directory, "plain-file");
      const unreadableRoot = createCatalogRoot(directory, "unreadable-root");
      writeFileSync(invalidRoot, "not a directory");
      mkdirSync(join(root, "missing-file"));
      const unreadable = writeSkill(root, "unreadable", skillContent("unreadable"));
      writeSkill(root, "malformed", "---\nname: malformed\nno closing delimiter");
      writeSkill(root, "empty", "   \n");
      const nonUtf8 = join(root, "non-utf8");
      mkdirSync(nonUtf8);
      writeFileSync(join(nonUtf8, "SKILL.md"), new Uint8Array([0xff, 0xfe, 0xfd]));

      const catalog = discoverSkillCatalog(
        { projectRoots: [root, missingRoot, invalidRoot, unreadableRoot], userRoots: [] },
        {
          fileSystem: {
            ...fileSystem,
            access(path) {
              if (path === realpathSync(unreadableRoot)) {
                throw Object.assign(new Error("denied"), { code: "EACCES" });
              }
              accessSync(path);
            },
            readFile(path) {
              if (path === realpathSync(unreadable)) {
                throw Object.assign(new Error("denied"), { code: "EACCES" });
              }
              return readFileSync(path);
            },
          },
        },
      );

      expect(catalog.entries).toEqual([]);
      expect(new Set(catalog.diagnostics.map(({ code }) => code))).toEqual(new Set([
        "missing_root",
        "unreadable_root",
        "invalid_root",
        "missing_skill_file",
        "unreadable_skill_file",
        "malformed_skill_file",
        "non_utf8_skill_file",
        "empty_skill_file",
      ]));
      expect(catalog.roots.filter(({ valid }) => !valid)).toHaveLength(3);
    });
  });

  test("changes digest and identity with bytes while preserving an earlier exact snapshot", () => {
    withCatalogFixture((directory) => {
      const root = createCatalogRoot(directory, "project");
      const firstContent = skillContent("verify", "First exact body.");
      const filename = writeSkill(root, "verify", firstContent);
      const firstCatalog = discoverSkillCatalog({ projectRoots: [root], userRoots: [] });
      const firstEntry = firstCatalog.entries[0];
      if (firstEntry === undefined) throw new Error("fixture Skill was not discovered");
      const firstSnapshot = createSkillSnapshot(firstCatalog, firstEntry.skillId);

      const secondContent = skillContent("verify", "Second exact body.");
      writeFileSync(filename, secondContent);
      const secondCatalog = discoverSkillCatalog({ projectRoots: [root], userRoots: [] });
      const secondEntry = secondCatalog.entries[0];
      if (secondEntry === undefined) throw new Error("updated fixture Skill was not discovered");
      const secondSnapshot = createSkillSnapshot(secondCatalog, secondEntry.skillId);

      expect(secondEntry.canonicalPath).toBe(firstEntry.canonicalPath);
      expect(secondEntry.digest).not.toBe(firstEntry.digest);
      expect(secondEntry.skillId).not.toBe(firstEntry.skillId);
      expect(firstSnapshot.content).toBe(firstContent);
      expect(firstSnapshot.digest).toBe(firstEntry.digest);
      expect(secondSnapshot.content).toBe(secondContent);
      expect(Object.isFrozen(firstSnapshot)).toBe(true);
      expect(() => workflowIds.skill("free-text-name")).toThrow("digest-backed catalog identity");
      expect(() => createSkillSnapshot(
        secondCatalog,
        workflowIds.skill(`skill:${"f".repeat(64)}`),
      )).toThrow(
        SkillSelectionError,
      );
    });
  });
});
