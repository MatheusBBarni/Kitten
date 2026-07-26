import { useMutation } from "@tanstack/react-query";
import type { AttentionOutcome } from "../../../attention/contracts.ts";
import type { AttentionBlockerProjection } from "../../../attention/contracts.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type {
  ContractErrorCode,
  ReviewEvidencePrecondition,
  SubmitCardPromptResult,
} from "../../../shared/rpc.ts";
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
  readonly error?: { readonly code: string };
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
          ?? submissionErrorMessage(result.error?.code)
          ?? "The inspector command was rejected. Review the refreshed task and try again.",
      };
}

function submissionErrorMessage(code: string | undefined): string | undefined {
  switch (code) {
    case "stale_projection":
      return "The task changed. Review the refreshed task and try again.";
    case "attempt_active":
      return "Wait for the active run state to refresh before sending.";
    case "blocker_active":
      return "Resolve the active attention request before sending another message.";
    case "submission_interrupted":
      return "Delivery was interrupted. Review the retained draft and retry explicitly.";
    case "evidence_missing":
      return "Review evidence is missing. Reload the review before sending; your draft is retained.";
    case "evidence_stale":
      return "Review evidence changed. Reload and review the current manifest; your draft is retained.";
    case "evidence_oversized":
      return "The change set is too large for review. Reduce it before sending; your draft is retained.";
    case "evidence_unsafe":
      return "The change set contains unsupported review evidence. Resolve it before sending; your draft is retained.";
    case "worktree_binding_mismatch":
      return "The task worktree changed. Reload the review before sending; your draft is retained.";
    case "invalid_prompt":
      return "The message cannot be submitted in the task's current state.";
    default:
      return undefined;
  }
}

function submissionSuccess(
  result: SubmitCardPromptResult,
  source: "initial" | "composer" | "request_changes",
): string {
  if (result.status !== "ok") return "";
  if (source === "request_changes") return "Change request accepted. A new attempt started on this task.";
  if (result.outcome === "queued") return "Message accepted and queued for the next safe turn boundary.";
  return source === "initial"
    ? "Run started with the saved initial message."
    : "Message accepted and a new run started.";
}

export function useInspectorCommands(input: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly attempt: NonNullable<Parameters<DesktopRpcClient["submitCardPrompt"]>[0]["activeAttempt"]> | null;
  readonly queueVersion: number;
  readonly blocker: AttentionBlockerProjection | null;
  readonly reviewEvidence: ReviewEvidencePrecondition | null;
  readonly refresh: () => Promise<void>;
  readonly onFeedback: (feedback: InspectorFeedback) => void;
  readonly onDraftConsumed: () => void;
  readonly onReviewRejected?: (code: ContractErrorCode) => void;
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
    mutationFn: (initialPrompt: string) => input.client.submitCardPrompt({
      commandId: commandId("start"),
      boardId: input.card.boardId,
      cardId: input.card.cardId,
      expectedCardVersion: input.card.version,
      content: initialPrompt,
      source: "initial",
    }),
    onSuccess: ({ result }) => finish(result, submissionSuccess(result, "initial"), true),
    onError: fail,
  });
  const sendDirection = useMutation({
    mutationFn: (text: string) => {
      if (input.attempt === null) throw new Error("No active attempt");
      return input.client.submitCardPrompt({
        commandId: commandId("steer"),
        boardId: input.card.boardId,
        cardId: input.card.cardId,
        expectedCardVersion: input.card.version,
        content: text,
        source: "composer",
        activeAttempt: input.attempt,
      });
    },
    onSuccess: ({ result }) => finish(result, submissionSuccess(result, "composer"), true),
    onError: fail,
  });
  const requestChanges = useMutation({
    mutationFn: (text: string) => {
      if (input.reviewEvidence === null) throw new Error("No current review evidence");
      return input.client.submitCardPrompt({
        commandId: commandId("request-changes"),
        boardId: input.card.boardId,
        cardId: input.card.cardId,
        expectedCardVersion: input.card.version,
        content: text,
        source: "request_changes",
        evidence: input.reviewEvidence,
      });
    },
    onSuccess: ({ result }) => {
      if (result.status === "rejected") input.onReviewRejected?.(result.error.code);
      finish(result, submissionSuccess(result, "request_changes"), true);
    },
    onError: fail,
  });
  const approveReview = useMutation({
    mutationFn: () => {
      if (input.reviewEvidence === null) throw new Error("No current review evidence");
      if (input.client.reviewCard === undefined) throw new Error("Review approval is unavailable");
      return input.client.reviewCard({
        commandId: commandId("approve"),
        boardId: input.card.boardId,
        cardId: input.card.cardId,
        expectedCardVersion: input.card.version,
        disposition: "approved",
        evidence: input.reviewEvidence,
      });
    },
    onSuccess: ({ result }) => {
      if (result.status === "rejected") input.onReviewRejected?.(result.error.code);
      finish(result, "Review approved. The task is complete.");
    },
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
      || requestChanges.isPending
      || approveReview.isPending
      || answerAttention.isPending,
    startAttempt: start.mutate,
    sendDirection: sendDirection.mutate,
    retryInterrupted: start.mutate,
    requestChanges: requestChanges.mutate,
    approveReview: approveReview.mutate,
    answerAttention: answerAttention.mutate,
  };
}
