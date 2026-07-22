import {
  assertHostMessage,
  createCardInspectorEnvelope,
  createBootstrapEnvelope,
  createEmptyDesktopSnapshot,
  createEmptyWorkflowBoardProjection,
  createEmptyWorkflowCatalogProjection,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type DesktopSnapshot,
  type HostMessageEnvelope,
  type WorkflowBoardEnvelope,
  type WorkflowCatalogEnvelope,
  type WorkflowCommandEnvelope,
  type SettingsCommandEnvelope,
  type SettingsEnvelope,
} from "./shared/rpc.ts";
import type { CardInspectorProjection } from "./attempts/inspectorProjection.ts";
import type { CardId } from "./workflow/workflowTypes.ts";
import type {
  ConfirmQueuedFollowUpInput,
  QueueFollowUpInput,
  RemoveQueuedFollowUpInput,
} from "./attempts/attemptCoordinator.ts";
import type {
  DesktopFollowUpRpc,
  DesktopInspectorRpc,
  DesktopReviewRpc,
  FollowUpRpcRequest,
  FollowUpRpcResultEnvelope,
} from "./host/desktopRpc.ts";
import type { DesktopBoardRpc } from "./host/boardRpc.ts";
import type { WorkflowCommand } from "./workflow/workflowTypes.ts";
import { createDesktopSettingsRpc } from "./host/settingsRpc.ts";
import type {
  DesktopSettingsRpc,
  SetExecutionLimitInput,
  SettingsCommandRequest,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "./shared/desktopRpc.ts";

export interface DesktopWindowPort {
  sendHostMessage(message: HostMessageEnvelope): void;
  removeHandlers(): void;
  close(): void;
}

export interface DesktopWindowFactory {
  open(options: {
    onGetDesktopSnapshot(params: { readonly knownRevision?: number }): Promise<BootstrapEnvelope>;
    onGetCardInspector(params: { readonly cardId: string }): Promise<CardInspectorEnvelope>;
    onGetBoard(params: { readonly boardId?: string }): Promise<WorkflowBoardEnvelope>;
    onGetCatalog(params: { readonly catalogId?: string }): Promise<WorkflowCatalogEnvelope>;
    onExecuteWorkflowCommand(params: {
      readonly commandId: string;
      readonly command: WorkflowCommand;
    }): Promise<WorkflowCommandEnvelope>;
    onQueueFollowUp(params: FollowUpRpcRequest<QueueFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onRemoveQueuedFollowUp(params: FollowUpRpcRequest<RemoveQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onConfirmQueuedFollowUp(params: FollowUpRpcRequest<ConfirmQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onStartAttempt(params: Parameters<DesktopInspectorRpc["startAttempt"]>[0]): ReturnType<DesktopInspectorRpc["startAttempt"]>;
    onAnswerAttention(params: Parameters<DesktopInspectorRpc["answerAttention"]>[0]): ReturnType<DesktopInspectorRpc["answerAttention"]>;
    onReviewCard(params: Parameters<DesktopReviewRpc["reviewCard"]>[0]): ReturnType<DesktopReviewRpc["reviewCard"]>;
    onGetSettings(params: { readonly knownRevision?: number }): Promise<SettingsEnvelope>;
    onUpdatePreferences(params: SettingsCommandRequest<UpdatePreferencesInput>): Promise<SettingsCommandEnvelope>;
    onUpdateProfileDefaults(params: SettingsCommandRequest<UpdateProfileDefaultsInput>): Promise<SettingsCommandEnvelope>;
    onUpdateCatalogRoots(params: SettingsCommandRequest<UpdateCatalogRootsInput>): Promise<SettingsCommandEnvelope>;
    onSetExecutionLimit(params: SettingsCommandRequest<SetExecutionLimitInput>): Promise<SettingsCommandEnvelope>;
  }): DesktopWindowPort;
}

export interface DesktopShell {
  publish(message: HostMessageEnvelope): boolean;
  stop(): void;
}

export function startDesktopShell(options: {
  readonly windowFactory: DesktopWindowFactory;
  readonly getSnapshot?: () => DesktopSnapshot | Promise<DesktopSnapshot>;
  readonly getCardInspector?: (cardId: CardId) => CardInspectorProjection | null | Promise<CardInspectorProjection | null>;
  readonly followUpRpc?: DesktopFollowUpRpc;
  readonly inspectorRpc?: DesktopInspectorRpc;
  readonly reviewRpc?: DesktopReviewRpc;
  readonly boardRpc?: DesktopBoardRpc;
  readonly settingsRpc?: DesktopSettingsRpc;
}): DesktopShell {
  let stopped = false;
  const settingsRpc = options.settingsRpc ?? createDesktopSettingsRpc();
  const getSnapshot = options.getSnapshot ?? (async () => {
    const settings = await settingsRpc.getSettings();
    const snapshot = createEmptyDesktopSnapshot();
    return settings.result.status === "ok"
      ? {
          ...snapshot,
          settings: {
            theme: settings.result.projection.preferences.theme,
            executionLimit: settings.result.projection.scheduler.automaticExecutionLimit,
          },
        }
      : snapshot;
  });

  let window: DesktopWindowPort;
  window = options.windowFactory.open({
    async onGetDesktopSnapshot() {
      if (stopped) {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }

      try {
        return createBootstrapEnvelope({ status: "ok", projection: await getSnapshot() });
      } catch {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_snapshot", reason: "projection_rejected" },
        });
      }
    },
    async onGetCardInspector({ cardId }) {
      if (stopped) {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (cardId.trim().length === 0 || options.getCardInspector === undefined) {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "not_ready" },
        });
      }
      try {
        const projection = await options.getCardInspector(cardId as CardId);
        return createCardInspectorEnvelope(projection === null
          ? {
              status: "unavailable",
              unavailable: { resource: "card_inspector", reason: "not_ready" },
            }
          : { status: "ok", projection });
      } catch {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "projection_rejected" },
        });
      }
    },
    async onGetBoard(params) {
      if (stopped) {
        return createWorkflowBoardEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (options.boardRpc === undefined) {
        return createWorkflowBoardEnvelope({
          status: "ok",
          projection: createEmptyWorkflowBoardProjection(),
        });
      }
      try {
        return await options.boardRpc.getBoard(params);
      } catch {
        return createWorkflowBoardEnvelope({
          status: "unavailable",
          unavailable: { resource: "workflow_board", reason: "projection_rejected" },
        });
      }
    },
    async onGetCatalog(params) {
      if (stopped) {
        return createWorkflowCatalogEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (options.boardRpc === undefined) {
        return createWorkflowCatalogEnvelope({
          status: "ok",
          projection: createEmptyWorkflowCatalogProjection(),
        });
      }
      try {
        return await options.boardRpc.getCatalog(params);
      } catch {
        return createWorkflowCatalogEnvelope({
          status: "unavailable",
          unavailable: { resource: "workflow_catalog", reason: "projection_rejected" },
        });
      }
    },
    async onExecuteWorkflowCommand(params) {
      if (stopped || options.boardRpc === undefined) {
        return createWorkflowCommandEnvelope(params.commandId, {
          status: "unavailable",
          unavailable: {
            resource: stopped ? "desktop_host" : "workflow_command",
            reason: stopped ? "host_stopped" : "not_ready",
          },
        });
      }
      try {
        const envelope = await options.boardRpc.executeWorkflowCommand(params);
        if (envelope.result.status === "ok" && envelope.result.outcome === "committed") {
          window.sendHostMessage(assertHostMessage({
            kind: "projection_committed",
            messageId: `workflow:${params.commandId}`,
            revision: envelope.result.projection.revision,
          }));
        }
        return envelope;
      } catch {
        return createWorkflowCommandEnvelope(params.commandId, {
          status: "unavailable",
          unavailable: { resource: "workflow_command", reason: "projection_rejected" },
        });
      }
    },
    async onQueueFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.queueFollowUp(request);
    },
    async onRemoveQueuedFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.removeQueuedFollowUp(request);
    },
    async onConfirmQueuedFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.confirmQueuedFollowUp(request);
    },
    async onStartAttempt(request) {
      return options.inspectorRpc === undefined
        ? unavailableInspectorCommand(request.commandId)
        : options.inspectorRpc.startAttempt(request);
    },
    async onAnswerAttention(request) {
      return options.inspectorRpc === undefined
        ? unavailableInspectorCommand(request.commandId)
        : options.inspectorRpc.answerAttention(request);
    },
    async onReviewCard(request) {
      if (stopped) return unavailableReview(request.commandId, "host_stopped");
      if (options.reviewRpc === undefined) return unavailableReview(request.commandId, "not_ready");
      try {
        const envelope = await options.reviewRpc.reviewCard(request);
        if (envelope.result.status === "committed") {
          window.sendHostMessage(assertHostMessage({
            kind: "projection_committed",
            messageId: `review:${request.commandId}`,
            revision: envelope.result.revision,
          }));
        }
        return envelope;
      } catch {
        return unavailableReview(request.commandId, "projection_rejected");
      }
    },
    async onGetSettings(params) {
      if (stopped) {
        return createSettingsUnavailable("desktop_host", "host_stopped");
      }
      try {
        return await settingsRpc.getSettings(params);
      } catch {
        return createSettingsUnavailable("desktop_settings", "projection_rejected");
      }
    },
    async onUpdatePreferences(request) {
      return handleSettingsCommand(
        stopped,
        window,
        request.commandId,
        () => settingsRpc.updatePreferences(request),
      );
    },
    async onUpdateProfileDefaults(request) {
      return handleSettingsCommand(
        stopped,
        window,
        request.commandId,
        () => settingsRpc.updateProfileDefaults(request),
      );
    },
    async onUpdateCatalogRoots(request) {
      return handleSettingsCommand(
        stopped,
        window,
        request.commandId,
        () => settingsRpc.updateCatalogRoots(request),
      );
    },
    async onSetExecutionLimit(request) {
      return handleSettingsCommand(
        stopped,
        window,
        request.commandId,
        () => settingsRpc.setExecutionLimit(request),
      );
    },
  });

  return {
    publish(message) {
      if (stopped) return false;
      window.sendHostMessage(assertHostMessage(message));
      return true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeHandlers();
      window.close();
    },
  };
}

async function handleSettingsCommand(
  stopped: boolean,
  window: DesktopWindowPort,
  commandId: string,
  execute: () => Promise<SettingsCommandEnvelope>,
): Promise<SettingsCommandEnvelope> {
  if (stopped) {
    return {
      kind: "settings_command_result",
      commandId,
      result: {
        status: "unavailable",
        unavailable: { resource: "desktop_host", reason: "host_stopped" },
      },
    };
  }
  try {
    const envelope = await execute();
    if (envelope.result.status === "ok" && envelope.result.changedSections.length > 0) {
      window.sendHostMessage(assertHostMessage({
        kind: "settings_committed",
        messageId: `settings:${commandId}`,
        revision: envelope.result.projection.revision,
        changedSections: envelope.result.changedSections,
      }));
    }
    return envelope;
  } catch {
    return {
      kind: "settings_command_result",
      commandId,
      result: {
        status: "unavailable",
        unavailable: { resource: "settings_command", reason: "projection_rejected" },
      },
    };
  }
}

function createSettingsUnavailable(
  resource: "desktop_host" | "desktop_settings",
  reason: "host_stopped" | "projection_rejected",
): SettingsEnvelope {
  return {
    kind: "desktop_settings",
    result: { status: "unavailable", unavailable: { resource, reason } },
  };
}

function unavailableInspectorCommand(commandId: string) {
  return {
    kind: "inspector_command_result" as const,
    commandId,
    result: {
      status: "rejected" as const,
      reason: { code: "not_ready", message: "Inspector commands are not ready" },
    },
  };
}

function unavailableReview(
  commandId: string,
  reason: "not_ready" | "host_stopped" | "projection_rejected",
) {
  return { kind: "review_card_result" as const, commandId, result: { status: "unavailable" as const, reason } };
}

function unavailableFollowUp(commandId: string): FollowUpRpcResultEnvelope {
  return {
    kind: "follow_up_command_result",
    commandId,
    result: {
      status: "rejected",
      reason: { code: "invalid_state", message: "Follow-up commands are not ready" },
    },
  };
}

export async function main(): Promise<DesktopShell> {
  const { createElectrobunWindowFactory } = await import("./host/electrobunWindow.ts");
  return startDesktopShell({ windowFactory: await createElectrobunWindowFactory() });
}

if (import.meta.main) {
  await main();
}
