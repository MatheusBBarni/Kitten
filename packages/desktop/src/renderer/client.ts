import type {
  BootstrapEnvelope,
  CardInspectorEnvelope,
  AnswerAttentionRpcInput,
  GetReviewDiffChunkRequest,
  GetReviewManifestRequest,
  HostMessageEnvelope,
  InspectorCommandResultEnvelope,
  ReviewApprovalEnvelope,
  ReviewDispositionInput,
  ReviewDiffChunkEnvelope,
  ReviewManifestEnvelope,
  SubmitCardPromptEnvelope,
  SubmitCardPromptInput,
  StopAttemptRpcInput,
  WorkflowBoardEnvelope,
  WorkflowCatalogEnvelope,
  WorkspaceEnvelope,
  SupervisionEnvelope,
  WorkflowCommandEnvelope,
  RepositoryDirectoryPickerEnvelope,
  SettingsCommandEnvelope,
  SettingsEnvelope,
  SetExecutionLimitInput,
  UpdateCatalogRootsInput,
  UpdatePreferencesInput,
  UpdateProfileDefaultsInput,
} from "../shared/rpc.ts";
import type { WorkflowCommand } from "../workflow/workflowTypes.ts";

export interface DesktopRpcClient {
  getDesktopSnapshot(): Promise<BootstrapEnvelope>;
  getCardInspector(cardId: string): Promise<CardInspectorEnvelope>;
  getBoard(boardId?: string, mode?: "active" | "new"): Promise<WorkflowBoardEnvelope>;
  getWorkspace?(): Promise<WorkspaceEnvelope>;
  getSupervision?(): Promise<SupervisionEnvelope>;
  getReviewManifest(request: GetReviewManifestRequest): Promise<ReviewManifestEnvelope>;
  getReviewDiffChunk(request: GetReviewDiffChunkRequest): Promise<ReviewDiffChunkEnvelope>;
  getCatalog(catalogId?: string): Promise<WorkflowCatalogEnvelope>;
  pickRepositoryDirectory?(): Promise<RepositoryDirectoryPickerEnvelope>;
  executeWorkflowCommand(commandId: string, command: WorkflowCommand): Promise<WorkflowCommandEnvelope>;
  submitCardPrompt(input: SubmitCardPromptInput): Promise<SubmitCardPromptEnvelope>;
  stopAttempt?(commandId: string, input: StopAttemptRpcInput): Promise<InspectorCommandResultEnvelope>;
  answerAttention(commandId: string, input: AnswerAttentionRpcInput): Promise<InspectorCommandResultEnvelope>;
  reviewCard?(input: ReviewDispositionInput): Promise<ReviewApprovalEnvelope>;
  getSettings(): Promise<SettingsEnvelope>;
  updatePreferences(commandId: string, input: UpdatePreferencesInput): Promise<SettingsCommandEnvelope>;
  updateProfileDefaults(commandId: string, input: UpdateProfileDefaultsInput): Promise<SettingsCommandEnvelope>;
  updateCatalogRoots(commandId: string, input: UpdateCatalogRootsInput): Promise<SettingsCommandEnvelope>;
  setExecutionLimit(commandId: string, input: SetExecutionLimitInput): Promise<SettingsCommandEnvelope>;
  subscribe(listener: (message: HostMessageEnvelope) => void): () => void;
  dispose(): void;
}

export function bindCardInspectorRenderer(
  client: DesktopRpcClient,
  cardId: string,
  onInspector: (envelope: CardInspectorEnvelope) => void,
): { readonly ready: Promise<void>; refresh(): Promise<void>; dispose(): void } {
  let active = true;
  let refreshSequence = 0;

  const refresh = async () => {
    const sequence = ++refreshSequence;
    const envelope = await client.getCardInspector(cardId);
    if (!active || sequence !== refreshSequence) return;
    if (envelope.result.status === "ok" && envelope.result.projection.cardId !== cardId) return;
    onInspector(envelope);
  };
  const unsubscribe = client.subscribe((message) => {
    const applies = message.kind === "host_unavailable"
      || message.kind === "projection_committed"
      || (message.kind === "attempt_activity" && message.cardId === cardId);
    if (applies) void refresh();
  });

  return {
    ready: refresh(),
    refresh,
    dispose() {
      if (!active) return;
      active = false;
      refreshSequence += 1;
      unsubscribe();
    },
  };
}

export function bindWorkflowBoardRenderer(
  client: DesktopRpcClient,
  callbacks: {
    readonly onBoard: (envelope: WorkflowBoardEnvelope) => void;
    readonly onCatalog: (envelope: WorkflowCatalogEnvelope) => void;
    readonly onWorkspace?: (envelope: WorkspaceEnvelope) => void;
  },
  options: { readonly boardId?: string; readonly mode?: "active" | "new" } = {},
): { readonly ready: Promise<void>; dispose(): void } {
  let active = true;
  let refreshSequence = 0;

  const refresh = async () => {
    const sequence = ++refreshSequence;
    const [board, catalog, workspace] = await Promise.all([
      client.getBoard(options.boardId, options.mode),
      client.getCatalog(),
      client.getWorkspace?.(),
    ]);
    if (!active || sequence !== refreshSequence) return;
    callbacks.onBoard(board);
    callbacks.onCatalog(catalog);
    if (workspace !== undefined) callbacks.onWorkspace?.(workspace);
  };
  const unsubscribe = client.subscribe((message) => {
    if (
      message.kind === "projection_committed"
      || message.kind === "attempt_activity"
      || message.kind === "settings_committed"
      || message.kind === "host_unavailable"
    ) {
      void refresh();
    }
  });

  return {
    ready: refresh(),
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
    },
  };
}

export function bindDesktopRenderer(
  client: DesktopRpcClient,
  onBootstrap: (envelope: BootstrapEnvelope) => void,
): { readonly ready: Promise<void>; dispose(): void } {
  let active = true;

  const refresh = async () => {
    const envelope = await client.getDesktopSnapshot();
    if (active) onBootstrap(envelope);
  };
  const unsubscribe = client.subscribe((message) => {
    if (
      message.kind === "projection_committed"
      || message.kind === "attempt_activity"
      || message.kind === "settings_committed"
      || message.kind === "host_unavailable"
    ) {
      void refresh();
    }
  });

  return {
    ready: refresh(),
    dispose() {
      if (!active) return;
      active = false;
      unsubscribe();
      client.dispose();
    },
  };
}
