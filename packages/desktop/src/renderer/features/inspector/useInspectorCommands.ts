import { useMutation } from "@tanstack/react-query";
import type { AttentionOutcome } from "../../../attention/contracts.ts";
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
  readonly queueVersion: number;
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
  const sendDirection = useMutation({
    mutationFn: (text: string) => {
      if (input.attempt === null) throw new Error("No active attempt");
      return input.client.queueFollowUp(commandId("steer"), {
        ...input.attempt,
        expectedQueueVersion: input.queueVersion,
        text,
      });
    },
    onSuccess: ({ result }) => finish(result, "Direction accepted for the active task.", true),
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
      || sendDirection.isPending
      || answerAttention.isPending,
    startAttempt: start.mutate,
    sendDirection: sendDirection.mutate,
    answerAttention: answerAttention.mutate,
  };
}
