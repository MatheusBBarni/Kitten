import type { CardProjection } from "../workflow/workflowTypes.ts";

export function isCardStageLocked(card: CardProjection): boolean {
  return card.executionStatus === "running" || card.executionStatus === "needs_attention";
}

export function markCardNeedsAttention(card: CardProjection, occurredAt: number): CardProjection {
  if (card.executionStatus !== "running") throw new Error("Only a running card can raise an Attention Blocker");
  return {
    ...card,
    executionStatus: "needs_attention",
    version: card.version + 1,
    updatedAt: Math.max(card.updatedAt, occurredAt),
  };
}

export function resumeCardAfterAttention(card: CardProjection, occurredAt: number): CardProjection {
  if (card.executionStatus !== "needs_attention") throw new Error("Only an attention-blocked card can resume");
  return {
    ...card,
    executionStatus: "running",
    version: card.version + 1,
    updatedAt: Math.max(card.updatedAt, occurredAt),
  };
}
