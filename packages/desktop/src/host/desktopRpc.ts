import type {
  ConfirmQueuedFollowUpInput,
  DesktopAttemptCoordinator,
  FollowUpQueueResult,
  FollowUpRejectionCode,
  QueueFollowUpInput,
  RemoveQueuedFollowUpInput,
} from "../attempts/attemptCoordinator.ts";
import type { AttemptGeneration, AttemptId, QuestionId } from "@kitten/engine";
import type { AttentionOutcome } from "../attention/contracts.ts";
import type { CardId } from "../workflow/workflowTypes.ts";
import type {
  ReviewCardInput,
  ReviewCardResult,
  ReviewDispositionService,
} from "./reviewDisposition.ts";

export interface FollowUpRpcRequest<Input> {
  readonly commandId: string;
  readonly input: Input;
}

export interface FollowUpRpcResultEnvelope {
  readonly kind: "follow_up_command_result";
  readonly commandId: string;
  readonly result: FollowUpRpcResult;
}

export type FollowUpRpcResult =
  | Extract<FollowUpQueueResult, { readonly status: "ok" }>
  | {
      readonly status: "conflict";
      readonly conflict: {
        readonly kind: "follow_up_queue";
        readonly code: Extract<FollowUpRejectionCode, "stale_attempt" | "stale_generation" | "stale_version" | "stale_head">;
        readonly message: string;
      };
    }
  | Extract<FollowUpQueueResult, { readonly status: "rejected" }>;

export interface DesktopFollowUpRpc {
  queueFollowUp(request: FollowUpRpcRequest<QueueFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
  removeQueuedFollowUp(request: FollowUpRpcRequest<RemoveQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
  confirmQueuedFollowUp(request: FollowUpRpcRequest<ConfirmQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
}

export interface StartAttemptRpcInput {
  readonly cardId: CardId;
  readonly expectedCardVersion: number;
  readonly initialPrompt: string;
}

export interface AnswerAttentionRpcInput {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly blockerId: QuestionId;
  readonly expectedVersion: number;
  readonly outcome: AttentionOutcome;
}

export interface InspectorRpcRequest<Input> {
  readonly commandId: string;
  readonly input: Input;
}

export interface ReviewRpcRequest<Input> {
  readonly commandId: string;
  readonly input: Input;
}

export type InspectorCommandResult =
  | { readonly status: "ok" }
  | {
      readonly status: "conflict";
      readonly conflict: {
        readonly kind: "inspector_command";
        readonly code: "stale_card" | "stale_attempt" | "stale_generation" | "stale_version";
        readonly message: string;
      };
    }
  | {
      readonly status: "rejected";
      readonly reason: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface InspectorCommandResultEnvelope {
  readonly kind: "inspector_command_result";
  readonly commandId: string;
  readonly result: InspectorCommandResult;
}

export interface DesktopInspectorRpc {
  startAttempt(request: InspectorRpcRequest<StartAttemptRpcInput>): Promise<InspectorCommandResultEnvelope>;
  answerAttention(request: InspectorRpcRequest<AnswerAttentionRpcInput>): Promise<InspectorCommandResultEnvelope>;
}

export type ReviewCardRpcResult = ReviewCardResult | {
  readonly status: "unavailable";
  readonly reason: "not_ready" | "host_stopped" | "projection_rejected";
};

export interface ReviewCardRpcEnvelope {
  readonly kind: "review_card_result";
  readonly commandId: string;
  readonly result: ReviewCardRpcResult;
}

export interface DesktopReviewRpc {
  reviewCard(request: ReviewRpcRequest<ReviewCardInput>): Promise<ReviewCardRpcEnvelope>;
}

export function createDesktopReviewRpc(service: ReviewDispositionService): DesktopReviewRpc {
  return {
    async reviewCard(request) {
      if (request.commandId.trim().length === 0) throw new Error("Review RPC commandId must be non-empty");
      return { kind: "review_card_result", commandId: request.commandId, result: service.reviewCard(request.input) };
    },
  };
}

export function createDesktopFollowUpRpc(coordinator: DesktopAttemptCoordinator): DesktopFollowUpRpc {
  return {
    async queueFollowUp(request) {
      return envelope(request.commandId, coordinator.queueFollowUp(request.input));
    },
    async removeQueuedFollowUp(request) {
      return envelope(request.commandId, coordinator.removeQueuedFollowUp(request.input));
    },
    async confirmQueuedFollowUp(request) {
      return envelope(request.commandId, await coordinator.confirmQueuedFollowUp(request.input));
    },
  };
}

function envelope(commandId: string, result: FollowUpQueueResult): FollowUpRpcResultEnvelope {
  if (commandId.trim().length === 0) throw new Error("Follow-up RPC commandId must be non-empty");
  if (
    result.status === "rejected"
    && (
      result.reason.code === "stale_attempt"
      || result.reason.code === "stale_generation"
      || result.reason.code === "stale_version"
      || result.reason.code === "stale_head"
    )
  ) {
    return {
      kind: "follow_up_command_result",
      commandId,
      result: {
        status: "conflict",
        conflict: { kind: "follow_up_queue", code: result.reason.code, message: result.reason.message },
      },
    };
  }
  return { kind: "follow_up_command_result", commandId, result };
}
