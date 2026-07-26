import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  lifecycleMatrix,
  type NativeLifecycleMatrixEntry,
} from "./lifecycleMatrix.ts";
import {
  NATIVE_CAPTURE_ENV,
  type NativeCaptureRuntime,
} from "./nativeCaptureRuntime.ts";
import { seedLifecycleFixture } from "./seedLifecycleFixture.ts";

export type NativeArtifactResult = "captured" | "pass" | "fail";

export interface NativeArtifactManifestEntry {
  readonly matrixVersion: string;
  readonly fixtureId: string;
  readonly state: string;
  readonly window: {
    readonly name: "wide" | "medium" | "narrow";
    readonly width: number;
    readonly height: number;
  };
  readonly preference: {
    readonly theme: "light" | "dark";
    readonly motion: "standard" | "reduced";
  };
  readonly platform: string;
  readonly buildIdentity: string;
  readonly timestamp: string;
  readonly hash: string;
  readonly artifact: string;
  readonly result: NativeArtifactResult;
  readonly review?: {
    readonly reviewedAt: string;
    readonly notes: string;
  };
}

export interface NativeArtifactManifest {
  readonly schemaVersion: 1;
  readonly matrixVersion: string;
  readonly buildIdentity: string;
  readonly generatedAt: string;
  readonly entries: readonly NativeArtifactManifestEntry[];
}

export interface ManagedChildProcess {
  readonly pid: number;
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
}

export class ChildProcessRegistry {
  readonly #children = new Set<ManagedChildProcess>();

  add(child: ManagedChildProcess): void {
    this.#children.add(child);
    void child.exited.finally(() => this.#children.delete(child));
  }

  delete(child: ManagedChildProcess): void {
    this.#children.delete(child);
  }

  size(): number {
    return this.#children.size;
  }

  async terminateAll(timeoutMs = 3_000): Promise<void> {
    const children = [...this.#children];
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        this.#children.delete(child);
      }
    }
    await Promise.all(children.map(async (child) => {
      const exited = child.exited.then(() => true, () => true);
      const timedOut = new Promise<false>((resolveTimeout) => {
        setTimeout(() => resolveTimeout(false), timeoutMs);
      });
      if (await Promise.race([exited, timedOut])) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // The child exited between the timeout and forced cleanup.
      }
      await child.exited.catch(() => undefined);
    }));
    this.#children.clear();
  }
}

export async function withChildProcessCleanup<T>(
  registry: ChildProcessRegistry,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await registry.terminateAll();
  }
}

interface BunChild {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: NodeJS.Signals | number): void;
}

function asManagedChild(child: BunChild): ManagedChildProcess {
  return {
    pid: child.pid,
    exited: child.exited,
    kill(signal) {
      child.kill(signal);
    },
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function packageRoot(): string {
  return resolve(import.meta.dir, "../..");
}

function buildPlatform(): { readonly os: string; readonly arch: string } {
  const os = process.platform === "darwin"
    ? "macos"
    : process.platform === "win32"
      ? "win"
      : process.platform;
  const arch = process.arch === "x64" ? "x64" : process.arch;
  return { os, arch };
}

export function packagedExecutable(root = packageRoot()): string {
  const { os, arch } = buildPlatform();
  if (os === "macos") {
    return join(
      root,
      "build",
      `stable-${os}-${arch}`,
      "Kitten Orchestrator.app",
      "Contents",
      "MacOS",
      "launcher",
    );
  }
  if (os === "linux") {
    return join(
      root,
      "build",
      `stable-${os}-${arch}`,
      "KittenOrchestrator",
      "bin",
      "launcher",
    );
  }
  if (os === "win") {
    return join(
      root,
      "build",
      `stable-${os}-${arch}`,
      "KittenOrchestrator",
      "bin",
      "launcher.exe",
    );
  }
  throw new Error(`Packaged lifecycle capture does not support ${os}`);
}

export function packagedLaunchCommand(executable: string): readonly string[] {
  assertPackagedCaptureTarget("packaged", executable);
  if (process.platform !== "darwin") return [executable];
  const macOSDirectory = dirname(executable);
  const bundledRuntime = join(macOSDirectory, "bun");
  const packagedMain = resolve(macOSDirectory, "../Resources/main.js");
  if (!existsSync(bundledRuntime) || !existsSync(packagedMain)) {
    throw new Error("Packaged Electrobun runtime or main entrypoint is missing");
  }
  return [bundledRuntime, packagedMain];
}

export function packagedBuildArtifact(root = packageRoot()): string {
  const { os, arch } = buildPlatform();
  const extension = os === "macos" ? "app.tar.zst" : "tar.zst";
  return join(
    root,
    "artifacts",
    `stable-${os}-${arch}-KittenOrchestrator.${extension}`,
  );
}

export function assertPackagedCaptureTarget(
  target: string,
  executable: string,
): void {
  if (target !== "packaged") {
    throw new Error("Lifecycle capture rejects browser and dev-server targets");
  }
  const normalized = executable.replaceAll("\\", "/");
  if (
    normalized.includes("localhost")
    || normalized.includes("/src/renderer/")
    || normalized.includes("electrobun dev")
    || !basename(executable).startsWith("launcher")
  ) {
    throw new Error("Lifecycle capture target is not a packaged Electrobun launcher");
  }
}

async function readText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  return stream === null ? "" : new Response(stream).text();
}

export async function runNativeCaptureCommand(
  cmd: readonly string[],
  cwd: string,
  registry: ChildProcessRegistry,
): Promise<void> {
  const child = Bun.spawn({
    cmd: [...cmd],
    cwd,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  }) as BunChild;
  const managed = asManagedChild(child);
  registry.add(managed);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readText(child.stdout),
    readText(child.stderr),
  ]);
  registry.delete(managed);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}): ${stderr.trim() || stdout.trim()}`,
    );
  }
}

async function waitForReady(
  path: string,
  child: BunChild,
  timeoutMs = 20_000,
): Promise<{
  readonly matrixVersion: string;
  readonly fixtureId: string;
  readonly state: string;
  readonly result: "ready" | "failed";
  readonly reason?: string;
}> {
  const startedAt = Date.now();
  let exited = false;
  void child.exited.then(() => {
    exited = true;
  });
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf8")) as Awaited<ReturnType<typeof waitForReady>>;
    }
    if (exited) throw new Error("Packaged application exited before capture readiness");
    await Bun.sleep(50);
  }
  throw new Error("Timed out waiting for packaged application capture readiness");
}

async function captureNativeWindow(
  artifactPath: string,
  runtime: NativeCaptureRuntime,
  registry: ChildProcessRegistry,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("The current native capture implementation requires macOS screencapture");
  }
  const region = `80,80,${runtime.window.width},${runtime.window.height}`;
  await runNativeCaptureCommand(
    ["/usr/sbin/screencapture", "-x", `-R${region}`, artifactPath],
    packageRoot(),
    registry,
  );
  if (!existsSync(artifactPath) || statSync(artifactPath).size === 0) {
    throw new Error("Native screenshot is missing or empty");
  }
}

function runtimeEnvironment(
  fixture: NativeLifecycleMatrixEntry,
  databasePath: string,
  readyPath: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [NATIVE_CAPTURE_ENV.enabled]: "1",
    [NATIVE_CAPTURE_ENV.target]: "packaged",
    [NATIVE_CAPTURE_ENV.fixtureId]: fixture.fixtureId,
    [NATIVE_CAPTURE_ENV.databasePath]: databasePath,
    [NATIVE_CAPTURE_ENV.readyPath]: readyPath,
    [NATIVE_CAPTURE_ENV.matrixVersion]: lifecycleMatrix.matrixVersion,
  };
}

async function captureEntry(
  fixture: NativeLifecycleMatrixEntry,
  launchCommand: readonly string[],
  outputDirectory: string,
  fixtureRoot: string,
  buildIdentity: string,
  registry: ChildProcessRegistry,
  captureWindow: (
    artifactPath: string,
    runtime: NativeCaptureRuntime,
    registry: ChildProcessRegistry,
  ) => Promise<void>,
): Promise<NativeArtifactManifestEntry> {
  const seeded = await seedLifecycleFixture(fixture.fixtureId, fixtureRoot);
  const readyPath = join(seeded.fixtureDirectory, "capture-ready.json");
  const artifactName = `${fixture.state}--${fixture.window}--${fixture.theme}--${fixture.motion}.png`;
  const artifactPath = join(outputDirectory, artifactName);
  const runtime: NativeCaptureRuntime = {
    matrixVersion: lifecycleMatrix.matrixVersion,
    fixture,
    databasePath: seeded.databasePath,
    readyPath,
    window: lifecycleMatrix.windows[fixture.window],
  };
  const child = Bun.spawn({
    cmd: [...launchCommand],
    cwd: dirname(launchCommand[0]!),
    env: runtimeEnvironment(fixture, seeded.databasePath, readyPath),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  }) as BunChild;
  const managed = asManagedChild(child);
  registry.add(managed);
  try {
    const ready = await waitForReady(readyPath, child);
    if (
      ready.matrixVersion !== lifecycleMatrix.matrixVersion
      || ready.fixtureId !== fixture.fixtureId
      || ready.state !== fixture.state
    ) {
      throw new Error("Packaged application reported mismatched fixture readiness");
    }
    if (ready.result !== "ready") {
      throw new Error(ready.reason ?? "Packaged capture driver failed");
    }
    await captureWindow(artifactPath, runtime, registry);
    const timestamp = new Date().toISOString();
    return {
      matrixVersion: lifecycleMatrix.matrixVersion,
      fixtureId: fixture.fixtureId,
      state: fixture.state,
      window: {
        name: fixture.window,
        ...lifecycleMatrix.windows[fixture.window],
      },
      preference: { theme: fixture.theme, motion: fixture.motion },
      platform: `${process.platform}-${process.arch}`,
      buildIdentity,
      timestamp,
      hash: sha256File(artifactPath),
      artifact: artifactName,
      result: "captured",
    };
  } catch (error) {
    await registry.terminateAll();
    const [stdout, stderr] = await Promise.all([
      readText(child.stdout),
      readText(child.stderr),
    ]);
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      `${error instanceof Error ? error.message : "Packaged capture failed"}`
      + (detail.length === 0 ? "" : `: ${detail}`),
    );
  } finally {
    await registry.terminateAll();
  }
}

export async function captureLifecycleMatrix(options: {
  readonly outputDirectory: string;
  readonly fixtureIds?: readonly string[];
  readonly build?: boolean;
  readonly dependencies?: {
    readonly executable?: string;
    readonly launchCommand?: readonly string[];
    readonly buildIdentity?: string;
    readonly build?: (
      packageDirectory: string,
      registry: ChildProcessRegistry,
    ) => Promise<void>;
    readonly captureWindow?: (
      artifactPath: string,
      runtime: NativeCaptureRuntime,
      registry: ChildProcessRegistry,
    ) => Promise<void>;
  };
}): Promise<NativeArtifactManifest> {
  const root = packageRoot();
  const outputDirectory = resolve(options.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const registry = new ChildProcessRegistry();
  const fixtureRoot = mkdtempSync(join(tmpdir(), "kitten-native-lifecycle-"));
  const onSignal = () => {
    void registry.terminateAll().finally(() => {
      process.exitCode = 130;
    });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    if (options.build !== false) {
      if (options.dependencies?.build === undefined) {
        await runNativeCaptureCommand(["bun", "run", "native:build"], root, registry);
      } else {
        await options.dependencies.build(root, registry);
      }
    }
    const executable = options.dependencies?.executable ?? packagedExecutable(root);
    assertPackagedCaptureTarget("packaged", executable);
    if (!existsSync(executable)) {
      throw new Error(`Packaged Electrobun launcher is missing: ${executable}`);
    }
    const buildArtifact = packagedBuildArtifact(root);
    let launchCommand = options.dependencies?.launchCommand;
    if (launchCommand === undefined) {
      if (options.dependencies?.executable === undefined && process.platform === "darwin") {
        if (!existsSync(buildArtifact)) {
          throw new Error(`Packaged Electrobun build artifact is missing: ${buildArtifact}`);
        }
        await runNativeCaptureCommand(
          ["tar", "-xf", buildArtifact, "-C", fixtureRoot],
          root,
          registry,
        );
        const extractedExecutable = join(
          fixtureRoot,
          "Kitten Orchestrator.app",
          "Contents",
          "MacOS",
          "launcher",
        );
        launchCommand = packagedLaunchCommand(extractedExecutable);
      } else {
        launchCommand = options.dependencies?.executable === undefined
          ? packagedLaunchCommand(executable)
          : [executable];
      }
    }
    const buildIdentity = options.dependencies?.buildIdentity
      ?? sha256File(
        options.dependencies?.executable === undefined && existsSync(buildArtifact)
          ? buildArtifact
          : executable,
      );
    const requested = options.fixtureIds === undefined
      ? lifecycleMatrix.entries
      : options.fixtureIds.map((fixtureId) => {
          const entry = lifecycleMatrix.entries.find(
            (candidate) => candidate.fixtureId === fixtureId,
          );
          if (entry === undefined) throw new Error(`Unsupported lifecycle fixture: ${fixtureId}`);
          return entry;
        });
    const entries: NativeArtifactManifestEntry[] = [];
    for (const fixture of requested) {
      entries.push(await captureEntry(
        fixture,
        launchCommand,
        outputDirectory,
        fixtureRoot,
        buildIdentity,
        registry,
        options.dependencies?.captureWindow ?? captureNativeWindow,
      ));
    }
    const manifest: NativeArtifactManifest = {
      schemaVersion: 1,
      matrixVersion: lifecycleMatrix.matrixVersion,
      buildIdentity,
      generatedAt: new Date().toISOString(),
      entries,
    };
    writeFileSync(
      join(outputDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await registry.terminateAll();
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function parseManifest(path: string): NativeArtifactManifest {
  if (!existsSync(path)) {
    throw new Error(`Missing native artifact manifest: ${path}`);
  }
  const value = JSON.parse(readFileSync(path, "utf8")) as NativeArtifactManifest;
  if (
    value.schemaVersion !== 1
    || value.matrixVersion !== lifecycleMatrix.matrixVersion
    || typeof value.buildIdentity !== "string"
    || value.buildIdentity.length === 0
    || !Array.isArray(value.entries)
  ) {
    throw new Error("Native artifact manifest header is invalid");
  }
  return value;
}

export function verifyNativeArtifacts(
  manifestPath: string,
  options: {
    readonly now?: number;
    readonly requireReview?: boolean;
    readonly expectedFixtureIds?: readonly string[];
  } = {},
): NativeArtifactManifest {
  const manifest = parseManifest(manifestPath);
  const expectedEntries = options.expectedFixtureIds === undefined
    ? lifecycleMatrix.entries
    : options.expectedFixtureIds.map((fixtureId) => {
        const entry = lifecycleMatrix.entries.find(
          (candidate) => candidate.fixtureId === fixtureId,
        );
        if (entry === undefined) throw new Error(`Unsupported lifecycle fixture: ${fixtureId}`);
        return entry;
      });
  const expectedIds = new Set(expectedEntries.map(({ fixtureId }) => fixtureId));
  const seenFixtureIds = new Set<string>();
  const seenArtifacts = new Set<string>();
  const now = options.now ?? Date.now();
  const maxAgeMs = lifecycleMatrix.artifactMaxAgeMinutes * 60_000;
  const expectedPlatform = `${process.platform}-${process.arch}`;
  for (const entry of manifest.entries) {
    if (seenFixtureIds.has(entry.fixtureId)) {
      throw new Error(`Duplicate native artifact fixture: ${entry.fixtureId}`);
    }
    if (seenArtifacts.has(entry.artifact)) {
      throw new Error(`Duplicate native artifact path: ${entry.artifact}`);
    }
    seenFixtureIds.add(entry.fixtureId);
    seenArtifacts.add(entry.artifact);
    const declared = lifecycleMatrix.entries.find(
      (candidate) => candidate.fixtureId === entry.fixtureId,
    );
    if (declared === undefined || !expectedIds.has(entry.fixtureId)) {
      throw new Error(`Undeclared native artifact fixture: ${entry.fixtureId}`);
    }
    const dimensions = lifecycleMatrix.windows[declared.window];
    if (
      entry.matrixVersion !== lifecycleMatrix.matrixVersion
      || entry.state !== declared.state
      || entry.window.name !== declared.window
      || entry.window.width !== dimensions.width
      || entry.window.height !== dimensions.height
      || entry.preference.theme !== declared.theme
      || entry.preference.motion !== declared.motion
      || entry.buildIdentity !== manifest.buildIdentity
      || entry.platform !== expectedPlatform
    ) {
      throw new Error(`Native artifact metadata mismatch: ${entry.fixtureId}`);
    }
    const capturedAt = Date.parse(entry.timestamp);
    if (!Number.isFinite(capturedAt) || capturedAt > now + 60_000 || now - capturedAt > maxAgeMs) {
      throw new Error(`Stale native artifact: ${entry.fixtureId}`);
    }
    const artifactPath = resolve(dirname(manifestPath), entry.artifact);
    if (!artifactPath.startsWith(`${resolve(dirname(manifestPath))}/`)) {
      throw new Error(`Native artifact path escapes the manifest directory: ${entry.fixtureId}`);
    }
    if (!existsSync(artifactPath)) {
      throw new Error(`Missing native artifact: ${entry.fixtureId}`);
    }
    if (statSync(artifactPath).size === 0) {
      throw new Error(`Zero-byte native artifact: ${entry.fixtureId}`);
    }
    if (sha256File(artifactPath) !== entry.hash) {
      throw new Error(`Hash-mismatched native artifact: ${entry.fixtureId}`);
    }
    if (options.requireReview !== false && (
      entry.result !== "pass"
      || entry.review === undefined
      || entry.review.notes.trim().length === 0
    )) {
      throw new Error(`Unreviewed native artifact: ${entry.fixtureId}`);
    }
  }
  const missing = [...expectedIds].filter((fixtureId) => !seenFixtureIds.has(fixtureId));
  if (missing.length > 0) {
    throw new Error(`Missing native artifacts: ${missing.join(", ")}`);
  }
  if (manifest.entries.length !== expectedIds.size) {
    throw new Error("Native artifact manifest contains duplicate or extra entries");
  }
  return manifest;
}

export function reviewNativeArtifacts(
  manifestPath: string,
  input: { readonly result: "pass" | "fail"; readonly notes: string },
): NativeArtifactManifest {
  if (input.notes.trim().length === 0) throw new Error("Native artifact review notes are required");
  const manifest = verifyNativeArtifacts(manifestPath, { requireReview: false });
  const reviewedAt = new Date().toISOString();
  const reviewed: NativeArtifactManifest = {
    ...manifest,
    entries: manifest.entries.map((entry) => ({
      ...entry,
      result: input.result,
      review: { reviewedAt, notes: input.notes.trim() },
    })),
  };
  writeFileSync(manifestPath, `${JSON.stringify(reviewed, null, 2)}\n`);
  return reviewed;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "capture") {
    const output = argument("--output")
      ?? join(packageRoot(), "test", "native", "artifacts", lifecycleMatrix.matrixVersion);
    const fixtureId = argument("--fixture");
    const manifest = await captureLifecycleMatrix({
      outputDirectory: output,
      ...(fixtureId === undefined ? {} : { fixtureIds: [fixtureId] }),
      build: !process.argv.includes("--skip-build"),
    });
    console.log(JSON.stringify({
      manifest: join(output, "manifest.json"),
      entries: manifest.entries.length,
      buildIdentity: manifest.buildIdentity,
    }));
  } else if (command === "verify") {
    const manifestPath = argument("--manifest")
      ?? join(packageRoot(), "test", "native", "artifacts", lifecycleMatrix.matrixVersion, "manifest.json");
    const fixtureId = argument("--fixture");
    const manifest = verifyNativeArtifacts(manifestPath, {
      ...(fixtureId === undefined ? {} : { expectedFixtureIds: [fixtureId] }),
    });
    console.log(JSON.stringify({
      verified: manifest.entries.length,
      matrixVersion: manifest.matrixVersion,
      buildIdentity: manifest.buildIdentity,
    }));
  } else if (command === "review") {
    const manifestPath = argument("--manifest")
      ?? join(packageRoot(), "test", "native", "artifacts", lifecycleMatrix.matrixVersion, "manifest.json");
    const result = argument("--result");
    const notes = argument("--notes");
    if ((result !== "pass" && result !== "fail") || notes === undefined) {
      throw new Error("Review requires --result pass|fail and --notes <text>");
    }
    const manifest = reviewNativeArtifacts(manifestPath, { result, notes });
    console.log(JSON.stringify({ reviewed: manifest.entries.length, result }));
  } else {
    throw new Error("Usage: runLifecycleCapture.ts capture|verify|review");
  }
}
