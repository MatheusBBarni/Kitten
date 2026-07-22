import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DesktopRpcClient } from "../../client.ts";
import {
  boardQueryOptions,
  catalogQueryOptions,
  desktopQueryKeys,
  settingsQueryOptions,
  workspaceQueryOptions,
} from "../../query/desktopQueries.ts";
import { useDesktopViewStore } from "../../state/desktopViewStore.ts";
import { createEmptyWorkspaceProjection } from "../../../shared/rpc.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import {
  boardInteractionMessage,
  createBrowserIdentityFactory,
  executeBoardCommand,
  updateCardCommand,
  type BoardInteractionResult,
  type CardEditInput,
  type IdentityFactory,
} from "./boardInteractions.ts";
import { showBoardToast, type BoardToastMessage } from "./boardToast.ts";

interface CommandVariables {
  readonly execute: () => Promise<BoardInteractionResult>;
  readonly onCommitted?: () => void;
}

interface SelectionVariables {
  readonly boardId: string;
  readonly announce: boolean;
}

export function useWorkflowBoardController(
  client: DesktopRpcClient,
  options: {
    readonly onBeginProjectSetup: () => void;
    readonly onSelectBoard: () => void;
    readonly publishFeedback?: (feedback: BoardToastMessage) => void;
  },
) {
  const identities = useRef<IdentityFactory>(createBrowserIdentityFactory());
  const queryClient = useQueryClient();
  const activeBoardId = useDesktopViewStore((state) => state.activeBoardId);
  const boardMode = useDesktopViewStore((state) => state.boardMode);
  const projectSetupOpen = useDesktopViewStore((state) => state.projectSetupOpen);
  const beginProjectSetup = useDesktopViewStore((state) => state.beginProjectSetup);
  const finishProjectSetup = useDesktopViewStore((state) => state.finishProjectSetup);
  const cancelProjectSetup = useDesktopViewStore((state) => state.cancelProjectSetup);
  const selectBoardInStore = useDesktopViewStore((state) => state.selectBoard);
  const [repositoryPath, setRepositoryPath] = useState("");
  const publishFeedback = options.publishFeedback ?? showBoardToast;

  const boardQuery = useQuery(boardQueryOptions(client, activeBoardId, boardMode));
  const catalogQuery = useQuery(catalogQueryOptions(client));
  const workspaceQuery = useQuery(workspaceQueryOptions(client));
  const settingsQuery = useQuery(settingsQueryOptions(client));

  const commandMutation = useMutation({
    mutationFn: ({ execute }: CommandVariables) => execute(),
    onSuccess(result, variables) {
      const message = boardInteractionMessage(result);
      publishFeedback({
        message: message ?? "Board projection committed.",
        tone: result.status === "ok" ? "success" : "error",
      });
      if (result.status !== "ok") return;
      queryClient.setQueryData(
        desktopQueryKeys.board(activeBoardId, boardMode),
        { kind: "workflow_board", result: { status: "ok", projection: result.projection } },
      );
      if (boardMode === "new" && result.projection.board !== null) {
        const nextBoardId = result.projection.board.boardId;
        queryClient.setQueryData(
          desktopQueryKeys.board(nextBoardId, "active"),
          { kind: "workflow_board", result: { status: "ok", projection: result.projection } },
        );
        finishProjectSetup(nextBoardId);
      }
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.workspace });
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.catalog });
      variables.onCommitted?.();
    },
    onError() {
      publishFeedback({
        message: "The desktop host did not finish this action. Review the current board and try again.",
        tone: "error",
      });
    },
  });

  const pickerMutation = useMutation({
    mutationFn: (purpose: "open" | "change") => {
      if (client.pickRepositoryDirectory === undefined) {
        return Promise.resolve({
          kind: "repository_directory_picker" as const,
          result: {
            status: "unavailable" as const,
            unavailable: { resource: "repository_picker" as const, reason: "not_ready" as const },
          },
          purpose,
        });
      }
      return client.pickRepositoryDirectory().then((envelope) => ({ ...envelope, purpose }));
    },
    onSuccess(envelope) {
      if (envelope.result.status === "selected") {
        const selectedPath = envelope.result.path;
        const selectedBoardId = envelope.result.boardId ?? (
          workspaceQuery.data?.result.status === "ok"
            ? workspaceQuery.data.result.projection.boards.find(({ repositoryPath }) => (
                repositoryPath.replace(/[\\/]+$/, "") === selectedPath.replace(/[\\/]+$/, "")
              ))?.boardId
            : undefined
        );
        if (envelope.purpose === "open" && selectedBoardId !== undefined) {
          setRepositoryPath("");
          selectionMutation.mutate({ boardId: selectedBoardId, announce: true });
          return;
        }
        setRepositoryPath(selectedPath);
        publishFeedback({ message: "Repository folder selected.", tone: "info" });
        if (envelope.purpose === "open") {
          options.onBeginProjectSetup();
          beginProjectSetup();
        }
        return;
      }
      if (envelope.result.status === "unavailable") {
        publishFeedback({
          message: "Couldn't open the folder picker. Restart the desktop app and try again.",
          tone: "error",
        });
        return;
      }
      publishFeedback({ message: "Folder selection cancelled.", tone: "info" });
    },
    onError() {
      publishFeedback({
        message: "Couldn't open the folder picker. Restart the desktop app and try again.",
        tone: "error",
      });
    },
  });

  const selectionMutation = useMutation({
    mutationFn: ({ boardId }: SelectionVariables) => client.getBoard(boardId, "active"),
    onSuccess(envelope, variables) {
      if (envelope.result.status !== "ok" || envelope.result.projection.board === null) {
        publishFeedback({ message: "This project could not be opened. Try selecting its folder again.", tone: "error" });
        return;
      }
      queryClient.setQueryData(desktopQueryKeys.board(variables.boardId, "active"), envelope);
      selectBoardInStore(variables.boardId);
      options.onSelectBoard();
      if (variables.announce) publishFeedback({ message: "Project opened.", tone: "success" });
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.catalog });
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.settings });
    },
    onError() {
      publishFeedback({ message: "This project could not be opened. Try selecting its folder again.", tone: "error" });
    },
  });

  const run = useCallback((execute: CommandVariables["execute"], onCommitted?: () => void) => {
    if (commandMutation.isPending) return;
    commandMutation.mutate({ execute, ...(onCommitted === undefined ? {} : { onCommitted }) });
  }, [commandMutation]);

  const saveTask = useCallback((card: CardProjection, input: CardEditInput, onSaved: () => void): void => {
    const command = updateCardCommand(card, input, identities.current);
    if (command === null) {
      publishFeedback({ message: "Title, provider, model, and effort are required.", tone: "error" });
      return;
    }
    commandMutation.mutate({
      execute: () => executeBoardCommand(client, command, identities.current),
      onCommitted: onSaved,
    });
  }, [client, commandMutation, publishFeedback]);

  const boardEnvelope = boardQuery.data;
  const catalogEnvelope = catalogQuery.data;
  const workspaceEnvelope = workspaceQuery.data;
  const settingsEnvelope = settingsQuery.data;
  const projection = boardEnvelope?.result.status === "ok" ? boardEnvelope.result.projection : null;
  const catalog = catalogEnvelope?.result.status === "ok" ? catalogEnvelope.result.projection : null;
  const workspace = workspaceEnvelope?.result.status === "ok"
    ? workspaceEnvelope.result.projection
    : createEmptyWorkspaceProjection();
  const settings = settingsEnvelope?.result.status === "ok" ? settingsEnvelope.result.projection : null;
  const loadError = boardEnvelope?.result.status === "unavailable"
    ? "The Workflow Board projection is unavailable. Wait for the desktop host to reconnect."
    : catalogEnvelope?.result.status === "unavailable"
      ? "The local Skill Catalog is unavailable. Stage setup cannot continue."
      : boardQuery.isError || catalogQuery.isError
        ? "The desktop host is unavailable. Wait for it to reconnect."
        : null;

  return {
    identities,
    projection,
    catalog,
    workspace,
    settings,
    loadError,
    repositoryPath,
    activeBoardId,
    boardMode,
    projectSetupOpen,
    busy: commandMutation.isPending || pickerMutation.isPending || selectionMutation.isPending,
    run,
    saveTask,
    openProject() {
      if (!pickerMutation.isPending && !commandMutation.isPending && !selectionMutation.isPending) pickerMutation.mutate("open");
    },
    addBoard(repositoryPath: string) {
      if (pickerMutation.isPending || commandMutation.isPending || selectionMutation.isPending) return;
      setRepositoryPath(repositoryPath);
      options.onBeginProjectSetup();
      beginProjectSetup();
      publishFeedback({ message: "Choose the stages for this board.", tone: "info" });
    },
    chooseRepository() {
      if (!pickerMutation.isPending && !commandMutation.isPending && !selectionMutation.isPending) pickerMutation.mutate("change");
    },
    selectBoard(boardId: string) {
      if (commandMutation.isPending || pickerMutation.isPending || selectionMutation.isPending || boardId === activeBoardId) return;
      selectionMutation.mutate({ boardId, announce: false });
    },
    closeProjectSetup() {
      if (commandMutation.isPending || pickerMutation.isPending || selectionMutation.isPending) return;
      cancelProjectSetup();
      setRepositoryPath("");
    },
  };
}
