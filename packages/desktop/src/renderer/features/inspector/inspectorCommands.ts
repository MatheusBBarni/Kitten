import type { AttentionBlockerProjection, AttentionOutcome } from "../../../attention/contracts.ts";
import type { DesktopRpcClient } from "../../client.ts";

export function answerAttentionThroughRpc(
  client: DesktopRpcClient,
  commandId: string,
  blocker: AttentionBlockerProjection,
  outcome: AttentionOutcome,
) {
  return client.answerAttention(commandId, {
    attemptId: blocker.attemptId,
    generation: blocker.generation,
    blockerId: blocker.blockerId,
    expectedVersion: blocker.version,
    outcome,
  });
}
