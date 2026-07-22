import type { ProjectionDelta } from "../persistence/eventJournal.ts";

declare const workflowIdBrand: unique symbol;

type WorkflowId<Kind extends string> = string & {
  readonly [workflowIdBrand]: Kind;
};

export type BoardId = WorkflowId<"board">;
export type StageId = WorkflowId<"stage">;
export type CardId = WorkflowId<"card">;
export type SkillId = WorkflowId<"skill">;
export type MutationId = WorkflowId<"mutation">;

function id<Kind extends string>(value: string, label: Kind): WorkflowId<Kind> {
  if (value.trim().length === 0) throw new Error(`${label} ID must not be empty`);
  return value as WorkflowId<Kind>;
}

export const workflowIds = {
  board: (value: string): BoardId => id(value, "board"),
  stage: (value: string): StageId => id(value, "stage"),
  card: (value: string): CardId => id(value, "card"),
  skill: (value: string): SkillId => id(value, "skill"),
  mutation: (value: string): MutationId => id(value, "mutation"),
} as const;

export type ExecutionStatus =
  | "idle"
  | "running"
  | "needs_attention"
  | "ready_for_review"
  | "completed"
  | "failed"
  | "cancelled";

export interface BoardProjection {
  readonly boardId: BoardId;
  readonly repositoryPath: string;
  readonly workflowVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface StageProjection {
  readonly stageId: StageId;
  readonly boardId: BoardId;
  readonly label: string;
  readonly position: number;
  readonly defaultSkillId: SkillId | null;
  readonly configured: boolean;
  readonly workflowVersion: number;
  readonly updatedAt: number;
}

export interface EdgeProjection {
  readonly boardId: BoardId;
  readonly sourceStageId: StageId;
  readonly targetStageId: StageId;
  readonly workflowVersion: number;
}

export interface CardProjection {
  readonly cardId: CardId;
  readonly boardId: BoardId;
  readonly stageId: StageId;
  readonly title: string;
  readonly description: string;
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly skillOverrideId: SkillId | null;
  readonly runnable: boolean;
  readonly executionStatus: ExecutionStatus;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface WorkflowMutation {
  readonly mutationId: MutationId;
}

interface VersionedWorkflowMutation extends WorkflowMutation {
  readonly boardId: BoardId;
  readonly expectedWorkflowVersion: number;
}

interface VersionedCardMutation extends VersionedWorkflowMutation {
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
}

export type WorkflowCommand =
  | (WorkflowMutation & {
      readonly kind: "bind_repository";
      readonly boardId: BoardId;
      readonly repositoryPath: string;
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "create_stage";
      readonly stageId: StageId;
      readonly label: string;
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "update_stage";
      readonly stageId: StageId;
      readonly label: string;
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "assign_stage_skill";
      readonly stageId: StageId;
      readonly defaultSkillId: SkillId | null;
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "connect_stages";
      readonly edges: readonly {
        readonly sourceStageId: StageId;
        readonly targetStageId: StageId;
      }[];
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "reorder_stages";
      readonly orderedStageIds: readonly StageId[];
    })
  | (VersionedWorkflowMutation & {
      readonly kind: "create_card";
      readonly cardId: CardId;
      readonly stageId: StageId;
      readonly title: string;
      readonly description: string;
      readonly provider: string;
      readonly model: string;
      readonly effort: string;
      readonly skillOverrideId: SkillId | null;
      readonly runnable: boolean;
    })
  | (Omit<VersionedCardMutation, "expectedWorkflowVersion"> & {
      readonly kind: "update_card";
      readonly title: string;
      readonly description: string;
      readonly provider: string;
      readonly model: string;
      readonly effort: string;
      readonly skillOverrideId: SkillId | null;
      readonly runnable: boolean;
    })
  | (Omit<VersionedCardMutation, "expectedWorkflowVersion"> & {
      readonly kind: "set_card_execution_status";
      readonly executionStatus: Exclude<ExecutionStatus, "ready_for_review" | "completed">;
    })
  | (VersionedCardMutation & {
      readonly kind: "move_card";
      readonly targetStageId: StageId;
    })
  | (VersionedCardMutation & {
      readonly kind: "record_agent_success";
    });

export type WorkflowCommandKind = WorkflowCommand["kind"];

export type WorkflowConflict =
  | {
      readonly kind: "stale_workflow";
      readonly boardId: BoardId;
      readonly expectedVersion: number;
      readonly actualVersion: number;
    }
  | {
      readonly kind: "stale_card";
      readonly cardId: CardId;
      readonly expectedVersion: number;
      readonly actualVersion: number;
    };

export type WorkflowRejectionKind =
  | "board_not_found"
  | "stage_not_found"
  | "card_not_found"
  | "duplicate_stage"
  | "duplicate_card"
  | "invalid_repository"
  | "invalid_label"
  | "invalid_card"
  | "invalid_workflow"
  | "invalid_stage_order"
  | "invalid_execution_status"
  | "stage_locked"
  | "not_immediate_successor"
  | "mutation_identity_conflict";

export interface WorkflowRejection {
  readonly kind: WorkflowRejectionKind;
  readonly message: string;
}

export type WorkflowCommandResult =
  | {
      readonly status: "committed";
      readonly mutationId: MutationId;
      readonly delta: ProjectionDelta;
    }
  | {
      readonly status: "idempotent";
      readonly mutationId: MutationId;
      readonly eventId: string;
    }
  | {
      readonly status: "conflict";
      readonly mutationId: MutationId;
      readonly conflict: WorkflowConflict;
    }
  | {
      readonly status: "rejected";
      readonly mutationId: MutationId;
      readonly rejection: WorkflowRejection;
    };
