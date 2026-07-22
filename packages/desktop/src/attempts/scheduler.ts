import type { CardId } from "../workflow/workflowTypes.ts";

export interface SchedulerReservation {
  readonly reservationId: string;
  readonly cardId: CardId;
}

export type SchedulerAdmission =
  | { readonly status: "available" }
  | { readonly status: "card_already_active" }
  | { readonly status: "capacity_exhausted" };

export type ReserveResult =
  | { readonly status: "reserved"; readonly reservation: SchedulerReservation }
  | Exclude<SchedulerAdmission, { readonly status: "available" }>;

export interface GlobalAttemptScheduler {
  readonly limit: number;
  readonly activeCount: number;
  setLimit(limit: number): void;
  inspect(cardId: CardId): SchedulerAdmission;
  reserve(cardId: CardId): ReserveResult;
  release(reservation: SchedulerReservation): boolean;
}

export interface CreateGlobalAttemptSchedulerOptions {
  readonly limit?: number;
  readonly createReservationId?: () => string;
}

export function createGlobalAttemptScheduler(
  options: CreateGlobalAttemptSchedulerOptions = {},
): GlobalAttemptScheduler {
  let limit = options.limit ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Global execution limit must be a positive integer");
  const createReservationId = options.createReservationId ?? (() => crypto.randomUUID());
  const byCard = new Map<CardId, SchedulerReservation>();
  const byId = new Map<string, SchedulerReservation>();

  const inspect = (cardId: CardId): SchedulerAdmission => {
    if (byCard.has(cardId)) return { status: "card_already_active" };
    if (byId.size >= limit) return { status: "capacity_exhausted" };
    return { status: "available" };
  };

  return {
    get limit() {
      return limit;
    },
    get activeCount() {
      return byId.size;
    },
    setLimit(nextLimit) {
      if (!Number.isSafeInteger(nextLimit) || nextLimit < 1) {
        throw new Error("Global execution limit must be a positive integer");
      }
      limit = nextLimit;
    },
    inspect,
    reserve(cardId) {
      const admission = inspect(cardId);
      if (admission.status !== "available") return admission;
      const reservation = Object.freeze({ reservationId: createReservationId(), cardId });
      if (reservation.reservationId.trim().length === 0 || byId.has(reservation.reservationId)) {
        throw new Error("Scheduler reservation identity must be unique and non-empty");
      }
      byCard.set(cardId, reservation);
      byId.set(reservation.reservationId, reservation);
      return { status: "reserved", reservation };
    },
    release(reservation) {
      const active = byId.get(reservation.reservationId);
      if (active !== reservation || byCard.get(reservation.cardId) !== reservation) return false;
      byId.delete(reservation.reservationId);
      byCard.delete(reservation.cardId);
      return true;
    },
  };
}
