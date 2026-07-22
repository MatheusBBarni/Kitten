import type { RPCSchema } from "electrobun/bun";
import type { ActivitySequence, AttemptGeneration, AttemptId } from "@kitten/engine";
import type {
  AttemptInspectorProjection,
  CardInspectorProjection,
} from "../attempts/inspectorProjection.ts";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";
import type {
  BoardProjection,
  CardProjection,
  EdgeProjection,
  StageProjection,
  WorkflowCommand,
  WorkflowConflict,
  WorkflowRejection,
} from "../workflow/workflowTypes.ts";
import type { CatalogProjection } from "../persistence/eventJournal.ts";
import type {
  ConfirmQueuedFollowUpInput,
  QueueFollowUpInput,
  RemoveQueuedFollowUpInput,
} from "../attempts/attemptCoordinator.ts";
import type {
  AnswerAttentionRpcInput,
  FollowUpRpcRequest,
  FollowUpRpcResultEnvelope,
  InspectorCommandResultEnvelope,
  InspectorRpcRequest,
  ReviewCardRpcEnvelope,
  ReviewRpcRequest,
  StartAttemptRpcInput,
} from "../host/desktopRpc.ts";
import type { ReviewCardInput } from "../host/reviewDisposition.ts";
import type {
  DesktopSettingsProjection,
  SetExecutionLimitInput,
  SettingsCommandEnvelope,
  SettingsCommandRequest,
  SettingsCommandResult,
  SettingsEnvelope,
  SettingsQueryResult,
  SettingsSection,
  SettingsTheme,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "./desktopRpc.ts";
export type {
  AnswerAttentionRpcInput,
  FollowUpRpcResultEnvelope,
  InspectorCommandResultEnvelope,
  ReviewCardRpcEnvelope,
  StartAttemptRpcInput,
} from "../host/desktopRpc.ts";
export type { ReviewCardInput } from "../host/reviewDisposition.ts";
export type {
  DesktopSettingsProjection,
  DesktopSettingsRpc,
  FutureCardProfileDefaults,
  SetExecutionLimitInput,
  SettingsCommandEnvelope,
  SettingsCommandRequest,
  SettingsCommandResult,
  SettingsEnvelope,
  SettingsProfileProjection,
  SettingsQueryResult,
  SettingsSection,
  SettingsTheme,
  SettingsUnavailable,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "./desktopRpc.ts";

export type JsonPrimitive = boolean | number | string | null;
export type ProjectionValue =
  | JsonPrimitive
  | { readonly [key: string]: ProjectionValue }
  | readonly ProjectionValue[];

export interface DesktopSnapshot {
  readonly kind: "desktop_snapshot";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly workspace: {
    readonly status: "unbound" | "bound";
    readonly boardCount: number;
  };
  readonly settings: {
    readonly theme: SettingsTheme;
    readonly executionLimit: number;
  };
}

export interface WorkflowBoardProjection {
  readonly kind: "workflow_board_projection";
  readonly revision: number;
  readonly board: BoardProjection | null;
  readonly stages: readonly StageProjection[];
  readonly edges: readonly EdgeProjection[];
  readonly cards: readonly CardProjection[];
}

export interface WorkflowCatalogProjection {
  readonly kind: "workflow_catalog_projection";
  readonly revision: number;
  readonly catalog: CatalogProjection;
}

export interface WorkspaceBoardSummary {
  readonly boardId: BoardId;
  readonly repositoryPath: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly workflowVersion: number;
}

export interface WorkspaceProjection {
  readonly kind: "workspace_projection";
  readonly revision: number;
  readonly boards: readonly WorkspaceBoardSummary[];
}

export interface RpcSuccess<TProjection> {
  readonly status: "ok";
  readonly projection: TProjection;
}

export interface RpcConflict {
  readonly status: "conflict";
  readonly conflict: {
    readonly kind: "stale_projection";
    readonly expectedRevision: number;
    readonly actualRevision: number;
  };
}

export interface RpcUnavailable {
  readonly status: "unavailable";
  readonly unavailable: {
    readonly resource:
      | "desktop_host"
      | "desktop_snapshot"
      | "workflow_board"
      | "workflow_catalog"
      | "workflow_command"
      | "card_inspector"
      | "desktop_settings"
      | "settings_command";
    readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
  };
}

export type WorkflowCommandRpcResult =
  | {
      readonly status: "ok";
      readonly outcome: "committed" | "idempotent";
      readonly projection: WorkflowBoardProjection;
    }
  | {
      readonly status: "conflict";
      readonly conflict: WorkflowConflict;
    }
  | {
      readonly status: "rejected";
      readonly rejection: WorkflowRejection;
    }
  | RpcUnavailable;

export interface WorkflowBoardEnvelope {
  readonly kind: "workflow_board";
  readonly result: DesktopQueryResult<WorkflowBoardProjection>;
}

export interface WorkflowCatalogEnvelope {
  readonly kind: "workflow_catalog";
  readonly result: DesktopQueryResult<WorkflowCatalogProjection>;
}

export interface WorkspaceEnvelope {
  readonly kind: "workspace";
  readonly result: DesktopQueryResult<WorkspaceProjection>;
}

export type RepositoryDirectoryPickerResult =
  | { readonly status: "selected"; readonly path: string; readonly boardId?: BoardId }
  | { readonly status: "cancelled" }
  | {
      readonly status: "unavailable";
      readonly unavailable: {
        readonly resource: "repository_picker";
        readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
      };
    };

export interface RepositoryDirectoryPickerEnvelope {
  readonly kind: "repository_directory_picker";
  readonly result: RepositoryDirectoryPickerResult;
}

export interface WorkflowCommandEnvelope {
  readonly kind: "workflow_command_result";
  readonly commandId: string;
  readonly result: WorkflowCommandRpcResult;
}

export type DesktopQueryResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcUnavailable;

export type DesktopCommandResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcConflict
  | RpcUnavailable;

export interface DesktopCommandEnvelope<TCommand extends ProjectionValue = ProjectionValue> {
  readonly kind: "command";
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly command: TCommand;
}

export interface DesktopCommandResultEnvelope<TProjection> {
  readonly kind: "command_result";
  readonly commandId: string;
  readonly result: DesktopCommandResult<TProjection>;
}

export interface BootstrapEnvelope {
  readonly kind: "bootstrap";
  readonly result: DesktopQueryResult<DesktopSnapshot>;
}

export interface CardInspectorEnvelope {
  readonly kind: "card_inspector";
  readonly result: DesktopQueryResult<CardInspectorProjection>;
}

export type HostMessageEnvelope =
  | {
      readonly kind: "projection_committed";
      readonly messageId: string;
      readonly revision: number;
    }
  | {
      readonly kind: "settings_committed";
      readonly messageId: string;
      readonly revision: number;
      readonly changedSections: readonly SettingsSection[];
    }
  | {
      readonly kind: "host_unavailable";
      readonly messageId: string;
      readonly reason: RpcUnavailable["unavailable"]["reason"];
    }
  | {
      readonly kind: "attempt_activity";
      readonly messageId: string;
      readonly revision: number;
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
      readonly sequence: ActivitySequence;
      readonly projection: AttemptInspectorProjection;
    };

export type DesktopRpcSchema = {
  bun: RPCSchema<{
    requests: {
      getDesktopSnapshot: {
        params: { readonly knownRevision?: number };
        response: BootstrapEnvelope;
      };
      getCardInspector: {
        params: { readonly cardId: string };
        response: CardInspectorEnvelope;
      };
      getBoard: {
        params: { readonly boardId?: string; readonly mode?: "active" | "new" };
        response: WorkflowBoardEnvelope;
      };
      getWorkspace: {
        params: { readonly knownRevision?: number };
        response: WorkspaceEnvelope;
      };
      getCatalog: {
        params: { readonly catalogId?: string };
        response: WorkflowCatalogEnvelope;
      };
      pickRepositoryDirectory: {
        params: Record<never, never>;
        response: RepositoryDirectoryPickerEnvelope;
      };
      executeWorkflowCommand: {
        params: { readonly commandId: string; readonly command: WorkflowCommand };
        response: WorkflowCommandEnvelope;
      };
      queueFollowUp: {
        params: FollowUpRpcRequest<QueueFollowUpInput>;
        response: FollowUpRpcResultEnvelope;
      };
      removeQueuedFollowUp: {
        params: FollowUpRpcRequest<RemoveQueuedFollowUpInput>;
        response: FollowUpRpcResultEnvelope;
      };
      confirmQueuedFollowUp: {
        params: FollowUpRpcRequest<ConfirmQueuedFollowUpInput>;
        response: FollowUpRpcResultEnvelope;
      };
      startAttempt: {
        params: InspectorRpcRequest<StartAttemptRpcInput>;
        response: InspectorCommandResultEnvelope;
      };
      answerAttention: {
        params: InspectorRpcRequest<AnswerAttentionRpcInput>;
        response: InspectorCommandResultEnvelope;
      };
      reviewCard: {
        params: ReviewRpcRequest<ReviewCardInput>;
        response: ReviewCardRpcEnvelope;
      };
      getSettings: {
        params: { readonly knownRevision?: number };
        response: SettingsEnvelope;
      };
      updatePreferences: {
        params: SettingsCommandRequest<UpdatePreferencesInput>;
        response: SettingsCommandEnvelope;
      };
      updateProfileDefaults: {
        params: SettingsCommandRequest<UpdateProfileDefaultsInput>;
        response: SettingsCommandEnvelope;
      };
      updateCatalogRoots: {
        params: SettingsCommandRequest<UpdateCatalogRootsInput>;
        response: SettingsCommandEnvelope;
      };
      setExecutionLimit: {
        params: SettingsCommandRequest<SetExecutionLimitInput>;
        response: SettingsCommandEnvelope;
      };
    };
    messages: Record<never, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<never, never>;
    messages: {
      hostMessage: HostMessageEnvelope;
    };
  }>;
};

const forbiddenProjectionKeys = [
  "acpconnection",
  "filesystemhandle",
  "sqlite",
  "sqlitehandle",
  "skillcontent",
  "skillcontents",
  "worktree",
  "worktreeobject",
  "secret",
  "secrets",
  "password",
  "credential",
  "credentials",
  "token",
  "privatekey",
  "apikey",
] as const;

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function assertProjectionNode(value: unknown, path: string, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== "object") {
    throw new ProjectionBoundaryError(path, "projection values must be JSON data");
  }

  if (seen.has(value)) {
    throw new ProjectionBoundaryError(path, "cyclic projection values are forbidden");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProjectionNode(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectionBoundaryError(path, "resource handles and class instances are forbidden");
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (forbiddenProjectionKeys.some((forbidden) => normalized.includes(forbidden))) {
      throw new ProjectionBoundaryError(`${path}.${key}`, "privileged resources and secrets are forbidden");
    }
    assertProjectionNode(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export class ProjectionBoundaryError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Unsafe RPC projection at ${path}: ${reason}`);
    this.name = "ProjectionBoundaryError";
  }
}

export function assertProjectionPayload<T>(value: T): T {
  assertProjectionNode(value, "$", new WeakSet());
  return value;
}

export function createEmptyDesktopSnapshot(): DesktopSnapshot {
  return {
    kind: "desktop_snapshot",
    schemaVersion: 1,
    revision: 0,
    workspace: { status: "unbound", boardCount: 0 },
    settings: { theme: "system", executionLimit: 1 },
  };
}

export function createEmptyWorkspaceProjection(revision = 0): WorkspaceProjection {
  return {
    kind: "workspace_projection",
    revision,
    boards: [],
  };
}

export function createEmptyWorkflowBoardProjection(revision = 0): WorkflowBoardProjection {
  return {
    kind: "workflow_board_projection",
    revision,
    board: null,
    stages: [],
    edges: [],
    cards: [],
  };
}

export function createEmptyWorkflowCatalogProjection(revision = 0): WorkflowCatalogProjection {
  return {
    kind: "workflow_catalog_projection",
    revision,
    catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
  };
}

export function createBootstrapEnvelope(
  result: DesktopQueryResult<DesktopSnapshot>,
): BootstrapEnvelope {
  return assertProjectionPayload({ kind: "bootstrap", result });
}

export function createCardInspectorEnvelope(
  result: DesktopQueryResult<CardInspectorProjection>,
): CardInspectorEnvelope {
  return assertProjectionPayload({ kind: "card_inspector", result });
}

export function createWorkflowBoardEnvelope(
  result: DesktopQueryResult<WorkflowBoardProjection>,
): WorkflowBoardEnvelope {
  return assertProjectionPayload({ kind: "workflow_board", result });
}

export function createWorkflowCatalogEnvelope(
  result: DesktopQueryResult<WorkflowCatalogProjection>,
): WorkflowCatalogEnvelope {
  return assertProjectionPayload({ kind: "workflow_catalog", result });
}

export function createWorkspaceEnvelope(
  result: DesktopQueryResult<WorkspaceProjection>,
): WorkspaceEnvelope {
  return assertProjectionPayload({ kind: "workspace", result });
}

export function createRepositoryDirectoryPickerEnvelope(
  result: RepositoryDirectoryPickerResult,
): RepositoryDirectoryPickerEnvelope {
  return assertProjectionPayload({ kind: "repository_directory_picker", result });
}

export function createWorkflowCommandEnvelope(
  commandId: string,
  result: WorkflowCommandRpcResult,
): WorkflowCommandEnvelope {
  if (commandId.trim().length === 0) throw new Error("Workflow commandId must be non-empty");
  return assertProjectionPayload({ kind: "workflow_command_result", commandId, result });
}

export function createSettingsEnvelope(result: SettingsQueryResult): SettingsEnvelope {
  return assertProjectionPayload({ kind: "desktop_settings", result });
}

export function createSettingsCommandEnvelope(
  commandId: string,
  result: SettingsCommandResult,
): SettingsCommandEnvelope {
  if (commandId.trim().length === 0) throw new Error("Settings commandId must be non-empty");
  return assertProjectionPayload({ kind: "settings_command_result", commandId, result });
}

export function createCommandResultEnvelope<TProjection>(
  commandId: string,
  result: DesktopCommandResult<TProjection>,
): DesktopCommandResultEnvelope<TProjection> {
  return assertProjectionPayload({ kind: "command_result", commandId, result });
}

export function assertHostMessage(message: HostMessageEnvelope): HostMessageEnvelope {
  return assertProjectionPayload(message);
}

export function createAttemptActivityMessage(input: Omit<
  Extract<HostMessageEnvelope, { kind: "attempt_activity" }>,
  "kind"
>): HostMessageEnvelope {
  return assertHostMessage({ kind: "attempt_activity", ...input });
}
