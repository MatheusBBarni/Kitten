import {
  appendFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  assertWorkflowMeasurementEvent,
  BYTE_COUNT_BUCKETS,
  COUNT_BUCKETS,
  DURATION_BUCKETS,
  type ByteCountBucket,
  type CountBucket,
  type DurationBucket,
  type WorkflowMeasurementEvent,
} from "./lifecycleDiagnostics.ts";

export const WORKFLOW_MEASUREMENT_EVENT_NAMES = [
  "supervision_projection",
  "workflow_navigation",
  "evidence_capture",
  "evidence_revalidation",
  "review_read",
  "prompt_admission",
  "safe_boundary_dispatch",
  "review_disposition",
  "review_draft",
  "packaged_verification",
] as const;

export type WorkflowMeasurementEventName =
  (typeof WORKFLOW_MEASUREMENT_EVENT_NAMES)[number];

export interface WorkflowMeasurementStorage {
  append(event: WorkflowMeasurementEvent): void;
  read(): readonly unknown[];
}

export interface WorkflowMeasurementSummary {
  readonly schemaVersion: 1;
  readonly totalEvents: number;
  readonly events: readonly {
    readonly name: WorkflowMeasurementEventName;
    readonly count: number;
    readonly outcomes: Readonly<Record<string, number>>;
  }[];
  readonly duration: {
    readonly sampleCount: number;
    readonly p50: DurationBucket | null;
    readonly p95: DurationBucket | null;
  };
}

function boundedWhole(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

export function bucketDuration(milliseconds: number): DurationBucket {
  const value = boundedWhole(milliseconds);
  if (value < 10) return "lt_10ms";
  if (value < 50) return "10_49ms";
  if (value < 100) return "50_99ms";
  if (value < 500) return "100_499ms";
  if (value < 1_000) return "500_999ms";
  return "1s_plus";
}

export function bucketCount(count: number): CountBucket {
  const value = boundedWhole(count);
  if (value === 0) return "0";
  if (value === 1) return "1";
  if (value === 2) return "2";
  if (value <= 5) return "3_5";
  if (value <= 10) return "6_10";
  if (value <= 100) return "11_100";
  if (value <= 1_000) return "101_1000";
  return "1001_plus";
}

export function bucketBytes(bytes: number): ByteCountBucket {
  const value = boundedWhole(bytes);
  if (value === 0) return "0";
  if (value <= 1_024) return "1_1kib";
  if (value <= 64 * 1_024) return "1_64kib";
  if (value <= 1_024 * 1_024) return "64kib_1mib";
  if (value <= 8 * 1_024 * 1_024) return "1_8mib";
  if (value <= 64 * 1_024 * 1_024) return "8_64mib";
  return "64mib_plus";
}

function percentile(
  samples: readonly DurationBucket[],
  percentileValue: number,
): DurationBucket | null {
  if (samples.length === 0) return null;
  const ordered = [...samples].sort(
    (left, right) => DURATION_BUCKETS.indexOf(left) - DURATION_BUCKETS.indexOf(right),
  );
  const index = Math.max(
    0,
    Math.min(ordered.length - 1, Math.ceil(percentileValue * ordered.length) - 1),
  );
  return ordered[index] ?? null;
}

function summarize(
  inputs: readonly unknown[],
): WorkflowMeasurementSummary {
  const events: WorkflowMeasurementEvent[] = [];
  for (const input of inputs) {
    try {
      assertWorkflowMeasurementEvent(input);
      events.push(input);
    } catch {
      // Corrupt or obsolete local rows are excluded from bounded summaries.
    }
  }

  const durationSamples: DurationBucket[] = [];
  const summaries = WORKFLOW_MEASUREMENT_EVENT_NAMES.map((name) => {
    const matching = events.filter((event) => event.name === name);
    const outcomes: Record<string, number> = {};
    for (const event of matching) {
      outcomes[event.outcome] = (outcomes[event.outcome] ?? 0) + 1;
      if ("durationBucket" in event) {
        durationSamples.push(event.durationBucket);
      }
    }
    return {
      name,
      count: matching.length,
      outcomes: Object.freeze(
        Object.fromEntries(
          Object.entries(outcomes).sort(([left], [right]) => left.localeCompare(right)),
        ),
      ),
    };
  });

  return {
    schemaVersion: 1,
    totalEvents: events.length,
    events: summaries,
    duration: {
      sampleCount: durationSamples.length,
      p50: percentile(durationSamples, 0.5),
      p95: percentile(durationSamples, 0.95),
    },
  };
}

export function createJsonlWorkflowMeasurementStorage(
  path: string,
): WorkflowMeasurementStorage {
  if (path.trim().length === 0) {
    throw new Error("Workflow measurement storage path must not be blank");
  }
  return {
    append(event) {
      assertWorkflowMeasurementEvent(event);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      appendFileSync(path, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
    read() {
      try {
        const content = readFileSync(path, "utf8");
        return content
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          });
      } catch {
        return [];
      }
    },
  };
}

export interface WorkflowMeasurement {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  record(input: unknown): boolean;
  summary(): WorkflowMeasurementSummary;
}

export function createWorkflowMeasurement(options: {
  readonly storage: WorkflowMeasurementStorage;
  readonly enabled?: boolean;
}): WorkflowMeasurement {
  let enabled = options.enabled ?? false;
  return {
    isEnabled() {
      return enabled;
    },
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
    },
    record(input) {
      if (!enabled) return false;
      try {
        assertWorkflowMeasurementEvent(input);
        options.storage.append(input);
        return true;
      } catch {
        return false;
      }
    },
    summary() {
      try {
        return summarize(options.storage.read());
      } catch {
        return summarize([]);
      }
    },
  };
}

export function createMemoryWorkflowMeasurementStorage(
  initial: readonly unknown[] = [],
): WorkflowMeasurementStorage & { readonly events: unknown[] } {
  const events = [...initial];
  return {
    events,
    append(event) {
      events.push(event);
    },
    read() {
      return [...events];
    },
  };
}

export function isBoundedMeasurementBucket(
  value: string,
): boolean {
  return DURATION_BUCKETS.includes(value as DurationBucket)
    || COUNT_BUCKETS.includes(value as CountBucket)
    || BYTE_COUNT_BUCKETS.includes(value as ByteCountBucket);
}
