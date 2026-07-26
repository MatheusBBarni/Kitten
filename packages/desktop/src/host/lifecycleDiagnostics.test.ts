import { describe, expect, test } from "bun:test";
import {
  assertWorkflowMeasurementEvent,
  recordWorkflowMeasurementSafely,
  WorkflowMeasurementValidationError,
  type WorkflowMeasurementEvent,
} from "./lifecycleDiagnostics.ts";

const validEvents: readonly WorkflowMeasurementEvent[] = [
  {
    schemaVersion: 1,
    name: "supervision_projection",
    outcome: "ok",
    durationBucket: "10_49ms",
    itemCountBucket: "3_5",
  },
  {
    schemaVersion: 1,
    name: "workflow_navigation",
    outcome: "opened",
    group: "needs_attention",
    interactionCountBucket: "2",
    durationBucket: "50_99ms",
    keyboardOnly: true,
  },
  {
    schemaVersion: 1,
    name: "evidence_capture",
    outcome: "available",
    fileCountBucket: "6_10",
    byteCountBucket: "1_64kib",
    reason: "none",
  },
  {
    schemaVersion: 1,
    name: "evidence_revalidation",
    outcome: "stale",
    reason: "evidence_stale",
  },
  {
    schemaVersion: 1,
    name: "review_read",
    outcome: "rejected",
    resource: "chunk",
    reason: "evidence_oversized",
  },
  {
    schemaVersion: 1,
    name: "prompt_admission",
    outcome: "queued",
    source: "composer",
    reason: "none",
  },
  {
    schemaVersion: 1,
    name: "safe_boundary_dispatch",
    outcome: "interrupted",
  },
  {
    schemaVersion: 1,
    name: "review_disposition",
    outcome: "completed",
    disposition: "approved",
    reason: "none",
  },
  {
    schemaVersion: 1,
    name: "review_draft",
    outcome: "abandoned",
  },
  {
    schemaVersion: 1,
    name: "packaged_verification",
    outcome: "passed",
    fixture: "ready_for_review",
    keyboardOnly: false,
  },
];

describe("workflow measurement event schema", () => {
  test("accepts every declared event shape", () => {
    for (const event of validEvents) {
      expect(() => assertWorkflowMeasurementEvent(event)).not.toThrow();
    }
  });

  test("rejects every forbidden content category as an undeclared field", () => {
    const forbidden = [
      "prompt",
      "response",
      "title",
      "code",
      "diff",
      "filename",
      "path",
      "repository",
      "branch",
      "modelOutput",
      "toolArguments",
      "secret",
      "rawError",
    ] as const;
    for (const field of forbidden) {
      expect(() => assertWorkflowMeasurementEvent({
        ...validEvents[0],
        [field]: "private content",
      })).toThrow(WorkflowMeasurementValidationError);
    }
  });

  test("rejects open strings, raw numbers, invalid versions, and non-plain inputs", () => {
    expect(() => assertWorkflowMeasurementEvent({
      ...validEvents[0],
      outcome: "private error detail",
    })).toThrow("outcome");
    expect(() => assertWorkflowMeasurementEvent({
      ...validEvents[0],
      durationBucket: 53,
    })).toThrow("durationBucket");
    expect(() => assertWorkflowMeasurementEvent({
      ...validEvents[0],
      schemaVersion: 2,
    })).toThrow("schemaVersion");
    expect(() => assertWorkflowMeasurementEvent(null)).toThrow("event");
    expect(() => assertWorkflowMeasurementEvent([])).toThrow("event");
    expect(() => assertWorkflowMeasurementEvent(new Date())).toThrow("event");
    expect(() => assertWorkflowMeasurementEvent({
      schemaVersion: 1,
      name: "unknown_event",
    })).toThrow("name");
  });

  test("isolates a throwing optional sink", () => {
    expect(() => recordWorkflowMeasurementSafely({
      record() {
        throw new Error("local disk failed");
      },
    }, validEvents[0]!)).not.toThrow();
    expect(() => recordWorkflowMeasurementSafely(undefined, validEvents[0]!)).not.toThrow();
  });
});
