import type { QuestionId } from "@kitten/engine";
import type { CardId } from "../workflow/workflowTypes.ts";

export interface CardNotificationPayload {
  readonly title: "Action required";
  readonly body: string;
  readonly cardId: CardId;
  readonly action: "open_card";
}

export type CardNotificationDeliveryResult =
  | { readonly state: "delivered"; readonly attemptedAt: number }
  | { readonly state: "failed"; readonly attemptedAt: number; readonly failureCode: "unavailable" };

export interface CardNotificationService {
  notify(input: {
    readonly blockerId: QuestionId;
    readonly cardId: CardId;
    readonly cardTitle: string;
  }): Promise<CardNotificationDeliveryResult>;
}

export function createCardNotificationService(options: {
  readonly deliver: (payload: CardNotificationPayload) => void | Promise<void>;
  readonly now?: () => number;
}): CardNotificationService {
  const now = options.now ?? Date.now;
  const deliveries = new Map<QuestionId, Promise<CardNotificationDeliveryResult>>();
  return {
    notify(input) {
      const existing = deliveries.get(input.blockerId);
      if (existing !== undefined) return existing;
      const delivery = (async (): Promise<CardNotificationDeliveryResult> => {
        const attemptedAt = Math.max(0, now());
        try {
          await options.deliver({
            title: "Action required",
            body: `${input.cardTitle} needs your answer.`,
            cardId: input.cardId,
            action: "open_card",
          });
          return { state: "delivered", attemptedAt };
        } catch {
          return { state: "failed", attemptedAt, failureCode: "unavailable" };
        }
      })();
      deliveries.set(input.blockerId, delivery);
      return delivery;
    },
  };
}
