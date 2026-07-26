import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import type {
  PromptSubmissionSource,
  SupervisionStatus,
} from "../shared/rpc.ts";

export type LifecycleDiagnostic =
  | {
      readonly name: "attempt_recovered";
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
      readonly outcome: "interrupted";
    }
  | {
      readonly name: "review_disposition_recorded";
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly outcome: "completed" | "changes_requested";
    };

/** Deliberately closed content-free diagnostic surface. */
export interface LifecycleDiagnostics {
  record(diagnostic: LifecycleDiagnostic): void;
}

export const silentLifecycleDiagnostics: LifecycleDiagnostics = Object.freeze({
  record() {},
});

export const WORKFLOW_MEASUREMENT_SCHEMA_VERSION = 1 as const;

export const DURATION_BUCKETS = [
  "lt_10ms",
  "10_49ms",
  "50_99ms",
  "100_499ms",
  "500_999ms",
  "1s_plus",
] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const COUNT_BUCKETS = [
  "0",
  "1",
  "2",
  "3_5",
  "6_10",
  "11_100",
  "101_1000",
  "1001_plus",
] as const;
export type CountBucket = (typeof COUNT_BUCKETS)[number];

export const BYTE_COUNT_BUCKETS = [
  "0",
  "1_1kib",
  "1_64kib",
  "64kib_1mib",
  "1_8mib",
  "8_64mib",
  "64mib_plus",
] as const;
export type ByteCountBucket = (typeof BYTE_COUNT_BUCKETS)[number];

export const MEASUREMENT_REASONS = [
  "none",
  "stale_projection",
  "evidence_missing",
  "evidence_stale",
  "evidence_oversized",
  "evidence_unsafe",
  "worktree_binding_mismatch",
  "attempt_active",
  "blocker_active",
  "submission_interrupted",
  "invalid_prompt",
  "incomplete",
  "invalid_file",
  "storage_unavailable",
] as const;
export type MeasurementReason = (typeof MEASUREMENT_REASONS)[number];

export const PACKAGED_FIXTURES = [
  "empty_workspace",
  "multiple_projects",
  "needs_attention",
  "running_attempt",
  "failed_attempt",
  "ready_for_review",
  "stale_evidence",
  "request_changes",
  "board_return",
  "narrow_window",
  "settings",
] as const;
export type PackagedFixture = (typeof PACKAGED_FIXTURES)[number];

export type WorkflowMeasurementEvent =
  | {
      readonly schemaVersion: 1;
      readonly name: "supervision_projection";
      readonly outcome: "ok" | "failed";
      readonly durationBucket: DurationBucket;
      readonly itemCountBucket: CountBucket;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "workflow_navigation";
      readonly outcome: "opened" | "abandoned";
      readonly group: SupervisionStatus;
      readonly interactionCountBucket: CountBucket;
      readonly durationBucket: DurationBucket;
      readonly keyboardOnly: boolean;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "evidence_capture";
      readonly outcome: "available" | "unavailable" | "failed";
      readonly fileCountBucket: CountBucket;
      readonly byteCountBucket: ByteCountBucket;
      readonly reason: MeasurementReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "evidence_revalidation";
      readonly outcome: "current" | "stale" | "unavailable";
      readonly reason: MeasurementReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "review_read";
      readonly outcome: "ok" | "rejected" | "unavailable";
      readonly resource: "manifest" | "chunk";
      readonly reason: MeasurementReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "prompt_admission";
      readonly outcome:
        | "admitted"
        | "queued"
        | "duplicate"
        | "blocked"
        | "interrupted"
        | "rejected";
      readonly source: PromptSubmissionSource;
      readonly reason: MeasurementReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "safe_boundary_dispatch";
      readonly outcome: "dispatched" | "interrupted" | "failed";
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "review_disposition";
      readonly outcome: "completed" | "idempotent" | "rejected";
      readonly disposition: "approved" | "changes_requested";
      readonly reason: MeasurementReason;
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "review_draft";
      readonly outcome: "abandoned" | "dispatched";
    }
  | {
      readonly schemaVersion: 1;
      readonly name: "packaged_verification";
      readonly outcome: "passed" | "failed";
      readonly fixture: PackagedFixture;
      readonly keyboardOnly: boolean;
    };

export class WorkflowMeasurementValidationError extends Error {
  constructor(readonly field: string) {
    super(`Workflow measurement event rejected at ${field}`);
    this.name = "WorkflowMeasurementValidationError";
  }
}

function measurementRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowMeasurementValidationError("event");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WorkflowMeasurementValidationError("event");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new WorkflowMeasurementValidationError("fields");
  }
}

function declared<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): asserts value is Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new WorkflowMeasurementValidationError(field);
  }
}

function boolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new WorkflowMeasurementValidationError(field);
  }
}

function common(value: Record<string, unknown>): void {
  if (value.schemaVersion !== WORKFLOW_MEASUREMENT_SCHEMA_VERSION) {
    throw new WorkflowMeasurementValidationError("schemaVersion");
  }
}

export function assertWorkflowMeasurementEvent(
  input: unknown,
): asserts input is WorkflowMeasurementEvent {
  const value = measurementRecord(input);
  common(value);
  declared(value.name, [
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
  ], "name");

  switch (value.name) {
    case "supervision_projection":
      exactKeys(value, ["schemaVersion", "name", "outcome", "durationBucket", "itemCountBucket"]);
      declared(value.outcome, ["ok", "failed"], "outcome");
      declared(value.durationBucket, DURATION_BUCKETS, "durationBucket");
      declared(value.itemCountBucket, COUNT_BUCKETS, "itemCountBucket");
      return;
    case "workflow_navigation":
      exactKeys(value, [
        "schemaVersion",
        "name",
        "outcome",
        "group",
        "interactionCountBucket",
        "durationBucket",
        "keyboardOnly",
      ]);
      declared(value.outcome, ["opened", "abandoned"], "outcome");
      declared(value.group, [
        "needs_attention",
        "ready_for_review",
        "failed",
        "running",
        "settled",
      ], "group");
      declared(value.interactionCountBucket, COUNT_BUCKETS, "interactionCountBucket");
      declared(value.durationBucket, DURATION_BUCKETS, "durationBucket");
      boolean(value.keyboardOnly, "keyboardOnly");
      return;
    case "evidence_capture":
      exactKeys(value, [
        "schemaVersion",
        "name",
        "outcome",
        "fileCountBucket",
        "byteCountBucket",
        "reason",
      ]);
      declared(value.outcome, ["available", "unavailable", "failed"], "outcome");
      declared(value.fileCountBucket, COUNT_BUCKETS, "fileCountBucket");
      declared(value.byteCountBucket, BYTE_COUNT_BUCKETS, "byteCountBucket");
      declared(value.reason, MEASUREMENT_REASONS, "reason");
      return;
    case "evidence_revalidation":
      exactKeys(value, ["schemaVersion", "name", "outcome", "reason"]);
      declared(value.outcome, ["current", "stale", "unavailable"], "outcome");
      declared(value.reason, MEASUREMENT_REASONS, "reason");
      return;
    case "review_read":
      exactKeys(value, ["schemaVersion", "name", "outcome", "resource", "reason"]);
      declared(value.outcome, ["ok", "rejected", "unavailable"], "outcome");
      declared(value.resource, ["manifest", "chunk"], "resource");
      declared(value.reason, MEASUREMENT_REASONS, "reason");
      return;
    case "prompt_admission":
      exactKeys(value, ["schemaVersion", "name", "outcome", "source", "reason"]);
      declared(value.outcome, [
        "admitted",
        "queued",
        "duplicate",
        "blocked",
        "interrupted",
        "rejected",
      ], "outcome");
      declared(value.source, ["initial", "composer", "request_changes"], "source");
      declared(value.reason, MEASUREMENT_REASONS, "reason");
      return;
    case "safe_boundary_dispatch":
      exactKeys(value, ["schemaVersion", "name", "outcome"]);
      declared(value.outcome, ["dispatched", "interrupted", "failed"], "outcome");
      return;
    case "review_disposition":
      exactKeys(value, ["schemaVersion", "name", "outcome", "disposition", "reason"]);
      declared(value.outcome, ["completed", "idempotent", "rejected"], "outcome");
      declared(value.disposition, ["approved", "changes_requested"], "disposition");
      declared(value.reason, MEASUREMENT_REASONS, "reason");
      return;
    case "review_draft":
      exactKeys(value, ["schemaVersion", "name", "outcome"]);
      declared(value.outcome, ["abandoned", "dispatched"], "outcome");
      return;
    case "packaged_verification":
      exactKeys(value, ["schemaVersion", "name", "outcome", "fixture", "keyboardOnly"]);
      declared(value.outcome, ["passed", "failed"], "outcome");
      declared(value.fixture, PACKAGED_FIXTURES, "fixture");
      boolean(value.keyboardOnly, "keyboardOnly");
  }
}

export interface WorkflowMeasurementSink {
  record(event: WorkflowMeasurementEvent): boolean | void;
}

export const silentWorkflowMeasurement: WorkflowMeasurementSink = Object.freeze({
  record() {
    return false;
  },
});

export function recordWorkflowMeasurementSafely(
  sink: WorkflowMeasurementSink | undefined,
  event: WorkflowMeasurementEvent,
): void {
  try {
    sink?.record(event);
  } catch {
    // Optional product measurement cannot influence authoritative behavior.
  }
}
