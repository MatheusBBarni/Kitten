import type { SkillSnapshot } from "../catalog/contracts.ts";
import type { EnsureCardWorktreeResult, WorktreeUnavailableReason } from "../worktrees/contracts.ts";
import type { BoardProjection, CardProjection, StageProjection } from "../workflow/workflowTypes.ts";
import type { CertifiedDirectAcpProfile, RepositoryReadinessEvidence } from "./contracts.ts";
import type { SchedulerAdmission } from "./scheduler.ts";

export type RunnableFailureCode =
  | "board_not_found"
  | "untrusted_repository"
  | "card_not_found"
  | "card_not_runnable"
  | "card_not_idle"
  | "stage_not_found"
  | "stage_unconfigured"
  | "invalid_stage_skill"
  | "invalid_skill_override"
  | "profile_unavailable"
  | "profile_not_ready"
  | "model_unavailable"
  | "effort_unavailable"
  | "worktree_unavailable"
  | "card_already_active"
  | "capacity_exhausted";

export interface RunnableFailure {
  readonly code: RunnableFailureCode;
  readonly message: string;
  readonly detail?: string;
}

export type RunnableResult =
  | { readonly runnable: true }
  | { readonly runnable: false; readonly reason: RunnableFailure };

export interface RunnableValidationInput {
  readonly board: BoardProjection | null;
  readonly card: CardProjection | null;
  readonly stage: StageProjection | null;
  readonly repository: RepositoryReadinessEvidence | null;
  readonly effectiveSkill: SkillSnapshot | null;
  readonly skillSource: "stage" | "override";
  readonly profile: CertifiedDirectAcpProfile | null;
  readonly worktree: EnsureCardWorktreeResult | null;
  readonly scheduler: SchedulerAdmission;
}

function blocked(code: RunnableFailureCode, message: string, detail?: string): RunnableResult {
  return { runnable: false, reason: { code, message, ...(detail === undefined ? {} : { detail }) } };
}

/** Pure, first-failure admission policy. The ordering is part of the user-facing contract. */
export function validateRunnable(input: RunnableValidationInput): RunnableResult {
  const { board, card, stage } = input;
  if (board === null) return blocked("board_not_found", "The card's board no longer exists.");
  if (input.repository === null || !input.repository.trusted || input.repository.canonicalPath !== board.repositoryPath) {
    return blocked(
      "untrusted_repository",
      "Verify and trust the repository again before starting this card.",
      input.repository?.message,
    );
  }
  if (card === null || card.boardId !== board.boardId) {
    return blocked("card_not_found", "The card no longer exists on this board.");
  }
  if (!card.runnable) return blocked("card_not_runnable", "Mark the card runnable before starting an attempt.");
  if (card.executionStatus !== "idle" && card.executionStatus !== "failed" && card.executionStatus !== "cancelled") {
    return blocked("card_not_idle", `Wait for the card's ${card.executionStatus} attempt to settle.`);
  }
  if (stage === null || stage.stageId !== card.stageId || stage.boardId !== board.boardId) {
    return blocked("stage_not_found", "Move the card to an existing Workflow Stage before starting it.");
  }
  if (!stage.configured || stage.defaultSkillId === null) {
    return blocked("stage_unconfigured", "Select a validated default Skill for this Workflow Stage.");
  }
  if (input.effectiveSkill === null) {
    return input.skillSource === "override"
      ? blocked("invalid_skill_override", "Select an available catalog Skill override or remove the override.")
      : blocked("invalid_stage_skill", "Select an available catalog Skill for this Workflow Stage.");
  }
  const expectedSkillId = card.skillOverrideId ?? stage.defaultSkillId;
  if (input.effectiveSkill.skillId !== expectedSkillId) {
    return input.skillSource === "override"
      ? blocked("invalid_skill_override", "The card's Skill override no longer resolves to its selected catalog identity.")
      : blocked("invalid_stage_skill", "The stage default no longer resolves to its selected catalog identity.");
  }
  if (
    input.profile === null
    || input.profile.provider !== card.provider
    || input.profile.readiness.profileId !== input.profile.profileId
  ) {
    return blocked("profile_unavailable", `Choose an available certified ${card.provider} Agent Profile.`);
  }
  if (!input.profile.readiness.ready) {
    return blocked("profile_not_ready", input.profile.readiness.message, input.profile.readiness.reason);
  }
  if (!input.profile.models.includes(card.model)) {
    return blocked("model_unavailable", `Choose a model supported by Agent Profile ${input.profile.profileId}.`, card.model);
  }
  if (!input.profile.efforts.includes(card.effort)) {
    return blocked("effort_unavailable", `Choose an effort supported by Agent Profile ${input.profile.profileId}.`, card.effort);
  }
  if (input.worktree === null || input.worktree.status === "unavailable") {
    const reason: WorktreeUnavailableReason = input.worktree?.reason ?? "unverified";
    return blocked("worktree_unavailable", worktreeMessage(reason), reason);
  }
  if (
    input.worktree.binding.cardId !== card.cardId
    || input.worktree.binding.boardId !== board.boardId
    || input.worktree.binding.repositoryRoot !== board.repositoryPath
    || input.worktree.binding.lifecycle !== "active"
  ) {
    return blocked("worktree_unavailable", "Reconcile the card-owned worktree before starting an attempt.", "unverified");
  }
  if (input.scheduler.status === "card_already_active") {
    return blocked("card_already_active", "This card already owns an active Run Attempt.");
  }
  if (input.scheduler.status === "capacity_exhausted") {
    return blocked("capacity_exhausted", "Wait for an active card to settle or raise the global execution limit.");
  }
  return { runnable: true };
}

function worktreeMessage(reason: WorktreeUnavailableReason): string {
  switch (reason) {
    case "dirty":
      return "Clean or review unexpected changes in the card-owned worktree before starting.";
    case "divergent":
    case "baseline_mismatch":
    case "parent_changed":
      return "Reconcile the card worktree baseline with the trusted repository before starting.";
    case "missing":
    case "removed":
      return "Provision the card-owned worktree before starting an attempt.";
    case "unmerged":
      return "Resolve unmerged worktree changes before starting an attempt.";
    default:
      return `Repair the card-owned worktree (${reason}) before starting an attempt.`;
  }
}
