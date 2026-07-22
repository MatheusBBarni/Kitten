import {
  assertHostMessage,
  createCardInspectorEnvelope,
  createBootstrapEnvelope,
  createEmptyDesktopSnapshot,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type DesktopSnapshot,
  type HostMessageEnvelope,
} from "./shared/rpc.ts";
import type { CardInspectorProjection } from "./attempts/inspectorProjection.ts";
import type { CardId } from "./workflow/workflowTypes.ts";
import type {
  ConfirmQueuedFollowUpInput,
  QueueFollowUpInput,
  RemoveQueuedFollowUpInput,
} from "./attempts/attemptCoordinator.ts";
import type {
  DesktopFollowUpRpc,
  DesktopReviewRpc,
  FollowUpRpcRequest,
  FollowUpRpcResultEnvelope,
  ReviewCardRpcEnvelope,
} from "./host/desktopRpc.ts";

export interface DesktopWindowPort {
  sendHostMessage(message: HostMessageEnvelope): void;
  removeHandlers(): void;
  close(): void;
}

export interface DesktopWindowFactory {
  open(options: {
    onGetDesktopSnapshot(params: { readonly knownRevision?: number }): Promise<BootstrapEnvelope>;
    onGetCardInspector(params: { readonly cardId: string }): Promise<CardInspectorEnvelope>;
    onQueueFollowUp(params: FollowUpRpcRequest<QueueFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onRemoveQueuedFollowUp(params: FollowUpRpcRequest<RemoveQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onConfirmQueuedFollowUp(params: FollowUpRpcRequest<ConfirmQueuedFollowUpInput>): Promise<FollowUpRpcResultEnvelope>;
    onReviewCard(params: Parameters<DesktopReviewRpc["reviewCard"]>[0]): ReturnType<DesktopReviewRpc["reviewCard"]>;
  }): DesktopWindowPort;
}

export interface DesktopShell {
  publish(message: HostMessageEnvelope): boolean;
  stop(): void;
}

export function startDesktopShell(options: {
  readonly windowFactory: DesktopWindowFactory;
  readonly getSnapshot?: () => DesktopSnapshot | Promise<DesktopSnapshot>;
  readonly getCardInspector?: (cardId: CardId) => CardInspectorProjection | null | Promise<CardInspectorProjection | null>;
  readonly followUpRpc?: DesktopFollowUpRpc;
  readonly reviewRpc?: DesktopReviewRpc;
}): DesktopShell {
  let stopped = false;
  const getSnapshot = options.getSnapshot ?? createEmptyDesktopSnapshot;

  let window: DesktopWindowPort;
  window = options.windowFactory.open({
    async onGetDesktopSnapshot() {
      if (stopped) {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }

      try {
        return createBootstrapEnvelope({ status: "ok", projection: await getSnapshot() });
      } catch {
        return createBootstrapEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_snapshot", reason: "projection_rejected" },
        });
      }
    },
    async onGetCardInspector({ cardId }) {
      if (stopped) {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "desktop_host", reason: "host_stopped" },
        });
      }
      if (cardId.trim().length === 0 || options.getCardInspector === undefined) {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "not_ready" },
        });
      }
      try {
        const projection = await options.getCardInspector(cardId as CardId);
        return createCardInspectorEnvelope(projection === null
          ? {
              status: "unavailable",
              unavailable: { resource: "card_inspector", reason: "not_ready" },
            }
          : { status: "ok", projection });
      } catch {
        return createCardInspectorEnvelope({
          status: "unavailable",
          unavailable: { resource: "card_inspector", reason: "projection_rejected" },
        });
      }
    },
    async onQueueFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.queueFollowUp(request);
    },
    async onRemoveQueuedFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.removeQueuedFollowUp(request);
    },
    async onConfirmQueuedFollowUp(request) {
      return options.followUpRpc === undefined
        ? unavailableFollowUp(request.commandId)
        : options.followUpRpc.confirmQueuedFollowUp(request);
    },
    async onReviewCard(request) {
      if (stopped) return unavailableReview(request.commandId, "host_stopped");
      if (options.reviewRpc === undefined) return unavailableReview(request.commandId, "not_ready");
      try {
        const envelope = await options.reviewRpc.reviewCard(request);
        if (envelope.result.status === "committed") {
          window.sendHostMessage(assertHostMessage({
            kind: "projection_committed",
            messageId: `review:${request.commandId}`,
            revision: envelope.result.revision,
          }));
        }
        return envelope;
      } catch {
        return unavailableReview(request.commandId, "projection_rejected");
      }
    },
  });

  return {
    publish(message) {
      if (stopped) return false;
      window.sendHostMessage(assertHostMessage(message));
      return true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      window.removeHandlers();
      window.close();
    },
  };
}

function unavailableFollowUp(commandId: string): FollowUpRpcResultEnvelope {
  return {
    kind: "follow_up_command_result",
    commandId,
    result: {
      status: "rejected",
      reason: { code: "invalid_state", message: "Follow-up commands are not ready" },
    },
  };
}

function unavailableReview(
  commandId: string,
  reason: "not_ready" | "host_stopped" | "projection_rejected",
): ReviewCardRpcEnvelope {
  return { kind: "review_card_result", commandId, result: { status: "unavailable", reason } };
}

export async function main(): Promise<DesktopShell> {
  const { createElectrobunWindowFactory } = await import("./host/electrobunWindow.ts");
  return startDesktopShell({ windowFactory: await createElectrobunWindowFactory() });
}

if (import.meta.main) {
  await main();
}
