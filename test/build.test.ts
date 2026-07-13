import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  artifactName,
  buildAll,
  BUILD_TARGETS,
  CHECKSUM_MANIFEST,
  compileCommand,
  ENTRYPOINT,
  hashFile,
  hostTarget,
  platformPackageManifest,
  platformSlug,
  readPackageVersion,
  renderManifest,
  resolveTargets,
  runCommand,
  TREE_SITTER_WORKER_ENTRYPOINT,
  writePlatformPackage,
  type BuildArtifact,
  type BuildTarget,
} from "../scripts/build.ts"

describe("BUILD_TARGETS", () => {
  it("enumerates exactly the four ADR-006 platform targets", () => {
    expect(BUILD_TARGETS.map((target) => target.platform)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "linux-arm64",
    ])
  })

  it("maps each platform to its bun compile target", () => {
    for (const target of BUILD_TARGETS) {
      expect(target.bunTarget).toBe(`bun-${target.platform}`)
    }
  })
})

describe("platformSlug / hostTarget / resolveTargets", () => {
  it("maps a node platform/arch pair to a slug, normalizing win32", () => {
    expect(platformSlug("darwin", "arm64")).toBe("darwin-arm64")
    expect(platformSlug("linux", "x64")).toBe("linux-x64")
    expect(platformSlug("win32", "x64")).toBe("windows-x64")
  })

  it("resolves the host target for a shipped platform", () => {
    expect(hostTarget("linux", "arm64")).toEqual({ platform: "linux-arm64", bunTarget: "bun-linux-arm64" })
  })

  it("throws for a host that is not a shipped target", () => {
    expect(() => hostTarget("win32", "x64")).toThrow('no Kitten build target for host "windows-x64"')
  })

  it("defaults to the host target when no names are given", () => {
    expect(resolveTargets([])).toEqual([hostTarget()])
  })

  it("resolves named platforms to their targets", () => {
    expect(resolveTargets(["linux-x64", "darwin-arm64"]).map((t) => t.platform)).toEqual(["linux-x64", "darwin-arm64"])
  })

  it("throws on an unknown target name", () => {
    expect(() => resolveTargets(["freebsd-x64"])).toThrow('unknown target "freebsd-x64"')
  })
})

describe("compileCommand", () => {
  const target: BuildTarget = { platform: "linux-x64", bunTarget: "bun-linux-x64" }

  it("builds a bun --compile invocation for the target", () => {
    expect(compileCommand(target)).toEqual([
      "bun",
      "build",
      "--compile",
      "--entry-naming=[name].[ext]",
      "--target=bun-linux-x64",
      "--outfile",
      "dist/kitten-linux-x64",
      ENTRYPOINT,
      TREE_SITTER_WORKER_ENTRYPOINT,
    ])
  })

  it("embeds OpenTUI's worker as a stable secondary entrypoint", () => {
    const command = compileCommand(target)
    expect(command).toContain("--entry-naming=[name].[ext]")
    expect(command.at(-1)).toBe(TREE_SITTER_WORKER_ENTRYPOINT)
  })

  it("honors a custom entry and output directory", () => {
    const command = compileCommand(target, { entry: "./src/main.ts", outDir: "out" })
    expect(command).toContain("./src/main.ts")
    expect(command).toContain("out/kitten-linux-x64")
  })
})

describe("artifactName / renderManifest", () => {
  it("names artifacts kitten-<platform>", () => {
    expect(artifactName({ platform: "darwin-arm64", bunTarget: "bun-darwin-arm64" })).toBe("kitten-darwin-arm64")
  })

  it("renders sha256sum-compatible manifest lines", () => {
    const artifacts: BuildArtifact[] = [
      { target: { platform: "linux-x64", bunTarget: "bun-linux-x64" }, outfile: "dist/kitten-linux-x64", sha256: "abc" },
    ]
    expect(renderManifest(artifacts)).toBe("abc  kitten-linux-x64\n")
  })
})

describe("platformPackageManifest", () => {
  it("renders the scoped package contract without install scripts or exports", () => {
    const manifest = JSON.parse(
      platformPackageManifest({ platform: "darwin-arm64", bunTarget: "bun-darwin-arm64" }, "1.2.3"),
    ) as Record<string, unknown>

    expect(manifest).toEqual({
      name: "@kitten/darwin-arm64",
      version: "1.2.3",
      os: ["darwin"],
      cpu: ["arm64"],
      files: ["kitten-darwin-arm64"],
    })
    expect(manifest).not.toHaveProperty("scripts")
    expect(manifest).not.toHaveProperty("exports")
  })

  it("maps every shipped slug to the correct npm os and cpu", () => {
    const metadata = BUILD_TARGETS.map((target) => {
      const manifest = JSON.parse(platformPackageManifest(target, "2.0.0")) as {
        name: string
        os: string[]
        cpu: string[]
      }
      return [target.platform, manifest.name, manifest.os[0], manifest.cpu[0]]
    })

    expect(metadata).toEqual([
      ["darwin-arm64", "@kitten/darwin-arm64", "darwin", "arm64"],
      ["darwin-x64", "@kitten/darwin-x64", "darwin", "x64"],
      ["linux-x64", "@kitten/linux-x64", "linux", "x64"],
      ["linux-arm64", "@kitten/linux-arm64", "linux", "arm64"],
    ])
  })
})

describe("writePlatformPackage", () => {
  it("writes package.json and copies the binary through the injected seam", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-platform-package-"))
    try {
      const target: BuildTarget = { platform: "linux-x64", bunTarget: "bun-linux-x64" }
      const outfile = join(dir, artifactName(target))
      await writeFile(outfile, "binary-bytes")
      const writes: { path: string; contents: string | Uint8Array }[] = []

      const platformPackage = await writePlatformPackage(
        { target, outfile, sha256: "unused" },
        "1.2.3",
        join(dir, "npm"),
        async (path, contents) => {
          writes.push({ path, contents })
        },
      )

      expect(platformPackage).toEqual({
        target,
        dir: join(dir, "npm", "@kitten", "linux-x64"),
        name: "@kitten/linux-x64",
      })
      expect(writes.map((write) => write.path)).toEqual([
        join(platformPackage.dir, "package.json"),
        join(platformPackage.dir, "kitten-linux-x64"),
      ])
      expect(JSON.parse(writes[0]!.contents as string)).toHaveProperty("version", "1.2.3")
      expect(Array.from(writes[1]!.contents as Uint8Array)).toEqual(Array.from(new TextEncoder().encode("binary-bytes")))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("readPackageVersion", () => {
  it("reads the build-time version directly from package.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-package-version-"))
    try {
      const packageJson = join(dir, "package.json")
      await writeFile(packageJson, JSON.stringify({ version: "9.8.7" }))
      expect(await readPackageVersion(packageJson)).toBe("9.8.7")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("buildAll", () => {
  it("compiles every target, hashes each, and writes the manifest", async () => {
    const commands: string[][] = []
    const manifests: { path: string; contents: string }[] = []

    const artifacts = await buildAll({
      targets: [
        { platform: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
        { platform: "linux-x64", bunTarget: "bun-linux-x64" },
      ],
      outDir: "dist",
      run: (argv) => {
        commands.push(argv)
        return { exitCode: 0 }
      },
      hash: async (path) => `hash:${path}`,
      writeManifest: async (path, contents) => {
        manifests.push({ path, contents })
      },
    })

    expect(commands).toHaveLength(2)
    expect(commands[0]).toContain("--target=bun-darwin-arm64")
    expect(artifacts.map((artifact) => artifact.sha256)).toEqual([
      "hash:dist/kitten-darwin-arm64",
      "hash:dist/kitten-linux-x64",
    ])
    expect(manifests).toHaveLength(1)
    expect(manifests[0]!.path).toBe(`dist/${CHECKSUM_MANIFEST}`)
    expect(manifests[0]!.contents).toContain("kitten-linux-x64")
  })

  it("throws when a compile exits non-zero and does not write a partial manifest", async () => {
    let wroteManifest = false
    const build = buildAll({
      targets: [{ platform: "linux-x64", bunTarget: "bun-linux-x64" }],
      run: () => ({ exitCode: 2 }),
      hash: async () => "unused",
      writeManifest: async () => {
        wroteManifest = true
      },
    })
    await expect(build).rejects.toThrow("bun build failed for linux-x64")
    expect(wroteManifest).toBe(false)
  })

  it("generates all four platform packages when the seam is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-platform-build-"))
    try {
      await Promise.all(BUILD_TARGETS.map((target) => writeFile(join(dir, artifactName(target)), target.platform)))
      const packageWrites: { path: string; contents: string | Uint8Array }[] = []
      const manifests: string[] = []

      await buildAll({
        targets: BUILD_TARGETS,
        outDir: dir,
        run: () => ({ exitCode: 0 }),
        hash: async (path) => `hash:${path}`,
        writeManifest: async (path) => {
          manifests.push(path)
        },
        platformPackages: {
          version: "1.2.3",
          outDir: join(dir, "npm"),
          write: async (path, contents) => {
            packageWrites.push({ path, contents })
          },
        },
      })

      expect(manifests).toEqual([join(dir, CHECKSUM_MANIFEST)])
      expect(packageWrites.filter((write) => write.path.endsWith("package.json"))).toHaveLength(4)
      expect(packageWrites.filter((write) => !write.path.endsWith("package.json"))).toHaveLength(4)
      for (const target of BUILD_TARGETS) {
        expect(packageWrites.map((write) => write.path)).toContain(
          join(dir, "npm", "@kitten", target.platform, artifactName(target)),
        )
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("does not generate platform packages when the seam is disabled", async () => {
    const target: BuildTarget = { platform: "linux-x64", bunTarget: "bun-linux-x64" }
    let manifestWrites = 0

    await buildAll({
      targets: [target],
      run: () => ({ exitCode: 0 }),
      hash: async () => "hash",
      writeManifest: async () => {
        manifestWrites += 1
      },
    })

    expect(manifestWrites).toBe(1)
  })

  it("hashes real artifacts and writes a real manifest through the defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-build-"))
    try {
      const target: BuildTarget = { platform: "linux-x64", bunTarget: "bun-linux-x64" }
      // The injected runner stands in for the compiler by producing the artifact bytes.
      const run = (argv: string[]): { exitCode: number } => {
        const outfile = argv[argv.indexOf("--outfile") + 1]!
        Bun.write(outfile, "binary-bytes")
        return { exitCode: 0 }
      }

      const artifacts = await buildAll({ targets: [target], outDir: dir, run })

      const expected = createHash("sha256").update("binary-bytes").digest("hex")
      expect(artifacts[0]!.sha256).toBe(expected)
      const manifest = await Bun.file(join(dir, CHECKSUM_MANIFEST)).text()
      expect(manifest).toBe(`${expected}  kitten-linux-x64\n`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runCommand / hashFile", () => {
  it("returns exit code 0 for a succeeding command", () => {
    expect(runCommand(["true"]).exitCode).toBe(0)
  })

  it("returns a non-zero exit code for a failing command", () => {
    expect(runCommand(["false"]).exitCode).not.toBe(0)
  })

  it("hashes a file to its sha256 hex digest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-hash-"))
    try {
      const file = join(dir, "artifact")
      await writeFile(file, "hello")
      expect(await hashFile(file)).toBe(createHash("sha256").update("hello").digest("hex"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
