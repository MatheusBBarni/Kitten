import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export type LifecycleDiagnostic =
  | {
      readonly name: "attempt_recovered";
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
      readonly outcome: "interrupted";
    }
  | {
      readonly name: "review_disposition_recorded";
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly outcome: "completed";
    };

/** Deliberately closed content-free diagnostic surface. */
export interface LifecycleDiagnostics {
  record(diagnostic: LifecycleDiagnostic): void;
}

export const silentLifecycleDiagnostics: LifecycleDiagnostics = Object.freeze({
  record() {},
});
