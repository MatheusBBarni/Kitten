import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ReviewDiffChunk,
  ReviewDiffChunkEnvelope,
  ReviewEvidenceFileSummary,
} from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import { DiffViewer, REVIEW_FILE_PATCH_LIMIT_BYTES } from "./DiffViewer.tsx";

afterEach(cleanup);

function file(input: Partial<ReviewEvidenceFileSummary> = {}): ReviewEvidenceFileSummary {
  return {
    fileId: "file-a",
    index: 0,
    status: "modified",
    oldPath: "src/file.ts",
    newPath: "src/file.ts",
    oldMode: "100644",
    newMode: "100644",
    isBinary: false,
    additions: 1,
    deletions: 1,
    patchByteLength: 128,
    patchDigest: "b".repeat(64),
    contentDigest: null,
    ...input,
  };
}

function chunk(input: Partial<ReviewDiffChunk> = {}): ReviewDiffChunkEnvelope {
  return {
    kind: "review_diff_chunk",
    result: {
      status: "ok",
      projection: {
        kind: "review_diff_chunk",
        schemaVersion: 1,
        evidenceId: "evidence-a",
        fileId: "file-a",
        offset: 0,
        nextOffset: null,
        complete: true,
        content: "first chunk",
        encoding: "utf8",
        ...input,
      },
    },
  };
}

function renderViewer(client: DesktopRpcClient, selectedFile = file()) {
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>
      <DiffViewer
        key={`${selectedFile.fileId}`}
        client={client}
        evidenceId="evidence-a"
        file={selectedFile}
      />
    </QueryClientProvider>,
  );
}

describe("bounded diff viewer", () => {
  test("requests offset zero and follows the exact nextOffset without concatenating chunks", async () => {
    const offsets: number[] = [];
    const client = {
      async getReviewDiffChunk(request: { readonly offset: number }) {
        offsets.push(request.offset);
        return request.offset === 0
          ? chunk({ content: "chunk zero only", nextOffset: 17, complete: false })
          : chunk({ offset: 17, content: "chunk seventeen only" });
      },
    } as unknown as DesktopRpcClient;
    const view = renderViewer(client);

    expect(await view.findByText("chunk zero only")).toBeDefined();
    await userEvent.setup().click(view.getByRole("button", { name: "Next chunk" }));
    expect(await view.findByText("chunk seventeen only")).toBeDefined();
    expect(view.queryByText("chunk zero only")).toBeNull();
    expect(offsets).toEqual([0, 17]);

    await userEvent.setup().click(view.getByRole("button", { name: "Previous chunk" }));
    expect(await view.findByText("chunk zero only")).toBeDefined();
    expect(offsets).toEqual([0, 17]);
  });

  test("ignores a late chunk after switching files", async () => {
    let resolveFirst: ((value: ReviewDiffChunkEnvelope) => void) | undefined;
    const first = new Promise<ReviewDiffChunkEnvelope>((resolve) => {
      resolveFirst = resolve;
    });
    const requests: string[] = [];
    const client = {
      async getReviewDiffChunk(request: { readonly fileId: string }) {
        requests.push(request.fileId);
        if (request.fileId === "file-a") return first;
        return chunk({ fileId: "file-b", content: "current file content" });
      },
    } as unknown as DesktopRpcClient;
    const queryClient = createDesktopQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <DiffViewer key="file-a" client={client} evidenceId="evidence-a" file={file()} />
      </QueryClientProvider>,
    );

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <DiffViewer
          key="file-b"
          client={client}
          evidenceId="evidence-a"
          file={file({
            fileId: "file-b",
            oldPath: "src/other.ts",
            newPath: "src/other.ts",
          })}
        />
      </QueryClientProvider>,
    );
    expect(await view.findByText("current file content")).toBeDefined();
    resolveFirst?.(chunk({ content: "late stale content" }));
    await Promise.resolve();

    expect(view.queryByText("late stale content")).toBeNull();
    expect(view.getByText("current file content")).toBeDefined();
    expect(requests).toEqual(["file-a", "file-b"]);
  });

  test("renders binary and oversized metadata without requesting patch content", () => {
    let requests = 0;
    const client = {
      async getReviewDiffChunk() {
        requests += 1;
        return chunk();
      },
    } as unknown as DesktopRpcClient;
    const binary = renderViewer(client, file({
      status: "binary",
      isBinary: true,
      patchByteLength: 0,
      contentDigest: "c".repeat(64),
    }));
    expect(binary.getByText(/Binary file\. Text patch content was not requested/)).toBeDefined();
    expect(requests).toBe(0);
    binary.unmount();

    const oversized = renderViewer(client, file({
      fileId: "file-large",
      patchByteLength: REVIEW_FILE_PATCH_LIMIT_BYTES + 1,
    }));
    expect(oversized.getByText(/exceeds the 8 MiB text-review limit/)).toBeDefined();
    expect(requests).toBe(0);
  });

  test("renders stale and unavailable recovery guidance", async () => {
    const staleClient = {
      async getReviewDiffChunk() {
        return {
          kind: "review_diff_chunk",
          result: {
            status: "rejected",
            error: { code: "evidence_stale", recoveryHint: "reload_evidence" },
          },
        } satisfies ReviewDiffChunkEnvelope;
      },
    } as unknown as DesktopRpcClient;
    const stale = renderViewer(staleClient);
    expect(await stale.findByText(/This diff is stale\. Reload the manifest/)).toBeDefined();
    stale.unmount();

    const unavailableClient = {
      async getReviewDiffChunk() {
        return {
          kind: "review_diff_chunk",
          result: {
            status: "unavailable",
            unavailable: { resource: "review_diff_chunk", reason: "not_ready" },
          },
        } satisfies ReviewDiffChunkEnvelope;
      },
    } as unknown as DesktopRpcClient;
    const unavailable = renderViewer(unavailableClient);
    expect(await unavailable.findByText(/unavailable while the desktop host is not ready/)).toBeDefined();
  });

  test("rejects a chunk whose identity does not match the current selection", async () => {
    const client = {
      async getReviewDiffChunk() {
        return chunk({ fileId: "late-file" });
      },
    } as unknown as DesktopRpcClient;
    const view = renderViewer(client);
    await waitFor(() => expect(view.getByText(/no longer matches the selected file/)).toBeDefined());
  });
});
