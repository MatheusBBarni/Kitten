import { useEffect } from "react";
import {
  QueryClient,
  queryOptions,
  useQueryClient,
} from "@tanstack/react-query";
import type { DesktopRpcClient } from "../client.ts";
import type { BoardMode } from "../state/desktopViewStore.ts";

export const desktopQueryKeys = {
  all: ["desktop"] as const,
  bootstrap: ["desktop", "bootstrap"] as const,
  board: (boardId: string | undefined, mode: BoardMode) => ["desktop", "board", mode, boardId ?? "default"] as const,
  boards: ["desktop", "board"] as const,
  workspace: ["desktop", "workspace"] as const,
  catalog: ["desktop", "catalog"] as const,
  settings: ["desktop", "settings"] as const,
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

export function useDesktopHostInvalidation(client: DesktopRpcClient): void {
  const queryClient = useQueryClient();

  useEffect(() => client.subscribe((message) => {
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
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.catalog });
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.bootstrap });
      return;
    }
    if (message.kind === "host_unavailable") {
      void queryClient.invalidateQueries({ queryKey: desktopQueryKeys.all });
    }
  }), [client, queryClient]);
}
