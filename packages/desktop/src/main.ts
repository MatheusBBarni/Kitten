import {
  assertHostMessage,
  createAttemptActivityMessage,
  createCardInspectorEnvelope,
  createBootstrapEnvelope,
  createEmptyDesktopSnapshot,
  createEmptySupervisionProjection,
  createEmptyWorkflowBoardProjection,
  createEmptyWorkflowCatalogProjection,
  createEmptyWorkspaceProjection,
  createRepositoryDirectoryPickerEnvelope,
  createReviewDiffChunkEnvelope,
  createReviewManifestEnvelope,
  createReviewApprovalEnvelope,
  createSubmitCardPromptEnvelope,
  createSupervisionEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkflowCommandEnvelope,
  createWorkspaceEnvelope,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type DesktopSnapshot,
  type HostMessageEnvelope,
  type WorkflowBoardEnvelope,
  type WorkflowCatalogEnvelope,
  type WorkflowCommandEnvelope,
  type WorkspaceEnvelope,
  type RepositoryDirectoryPickerEnvelope,
  type ReviewDiffChunkEnvelope,
  type ReviewManifestEnvelope,
  type SettingsCommandEnvelope,
  type SettingsEnvelope,
  type SupervisionEnvelope,
  type SubmitCardPromptEnvelope,
  type SubmitCardPromptInput,
} from "./shared/rpc.ts";
import type { CardInspectorProjection } from "./attempts/inspectorProjection.ts";
import { createActivityIngestor, getCardInspectorProjection } from "./attempts/activityIngestor.ts";
import {
  completeSuccessfulAttempt,
  createAttemptCoordinator,
} from "./attempts/attemptCoordinator.ts";
import { createDesktopAcpConnectionFactory } from "./attempts/desktopAcpAdapter.ts";
import { createDirectAcpAttemptStarter } from "./attempts/directAcpAttempt.ts";
import type { CardId } from "./workflow/workflowTypes.ts";
import {
  createDesktopPromptSubmissionRpc,
  createDesktopInspectorRpc,
  createDesktopReviewRpc,
  createDesktopReviewEvidenceRpc,
  type DesktopInspectorRpc,
  type DesktopPromptSubmissionRpc,
  type DesktopReviewEvidenceRpc,
  type DesktopReviewRpc,
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
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createDesktopBoardRpc, projectWorkflowBoard } from "./host/boardRpc.ts";
import { createEventJournal } from "./persistence/eventJournal.ts";
import { migrateDatabase } from "./persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "./persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "./workflow/workflowCommands.ts";
import { readCatalogProjection, replaceCatalogProjection } from "./catalog/catalogProjection.ts";
import type { SkillCatalog } from "./catalog/contracts.ts";
import {
  defaultProjectSkillRoots,
  defaultUserSkillRoots,
  discoverAcpProviders,
  discoverDesktopAcpRuntimeProfiles,
} from "./host/localConfiguration.ts";
import {
  findBoardForRepository,
  writeProjectBoardConfig,
} from "./host/projectBoardConfig.ts";
import { createWorkflowApiServer } from "./host/workflowApiServer.ts";
import { createCardWorktreeService } from "./worktrees/cardWorktreeService.ts";
import { createAttentionCoordinator } from "./attention/attentionCoordinator.ts";
import { createAttemptAskUserBridge } from "./attention/attemptAskUserBridge.ts";
import { DESKTOP_ASK_USER_MCP_MODE_FLAG, runDesktopAskUserMcp } from "./attention/desktopAskUserMcpServer.ts";
import { createCardNotificationService } from "./notifications/cardNotificationService.ts";
import { createReviewEvidenceService } from "./host/reviewEvidence.ts";
import { createReviewDispositionService } from "./host/reviewDisposition.ts";
import {
  createJsonlWorkflowMeasurementStorage,
  createWorkflowMeasurement,
} from "./host/workflowMeasurement.ts";
import { resolveNativeCaptureRuntime } from "../test/native/nativeCaptureRuntime.ts";

export interface DesktopWindowPort {
  sendHostMessage(message: HostMessageEnvelope): void;
  removeHandlers(): void;
  close(): void;
}

export interface DesktopWindowFactory {
  open(options: {
    onGetDesktopSnapshot(params: { readonly knownRevision?: number }): Promise<BootstrapEnvelope>;
    onGetCardInspector(params: { readonly cardId: string }): Promise<CardInspectorEnvelope>;
    onGetBoard(params: { readonly boardId?: string; readonly mode?: "active" | "new" }): Promise<WorkflowBoardEnvelope>;
    onGetWorkspace(params: { readonly knownRevision?: number }): Promise<WorkspaceEnvelope>;
    onGetSupervision(params: { readonly knownRevision?: number }): Promise<SupervisionEnvelope>;
    onGetReviewManifest(params: Parameters<DesktopReviewEvidenceRpc["getReviewManifest"]>[0]): Promise<ReviewManifestEnvelope>;
    onGetReviewDiffChunk(params: Parameters<DesktopReviewEvidenceRpc["getReviewDiffChunk"]>[0]): Promise<ReviewDiffChunkEnvelope>;
    onGetCatalog(params: { readonly catalogId?: string }): Promise<WorkflowCatalogEnvelope>;
    onPickRepositoryDirectory(params: Record<never, never>): Promise<RepositoryDirectoryPickerEnvelope>;
    onExecuteWorkflowCommand(params: {
      readonly commandId: string;
      readonly command: WorkflowCommand;
    }): Promise<WorkflowCommandEnvelope>;
    onSubmitCardPrompt(params: SubmitCardPromptInput): Promise<SubmitCardPromptEnvelope>;
    onStopAttempt(params: Parameters<DesktopInspectorRpc["stopAttempt"]>[0]): ReturnType<DesktopInspectorRpc["stopAttempt"]>;
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
  readonly promptSubmissionRpc?: DesktopPromptSubmissionRpc;
  readonly inspectorRpc?: DesktopInspectorRpc;
  readonly reviewRpc?: DesktopReviewRpc;
  readonly reviewEvidenceRpc?: DesktopReviewEvidenceRpc;
  readonly boardRpc?: DesktopBoardRpc;
  readonly settingsRpc?: DesktopSettingsRpc;
  readonly pickRepositoryDirectory?: () => Promise<RepositoryDirectoryPickerEnvelope>;
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
    async onGetWorkspace() {
      if (stopped) {
        return createWorkspaceEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (options.boardRpc?.getWorkspace === undefined) {
        return createWorkspaceEnvelope({
          status: "ok",
          projection: createEmptyWorkspaceProjection(),
        });
      }
      try {
        return await options.boardRpc.getWorkspace({});
      } catch {
        return createWorkspaceEnvelope({
          status: "unavailable",
          unavailable: { resource: "workflow_board", reason: "projection_rejected" },
        });
      }
    },
    async onGetSupervision() {
      if (stopped) {
        return createSupervisionEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (options.boardRpc === undefined) {
        return createSupervisionEnvelope({
          status: "ok",
          projection: createEmptySupervisionProjection(),
        });
      }
      try {
        return await options.boardRpc.getSupervision({});
      } catch {
        return createSupervisionEnvelope({
          status: "unavailable",
          unavailable: { resource: "supervision", reason: "projection_rejected" },
        });
      }
    },
    async onGetReviewManifest(request) {
      if (stopped) return unavailableReviewManifest("host_stopped");
      if (options.reviewEvidenceRpc === undefined) return unavailableReviewManifest("not_ready");
      try {
        return await options.reviewEvidenceRpc.getReviewManifest(request);
      } catch {
        return unavailableReviewManifest("projection_rejected");
      }
    },
    async onGetReviewDiffChunk(request) {
      if (stopped) return unavailableReviewDiffChunk("host_stopped");
      if (options.reviewEvidenceRpc === undefined) return unavailableReviewDiffChunk("not_ready");
      try {
        return await options.reviewEvidenceRpc.getReviewDiffChunk(request);
      } catch {
        return unavailableReviewDiffChunk("projection_rejected");
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
    async onPickRepositoryDirectory() {
      if (stopped) {
        return createRepositoryDirectoryPickerEnvelope({
          status: "unavailable",
          unavailable: { resource: "repository_picker", reason: "host_stopped" },
        });
      }
      if (options.pickRepositoryDirectory === undefined) {
        return createRepositoryDirectoryPickerEnvelope({
          status: "unavailable",
          unavailable: { resource: "repository_picker", reason: "not_ready" },
        });
      }
      try {
        return await options.pickRepositoryDirectory();
      } catch {
        return createRepositoryDirectoryPickerEnvelope({
          status: "unavailable",
          unavailable: { resource: "repository_picker", reason: "projection_rejected" },
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
    async onSubmitCardPrompt(request) {
      return options.promptSubmissionRpc === undefined
        ? unavailablePromptSubmission(request.commandId)
        : options.promptSubmissionRpc.submitCardPrompt(request);
    },
    async onStopAttempt(request) {
      return options.inspectorRpc === undefined
        ? unavailableInspectorCommand(request.commandId)
        : options.inspectorRpc.stopAttempt(request);
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
        if (envelope.result.status === "ok" && envelope.result.outcome === "approved") {
          window.sendHostMessage(assertHostMessage({
            kind: "projection_committed",
            messageId: `review:${request.commandId}`,
            revision: options.reviewRpc.currentRevision(),
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
  _reason: "not_ready" | "host_stopped" | "projection_rejected",
) {
  return createReviewApprovalEnvelope(commandId, {
    status: "rejected",
    error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
  });
}

function unavailableReviewManifest(
  reason: "not_ready" | "host_stopped" | "projection_rejected",
): ReviewManifestEnvelope {
  return createReviewManifestEnvelope({
    status: "unavailable",
    unavailable: { resource: "review_manifest", reason },
  });
}

function unavailableReviewDiffChunk(
  reason: "not_ready" | "host_stopped" | "projection_rejected",
): ReviewDiffChunkEnvelope {
  return createReviewDiffChunkEnvelope({
    status: "unavailable",
    unavailable: { resource: "review_diff_chunk", reason },
  });
}

function unavailablePromptSubmission(commandId: string): SubmitCardPromptEnvelope {
  return createSubmitCardPromptEnvelope(commandId, {
    status: "rejected",
    error: { code: "invalid_prompt", recoveryHint: "none" },
  });
}

export async function main(): Promise<DesktopShell> {
  const [{ createElectrobunWindowFactory }, { Utils }] = await Promise.all([
    import("./host/electrobunWindow.ts"),
    import("electrobun/bun"),
  ]);
  const nativeCapture = resolveNativeCaptureRuntime(process.env);
  const userDataPath = nativeCapture === null
    ? Utils.paths.userData
    : dirname(nativeCapture.databasePath);
  const homePath = nativeCapture === null ? Utils.paths.home : userDataPath;
  mkdirSync(userDataPath, { recursive: true });
  const database = openSqliteDatabase({
    filename: nativeCapture?.databasePath ?? join(userDataPath, "workflow.sqlite"),
  });
  migrateDatabase(database);
  const workflowMeasurement = createWorkflowMeasurement({
    storage: createJsonlWorkflowMeasurementStorage(
      join(userDataPath, "workflow-measurement.jsonl"),
    ),
  });

  const journal = createEventJournal(database);
  let currentCatalog: SkillCatalog | null = null;
  const syncCatalog = (catalog: SkillCatalog) => {
    currentCatalog = catalog;
    const current = readCatalogProjection(journal.snapshot(), "default");
    const next = {
      catalogId: "default",
      roots: catalog.roots,
      entries: catalog.entries,
      diagnostics: catalog.diagnostics,
    };
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    replaceCatalogProjection(journal, {
      eventId: `catalog-sync:${crypto.randomUUID()}`,
      catalogId: "default",
      catalog,
      occurredAt: Date.now(),
    });
  };
  const initialBoard = journal.snapshot().boards[0];
  const acpProviders = discoverAcpProviders({ homePath });
  const runtimeProfiles = discoverDesktopAcpRuntimeProfiles({ homePath });
  const settingsRpc = createDesktopSettingsRpc({
    initialProjectRoots: initialBoard === undefined
      ? []
      : defaultProjectSkillRoots(initialBoard.repositoryPath),
    initialUserRoots: defaultUserSkillRoots(homePath),
    profiles: runtimeProfiles.map(({ profile }) => profile),
    acpProviders,
    onCatalogChanged: syncCatalog,
    onWorkflowMeasurementEnabledChanged(enabled) {
      workflowMeasurement.setEnabled(enabled);
    },
  });
  const workflowCommands = createWorkflowCommandHandler(journal);
  const boardRpc = createDesktopBoardRpc(journal, workflowCommands, {
    onRepositoryBound(repositoryPath) {
      settingsRpc.replaceProjectRoots(defaultProjectSkillRoots(repositoryPath));
    },
    onRepositoryOpened(repositoryPath) {
      settingsRpc.replaceProjectRoots(defaultProjectSkillRoots(repositoryPath));
    },
    onProjectionCommitted(projection) {
      writeProjectBoardConfig(projection);
    },
    measurement: workflowMeasurement,
  });
  const startupSnapshot = journal.snapshot();
  for (const board of startupSnapshot.boards) {
    try {
      writeProjectBoardConfig(projectWorkflowBoard(startupSnapshot, board.boardId));
    } catch {
      // SQLite remains authoritative when a repository is temporarily read-only or unavailable.
    }
  }
  let shell: DesktopShell | null = null;
  const attention = createAttentionCoordinator({
    journal,
    notifications: createCardNotificationService({
      deliver(payload) {
        Utils.showNotification({ title: payload.title, body: payload.body });
      },
    }),
  });
  const askUserBridge = createAttemptAskUserBridge({ journal, attention });
  const reviewEvidence = createReviewEvidenceService(journal);
  const activityIngestor = createActivityIngestor({
    journal,
    async onCommitted({ event, inspector, delta }) {
      let revision = delta.revision;
      if (event.activity.kind === "attempt_state" && event.activity.state === "succeeded") {
        const completion = await completeSuccessfulAttempt({
          journal,
          workflowCommands,
          reviewEvidence,
          attemptId: inspector.attemptId,
          generation: inspector.generation,
          measurement: workflowMeasurement,
        });
        if (
          completion.status === "advanced"
          || completion.status === "ready_for_review"
        ) {
          revision = completion.revision;
        }
      }
      shell?.publish(createAttemptActivityMessage({
        messageId: `attempt:${event.eventId}`,
        revision,
        boardId: inspector.boardId,
        cardId: inspector.cardId,
        attemptId: inspector.attemptId,
        generation: inspector.generation,
        sequence: event.sequence,
        projection: inspector,
      }));
    },
  });
  const attemptCoordinator = createAttemptCoordinator({
    journal,
    scheduler: settingsRpc.scheduler,
    worktrees: createCardWorktreeService(journal),
    directAcp: createDirectAcpAttemptStarter(createDesktopAcpConnectionFactory(runtimeProfiles, undefined, {
      command: process.execPath,
      args: [import.meta.path, DESKTOP_ASK_USER_MCP_MODE_FLAG],
    })),
    reviewEvidence,
    measurement: workflowMeasurement,
    activityIngestor,
    askUserBridge,
    hasActiveAttention: (attemptId) => attention.hasActive(attemptId),
    getCatalog: () => {
      if (currentCatalog === null) throw new Error("The Workflow Skill catalog is not ready.");
      return currentCatalog;
    },
    resolveProfile: (card) => runtimeProfiles.find(({ profile }) => profile.provider === card.provider)?.profile ?? null,
    verifyRepository: (board) => {
      try {
        const canonicalPath = realpathSync(board.repositoryPath);
        return {
          trusted: canonicalPath === board.repositoryPath,
          canonicalPath,
          checkedAt: Date.now(),
          message: canonicalPath === board.repositoryPath ? "Repository verified" : "Repository path is not canonical",
        };
      } catch {
        return {
          trusted: false,
          canonicalPath: board.repositoryPath,
          checkedAt: Date.now(),
          message: "Repository is unavailable",
        };
      }
    },
  });
  const reviewDisposition = createReviewDispositionService({
    journal,
    evidence: reviewEvidence,
  });
  shell = startDesktopShell({
    windowFactory: await createElectrobunWindowFactory(nativeCapture),
    boardRpc,
    settingsRpc,
    getCardInspector: (cardId) => getCardInspectorProjection(journal, cardId),
    inspectorRpc: createDesktopInspectorRpc(journal, attemptCoordinator, attention),
    promptSubmissionRpc: createDesktopPromptSubmissionRpc(
      attemptCoordinator,
      workflowMeasurement,
    ),
    reviewRpc: createDesktopReviewRpc(reviewDisposition, workflowMeasurement),
    reviewEvidenceRpc: createDesktopReviewEvidenceRpc(
      reviewEvidence,
      workflowMeasurement,
    ),
    async getSnapshot() {
      const snapshot = journal.snapshot();
      const settings = await settingsRpc.getSettings();
      const settingsProjection = settings.result.status === "ok" ? settings.result.projection : null;
      return {
        kind: "desktop_snapshot",
        schemaVersion: 1,
        revision: snapshot.revision,
        workspace: {
          status: snapshot.boards.length === 0 ? "unbound" : "bound",
          boardCount: snapshot.boards.length,
        },
        settings: {
          theme: settingsProjection?.preferences.theme ?? "system",
          executionLimit: settingsProjection?.scheduler.automaticExecutionLimit ?? 1,
        },
      };
    },
    async pickRepositoryDirectory() {
      const chosenPaths = await Utils.openFileDialog({
        startingFolder: homePath,
        allowedFileTypes: "*",
        canChooseFiles: false,
        canChooseDirectory: true,
        allowsMultipleSelection: false,
      });
      const path = chosenPaths.find((candidate) => candidate.trim().length > 0);
      if (path === undefined) return createRepositoryDirectoryPickerEnvelope({ status: "cancelled" });
      settingsRpc.replaceProjectRoots(defaultProjectSkillRoots(path));
      const boardId = findBoardForRepository(path, journal.snapshot().boards);
      return createRepositoryDirectoryPickerEnvelope({
        status: "selected",
        path,
        ...(boardId === null ? {} : { boardId }),
      });
    },
  });
  const workflowApi = createWorkflowApiServer({
    boardRpc,
    getSnapshot: () => journal.snapshot(),
    homePath,
    onProjectionCommitted(projection) {
      shell?.publish(assertHostMessage({
        kind: "projection_committed",
        messageId: `workflow-api:${crypto.randomUUID()}`,
        revision: projection.revision,
      }));
    },
  });

  let databaseClosed = false;
  return {
    publish: shell.publish,
    stop() {
      shell.stop();
      workflowApi.stop();
      askUserBridge.dispose();
      if (!databaseClosed) {
        databaseClosed = true;
        closeSqliteDatabase(database);
      }
    },
  };
}

if (import.meta.main) {
  if (process.argv.includes(DESKTOP_ASK_USER_MCP_MODE_FLAG)) await runDesktopAskUserMcp();
  else await main();
}
