import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function withCatalogFixture(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "kitten-skill-catalog-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function createCatalogRoot(directory: string, name: string): string {
  const root = join(directory, name);
  mkdirSync(root, { recursive: true });
  return root;
}

export function skillContent(name: string, body = "Follow the workflow.", description = `${name} workflow`): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

export function writeSkill(
  root: string,
  directoryName: string,
  content: string,
): string {
  const directory = join(root, directoryName);
  mkdirSync(directory, { recursive: true });
  const filename = join(directory, "SKILL.md");
  writeFileSync(filename, content);
  return filename;
}
