import { describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import type { SkillSnapshot } from "../catalog/contracts.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import { workflowIds, type BoardProjection, type CardProjection, type StageProjection } from "../workflow/workflowTypes.ts";
import type { CertifiedDirectAcpProfile } from "./contracts.ts";
import { validateRunnable, type RunnableValidationInput } from "./runnableValidator.ts";

const BOARD_ID = workflowIds.board("board-1");
const CARD_ID = workflowIds.card("card-1");
const STAGE_ID = workflowIds.stage("stage-1");
const SKILL_ID = workflowIds.skill(`skill:${"a".repeat(64)}`);
const PROFILE_ID = "profile-1" as ProfileId;
const REPOSITORY = "/tmp/kitten-repository";

const board: BoardProjection = {
  boardId: BOARD_ID,
  repositoryPath: REPOSITORY,
  workflowVersion: 3,
  createdAt: 1,
  updatedAt: 3,
};
const stage: StageProjection = {
  stageId: STAGE_ID,
  boardId: BOARD_ID,
  label: "Doing",
  position: 0,
  defaultSkillId: SKILL_ID,
  configured: true,
  workflowVersion: 3,
  updatedAt: 3,
};
const card: CardProjection = {
  cardId: CARD_ID,
  boardId: BOARD_ID,
  stageId: STAGE_ID,
  title: "Task",
  description: "Description",
  provider: "codex",
  model: "gpt-5",
  effort: "high",
  skillOverrideId: null,
  runnable: true,
  executionStatus: "idle",
  version: 2,
  createdAt: 2,
  updatedAt: 3,
};
const skill: SkillSnapshot = {
  snapshotId: SKILL_ID,
  skillId: SKILL_ID,
  canonicalPath: "/tmp/skills/doing/SKILL.md",
  rootClass: "project",
  digest: "a".repeat(64),
  metadata: { name: "doing", description: "Do work", frontmatter: { name: "doing" } },
  content: "---\nname: doing\n---\nDo work",
};
const profile: CertifiedDirectAcpProfile = {
  profileId: PROFILE_ID,
  provider: "codex",
  models: ["gpt-5"],
  efforts: ["high"],
  readiness: { profileId: PROFILE_ID, ready: true, protocolVersion: 1 },
  certification: { recipeId: "codex-acp", adapterVersion: "1.2.3", checkedAt: 4 },
};
const binding: CardWorktreeBinding = {
  bindingVersion: 1,
  bindingId: "kw-validator001",
  boardId: BOARD_ID,
  cardId: CARD_ID,
  repositoryRoot: REPOSITORY,
  repositoryGitDir: `${REPOSITORY}/.git`,
  managedRoot: `${REPOSITORY}/.kitten/worktrees/cards`,
  worktreePath: `${REPOSITORY}/.kitten/worktrees/cards/kw-validator001`,
  branch: "kitten/card/kw-validator001",
  baselineBranch: "main",
  baselineCommit: "b".repeat(40),
  lifecycle: "active",
  reason: null,
  createdAt: 4,
  updatedAt: 4,
};

function valid(overrides: Partial<RunnableValidationInput> = {}): RunnableValidationInput {
  return {
    board,
    card,
    stage,
    repository: { trusted: true, canonicalPath: REPOSITORY, checkedAt: 4, message: "Repository verified" },
    effectiveSkill: skill,
    skillSource: "stage",
    profile,
    worktree: { status: "reused", binding },
    scheduler: { status: "available" },
    ...overrides,
  };
}

function code(input: RunnableValidationInput): string | null {
  const result = validateRunnable(input);
  return result.runnable ? null : result.reason.code;
}

describe("runnable validation", () => {
  test("returns deterministic actionable repository, Skill, profile, worktree, card, and capacity reasons", () => {
    const cases: readonly [string, RunnableValidationInput][] = [
      ["untrusted_repository", valid({ repository: { trusted: false, canonicalPath: REPOSITORY, checkedAt: 4, message: "Trust was revoked" } })],
      ["card_not_runnable", valid({ card: { ...card, runnable: false } })],
      ["invalid_stage_skill", valid({ effectiveSkill: null })],
      ["profile_unavailable", valid({ profile: null })],
      ["profile_not_ready", valid({ profile: { ...profile, readiness: { profileId: PROFILE_ID, ready: false, reason: "authentication_required", message: "Sign in to Codex." } } })],
      ["worktree_unavailable", valid({ worktree: { status: "unavailable", reason: "dirty" } })],
      ["card_already_active", valid({ scheduler: { status: "card_already_active" } })],
      ["capacity_exhausted", valid({ scheduler: { status: "capacity_exhausted" } })],
    ];
    expect(cases.map(([expected, input]) => [expected, code(input)])).toEqual(
      cases.map(([expected]) => [expected, expected]),
    );
    for (const [, input] of cases) {
      const result = validateRunnable(input);
      if (result.runnable) throw new Error("expected blocked result");
      expect(result.reason.message.length).toBeGreaterThan(10);
    }
  });

  test("distinguishes an invalid card override from an invalid stage default", () => {
    const override = workflowIds.skill(`skill:${"c".repeat(64)}`);
    expect(code(valid({
      card: { ...card, skillOverrideId: override },
      skillSource: "override",
      effectiveSkill: null,
    }))).toBe("invalid_skill_override");
    expect(code(valid({ effectiveSkill: null, skillSource: "stage" }))).toBe("invalid_stage_skill");
  });

  test("admits only the fully matched certified configuration", () => {
    expect(validateRunnable(valid())).toEqual({ runnable: true });
    expect(code(valid({ profile: { ...profile, models: ["other"] } }))).toBe("model_unavailable");
    expect(code(valid({ profile: { ...profile, efforts: ["low"] } }))).toBe("effort_unavailable");
  });
});
