import { describe, expect, test } from "bun:test";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  validateNormalizedAttemptEvent,
  type ActivityEventId,
  type AttemptId,
  type NormalizedAttemptActivity,
  type ProfileId,
} from "@kitten/engine";
import { workflowIds } from "../workflow/workflowTypes.ts";
import type { RunContext } from "./contracts.ts";
import {
  createAttemptInspectorProjection,
  projectAttemptActivity,
  validateAttemptInspectorProjection,
} from "./inspectorProjection.ts";

const ATTEMPT_ID = toOpaqueId<AttemptId>("attempt-inspector-1")!;
const GENERATION = toAttemptGeneration(1)!;
const BOARD_ID = workflowIds.board("board-inspector");
const CARD_ID = workflowIds.card("card-inspector");

function context(title = "Original card title"): RunContext {
  const digest = "a".repeat(64);
  return {
    schemaVersion: 1,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    capturedAt: 100,
    card: { cardId: CARD_ID, title, description: "Durable description", version: 3 },
    stage: { stageId: workflowIds.stage("stage-doing"), label: "Doing" },
    workflow: { boardId: BOARD_ID, version: 4 },
    skill: {
      snapshotId: workflowIds.skill(`skill:${digest}`),
      skillId: workflowIds.skill(`skill:${digest}`),
      canonicalPath: "/private/repository/.agents/skills/execute/SKILL.md",
      rootClass: "project",
      digest,
      metadata: { name: "execute", description: "Fixture", frontmatter: { name: "execute" } },
      content: "secret local workflow instructions",
    },
    profile: {
      profileId: "profile-codex" as ProfileId,
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      protocolVersion: 1,
      recipeId: "codex-acp",
      adapterVersion: "1.2.3",
      readinessCheckedAt: 80,
    },
    repository: {
      trusted: true,
      canonicalPath: "/private/repository",
      checkedAt: 80,
      message: "verified",
    },
    worktree: {
      bindingVersion: 1,
      bindingId: "kw-inspector0001",
      boardId: BOARD_ID,
      cardId: CARD_ID,
      repositoryRoot: "/private/repository",
      repositoryGitDir: "/private/repository/.git",
      managedRoot: "/private/repository/.kitten/worktrees/cards",
      worktreePath: "/private/repository/.kitten/worktrees/cards/kw-inspector0001",
      branch: "kitten/card/kw-inspector0001",
      baselineBranch: "main",
      baselineCommit: "b".repeat(40),
      lifecycle: "active",
      reason: null,
      createdAt: 80,
      updatedAt: 80,
    },
  };
}

function event(sequence: number, activity: NormalizedAttemptActivity) {
  return validateNormalizedAttemptEvent({
    eventId: toOpaqueId<ActivityEventId>(`activity-${sequence}`)!,
    attemptId: ATTEMPT_ID,
    generation: GENERATION,
    sequence: toActivitySequence(sequence)!,
    occurredAt: 100 + sequence,
    activity,
  });
}

describe("durable attempt inspector projection", () => {
  test("coalesces adjacent message chunks and tool updates without losing event evidence", () => {
    let projection = createAttemptInspectorProjection(context());
    for (const input of [
      event(2, { kind: "agent_message", messageId: "message-1", textDelta: "Hello" }),
      event(3, { kind: "agent_message", messageId: "message-1", textDelta: " world" }),
      event(4, { kind: "user_message", messageId: "message-2", text: "Continue" }),
      event(5, { kind: "tool_call", call: { toolCallId: "tool-1", kind: "execute", status: "in_progress" } }),
      event(6, { kind: "tool_call", call: { toolCallId: "tool-1", status: "completed", diff: { path: "src/a.ts", unified: "@@" } } }),
      event(7, { kind: "plan", entries: [{ content: "Verify", status: "completed" }] }),
      event(8, { kind: "attempt_state", state: "succeeded" }),
    ]) {
      projection = projectAttemptActivity(projection, input);
    }

    expect(projection.entries).toHaveLength(5);
    expect(projection.entries[0]).toMatchObject({
      kind: "agent",
      text: "Hello world",
      evidence: { eventIds: ["activity-2", "activity-3"], firstSequence: 2, lastSequence: 3 },
    });
    expect(projection.entries[2]).toMatchObject({
      kind: "tool",
      call: { toolCallId: "tool-1", kind: "execute", status: "completed", diff: { path: "src/a.ts" } },
      evidence: { eventIds: ["activity-5", "activity-6"] },
    });
    expect(projection.entries.map((entry) => entry.kind)).toEqual([
      "agent", "user", "tool", "activity", "terminal",
    ]);
    expect(projection.terminalOutcome).toBe("succeeded");
    expect(Number(projection.nextSequence)).toBe(9);
    expect(validateAttemptInspectorProjection(JSON.parse(JSON.stringify(projection)))).toEqual(projection);
  });

  test("keeps immutable Run Context evidence content-minimized across later projection steps", () => {
    let projection = createAttemptInspectorProjection(context());
    projection = projectAttemptActivity(projection, event(2, {
      kind: "agent_message", messageId: "message-1", textDelta: "Evidence",
    }));

    expect(projection.context.card.title).toBe("Original card title");
    expect(projection.context.executionBindingId).toBe("kw-inspector0001");
    const serialized = JSON.stringify(projection.context);
    expect(serialized).not.toContain("/private/repository");
    expect(serialized).not.toContain("secret local workflow instructions");
    expect(serialized).not.toContain("worktree");
    expect(createAttemptInspectorProjection(context("Changed later")).context.card.title).toBe("Changed later");
    expect(projection.context.card.title).toBe("Original card title");
    expect(Object.isFrozen(projection.context)).toBeTrue();
  });

  test("rejects mismatched sequence, identity, and post-terminal projection mutation", () => {
    const initial = createAttemptInspectorProjection(context());
    expect(() => projectAttemptActivity(initial, event(3, {
      kind: "agent_message", messageId: "message-1", textDelta: "gap",
    }))).toThrow("identity or sequence");
    const terminal = projectAttemptActivity(initial, event(2, { kind: "attempt_state", state: "cancelled" }));
    expect(() => projectAttemptActivity(terminal, event(3, {
      kind: "agent_message", messageId: "message-2", textDelta: "late",
    }))).toThrow("Terminal inspector projections are immutable");
  });
});
