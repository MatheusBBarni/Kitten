import { useEffect } from "react";
import {
  QueryClient,
  queryOptions,
  useQueryClient,
} from "@tanstack/react-query";
import type { DesktopRpcClient } from "../client.ts";
import type {
  GetReviewManifestRequest,
  HostMessageEnvelope,
} from "../../shared/rpc.ts";
import type { BoardMode } from "../state/desktopViewStore.ts";

export const REVIEW_DIFF_CHUNK_GC_TIME_MS = 2 * 60 * 1_000;

export const desktopQueryKeys = {
  all: ["desktop"] as const,
  bootstrap: ["desktop", "bootstrap"] as const,
  board: (boardId: string | undefined, mode: BoardMode) => ["desktop", "board", mode, boardId ?? "default"] as const,
  boards: ["desktop", "board"] as const,
  workspace: ["desktop", "workspace"] as const,
  supervision: ["desktop", "supervision"] as const,
  catalog: ["desktop", "catalog"] as const,
  settings: ["desktop", "settings"] as const,
  evidence: ["desktop", "evidence"] as const,
  reviewManifests: ["desktop", "evidence", "manifest"] as const,
  reviewManifest: (cardId: string, evidenceId: string) =>
    ["desktop", "evidence", "manifest", cardId, evidenceId] as const,
  reviewChunks: ["desktop", "evidence", "chunk"] as const,
  reviewDiffChunk: (evidenceId: string, fileId: string, offset: number) =>
    ["desktop", "evidence", "chunk", evidenceId, fileId, offset] as const,
} as const;

export function createDesktopQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export function bootstrapQueryOptions(client: DesktopRpcClient) {
  return queryOptions({
    queryKey: desktopQueryKeys.bootstrap,
    queryFn: () => client.getDesktopSnapshot(),
  });
}

export function boardQueryOptions(client: DesktopRpcClient, boardId: string | undefined, mode: BoardMode) {
  return queryOptions({
    queryKey: desktopQueryKeys.board(boardId, mode),
    queryFn: () => client.getBoard(boardId, mode),
  });
}

export function workspaceQueryOptions(client: DesktopRpcClient) {
  return queryOptions({
    queryKey: desktopQueryKeys.workspace,
    queryFn: () => client.getWorkspace!(),
    enabled: client.getWorkspace !== undefined,
  });
}

export function supervisionQueryOptions(client: DesktopRpcClient) {
  return queryOptions({
    queryKey: desktopQueryKeys.supervision,
    queryFn: () => client.getSupervision?.() ?? Promise.resolve({
      kind: "supervision" as const,
      result: {
        status: "unavailable" as const,
        unavailable: {
          resource: "supervision" as const,
          reason: "not_ready" as const,
        },
      },
    }),
  });
}

export function catalogQueryOptions(client: DesktopRpcClient) {
  return queryOptions({
    queryKey: desktopQueryKeys.catalog,
    queryFn: () => client.getCatalog(),
  });
}

export function settingsQueryOptions(client: DesktopRpcClient) {
  return queryOptions({
    queryKey: desktopQueryKeys.settings,
    queryFn: () => client.getSettings(),
  });
}

export function reviewManifestQueryOptions(
  client: DesktopRpcClient,
  cardId: string,
  evidenceId: string,
) {
  return queryOptions({
    queryKey: desktopQueryKeys.reviewManifest(cardId, evidenceId),
    queryFn: () => client.getReviewManifest({
      cardId: cardId as GetReviewManifestRequest["cardId"],
      evidenceId,
    }),
  });
}

export function reviewDiffChunkQueryOptions(
  client: DesktopRpcClient,
  evidenceId: string,
  fileId: string,
  offset: number,
) {
  return queryOptions({
    queryKey: desktopQueryKeys.reviewDiffChunk(evidenceId, fileId, offset),
    queryFn: () => client.getReviewDiffChunk({ evidenceId, fileId, offset }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: REVIEW_DIFF_CHUNK_GC_TIME_MS,
  });
}

export function invalidateDesktopQueries(
  queryClient: QueryClient,
  message: HostMessageEnvelope,
): void {
  if (message.kind === "settings_committed") {
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.settings });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.bootstrap });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.catalog });
    return;
  }
  if (
    message.kind === "projection_committed"
    || message.kind === "attempt_activity"
  ) {
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.boards });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.workspace });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.supervision });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.catalog });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.bootstrap });
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.reviewManifests });
    return;
  }
  if (message.kind === "host_unavailable") {
    void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.all });
  }
}

export function useDesktopHostInvalidation(client: DesktopRpcClient): void {
  const queryClient = useQueryClient();

  useEffect(() => client.subscribe((message) => {
    invalidateDesktopQueries(queryClient, message);
  }), [client, queryClient]);
}
