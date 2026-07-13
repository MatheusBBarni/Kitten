/**
 * Release build: compile Kitten to a standalone binary per platform (ADR-006).
 *
 * ADR-006 distributes Kitten as per-platform executables produced by
 * `bun build --compile`, delivered through the checksummed curl installer in
 * `scripts/install.sh`. This script compiles the exact four targets that ADR names,
 * hashes each artifact, and writes a `SHA256SUMS` manifest the installer verifies
 * before it puts anything on a user's PATH.
 *
 * The moving parts - which command runs, how a file is hashed, how the manifest is
 * written - are injectable so the enumeration and manifest logic are unit-tested
 * without cross-compiling four binaries.
 *
 * OpenTUI's native (Zig) core is loaded per-platform via FFI, and only the host's
 * platform package is installed, so a single machine cannot cross-compile all four
 * targets. The release pipeline therefore builds each target on its own native CI
 * runner (`.github/workflows/release.yml`), invoking this script with that runner's
 * platform. Run with no arguments it builds only the host target; run with platform
 * slugs it builds exactly those.
 */

import { createHash } from "node:crypto"
import { chmod, mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

/** A platform Kitten ships a standalone binary for, and its Bun compile target. */
export interface BuildTarget {
  /** The platform slug used in the artifact name and the installer's detection. */
  platform: string
  /** The `bun build --compile --target` value that cross-compiles for it. */
  bunTarget: string
}

/**
 * The four targets ADR-006 mandates, in a stable order.
 *
 * Kept exact and explicit: the installer and CI matrix read the same set, and the
 * onboarding promise ("no runtime prerequisite") depends on shipping a native binary
 * for each of these platforms rather than falling back to a runtime.
 */
export const BUILD_TARGETS: readonly BuildTarget[] = [
  { platform: "darwin-arm64", bunTarget: "bun-darwin-arm64" },
  { platform: "darwin-x64", bunTarget: "bun-darwin-x64" },
  { platform: "linux-x64", bunTarget: "bun-linux-x64" },
  { platform: "linux-arm64", bunTarget: "bun-linux-arm64" },
]

/** The entry point compiled into each binary. */
export const ENTRYPOINT = "./src/index.ts"

/**
 * OpenTUI computes this Worker URL, so Bun cannot trace it from the main graph.
 * Listing it as a second compile entry embeds the worker and its web-tree-sitter wasm;
 * OpenTUI's main graph already embeds the language wasm/scm assets it imports.
 */
export const TREE_SITTER_WORKER_ENTRYPOINT = "./node_modules/@opentui/core/parser.worker.js"

/** Where the artifacts and the checksum manifest are written. */
export const OUTPUT_DIR = "dist"

/** The checksum manifest file name (BSD/coreutils `sha256sum -c` compatible). */
export const CHECKSUM_MANIFEST = "SHA256SUMS"

/** The artifact file name for a target, e.g. `kitten-darwin-arm64`. */
export function artifactName(target: BuildTarget): string {
  return `kitten-${target.platform}`
}

/** The platform slug for a Node platform/arch pair, e.g. `darwin-arm64`. */
export function platformSlug(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return `${platform === "win32" ? "windows" : platform}-${arch}`
}

/** The build target matching the host, or throw if the host is not a shipped target. */
export function hostTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): BuildTarget {
  const slug = platformSlug(platform, arch)
  const target = BUILD_TARGETS.find((candidate) => candidate.platform === slug)
  if (!target) {
    throw new Error(`no Kitten build target for host "${slug}". Shipped: ${BUILD_TARGETS.map((t) => t.platform).join(", ")}`)
  }
  return target
}

/**
 * Resolve platform-slug arguments to build targets. With none, defaults to the host
 * target - the only one a single machine can compile without cross toolchains.
 */
export function resolveTargets(names: readonly string[]): BuildTarget[] {
  if (names.length === 0) return [hostTarget()]
  return names.map((name) => {
    const target = BUILD_TARGETS.find((candidate) => candidate.platform === name)
    if (!target) {
      throw new Error(`unknown target "${name}". Known: ${BUILD_TARGETS.map((t) => t.platform).join(", ")}`)
    }
    return target
  })
}

/**
 * The `bun` argv that compiles one target.
 *
 * The worker is a second entrypoint in the same executable. Stable entry naming
 * makes it addressable as `/$bunfs/root/parser.worker.js` for startup extraction.
 */
export function compileCommand(
  target: BuildTarget,
  options: { entry?: string; outDir?: string } = {},
): string[] {
  const entry = options.entry ?? ENTRYPOINT
  const outDir = options.outDir ?? OUTPUT_DIR
  return [
    "bun",
    "build",
    "--compile",
    "--entry-naming=[name].[ext]",
    `--target=${target.bunTarget}`,
    "--outfile",
    `${outDir}/${artifactName(target)}`,
    entry,
    TREE_SITTER_WORKER_ENTRYPOINT,
  ]
}

/** One artifact's build outcome and its checksum. */
export interface BuildArtifact {
  target: BuildTarget
  outfile: string
  sha256: string
}

/** A generated npm package containing one platform's prebuilt binary. */
export interface PlatformPackage {
  target: BuildTarget
  dir: string
  name: string
}

/** Writes generated package files. Injectable so tests can capture output. */
export type FileWriter = (path: string, contents: string | Uint8Array) => Promise<void>

/** How a command is run; returns the process exit code. Seam for tests. */
export type CommandRunner = (argv: string[]) => { exitCode: number }

/** Injectable seams so {@link buildAll} is testable without cross-compiling. */
export interface BuildOptions {
  targets?: readonly BuildTarget[]
  entry?: string
  outDir?: string
  /** Runs a build command; defaults to a real synchronous `bun build`. */
  run?: CommandRunner
  /** Hashes a built artifact; defaults to a SHA-256 of the file bytes. */
  hash?: (path: string) => Promise<string>
  /** Persists the checksum manifest; defaults to writing `<outDir>/SHA256SUMS`. */
  writeManifest?: (path: string, contents: string) => Promise<void>
  /** Opts into staging npm platform packages from the compiled artifacts. */
  platformPackages?: {
    version: string
    /** Package staging root; defaults to `<outDir>/npm`. */
    outDir?: string
    /** Persists package manifests and binary bytes; defaults to {@link Bun.write}. */
    write?: FileWriter
  }
}

/**
 * Compile every target, hash each artifact, and write the checksum manifest.
 *
 * Throws on the first target whose compile exits non-zero: a partial release is
 * worse than no release, and the installer would otherwise verify against a manifest
 * missing an entry. Returns one {@link BuildArtifact} per target on success.
 */
export async function buildAll(options: BuildOptions = {}): Promise<BuildArtifact[]> {
  const targets = options.targets ?? BUILD_TARGETS
  const outDir = options.outDir ?? OUTPUT_DIR
  const run = options.run ?? defaultRun
  const hash = options.hash ?? defaultHash
  const writeManifest = options.writeManifest ?? defaultWriteManifest

  const artifacts: BuildArtifact[] = []
  for (const target of targets) {
    const command = compileCommand(target, { entry: options.entry, outDir })
    const { exitCode } = run(command)
    if (exitCode !== 0) {
      throw new Error(`bun build failed for ${target.platform} (exit code ${exitCode})`)
    }
    const outfile = `${outDir}/${artifactName(target)}`
    artifacts.push({ target, outfile, sha256: await hash(outfile) })
  }

  if (options.platformPackages) {
    const packageOutDir = options.platformPackages.outDir ?? join(outDir, "npm")
    for (const artifact of artifacts) {
      await writePlatformPackage(
        artifact,
        options.platformPackages.version,
        packageOutDir,
        options.platformPackages.write,
      )
    }
  }

  await writeManifest(`${outDir}/${CHECKSUM_MANIFEST}`, renderManifest(artifacts))
  return artifacts
}

/** Render the artifacts as `sha256sum`-compatible lines (`<hash>  <name>`). */
export function renderManifest(artifacts: BuildArtifact[]): string {
  return artifacts.map((artifact) => `${artifact.sha256}  ${artifactName(artifact.target)}`).join("\n") + "\n"
}

const PLATFORM_PACKAGE_METADATA = {
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64" },
  "linux-x64": { os: "linux", cpu: "x64" },
  "linux-arm64": { os: "linux", cpu: "arm64" },
} as const

/** Serialize the npm package manifest for one shipped platform target. */
export function platformPackageManifest(target: BuildTarget, version: string): string {
  const metadata = PLATFORM_PACKAGE_METADATA[target.platform as keyof typeof PLATFORM_PACKAGE_METADATA]
  if (!metadata) {
    throw new Error(`no npm platform package metadata for target "${target.platform}"`)
  }

  return `${JSON.stringify(
    {
      name: `@kitten/${target.platform}`,
      version,
      os: [metadata.os],
      cpu: [metadata.cpu],
      files: [artifactName(target)],
    },
    null,
    2,
  )}\n`
}

/** Stage one platform package containing its manifest and compiled binary bytes. */
export async function writePlatformPackage(
  artifact: BuildArtifact,
  version: string,
  outDir: string,
  write: FileWriter = defaultWrite,
): Promise<PlatformPackage> {
  const name = `@kitten/${artifact.target.platform}`
  const dir = join(outDir, "@kitten", artifact.target.platform)
  const binaryPath = join(dir, artifactName(artifact.target))

  await write(join(dir, "package.json"), platformPackageManifest(artifact.target, version))
  await write(binaryPath, await Bun.file(artifact.outfile).bytes())
  if (write === defaultWrite) {
    const sourceMode = (await stat(artifact.outfile)).mode & 0o777
    await chmod(binaryPath, sourceMode)
  }

  return { target: artifact.target, dir, name }
}

/** Read the release version that release-please stamps into package.json. */
export async function readPackageVersion(
  path: string | URL = new URL("../package.json", import.meta.url),
): Promise<string> {
  const packageJson = (await Bun.file(path).json()) as { version?: unknown }
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error(`package.json at ${path.toString()} does not contain a version`)
  }
  return packageJson.version
}

/** Run a build command synchronously, streaming its output to this process. */
export const runCommand: CommandRunner = (argv) => {
  const result = Bun.spawnSync(argv, { stdout: "inherit", stderr: "inherit" })
  return { exitCode: result.exitCode }
}

/** SHA-256 (lowercase hex) of a file's bytes - the digest the installer verifies. */
export async function hashFile(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes()
  return createHash("sha256").update(bytes).digest("hex")
}

const defaultRun = runCommand
const defaultHash = hashFile
const defaultWrite: FileWriter = async (path, contents) => {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, contents)
}
const defaultWriteManifest = async (path: string, contents: string): Promise<void> => {
  await Bun.write(path, contents)
}

if (import.meta.main) {
  const targets = resolveTargets(process.argv.slice(2))
  const version = await readPackageVersion()
  const artifacts = await buildAll({
    targets,
    platformPackages: { version, outDir: join(OUTPUT_DIR, "npm") },
  })
  for (const artifact of artifacts) {
    process.stdout.write(`built ${artifact.outfile}  ${artifact.sha256}\n`)
  }
  process.stdout.write(`wrote ${OUTPUT_DIR}/${CHECKSUM_MANIFEST}\n`)
}
