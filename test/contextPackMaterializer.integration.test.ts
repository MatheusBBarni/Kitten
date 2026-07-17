// Integration: bounded Context Pack artifacts from a real temporary Git workspace.

import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { contextSelectionKey } from "../src/core/contextPack.ts"
import type {
  BoundedArtifactRead,
  ContextSelection,
  ContextPackSourceReference,
} from "../src/core/types.ts"
import { createContextPackMaterializer } from "../src/app/contextPackMaterializer.ts"

describe("Context Pack materializer temporary workspace", () => {
  it("returns contained full-file, slice, staged-diff, and unstaged-diff artifacts only", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "kitten-context-pack-"))
    const workspace = join(sandbox, "workspace")
    const sourcePath = join(workspace, "src", "example.ts")
    const outsidePath = join(sandbox, "outside.ts")
    await mkdir(join(workspace, "src"), { recursive: true })

    try {
      await Bun.write(sourcePath, "export const value = 'base'\nexport const tail = 'base'\n")
      await Bun.write(outsidePath, "export const secret = true\n")
      runGit(workspace, ["init"])
      runGit(workspace, ["config", "user.name", "Kitten Test"])
      runGit(workspace, ["config", "user.email", "kitten@example.test"])
      runGit(workspace, ["add", "src/example.ts"])
      runGit(workspace, ["commit", "-m", "base"])

      await Bun.write(sourcePath, "export const value = 'staged'\nexport const tail = 'base'\n")
      runGit(workspace, ["add", "src/example.ts"])
      await Bun.write(sourcePath, "export const value = 'staged'\nexport const tail = 'unstaged'\n")
      await symlink(outsidePath, join(workspace, "escape.ts"))

      const materializer = createContextPackMaterializer()
      const reads: readonly BoundedArtifactRead[] = [
        { kind: "full_file", path: "src/example.ts" },
        {
          kind: "file_slice",
          path: "src/example.ts",
          range: { startLine: 2, endLine: 2 },
        },
        { kind: "diff", path: "src/example.ts", scope: "staged" },
        { kind: "diff", path: "src/example.ts", scope: "unstaged" },
      ]
      const selections: ContextSelection[] = []
      for (const read of reads) {
        const result = await materializer.read(workspace, read)
        expect(result.kind).toBe("ready")
        if (result.kind !== "ready") throw new Error(`unexpected ${result.kind}`)
        selections.push(selectionFor(read, result.artifact.source))
      }

      const result = await materializer.materialize(workspace, selections)
      expect(result.kind).toBe("materialized")
      if (result.kind !== "materialized") throw new Error(`unexpected ${result.kind}`)

      expect(result.artifacts.map(({ selectionKey }) => selectionKey)).toEqual(
        selections.map(contextSelectionKey),
      )
      expect(result.totalBytes).toBe(
        result.artifacts.reduce((total, artifact) => total + artifact.source.bytes, 0),
      )
      expect(result.artifacts[0]?.content).toBe(
        "export const value = 'staged'\nexport const tail = 'unstaged'\n",
      )
      expect(result.artifacts[1]?.content).toBe("export const tail = 'unstaged'\n")
      expect(result.artifacts[2]?.content).toContain("-export const value = 'base'")
      expect(result.artifacts[2]?.content).toContain("+export const value = 'staged'")
      expect(result.artifacts[3]?.content).toContain("-export const tail = 'base'")
      expect(result.artifacts[3]?.content).toContain("+export const tail = 'unstaged'")

      await expect(materializer.read(workspace, { kind: "full_file", path: "../outside.ts" }))
        .resolves.toEqual({ kind: "blocked", reason: "invalid_path", path: "../outside.ts" })
      await expect(materializer.read(workspace, { kind: "full_file", path: "escape.ts" }))
        .resolves.toEqual({ kind: "blocked", reason: "ineligible_source", path: "escape.ts" })
    } finally {
      await rm(sandbox, { recursive: true, force: true })
    }
  })
})

function selectionFor(
  read: BoundedArtifactRead,
  source: ContextPackSourceReference,
): ContextSelection {
  const common = {
    path: read.path,
    source,
    rationale: "Integration coverage",
    relationship: "Real temporary workspace artifact",
  }
  switch (read.kind) {
    case "full_file":
      return { ...common, kind: read.kind }
    case "file_slice":
      return { ...common, kind: read.kind, range: read.range }
    case "diff":
      return { ...common, kind: read.kind, scope: read.scope }
  }
}

function runGit(cwd: string, args: readonly string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: { ...process.env, LC_ALL: "C" },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr))
  }
}
