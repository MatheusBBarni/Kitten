import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { desktopQueryKeys } from "../../query/desktopQueries.ts";
import { showBoardToast } from "./boardToast.ts";

function commandId(action: "start" | "stop"): string {
  return `inspector:${action}:${crypto.randomUUID()}`;
}

export function useTaskRunControls(client: DesktopRpcClient) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: (card: CardProjection) => client.submitCardPrompt({
      commandId: commandId("start"),
      boardId: card.boardId,
      cardId: card.cardId,
      expectedCardVersion: card.version,
      content: card.description.trim() || card.title,
      source: "initial",
    }),
    onSuccess({ result }) {
      if (result.status === "ok") {
        showBoardToast({ message: "Run started.", tone: "success" });
        void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.boards });
        return;
      }
      showBoardToast({
        message: "The run could not start from the task's current state.",
        tone: "error",
      });
    },
    onError() {
      showBoardToast({ message: "The desktop host could not start this run.", tone: "error" });
    },
  });
  const stop = useMutation({
    mutationFn: (card: CardProjection) => client.stopAttempt === undefined
      ? Promise.resolve({
          kind: "inspector_command_result" as const,
          commandId: commandId("stop"),
          result: { status: "rejected" as const, reason: { code: "not_ready", message: "Stopping runs is not available." } },
        })
      : client.stopAttempt(commandId("stop"), {
          cardId: card.cardId,
          expectedCardVersion: card.version,
        }),
    onSuccess({ result }) {
      if (result.status === "ok") {
        showBoardToast({ message: "Run stop requested.", tone: "info" });
        void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.boards });
        return;
      }
      showBoardToast({
        message: result.status === "conflict" ? result.conflict.message : result.reason.message,
        tone: "error",
      });
    },
    onError() {
      showBoardToast({ message: "The desktop host could not stop this run.", tone: "error" });
    },
  });

  return {
    start: start.mutate,
    stop: stop.mutate,
    busy: start.isPending || stop.isPending,
  };
}
