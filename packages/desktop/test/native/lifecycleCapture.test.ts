import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  lifecycleMatrix,
  parseLifecycleMatrix,
} from "./lifecycleMatrix.ts";
import {
  NATIVE_CAPTURE_ENV,
  buildNativeCaptureDriverScript,
  resolveNativeCaptureRuntime,
} from "./nativeCaptureRuntime.ts";
import {
  NATIVE_FIXTURE_IDS,
  seedLifecycleFixture,
} from "./seedLifecycleFixture.ts";
import {
  ChildProcessRegistry,
  assertPackagedCaptureTarget,
  captureLifecycleMatrix,
  packagedBuildArtifact,
  packagedExecutable,
  packagedLaunchCommand,
  reviewNativeArtifacts,
  runNativeCaptureCommand,
  verifyNativeArtifacts,
  withChildProcessCleanup,
  type ManagedChildProcess,
  type NativeArtifactManifest,
  type NativeArtifactManifestEntry,
} from "./runLifecycleCapture.ts";
import { createEventJournal } from "../../src/persistence/eventJournal.ts";
import {
  closeSqliteDatabase,
  openSqliteDatabase,
} from "../../src/persistence/sqliteDatabase.ts";
import { migrateDatabase } from "../../src/persistence/migrations.ts";
import {
  createReviewEvidenceService,
  REVIEW_TEXT_PATCH_BYTE_LIMIT,
} from "../../src/host/reviewEvidence.ts";
import { projectSupervision } from "../../src/host/boardRpc.ts";
import { getCardInspectorProjection } from "../../src/attempts/activityIngestor.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const path = mkdtempSync(join(tmpdir(), `kitten-native-${label}-`));
  temporaryDirectories.push(path);
  return path;
}

const requiredStates = [
  "empty_workspace",
  "populated_work_inbox",
  "multiple_projects_group_order",
  "needs_attention",
  "running_attempt_direct_send",
  "failed_attempt",
  "ready_for_review_manifest",
  "settled_group",
  "board_workbench_closed",
  "board_workbench_open",
  "conversation_grouped_tool_activity",
  "composer_idle",
  "composer_queued",
  "composer_blocked",
  "composer_request_changes_draft",
  "composer_interrupted",
  "review_text_diff",
  "review_binary_entry",
  "review_too_large",
  "review_stale_evidence",
  "review_approve_available",
  "request_changes_mutation_free_selection",
  "request_changes_same_card_stage_send",
  "board_return_restoration",
  "settings_entry",
  "settings_return_context",
  "visible_keyboard_focus",
  "wide_layout",
  "medium_layout",
  "narrow_layout",
] as const;

describe("authoritative native lifecycle matrix", () => {
  test("assigns every layout-, trust-, and action-changing state a unique fixture identity", () => {
    expect(lifecycleMatrix.matrixVersion).toBe("lifecycle-v1");
    expect(lifecycleMatrix.entries.map(({ state }) => state)).toEqual([...requiredStates]);
    expect(new Set(lifecycleMatrix.entries.map(({ fixtureId }) => fixtureId)).size)
      .toBe(lifecycleMatrix.entries.length);
    expect(new Set(lifecycleMatrix.entries.map(({ state }) => state)).size)
      .toBe(lifecycleMatrix.entries.length);
    expect(new Set(lifecycleMatrix.entries.map(({ window }) => window))).toEqual(
      new Set(["wide", "medium", "narrow"]),
    );
    expect(new Set(lifecycleMatrix.entries.map(({ theme }) => theme))).toEqual(
      new Set(["light", "dark"]),
    );
    expect(lifecycleMatrix.entries.some(({ motion }) => motion === "reduced")).toBeTrue();
  });

  test("rejects duplicate fixture and state identities", () => {
    const duplicate = {
      ...lifecycleMatrix,
      entries: lifecycleMatrix.entries.map((entry) => ({
        ...entry,
        driver: { ...entry.driver },
      })),
    };
    const first = duplicate.entries[0]!;
    const second = duplicate.entries[1]!;
    duplicate.entries[1] = { ...second, fixtureId: first.fixtureId };
    expect(() => parseLifecycleMatrix(duplicate)).toThrow("unique fixtureId");
    duplicate.entries[1] = { ...second, state: first.state };
    expect(() => parseLifecycleMatrix(duplicate)).toThrow("unique state");
  });
});

describe("host-owned lifecycle fixture seeding", () => {
  test("produces equivalent SQLite projections from repeated deterministic seeding", async () => {
    const root = temporaryDirectory("repeat-seed");
    const fixtureId = "fx-v1-populated-inbox";
    const first = await seedLifecycleFixture(fixtureId, root);
    const firstSnapshot = structuredClone(first.snapshot);
    const second = await seedLifecycleFixture(fixtureId, root);
    expect(second.snapshot).toEqual(firstSnapshot);
    expect(JSON.stringify(second.snapshot)).not.toContain(process.env.HOME ?? "__missing_home__");
    expect(second.repositoryPath).toStartWith(realpathSync(root));
  });

  test("seeds every actionable lifecycle group, conversation, queues, attention, and review evidence", async () => {
    const seeded = await seedLifecycleFixture(
      "fx-v1-populated-inbox",
      temporaryDirectory("projection"),
    );
    const projection = projectSupervision(seeded.snapshot);
    expect(projection.counts).toMatchObject({
      needs_attention: 1,
      ready_for_review: 1,
      failed: 1,
      running: 3,
      settled: 2,
    });
    expect(projection.groups.map(({ status }) => status)).toEqual([
      "needs_attention",
      "ready_for_review",
      "failed",
      "running",
      "settled",
    ]);
    expect(seeded.snapshot.followUpQueues.map(({ drafts }) => drafts[0]?.state).sort())
      .toEqual(["interrupted", "queued"]);
    expect(seeded.snapshot.attentionBlockers).toHaveLength(1);
    const inspector = (() => {
      const database = openSqliteDatabase({ filename: seeded.databasePath, readonly: true });
      try {
        migrateDatabase(database);
        return getCardInspectorProjection(
          createEventJournal(database),
          NATIVE_FIXTURE_IDS.runningCard,
        );
      } finally {
        closeSqliteDatabase(database);
      }
    })();
    expect(inspector?.attempts[0]?.entries.map(({ kind }) => kind)).toEqual([
      "user",
      "agent",
      "tool",
    ]);
  });

  test("exposes deterministic text/binary manifests and fails oversized evidence closed", async () => {
    const root = temporaryDirectory("review-evidence");
    const regular = await seedLifecycleFixture("fx-v1-review-text", root);
    const regularDatabase = openSqliteDatabase({ filename: regular.databasePath });
    try {
      migrateDatabase(regularDatabase);
      const regularJournal = createEventJournal(regularDatabase);
      const regularEvidence = regularJournal.snapshot()
        .reviewEvidenceByCard[NATIVE_FIXTURE_IDS.reviewCard]!;
      const service = createReviewEvidenceService(regularJournal);
      const manifest = service.manifest(regularEvidence.evidenceId);
      expect(manifest.status).toBe("ok");
      if (manifest.status !== "ok") throw new Error("regular manifest missing");
      expect(manifest.manifest.availability.status).toBe("available");
      expect(manifest.manifest.files.map(({ isBinary }) => isBinary)).toEqual([
        false,
        true,
      ]);
      expect(service.readDiffChunk(
        regularEvidence.evidenceId,
        "native-file-text",
        0,
      ).status).toBe("ok");
      expect(service.readDiffChunk(
        regularEvidence.evidenceId,
        "native-file-binary",
        0,
      )).toEqual({ status: "non_text", state: "binary" });
    } finally {
      closeSqliteDatabase(regularDatabase);
    }

    const oversized = await seedLifecycleFixture("fx-v1-review-too-large", root);
    const oversizedDatabase = openSqliteDatabase({ filename: oversized.databasePath });
    try {
      migrateDatabase(oversizedDatabase);
      const journal = createEventJournal(oversizedDatabase);
      const evidence = journal.snapshot()
        .reviewEvidenceByCard[NATIVE_FIXTURE_IDS.oversizedCard]!;
      expect(evidence.totalPatchBytes).toBe(REVIEW_TEXT_PATCH_BYTE_LIMIT + 1);
      const manifest = createReviewEvidenceService(journal).manifest(evidence.evidenceId);
      expect(manifest.status).toBe("ok");
      if (manifest.status !== "ok") throw new Error("oversized manifest missing");
      expect(manifest.manifest.availability).toEqual({
        status: "unavailable",
        error: {
          code: "evidence_oversized",
          recoveryHint: "reduce_change_set",
        },
      });
    } finally {
      closeSqliteDatabase(oversizedDatabase);
    }
  });
});

describe("packaged runtime selection and driver", () => {
  test("rejects browser/dev-server targets and undeclared fixtures", async () => {
    expect(() => assertPackagedCaptureTarget(
      "browser",
      "/Applications/Kitten.app/Contents/MacOS/launcher",
    )).toThrow("rejects browser");
    expect(() => assertPackagedCaptureTarget(
      "packaged",
      "http://localhost:5173/src/renderer/main.tsx",
    )).toThrow("not a packaged");
    expect(() => resolveNativeCaptureRuntime({
      [NATIVE_CAPTURE_ENV.enabled]: "1",
      [NATIVE_CAPTURE_ENV.target]: "packaged",
      [NATIVE_CAPTURE_ENV.fixtureId]: "undeclared",
      [NATIVE_CAPTURE_ENV.matrixVersion]: lifecycleMatrix.matrixVersion,
      [NATIVE_CAPTURE_ENV.databasePath]: "/tmp/missing.sqlite",
      [NATIVE_CAPTURE_ENV.readyPath]: "/tmp/ready.json",
    })).toThrow("Unsupported lifecycle fixture");
  });

  test("resolves the current packaged launcher and checks child command failures", async () => {
    const executable = packagedExecutable();
    expect(executable).toContain("stable-macos-arm64");
    expect(packagedBuildArtifact()).toContain(
      "stable-macos-arm64-KittenOrchestrator.app.tar.zst",
    );
    const extractedRoot = temporaryDirectory("packaged-command");
    const macOSDirectory = join(
      extractedRoot,
      "Kitten Orchestrator.app",
      "Contents",
      "MacOS",
    );
    const resourcesDirectory = resolve(macOSDirectory, "../Resources");
    mkdirSync(macOSDirectory, { recursive: true });
    mkdirSync(resourcesDirectory, { recursive: true });
    const extractedLauncher = join(macOSDirectory, "launcher");
    writeFileSync(extractedLauncher, "");
    writeFileSync(join(macOSDirectory, "bun"), "");
    writeFileSync(join(resourcesDirectory, "main.js"), "");
    expect(packagedLaunchCommand(extractedLauncher)).toEqual([
      join(macOSDirectory, "bun"),
      join(resourcesDirectory, "main.js"),
    ]);
    const registry = new ChildProcessRegistry();
    await runNativeCaptureCommand(
      [process.execPath, "-e", "console.log('native command ok')"],
      import.meta.dir,
      registry,
    );
    expect(registry.size()).toBe(0);
    await expect(runNativeCaptureCommand(
      [process.execPath, "-e", "console.error('native command failed'); process.exit(2)"],
      import.meta.dir,
      registry,
    )).rejects.toThrow("native command failed");
    expect(registry.size()).toBe(0);
  });

  test("accepts only a matching seeded descriptor and emits semantic packaged interactions", async () => {
    const seeded = await seedLifecycleFixture(
      "fx-v1-composer-request-changes",
      temporaryDirectory("runtime"),
    );
    const readyPath = join(seeded.fixtureDirectory, "capture-ready.json");
    const runtime = resolveNativeCaptureRuntime({
      [NATIVE_CAPTURE_ENV.enabled]: "1",
      [NATIVE_CAPTURE_ENV.target]: "packaged",
      [NATIVE_CAPTURE_ENV.fixtureId]: seeded.fixtureId,
      [NATIVE_CAPTURE_ENV.matrixVersion]: lifecycleMatrix.matrixVersion,
      [NATIVE_CAPTURE_ENV.databasePath]: seeded.databasePath,
      [NATIVE_CAPTURE_ENV.readyPath]: readyPath,
    });
    expect(runtime?.fixture.state).toBe("composer_request_changes_draft");
    const script = buildNativeCaptureDriverScript(runtime!);
    expect(script).toContain("Request changes");
    expect(script).toContain(NATIVE_FIXTURE_IDS.reviewCard);
    expect(script).toContain("native-file-text");
    expect(script).not.toContain("localhost");
  });

  test("launches a packaged child, captures an artifact, emits metadata, and cleans up", async () => {
    const root = temporaryDirectory("runner-integration");
    const outputDirectory = join(root, "artifacts");
    const executable = join(root, "launcher-test");
    const pidPath = join(root, "launcher.pid");
    writeFileSync(executable, `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const readyPath = process.env.KITTEN_NATIVE_CAPTURE_READY;
if (readyPath === undefined) throw new Error("missing ready path");
writeFileSync(process.env.KITTEN_NATIVE_TEST_PID_PATH, String(process.pid));
writeFileSync(readyPath, JSON.stringify({
  matrixVersion: process.env.KITTEN_NATIVE_MATRIX_VERSION,
  fixtureId: process.env.KITTEN_NATIVE_FIXTURE_ID,
  state: "empty_workspace",
  result: "ready"
}));
await new Promise(() => {});
`);
    chmodSync(executable, 0o755);
    const previousPidPath = process.env.KITTEN_NATIVE_TEST_PID_PATH;
    process.env.KITTEN_NATIVE_TEST_PID_PATH = pidPath;
    let buildCalls = 0;
    try {
      const manifest = await captureLifecycleMatrix({
        outputDirectory,
        fixtureIds: ["fx-v1-empty-workspace"],
        dependencies: {
          executable,
          async build() {
            buildCalls += 1;
          },
          async captureWindow(artifactPath) {
            writeFileSync(artifactPath, new Uint8Array([137, 80, 78, 71]));
          },
        },
      });
      expect(buildCalls).toBe(1);
      expect(manifest.entries).toHaveLength(1);
      expect(manifest.entries[0]).toMatchObject({
        fixtureId: "fx-v1-empty-workspace",
        state: "empty_workspace",
        result: "captured",
      });
      expect(readFileSync(join(outputDirectory, "manifest.json"), "utf8")).toContain(
        "\"buildIdentity\"",
      );
      const pid = Number(readFileSync(pidPath, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      if (previousPidPath === undefined) {
        delete process.env.KITTEN_NATIVE_TEST_PID_PATH;
      } else {
        process.env.KITTEN_NATIVE_TEST_PID_PATH = previousPidPath;
      }
    }
  });
});

class FakeChild implements ManagedChildProcess {
  readonly pid: number;
  readonly exited: Promise<number>;
  kills: NodeJS.Signals[] = [];
  #resolve!: (code: number) => void;

  constructor(pid: number) {
    this.pid = pid;
    this.exited = new Promise((resolveExit) => {
      this.#resolve = resolveExit;
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.kills.push(signal);
    this.#resolve(signal === "SIGKILL" ? 137 : 0);
  }
}

describe("native child process cleanup", () => {
  for (const outcome of ["success", "failure", "interruption"] as const) {
    test(`terminates packaged and capture children after ${outcome}`, async () => {
      const registry = new ChildProcessRegistry();
      const packaged = new FakeChild(100);
      const capture = new FakeChild(101);
      registry.add(packaged);
      registry.add(capture);
      const operation = async () => {
        if (outcome === "success") return "ok";
        throw new Error(outcome);
      };
      if (outcome === "success") {
        expect(await withChildProcessCleanup(registry, operation)).toBe("ok");
      } else {
        await expect(withChildProcessCleanup(registry, operation)).rejects.toThrow(outcome);
      }
      expect(packaged.kills).toEqual(["SIGTERM"]);
      expect(capture.kills).toEqual(["SIGTERM"]);
      expect(registry.size()).toBe(0);
    });
  }
});

function artifactEntry(
  fixture: (typeof lifecycleMatrix.entries)[number],
  buildIdentity: string,
  timestamp: string,
  hash: string,
): NativeArtifactManifestEntry {
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
    hash,
    artifact: `${fixture.fixtureId}.png`,
    result: "captured",
  };
}

function artifactFixture(): {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: NativeArtifactManifest;
} {
  const directory = temporaryDirectory("artifacts");
  const bytes = Buffer.from("native-png-fixture");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const buildIdentity = "build-native-test";
  const timestamp = new Date().toISOString();
  const entries = lifecycleMatrix.entries.map((fixture) => {
    writeFileSync(join(directory, `${fixture.fixtureId}.png`), bytes);
    return artifactEntry(fixture, buildIdentity, timestamp, hash);
  });
  const manifest: NativeArtifactManifest = {
    schemaVersion: 1,
    matrixVersion: lifecycleMatrix.matrixVersion,
    buildIdentity,
    generatedAt: timestamp,
    entries,
  };
  const manifestPath = join(directory, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath, manifest };
}

function writeManifest(path: string, manifest: NativeArtifactManifest): void {
  writeFileSync(path, JSON.stringify(manifest));
}

describe("native artifact metadata and completeness verification", () => {
  test("fails when the artifact manifest is missing", () => {
    expect(() => verifyNativeArtifacts(
      join(temporaryDirectory("missing-manifest"), "manifest.json"),
    )).toThrow("Missing native artifact manifest");
  });

  test("requires review plus matching matrix, dimensions, preferences, platform, build, timestamp, and hash", () => {
    const fixture = artifactFixture();
    expect(() => verifyNativeArtifacts(fixture.manifestPath)).toThrow("Unreviewed");
    reviewNativeArtifacts(fixture.manifestPath, {
      result: "pass",
      notes: "Reviewed packaged hierarchy, clipping, focus, status, and responsive behavior.",
    });
    expect(verifyNativeArtifacts(fixture.manifestPath).entries).toHaveLength(
      lifecycleMatrix.entries.length,
    );
  });

  test("fails missing and duplicate artifacts", () => {
    const fixture = artifactFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      entries: fixture.manifest.entries.slice(1),
    });
    expect(() => verifyNativeArtifacts(fixture.manifestPath, { requireReview: false }))
      .toThrow("Missing native artifacts");
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      entries: [
        ...fixture.manifest.entries.slice(0, -1),
        fixture.manifest.entries[0]!,
      ],
    });
    expect(() => verifyNativeArtifacts(fixture.manifestPath, { requireReview: false }))
      .toThrow("Duplicate native artifact fixture");
  });

  test("fails stale, zero-byte, hash-mismatched, and metadata-mismatched artifacts", () => {
    const stale = artifactFixture();
    const old = new Date(Date.now() - (
      lifecycleMatrix.artifactMaxAgeMinutes * 60_000 + 1
    )).toISOString();
    writeManifest(stale.manifestPath, {
      ...stale.manifest,
      entries: stale.manifest.entries.map((entry) => ({ ...entry, timestamp: old })),
    });
    expect(() => verifyNativeArtifacts(stale.manifestPath, { requireReview: false }))
      .toThrow("Stale native artifact");

    const zero = artifactFixture();
    writeFileSync(join(zero.directory, zero.manifest.entries[0]!.artifact), "");
    expect(() => verifyNativeArtifacts(zero.manifestPath, { requireReview: false }))
      .toThrow("Zero-byte native artifact");

    const hash = artifactFixture();
    writeFileSync(join(hash.directory, hash.manifest.entries[0]!.artifact), "changed");
    expect(() => verifyNativeArtifacts(hash.manifestPath, { requireReview: false }))
      .toThrow("Hash-mismatched native artifact");

    const metadata = artifactFixture();
    writeManifest(metadata.manifestPath, {
      ...metadata.manifest,
      entries: metadata.manifest.entries.map((entry, index) => (
        index === 0
          ? { ...entry, window: { ...entry.window, width: entry.window.width + 1 } }
          : entry
      )),
    });
    expect(() => verifyNativeArtifacts(metadata.manifestPath, { requireReview: false }))
      .toThrow("metadata mismatch");

    const platform = artifactFixture();
    writeManifest(platform.manifestPath, {
      ...platform.manifest,
      entries: platform.manifest.entries.map((entry, index) => (
        index === 0 ? { ...entry, platform: "browser-dev-server" } : entry
      )),
    });
    expect(() => verifyNativeArtifacts(platform.manifestPath, { requireReview: false }))
      .toThrow("metadata mismatch");
  });

  test("does not record repository paths, prompts, credentials, or workspace content", () => {
    const fixture = artifactFixture();
    const serialized = readFileSync(fixture.manifestPath, "utf8");
    for (const forbidden of [
      process.env.HOME ?? "__missing_home__",
      "worktreePath",
      "prompt",
      "credential",
      "secret",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
