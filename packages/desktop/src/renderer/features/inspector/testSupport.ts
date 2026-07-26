import type {
  ActivityEventId,
  ActivitySequence,
  AttemptGeneration,
  AttemptId,
  ProfileId,
  QuestionId,
} from "@kitten/engine";
import type { AttentionBlockerProjection } from "../../../attention/contracts.ts";
import type { AttemptInspectorProjection, CardInspectorProjection } from "../../../attempts/inspectorProjection.ts";
import { createFollowUpQueue, type FollowUpQueueId } from "../../../attempts/followUpQueue.ts";
import type { ReviewEvidenceManifest } from "../../../shared/rpc.ts";
import { workflowIds, type CardProjection, type ExecutionStatus } from "../../../workflow/workflowTypes.ts";

export const TEST_BOARD_ID = workflowIds.board("board-inspector-renderer");
export const TEST_CARD_ID = workflowIds.card("card-inspector-renderer");
export const TEST_ATTEMPT_ID = "attempt-inspector-renderer" as AttemptId;
export const TEST_GENERATION = 2 as AttemptGeneration;
export const TEST_BLOCKER_ID = "blocker-inspector-renderer" as QuestionId;
export const TEST_QUEUE_ID = "queue-inspector-renderer" as FollowUpQueueId;
export const TEST_EVIDENCE_ID = "evidence-inspector-renderer";
export const TEST_EVIDENCE_DIGEST = "a".repeat(64);

export function inspectorCard(executionStatus: ExecutionStatus = "running"): CardProjection {
  return {
    cardId: TEST_CARD_ID,
    boardId: TEST_BOARD_ID,
    stageId: workflowIds.stage("stage-doing"),
    title: "Implement supervision surface",
    description: "Keep durable evidence visible",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus,
    version: 7,
    createdAt: 10,
    updatedAt: 20,
  };
}

function evidence(sequence: number, occurredAt: number) {
  return {
    eventIds: [`activity-${sequence}` as ActivityEventId],
    firstSequence: sequence as ActivitySequence,
    lastSequence: sequence as ActivitySequence,
    firstOccurredAt: occurredAt,
    lastOccurredAt: occurredAt,
  };
}

export function inspectorAttempt(terminalOutcome: AttemptInspectorProjection["terminalOutcome"] = null): AttemptInspectorProjection {
  const entries: AttemptInspectorProjection["entries"] = [
    { kind: "agent", messageId: "agent-message", text: "I am inspecting the code.", evidence: evidence(2, 102) },
    { kind: "activity", activity: { kind: "plan", entries: [{ content: "Inspect", status: "completed" }] }, evidence: evidence(3, 103) },
    { kind: "user", messageId: "operator-message", text: "Keep the draft safe.", evidence: evidence(4, 104) },
    { kind: "tool", toolCallId: "tool-call", call: { toolCallId: "tool-call", kind: "read", status: "completed", locations: ["src/example.ts"] }, evidence: evidence(5, 105) },
    ...(terminalOutcome === null ? [] : [{ kind: "terminal" as const, outcome: terminalOutcome, evidence: evidence(6, 106) }]),
  ];
  return {
    schemaVersion: 1,
    attemptId: TEST_ATTEMPT_ID,
    boardId: TEST_BOARD_ID,
    cardId: TEST_CARD_ID,
    generation: TEST_GENERATION,
    context: {
      attemptId: TEST_ATTEMPT_ID,
      generation: TEST_GENERATION,
      capturedAt: 100,
      card: { cardId: TEST_CARD_ID, title: "Immutable card title", description: "Immutable description", version: 6 },
      stage: { stageId: workflowIds.stage("stage-doing"), label: "Doing" },
      workflow: { boardId: TEST_BOARD_ID, version: 4 },
      skill: { snapshotId: "snapshot-1", skillId: `skill:${"a".repeat(64)}`, digest: "a".repeat(64), name: "execute-task" },
      profile: {
        profileId: "profile-codex" as ProfileId,
        provider: "codex",
        model: "gpt-5",
        effort: "high",
        protocolVersion: 1,
        recipeId: "codex-acp",
        adapterVersion: "1.0.0",
      },
      repository: { verified: true, checkedAt: 90 },
      executionBindingId: "kw-renderer-test",
    },
    entries,
    terminalOutcome,
    nextSequence: (terminalOutcome === null ? 6 : 7) as ActivitySequence,
    updatedAt: terminalOutcome === null ? 105 : 106,
  };
}

export function attentionBlocker(active = true): AttentionBlockerProjection {
  return {
    schemaVersion: 1,
    blockerId: TEST_BLOCKER_ID,
    callId: "call-inspector-renderer",
    boardId: TEST_BOARD_ID,
    cardId: TEST_CARD_ID,
    attemptId: TEST_ATTEMPT_ID,
    generation: TEST_GENERATION,
    form: {
      title: "Choose the verification scope",
      context: "The agent cannot continue without this decision.",
      prompt: "Which verification gate should run?",
      fields: [
        {
          id: "scope",
          label: "Verification scope",
          required: true,
          mode: "single",
          options: [{ id: "focused", label: "Focused tests" }, { id: "full", label: "Full gate" }],
          allowsCustom: true,
        },
        { id: "notes", label: "Notes", required: false, mode: "text" },
      ],
    },
    active,
    outcome: active ? null : { kind: "skipped" },
    notification: { state: "delivered", attemptedAt: 111, failureCode: null },
    version: active ? 2 : 3,
    createdAt: 110,
    updatedAt: active ? 111 : 120,
    terminalAt: active ? null : 120,
  };
}

export function inspectorProjection(input: {
  readonly status?: ExecutionStatus;
  readonly terminalOutcome?: AttemptInspectorProjection["terminalOutcome"];
  readonly queue?: "none" | "active" | "settled";
  readonly blocker?: "none" | "active" | "settled";
  readonly revision?: number;
  readonly evidence?: boolean;
} = {}): CardInspectorProjection {
  const attempt = inspectorAttempt(input.terminalOutcome ?? null);
  const queue = input.queue === undefined || input.queue === "none"
    ? []
    : [createFollowUpQueue({
        boardId: TEST_BOARD_ID,
        cardId: TEST_CARD_ID,
        attemptId: TEST_ATTEMPT_ID,
        generation: TEST_GENERATION,
        queueId: TEST_QUEUE_ID,
        text: "Verify the renderer queue.",
        occurredAt: input.queue === "settled" ? 108 : 107,
      })];
  const blocker = input.blocker === undefined || input.blocker === "none"
    ? []
    : [attentionBlocker(input.blocker === "active")];
  return {
    schemaVersion: 3,
    cardId: TEST_CARD_ID,
    revision: input.revision ?? 12,
    card: inspectorCard(input.status ?? "running"),
    attempts: [attempt],
    attemptStates: [{
      attemptId: TEST_ATTEMPT_ID,
      generation: TEST_GENERATION,
      state: input.terminalOutcome ?? "running",
      failure: null,
      createdAt: 100,
      startedAt: 101,
      terminalAt: input.terminalOutcome === undefined || input.terminalOutcome === null ? null : 106,
    }],
    followUpQueues: queue,
    attentionBlockers: blocker,
    reviewEvidence: input.evidence === true ? [{
      evidenceId: TEST_EVIDENCE_ID,
      evidenceDigest: TEST_EVIDENCE_DIGEST,
      attemptId: TEST_ATTEMPT_ID,
      generation: TEST_GENERATION,
      worktreeBindingId: "binding-inspector-renderer",
      fileCount: 1,
      totalPatchBytes: 128,
      createdAt: 121,
    }] : [],
  };
}

export function reviewManifest(): ReviewEvidenceManifest {
  return {
    kind: "review_evidence_manifest",
    schemaVersion: 1,
    revision: 12,
    evidenceId: TEST_EVIDENCE_ID,
    boardId: TEST_BOARD_ID,
    cardId: TEST_CARD_ID,
    attemptId: TEST_ATTEMPT_ID,
    generation: TEST_GENERATION,
    worktreeBindingId: "binding-inspector-renderer",
    evidenceDigest: TEST_EVIDENCE_DIGEST,
    baseCommit: "base-commit",
    headCommit: "head-commit",
    policyVersion: 1,
    fileCount: 1,
    totalPatchBytes: 128,
    createdAt: 121,
    availability: {
      status: "available",
      evidenceId: TEST_EVIDENCE_ID,
      evidenceDigest: TEST_EVIDENCE_DIGEST,
    },
    files: [{
      fileId: "file-inspector-renderer",
      index: 0,
      status: "modified",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      oldMode: "100644",
      newMode: "100644",
      isBinary: false,
      additions: 4,
      deletions: 2,
      patchByteLength: 128,
      patchDigest: "b".repeat(64),
      contentDigest: null,
    }],
  };
}
