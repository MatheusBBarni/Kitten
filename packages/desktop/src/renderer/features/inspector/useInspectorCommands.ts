import { useMutation } from "@tanstack/react-query";
import type { AttentionOutcome } from "../../../attention/contracts.ts";
import type { FollowUpQueueId, FollowUpQueueProjection } from "../../../attempts/followUpQueue.ts";
import type { AttentionBlockerProjection } from "../../../attention/contracts.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { answerAttentionThroughRpc } from "./inspectorCommands.ts";

export interface InspectorFeedback {
  readonly tone: "status" | "error";
  readonly message: string;
}

interface CommandResult {
  readonly status: string;
  readonly conflict?: { readonly message: string };
  readonly reason?: { readonly message: string };
}

function commandId(kind: string): string {
  return `inspector:${kind}:${crypto.randomUUID()}`;
}

function feedbackFor(result: CommandResult, success: string): InspectorFeedback {
  return result.status === "ok"
    ? { tone: "status", message: success }
    : {
        tone: "error",
        message: result.conflict?.message
          ?? result.reason?.message
          ?? "The inspector command was rejected. Review the refreshed task and try again.",
      };
}

export function useInspectorCommands(input: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly attempt: {
    readonly attemptId: Parameters<DesktopRpcClient["queueFollowUp"]>[1]["attemptId"];
    readonly generation: Parameters<DesktopRpcClient["queueFollowUp"]>[1]["generation"];
  } | null;
  readonly queue: FollowUpQueueProjection | null;
  readonly blocker: AttentionBlockerProjection | null;
  readonly refresh: () => Promise<void>;
  readonly onFeedback: (feedback: InspectorFeedback) => void;
  readonly onDraftConsumed: () => void;
}) {
  const finish = (result: CommandResult, success: string, consumesDraft = false) => {
    const feedback = feedbackFor(result, success);
    input.onFeedback(feedback);
    if (feedback.tone === "status") {
      if (consumesDraft) input.onDraftConsumed();
      void input.refresh();
    }
  };
  const fail = () => input.onFeedback({
    tone: "error",
    message: "The desktop host did not finish this action. Review the refreshed task and try again.",
  });

  const start = useMutation({
    mutationFn: (initialPrompt: string) => input.client.startAttempt(commandId("start"), {
      cardId: input.card.cardId,
      expectedCardVersion: input.card.version,
      initialPrompt,
    }),
    onSuccess: ({ result }) => finish(result, "Run started with the saved initial message.", true),
    onError: fail,
  });
  const queueFollowUp = useMutation({
    mutationFn: (text: string) => {
      if (input.attempt === null) throw new Error("No active attempt");
      return input.client.queueFollowUp(commandId("queue"), {
        ...input.attempt,
        expectedQueueVersion: input.queue?.version ?? 0,
        text,
      });
    },
    onSuccess: ({ result }) => finish(result, "Follow-up queued. Confirm it after the active turn settles.", true),
    onError: fail,
  });
  const removeFollowUp = useMutation({
    mutationFn: (queueId: FollowUpQueueId) => {
      if (input.attempt === null || input.queue === null) throw new Error("No active queue");
      return input.client.removeQueuedFollowUp(commandId("remove"), {
        ...input.attempt,
        expectedQueueVersion: input.queue.version,
        queueId,
      });
    },
    onSuccess: ({ result }) => finish(result, "Queued follow-up removed."),
    onError: fail,
  });
  const confirmFollowUp = useMutation({
    mutationFn: (queueId: FollowUpQueueId) => {
      if (input.attempt === null || input.queue === null || input.blocker !== null) throw new Error("Follow-up is blocked");
      return input.client.confirmQueuedFollowUp(commandId("confirm"), {
        ...input.attempt,
        expectedQueueVersion: input.queue.version,
        queueId,
      });
    },
    onSuccess: ({ result }) => finish(result, "Confirmed follow-up dispatched once."),
    onError: fail,
  });
  const answerAttention = useMutation({
    mutationFn: (outcome: AttentionOutcome) => {
      if (input.blocker === null) throw new Error("No active attention request");
      return answerAttentionThroughRpc(input.client, commandId("attention"), input.blocker, outcome);
    },
    onSuccess: ({ result }) => finish(result, "Attention response recorded."),
    onError: fail,
  });

  return {
    busy: start.isPending
      || queueFollowUp.isPending
      || removeFollowUp.isPending
      || confirmFollowUp.isPending
      || answerAttention.isPending,
    startAttempt: start.mutate,
    queueFollowUp: queueFollowUp.mutate,
    removeQueuedFollowUp: removeFollowUp.mutate,
    confirmQueuedFollowUp: confirmFollowUp.mutate,
    answerAttention: answerAttention.mutate,
  };
}
