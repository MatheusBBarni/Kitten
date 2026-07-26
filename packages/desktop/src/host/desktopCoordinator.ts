import type { EventJournal } from "../persistence/eventJournal.ts";
import type {
  ReviewApprovalResult,
  ReviewDispositionInput,
} from "../shared/rpc.ts";
import type { LifecycleDiagnostics } from "./lifecycleDiagnostics.ts";
import {
  recoverInterruptedAttempts,
  type InterruptedAttemptRecoveryResult,
} from "./recovery.ts";
import {
  createReviewDispositionService,
} from "./reviewDisposition.ts";
import type { ReviewEvidenceService } from "./reviewEvidence.ts";

export interface DesktopCoordinator {
  start(): InterruptedAttemptRecoveryResult;
  reviewCard(input: ReviewDispositionInput): Promise<ReviewApprovalResult>;
}

export function createDesktopCoordinator(options: {
  readonly journal: EventJournal;
  readonly evidence: Pick<ReviewEvidenceService, "revalidate">;
  readonly now?: () => number;
  readonly diagnostics?: LifecycleDiagnostics;
}): DesktopCoordinator {
  const review = createReviewDispositionService(options);
  return {
    start() {
      return recoverInterruptedAttempts(options);
    },
    reviewCard(input) {
      return review.reviewCard(input);
    },
  };
}
