import { describe, expect, test } from "bun:test";
import type { DesktopRpcClient } from "../client.ts";
import {
  REVIEW_DIFF_CHUNK_GC_TIME_MS,
  boardQueryOptions,
  createDesktopQueryClient,
  desktopQueryKeys,
  invalidateDesktopQueries,
  reviewDiffChunkQueryOptions,
  reviewManifestQueryOptions,
  supervisionQueryOptions,
} from "./desktopQueries.ts";

function client(overrides: Partial<DesktopRpcClient>): DesktopRpcClient {
  return overrides as DesktopRpcClient;
}

describe("desktop review evidence queries", () => {
  test("prevents collisions across cards, evidence, files, and offsets", () => {
    const keys = [
      desktopQueryKeys.reviewManifest("card-a", "evidence-a"),
      desktopQueryKeys.reviewManifest("card-b", "evidence-a"),
      desktopQueryKeys.reviewManifest("card-a", "evidence-b"),
      desktopQueryKeys.reviewDiffChunk("evidence-a", "file-a", 0),
      desktopQueryKeys.reviewDiffChunk("evidence-a", "file-b", 0),
      desktopQueryKeys.reviewDiffChunk("evidence-a", "file-a", 64),
      desktopQueryKeys.reviewDiffChunk("evidence-b", "file-a", 0),
    ].map((key) => JSON.stringify(key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("binds exact renderer request identities and gives immutable chunks finite garbage collection", async () => {
    const requests: unknown[] = [];
    const rpc = client({
      async getReviewManifest(request) {
        requests.push(request);
        return {
          kind: "review_manifest",
          result: {
            status: "unavailable",
            unavailable: { resource: "review_manifest", reason: "not_ready" },
          },
        };
      },
      async getReviewDiffChunk(request) {
        requests.push(request);
        return {
          kind: "review_diff_chunk",
          result: {
            status: "unavailable",
            unavailable: { resource: "review_diff_chunk", reason: "not_ready" },
          },
        };
      },
    });
    const manifest = reviewManifestQueryOptions(rpc, "card-a", "evidence-a");
    const chunk = reviewDiffChunkQueryOptions(rpc, "evidence-a", "file-a", 128);

    await manifest.queryFn!({} as never);
    await chunk.queryFn!({} as never);

    expect(requests).toEqual([
      { cardId: "card-a", evidenceId: "evidence-a" },
      { evidenceId: "evidence-a", fileId: "file-a", offset: 128 },
    ]);
    expect(chunk.gcTime).toBe(REVIEW_DIFF_CHUNK_GC_TIME_MS);
    expect(Number.isFinite(chunk.gcTime)).toBe(true);
    expect(chunk.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(boardQueryOptions(rpc, "board-a", "active").gcTime).toBeUndefined();
  });

  test("projection commits invalidate manifests without touching immutable chunks", async () => {
    const queryClient = createDesktopQueryClient();
    const manifestKey = desktopQueryKeys.reviewManifest("card-a", "evidence-a");
    const chunkKey = desktopQueryKeys.reviewDiffChunk("evidence-a", "file-a", 0);
    const supervisionKey = desktopQueryKeys.supervision;
    queryClient.setQueryData(manifestKey, { kind: "manifest" });
    queryClient.setQueryData(chunkKey, { kind: "chunk" });
    queryClient.setQueryData(supervisionKey, { kind: "supervision" });

    invalidateDesktopQueries(queryClient, {
      kind: "projection_committed",
      messageId: "projection-1",
      revision: 2,
    });
    await Bun.sleep(0);

    expect(queryClient.getQueryState(manifestKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(chunkKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(supervisionKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });

  test("binds one supervision query and degrades when the bridge is unavailable", async () => {
    let calls = 0;
    const available = supervisionQueryOptions(client({
      async getSupervision() {
        calls += 1;
        return {
          kind: "supervision",
          result: {
            status: "unavailable",
            unavailable: { resource: "supervision", reason: "not_ready" },
          },
        };
      },
    }));
    const missing = supervisionQueryOptions(client({}));

    await available.queryFn!({} as never);
    const unavailable = await missing.queryFn!({} as never);

    expect(calls).toBe(1);
    expect(JSON.stringify(available.queryKey)).toBe(JSON.stringify(desktopQueryKeys.supervision));
    expect(unavailable).toEqual({
      kind: "supervision",
      result: {
        status: "unavailable",
        unavailable: { resource: "supervision", reason: "not_ready" },
      },
    });
  });

  test("host unavailability invalidates the complete evidence family", async () => {
    const queryClient = createDesktopQueryClient();
    const manifestKey = desktopQueryKeys.reviewManifest("card-a", "evidence-a");
    const chunkKey = desktopQueryKeys.reviewDiffChunk("evidence-a", "file-a", 0);
    queryClient.setQueryData(manifestKey, { kind: "manifest" });
    queryClient.setQueryData(chunkKey, { kind: "chunk" });

    invalidateDesktopQueries(queryClient, {
      kind: "host_unavailable",
      messageId: "host-1",
      reason: "host_stopped",
    });
    await Bun.sleep(0);

    expect(queryClient.getQueryState(manifestKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(chunkKey)?.isInvalidated).toBe(true);
    queryClient.clear();
  });
});
