import type {
  AttemptGeneration,
  AttemptId,
  CertifiedProfileReadiness,
  DirectAcpAttemptState,
  ProfileId,
} from "@kitten/engine";
import type { SkillSnapshot } from "../catalog/contracts.ts";
import type { CardWorktreeBinding } from "../worktrees/contracts.ts";
import { validateCardWorktreeBinding } from "../worktrees/contracts.ts";
import type { BoardId, CardId, StageId } from "../workflow/workflowTypes.ts";

export interface CertifiedDirectAcpProfile {
  readonly profileId: ProfileId;
  readonly provider: string;
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  readonly readiness: CertifiedProfileReadiness;
  readonly certification: {
    readonly recipeId: string;
    readonly adapterVersion: string;
    readonly checkedAt: number;
  };
}

export interface RepositoryReadinessEvidence {
  readonly trusted: boolean;
  readonly canonicalPath: string;
  readonly checkedAt: number;
  readonly message: string;
}

export type AttemptStartupFailureCode =
  | "connection_failed"
  | "session_start_failed"
  | "startup_commit_failed";

export interface AttemptStartupFailure {
  readonly code: AttemptStartupFailureCode;
  readonly message: string;
  readonly occurredAt: number;
}

export interface AttemptProjection {
  readonly attemptId: AttemptId;
  readonly boardId: BoardId;
  readonly cardId: CardId;
  readonly generation: AttemptGeneration;
  readonly state: DirectAcpAttemptState;
  readonly sessionId: string | null;
  readonly failure: AttemptStartupFailure | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly terminalAt: number | null;
}

export interface RunContext {
  readonly schemaVersion: 1;
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly capturedAt: number;
  readonly card: {
    readonly cardId: CardId;
    readonly title: string;
    readonly description: string;
    readonly version: number;
  };
  readonly stage: {
    readonly stageId: StageId;
    readonly label: string;
  };
  readonly workflow: {
    readonly boardId: BoardId;
    readonly version: number;
  };
  readonly skill: SkillSnapshot;
  readonly profile: {
    readonly profileId: ProfileId;
    readonly provider: string;
    readonly model: string;
    readonly effort: string;
    readonly protocolVersion: number;
    readonly recipeId: string;
    readonly adapterVersion: string;
    readonly readinessCheckedAt: number;
  };
  readonly repository: RepositoryReadinessEvidence;
  readonly worktree: CardWorktreeBinding;
}

const STATES: readonly DirectAcpAttemptState[] = [
  "created", "starting", "running", "needs_attention", "succeeded", "failed", "cancelled", "interrupted",
];
const FAILURE_CODES: readonly AttemptStartupFailureCode[] = [
  "connection_failed", "session_start_failed", "startup_commit_failed",
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  return value === null ? null : integer(value, label);
}

export function validateAttemptProjection(input: unknown): AttemptProjection {
  const value = record(input, "attempt projection");
  const state = nonEmpty(value.state, "attempt state") as DirectAcpAttemptState;
  if (!STATES.includes(state)) throw new Error("attempt state is unsupported");
  const sessionId = value.sessionId === null ? null : nonEmpty(value.sessionId, "attempt sessionId");
  const failureValue = value.failure;
  let failure: AttemptStartupFailure | null = null;
  if (failureValue !== null) {
    const parsed = record(failureValue, "attempt failure");
    const code = nonEmpty(parsed.code, "attempt failure code") as AttemptStartupFailureCode;
    if (!FAILURE_CODES.includes(code)) throw new Error("attempt failure code is unsupported");
    failure = {
      code,
      message: nonEmpty(parsed.message, "attempt failure message"),
      occurredAt: integer(parsed.occurredAt, "attempt failure occurredAt"),
    };
  }
  const createdAt = integer(value.createdAt, "attempt createdAt");
  const startedAt = nullableInteger(value.startedAt, "attempt startedAt");
  const terminalAt = nullableInteger(value.terminalAt, "attempt terminalAt");
  if (startedAt !== null && startedAt < createdAt) throw new Error("attempt startedAt precedes creation");
  if (terminalAt !== null && terminalAt < createdAt) throw new Error("attempt terminalAt precedes creation");
  if (state === "running" && sessionId === null) throw new Error("running attempt requires a sessionId");
  if (state === "failed" && failure === null) throw new Error("failed attempt requires failure evidence");
  return {
    attemptId: nonEmpty(value.attemptId, "attemptId") as AttemptId,
    boardId: nonEmpty(value.boardId, "attempt boardId") as BoardId,
    cardId: nonEmpty(value.cardId, "attempt cardId") as CardId,
    generation: integer(value.generation, "attempt generation") as AttemptGeneration,
    state,
    sessionId,
    failure,
    createdAt,
    startedAt,
    terminalAt,
  };
}

export function validateRunContext(input: unknown): RunContext {
  const value = record(input, "Run Context");
  const card = record(value.card, "Run Context card");
  const stage = record(value.stage, "Run Context stage");
  const workflow = record(value.workflow, "Run Context workflow");
  const skill = record(value.skill, "Run Context skill");
  const metadata = record(skill.metadata, "Run Context Skill metadata");
  const profile = record(value.profile, "Run Context profile");
  const repository = record(value.repository, "Run Context repository");
  const frontmatter = record(metadata.frontmatter, "Run Context Skill frontmatter");
  if (value.schemaVersion !== 1) throw new Error("Run Context schemaVersion must be 1");
  if (repository.trusted !== true) throw new Error("Run Context repository must be trusted");
  if (typeof card.description !== "string") throw new Error("Run Context description is invalid");
  if (typeof metadata.description !== "string") throw new Error("Run Context Skill description is invalid");
  if (skill.rootClass !== "project" && skill.rootClass !== "user") {
    throw new Error("Run Context Skill rootClass is invalid");
  }
  const parsed: RunContext = {
    schemaVersion: 1,
    attemptId: nonEmpty(value.attemptId, "Run Context attemptId") as AttemptId,
    generation: integer(value.generation, "Run Context generation") as AttemptGeneration,
    capturedAt: integer(value.capturedAt, "Run Context capturedAt"),
    card: {
      cardId: nonEmpty(card.cardId, "Run Context cardId") as CardId,
      title: nonEmpty(card.title, "Run Context title"),
      description: card.description,
      version: integer(card.version, "Run Context card version"),
    },
    stage: {
      stageId: nonEmpty(stage.stageId, "Run Context stageId") as StageId,
      label: nonEmpty(stage.label, "Run Context stage label"),
    },
    workflow: {
      boardId: nonEmpty(workflow.boardId, "Run Context boardId") as BoardId,
      version: integer(workflow.version, "Run Context workflow version"),
    },
    skill: {
      snapshotId: nonEmpty(skill.snapshotId, "Run Context Skill snapshotId") as SkillSnapshot["snapshotId"],
      skillId: nonEmpty(skill.skillId, "Run Context Skill skillId") as SkillSnapshot["skillId"],
      canonicalPath: nonEmpty(skill.canonicalPath, "Run Context Skill path"),
      rootClass: skill.rootClass,
      digest: nonEmpty(skill.digest, "Run Context Skill digest"),
      metadata: {
        name: nonEmpty(metadata.name, "Run Context Skill name"),
        description: metadata.description,
        frontmatter: Object.fromEntries(Object.entries(frontmatter).map(([key, entry]) => [key, nonEmpty(entry, `Run Context Skill frontmatter ${key}`)])),
      },
      content: nonEmpty(skill.content, "Run Context Skill content"),
    },
    profile: {
      profileId: nonEmpty(profile.profileId, "Run Context profileId") as ProfileId,
      provider: nonEmpty(profile.provider, "Run Context provider"),
      model: nonEmpty(profile.model, "Run Context model"),
      effort: nonEmpty(profile.effort, "Run Context effort"),
      protocolVersion: integer(profile.protocolVersion, "Run Context protocolVersion"),
      recipeId: nonEmpty(profile.recipeId, "Run Context recipeId"),
      adapterVersion: nonEmpty(profile.adapterVersion, "Run Context adapterVersion"),
      readinessCheckedAt: integer(profile.readinessCheckedAt, "Run Context readinessCheckedAt"),
    },
    repository: {
      trusted: true,
      canonicalPath: nonEmpty(repository.canonicalPath, "Run Context repository path"),
      checkedAt: integer(repository.checkedAt, "Run Context repository checkedAt"),
      message: nonEmpty(repository.message, "Run Context repository message"),
    },
    worktree: validateCardWorktreeBinding(value.worktree),
  };
  if (parsed.card.cardId !== parsed.worktree.cardId || parsed.workflow.boardId !== parsed.worktree.boardId) {
    throw new Error("Run Context worktree does not match card and board");
  }
  return deepFreeze(parsed);
}

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}
