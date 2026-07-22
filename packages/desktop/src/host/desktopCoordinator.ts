import type { EventJournal } from "../persistence/eventJournal.ts";
import type { LifecycleDiagnostics } from "./lifecycleDiagnostics.ts";
import {
  recoverInterruptedAttempts,
  type InterruptedAttemptRecoveryResult,
} from "./recovery.ts";
import {
  createReviewDispositionService,
  type ReviewCardInput,
  type ReviewCardResult,
} from "./reviewDisposition.ts";

export interface DesktopCoordinator {
  start(): InterruptedAttemptRecoveryResult;
  reviewCard(input: ReviewCardInput): ReviewCardResult;
}

export function createDesktopCoordinator(options: {
  readonly journal: EventJournal;
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
