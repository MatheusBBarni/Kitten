import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InspectorReviewEvidenceSummary } from "../../../attempts/inspectorProjection.ts";
import type {
  ContractErrorCode,
  ReviewEvidenceManifest,
  ReviewManifestEnvelope,
} from "../../../shared/rpc.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import {
  inspectorCard,
  reviewManifest,
  TEST_EVIDENCE_DIGEST,
  TEST_EVIDENCE_ID,
} from "./testSupport.ts";
import { ReviewPanel } from "./ReviewPanel.tsx";

afterEach(cleanup);

function evidence(manifest = reviewManifest()): InspectorReviewEvidenceSummary {
  return {
    evidenceId: manifest.evidenceId,
    evidenceDigest: manifest.evidenceDigest,
    attemptId: manifest.attemptId,
    generation: manifest.generation,
    worktreeBindingId: manifest.worktreeBindingId,
    fileCount: manifest.fileCount,
    totalPatchBytes: manifest.totalPatchBytes,
    createdAt: manifest.createdAt,
  };
}

function okManifest(manifest = reviewManifest()): ReviewManifestEnvelope {
  return {
    kind: "review_manifest",
    result: { status: "ok", projection: manifest },
  };
}

function renderPanel(input: {
  readonly client: DesktopRpcClient;
  readonly manifest?: ReviewEvidenceManifest;
  readonly evidence?: InspectorReviewEvidenceSummary;
  readonly card?: CardProjection;
  readonly busy?: boolean;
  readonly onApprove?: (manifest: ReviewEvidenceManifest) => void;
  readonly onRequestChanges?: (manifest: ReviewEvidenceManifest) => void;
  readonly onReload?: () => Promise<void>;
}) {
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>
      <ReviewPanel
        client={input.client}
        card={input.card ?? inspectorCard("ready_for_review")}
        evidence={input.evidence ?? evidence(input.manifest)}
        busy={input.busy ?? false}
        onApprove={input.onApprove ?? (() => {})}
        onRequestChanges={input.onRequestChanges ?? (() => {})}
        onClose={() => {}}
        onReload={input.onReload ?? (async () => {})}
      />
    </QueryClientProvider>,
  );
}

describe("manifest-first review panel", () => {
  test("keeps dispositions disabled while the manifest is loading", async () => {
    const client = {
      async getReviewManifest() {
        return new Promise<ReviewManifestEnvelope>(() => {});
      },
    } as unknown as DesktopRpcClient;
    const view = renderPanel({ client });

    expect(view.getByText(/Loading the review manifest before any disposition/)).toBeDefined();
    expect(view.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
    expect(view.getByRole("button", { name: "Request changes" }).hasAttribute("disabled")).toBeTrue();
  });

  test("enables both actions only for a host-declared current, identity-bound manifest", async () => {
    const approved: string[] = [];
    const requested: string[] = [];
    const client = {
      async getReviewManifest() {
        return okManifest();
      },
    } as unknown as DesktopRpcClient;
    const view = renderPanel({
      client,
      onApprove: (manifest) => approved.push(manifest.evidenceId),
      onRequestChanges: (manifest) => requested.push(manifest.evidenceId),
    });

    await view.findByText("Current evidence");
    const approve = view.getByRole("button", { name: "Approve" });
    const request = view.getByRole("button", { name: "Request changes" });
    expect(approve.hasAttribute("disabled")).toBeFalse();
    expect(request.hasAttribute("disabled")).toBeFalse();
    await userEvent.setup().click(approve);
    await userEvent.setup().click(request);
    expect(approved).toEqual([TEST_EVIDENCE_ID]);
    expect(requested).toEqual([TEST_EVIDENCE_ID]);
  });

  test("fails closed when manifest identity differs even if availability says available", async () => {
    const manifest = {
      ...reviewManifest(),
      evidenceDigest: "d".repeat(64),
      availability: {
        status: "available" as const,
        evidenceId: TEST_EVIDENCE_ID,
        evidenceDigest: "d".repeat(64),
      },
    };
    const client = {
      async getReviewManifest() {
        return okManifest(manifest);
      },
    } as unknown as DesktopRpcClient;
    const view = renderPanel({
      client,
      manifest,
      evidence: { ...evidence(), evidenceDigest: TEST_EVIDENCE_DIGEST },
    });

    expect(await view.findByText(/manifest no longer matches this card and attempt/)).toBeDefined();
    expect(view.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
    expect(view.getByRole("button", { name: "Request changes" }).hasAttribute("disabled")).toBeTrue();
  });

  test("shows exact recovery guidance for stale, missing, oversized, and unsafe evidence", async () => {
    const cases: readonly [ContractErrorCode, RegExp][] = [
      ["evidence_stale", /Review evidence changed\. Reload the manifest/],
      ["evidence_missing", /Review evidence is missing\. Retry evidence capture/],
      ["evidence_oversized", /change set exceeds the review limit\. Reduce the change set/],
      ["evidence_unsafe", /unsupported or unsafe evidence\. Resolve the unsafe change/],
    ];
    for (const [code, expected] of cases) {
      const manifest = {
        ...reviewManifest(),
        availability: {
          status: "unavailable" as const,
          error: { code, recoveryHint: "none" as const },
        },
      };
      const client = {
        async getReviewManifest() {
          return okManifest(manifest);
        },
      } as unknown as DesktopRpcClient;
      const view = renderPanel({ client, manifest });
      expect(await view.findByText(expected)).toBeDefined();
      expect(view.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
      view.unmount();
    }
  });

  test("keeps dispositions disabled for unavailable, rejected, and failed manifest reads", async () => {
    const unavailableClient = {
      async getReviewManifest() {
        return {
          kind: "review_manifest",
          result: {
            status: "unavailable",
            unavailable: { resource: "review_manifest", reason: "not_ready" },
          },
        } satisfies ReviewManifestEnvelope;
      },
    } as unknown as DesktopRpcClient;
    const unavailable = renderPanel({ client: unavailableClient });
    expect(await unavailable.findByText(/Review is unavailable while the desktop host is not ready/)).toBeDefined();
    expect(unavailable.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
    unavailable.unmount();

    const rejectedClient = {
      async getReviewManifest() {
        return {
          kind: "review_manifest",
          result: {
            status: "rejected",
            error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
          },
        } satisfies ReviewManifestEnvelope;
      },
    } as unknown as DesktopRpcClient;
    const rejected = renderPanel({ client: rejectedClient });
    expect(await rejected.findByText(/Review evidence is missing\. Retry evidence capture/)).toBeDefined();
    expect(rejected.getByRole("button", { name: "Request changes" }).hasAttribute("disabled")).toBeTrue();
    rejected.unmount();

    const failedClient = {
      async getReviewManifest(): Promise<ReviewManifestEnvelope> {
        throw new Error("host disconnected");
      },
    } as unknown as DesktopRpcClient;
    const failed = renderPanel({ client: failedClient });
    expect(await failed.findByText(/desktop host did not return the review manifest/)).toBeDefined();
    expect(failed.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
  });

  test("fails closed for not-applicable evidence and cards no longer ready for review", async () => {
    const notApplicable = {
      ...reviewManifest(),
      availability: { status: "not_applicable" as const },
    };
    const client = {
      async getReviewManifest() {
        return okManifest(notApplicable);
      },
    } as unknown as DesktopRpcClient;
    const unavailable = renderPanel({ client, manifest: notApplicable });
    expect(await unavailable.findByText(/Review evidence is not available for this card/)).toBeDefined();
    expect(unavailable.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBeTrue();
    unavailable.unmount();

    const currentClient = {
      async getReviewManifest() {
        return okManifest();
      },
    } as unknown as DesktopRpcClient;
    const completed = renderPanel({
      client: currentClient,
      card: inspectorCard("completed"),
    });
    expect(await completed.findByText(/card is no longer ready for review/)).toBeDefined();
    expect(completed.getByRole("button", { name: "Request changes" }).hasAttribute("disabled")).toBeTrue();
  });

  test("requests no chunk until a text file is selected, then requests only that file", async () => {
    const calls: string[] = [];
    const client = {
      async getReviewManifest() {
        calls.push("manifest");
        return okManifest();
      },
      async getReviewDiffChunk(request: { readonly fileId: string; readonly offset: number }) {
        calls.push(`chunk:${request.fileId}:${request.offset}`);
        return {
          kind: "review_diff_chunk",
          result: {
            status: "ok",
            projection: {
              kind: "review_diff_chunk",
              schemaVersion: 1,
              evidenceId: TEST_EVIDENCE_ID,
              fileId: request.fileId,
              offset: request.offset,
              nextOffset: null,
              complete: true,
              content: "selected patch",
              encoding: "utf8",
            },
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const view = renderPanel({ client });

    const fileButton = await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/ });
    expect(calls).toEqual(["manifest"]);
    await userEvent.setup().click(fileButton);
    expect(await view.findByText("selected patch")).toBeDefined();
    expect(calls).toEqual(["manifest", "chunk:file-inspector-renderer:0"]);
  });

  test("renders a binary summary without requesting text patch content", async () => {
    let chunks = 0;
    const manifest = {
      ...reviewManifest(),
      files: [{
        ...reviewManifest().files[0]!,
        status: "binary" as const,
        isBinary: true,
        additions: null,
        deletions: null,
        patchByteLength: 0,
        contentDigest: "c".repeat(64),
      }],
    };
    const client = {
      async getReviewManifest() {
        return okManifest(manifest);
      },
      async getReviewDiffChunk() {
        chunks += 1;
        throw new Error("binary content must not be requested");
      },
    } as unknown as DesktopRpcClient;
    const view = renderPanel({ client, manifest });

    await userEvent.setup().click(await view.findByRole("button", { name: /binary/ }));
    expect(view.getByText(/Binary file\. Text patch content was not requested/)).toBeDefined();
    expect(chunks).toBe(0);
  });

  test("keeps the selected path through a refreshed manifest identity", async () => {
    const first = reviewManifest();
    const second = {
      ...first,
      evidenceId: "evidence-refreshed",
      evidenceDigest: "e".repeat(64),
      availability: {
        status: "available" as const,
        evidenceId: "evidence-refreshed",
        evidenceDigest: "e".repeat(64),
      },
      files: [{
        ...first.files[0]!,
        fileId: "file-refreshed",
      }],
    };
    const client = {
      async getReviewManifest(request: { readonly evidenceId: string }) {
        return okManifest(request.evidenceId === first.evidenceId ? first : second);
      },
      async getReviewDiffChunk(request: { readonly evidenceId: string; readonly fileId: string }) {
        return {
          kind: "review_diff_chunk",
          result: {
            status: "ok",
            projection: {
              kind: "review_diff_chunk",
              schemaVersion: 1,
              evidenceId: request.evidenceId,
              fileId: request.fileId,
              offset: 0,
              nextOffset: null,
              complete: true,
              content: request.evidenceId,
              encoding: "utf8",
            },
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const queryClient = createDesktopQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ReviewPanel
          client={client}
          card={inspectorCard("ready_for_review")}
          evidence={evidence(first)}
          busy={false}
          onApprove={() => {}}
          onRequestChanges={() => {}}
          onClose={() => {}}
          onReload={async () => {}}
        />
      </QueryClientProvider>,
    );
    await userEvent.setup().click(await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/ }));
    expect((await view.findByLabelText(/Patch content for src\/old\.ts → src\/new\.ts/)).textContent).toBe(TEST_EVIDENCE_ID);

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ReviewPanel
          client={client}
          card={inspectorCard("ready_for_review")}
          evidence={evidence(second)}
          busy={false}
          onApprove={() => {}}
          onRequestChanges={() => {}}
          onClose={() => {}}
          onReload={async () => {}}
        />
      </QueryClientProvider>,
    );
    expect((await view.findByLabelText(/Patch content for src\/old\.ts → src\/new\.ts/)).textContent).toBe("evidence-refreshed");
    await waitFor(() => expect(view.getByRole("button", { name: /src\/old\.ts → src\/new\.ts/ }).getAttribute("aria-pressed")).toBe("true"));
  });
});
