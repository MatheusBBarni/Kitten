import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bucketBytes,
  bucketCount,
  bucketDuration,
  createJsonlWorkflowMeasurementStorage,
  createMemoryWorkflowMeasurementStorage,
  createWorkflowMeasurement,
  isBoundedMeasurementBucket,
} from "./workflowMeasurement.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function projectionEvent(
  durationBucket: ReturnType<typeof bucketDuration>,
  outcome: "ok" | "failed" = "ok",
) {
  return {
    schemaVersion: 1 as const,
    name: "supervision_projection" as const,
    outcome,
    durationBucket,
    itemCountBucket: "1" as const,
  };
}

describe("local workflow measurement", () => {
  test("records nothing until explicitly enabled and stops immediately after disable", () => {
    const storage = createMemoryWorkflowMeasurementStorage();
    const measurement = createWorkflowMeasurement({ storage });

    expect(measurement.isEnabled()).toBeFalse();
    expect(measurement.record(projectionEvent("lt_10ms"))).toBeFalse();
    expect(storage.events).toEqual([]);

    measurement.setEnabled(true);
    expect(measurement.record(projectionEvent("10_49ms"))).toBeTrue();
    measurement.setEnabled(false);
    expect(measurement.record(projectionEvent("50_99ms"))).toBeFalse();
    expect(storage.events).toEqual([projectionEvent("10_49ms")]);
  });

  test("clamps durations, counts, and bytes into fixed bounded buckets", () => {
    expect([
      bucketDuration(-1),
      bucketDuration(9),
      bucketDuration(10),
      bucketDuration(50),
      bucketDuration(100),
      bucketDuration(500),
      bucketDuration(Number.POSITIVE_INFINITY),
    ]).toEqual([
      "lt_10ms",
      "lt_10ms",
      "10_49ms",
      "50_99ms",
      "100_499ms",
      "500_999ms",
      "1s_plus",
    ]);
    expect([
      bucketCount(Number.NaN),
      bucketCount(1),
      bucketCount(2),
      bucketCount(5),
      bucketCount(10),
      bucketCount(100),
      bucketCount(1_000),
      bucketCount(Number.POSITIVE_INFINITY),
    ]).toEqual(["0", "1", "2", "3_5", "6_10", "11_100", "101_1000", "1001_plus"]);
    expect([
      bucketBytes(0),
      bucketBytes(1_024),
      bucketBytes(64 * 1_024),
      bucketBytes(1_024 * 1_024),
      bucketBytes(8 * 1_024 * 1_024),
      bucketBytes(64 * 1_024 * 1_024),
      bucketBytes(Number.POSITIVE_INFINITY),
    ]).toEqual([
      "0",
      "1_1kib",
      "1_64kib",
      "64kib_1mib",
      "1_8mib",
      "8_64mib",
      "64mib_plus",
    ]);
    expect(isBoundedMeasurementBucket("1s_plus")).toBeTrue();
    expect(isBoundedMeasurementBucket("private raw duration")).toBeFalse();
  });

  test("computes deterministic p50, p95, and outcome counts from fixed samples", () => {
    const storage = createMemoryWorkflowMeasurementStorage([
      projectionEvent("1s_plus", "failed"),
      projectionEvent("lt_10ms"),
      projectionEvent("100_499ms"),
      projectionEvent("10_49ms"),
      projectionEvent("50_99ms"),
      { schemaVersion: 1, name: "unknown", outcome: "raw" },
      null,
    ]);
    const summary = createWorkflowMeasurement({ storage }).summary();
    expect(summary.totalEvents).toBe(5);
    expect(summary.duration).toEqual({
      sampleCount: 5,
      p50: "50_99ms",
      p95: "1s_plus",
    });
    expect(summary.events.find(({ name }) => name === "supervision_projection")).toEqual({
      name: "supervision_projection",
      count: 5,
      outcomes: { failed: 1, ok: 4 },
    });
    expect(summary.events.find(({ name }) => name === "review_read")?.count).toBe(0);
  });

  test("swallows recorder and reader failures without exposing storage errors", () => {
    const measurement = createWorkflowMeasurement({
      enabled: true,
      storage: {
        append() {
          throw new Error("secret disk path");
        },
        read() {
          throw new Error("secret disk path");
        },
      },
    });
    expect(measurement.record(projectionEvent("lt_10ms"))).toBeFalse();
    expect(measurement.summary()).toMatchObject({
      totalEvents: 0,
      duration: { sampleCount: 0, p50: null, p95: null },
    });
  });

  test("creates a private local JSONL file only after opt-in and ignores malformed rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-measurement-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "workflow-measurement.jsonl");
    const storage = createJsonlWorkflowMeasurementStorage(path);
    const measurement = createWorkflowMeasurement({ storage });

    measurement.record(projectionEvent("lt_10ms"));
    expect(existsSync(path)).toBeFalse();

    measurement.setEnabled(true);
    measurement.record(projectionEvent("10_49ms"));
    expect(JSON.parse(readFileSync(path, "utf8").trim())).toEqual(
      projectionEvent("10_49ms"),
    );
    expect(storage.read()).toEqual([projectionEvent("10_49ms")]);
    expect(createJsonlWorkflowMeasurementStorage(join(directory, "missing.jsonl")).read()).toEqual([]);
    expect(() => createJsonlWorkflowMeasurementStorage("   ")).toThrow("must not be blank");
  });
});
