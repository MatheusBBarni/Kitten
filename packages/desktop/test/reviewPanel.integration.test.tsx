import { afterEach, describe, expect, test } from "bun:test";
import "../src/renderer/settings/testDom.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CardInspectorProjection } from "../src/attempts/inspectorProjection.ts";
import type {
  HostMessageEnvelope,
  ReviewDispositionInput,
  ReviewEvidenceManifest,
  SubmitCardPromptInput,
} from "../src/shared/rpc.ts";
import { createCardInspectorEnvelope } from "../src/shared/rpc.ts";
import type { DesktopRpcClient } from "../src/renderer/client.ts";
import { createDesktopQueryClient } from "../src/renderer/query/desktopQueries.ts";
import { CardInspector } from "../src/renderer/features/inspector/CardInspector.tsx";
import {
  inspectorProjection,
  reviewManifest,
} from "../src/renderer/features/inspector/testSupport.ts";
import {
  resetDesktopViewStore,
  useDesktopViewStore,
} from "../src/renderer/state/desktopViewStore.ts";

afterEach(() => {
  cleanup();
  resetDesktopViewStore();
  window.localStorage.clear();
});

function refreshedManifest(): ReviewEvidenceManifest {
  const current = reviewManifest();
  return {
    ...current,
    revision: current.revision + 1,
    evidenceId: "evidence-inspector-refreshed",
    evidenceDigest: "e".repeat(64),
    availability: {
      status: "available",
      evidenceId: "evidence-inspector-refreshed",
      evidenceDigest: "e".repeat(64),
    },
    files: [{
      ...current.files[0]!,
      fileId: "file-inspector-refreshed",
      patchDigest: "f".repeat(64),
    }],
  };
}

function projectionFor(manifest: ReviewEvidenceManifest): CardInspectorProjection {
  const projection = inspectorProjection({
    status: "ready_for_review",
    terminalOutcome: "succeeded",
    evidence: true,
  });
  return {
    ...projection,
    reviewEvidence: [{
      evidenceId: manifest.evidenceId,
      evidenceDigest: manifest.evidenceDigest,
      attemptId: manifest.attemptId,
      generation: manifest.generation,
      worktreeBindingId: manifest.worktreeBindingId,
      fileCount: manifest.fileCount,
      totalPatchBytes: manifest.totalPatchBytes,
      createdAt: manifest.createdAt,
    }],
  };
}

function reviewClient(options: {
  readonly rejectFirstRequestChanges?: boolean;
} = {}) {
  let manifest = reviewManifest();
  let projection = projectionFor(manifest);
  let subscriber: ((message: HostMessageEnvelope) => void) | undefined;
  let rejectNextRequest = options.rejectFirstRequestChanges === true;
  const calls: string[] = [];
  const approvals: ReviewDispositionInput[] = [];
  const submissions: SubmitCardPromptInput[] = [];
  const client = {
    async getCardInspector() {
      calls.push(`inspector:${manifest.evidenceId}`);
      return createCardInspectorEnvelope({ status: "ok", projection });
    },
    async getReviewManifest(request: { readonly evidenceId: string }) {
      calls.push(`manifest:${request.evidenceId}`);
      if (request.evidenceId !== manifest.evidenceId) {
        return {
          kind: "review_manifest" as const,
          result: {
            status: "rejected" as const,
            error: {
              code: "evidence_stale" as const,
              recoveryHint: "reload_evidence" as const,
            },
          },
        };
      }
      return {
        kind: "review_manifest" as const,
        result: { status: "ok" as const, projection: manifest },
      };
    },
    async getReviewDiffChunk(request: {
      readonly evidenceId: string;
      readonly fileId: string;
      readonly offset: number;
    }) {
      calls.push(`chunk:${request.evidenceId}:${request.fileId}:${request.offset}`);
      return {
        kind: "review_diff_chunk" as const,
        result: {
          status: "ok" as const,
          projection: {
            kind: "review_diff_chunk" as const,
            schemaVersion: 1 as const,
            evidenceId: request.evidenceId,
            fileId: request.fileId,
            offset: request.offset,
            nextOffset: null,
            complete: true,
            content: `patch:${request.evidenceId}`,
            encoding: "utf8" as const,
          },
        },
      };
    },
    async reviewCard(input: ReviewDispositionInput) {
      approvals.push(input);
      return {
        kind: "review_approval_result" as const,
        commandId: input.commandId,
        result: {
          status: "ok" as const,
          outcome: "approved" as const,
          cardVersion: input.expectedCardVersion + 1,
        },
      };
    },
    async submitCardPrompt(input: SubmitCardPromptInput) {
      submissions.push(input);
      if (input.source === "request_changes" && rejectNextRequest) {
        rejectNextRequest = false;
        manifest = refreshedManifest();
        projection = projectionFor(manifest);
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "rejected" as const,
            error: {
              code: "evidence_stale" as const,
              recoveryHint: "reload_evidence" as const,
            },
          },
        };
      }
      return {
        kind: "submit_card_prompt_result" as const,
        commandId: input.commandId,
        result: {
          status: "ok" as const,
          outcome: "admitted" as const,
          cardVersion: input.expectedCardVersion + 1,
          attemptId: manifest.attemptId,
          generation: manifest.generation,
        },
      };
    },
    async getDesktopSnapshot() { throw new Error("not used"); },
    async getBoard() { throw new Error("not used"); },
    async getCatalog() { throw new Error("not used"); },
    async executeWorkflowCommand() { throw new Error("not used"); },
    async answerAttention() { throw new Error("not used"); },
    async getSettings() { throw new Error("not used"); },
    async updatePreferences() { throw new Error("not used"); },
    async updateProfileDefaults() { throw new Error("not used"); },
    async updateCatalogRoots() { throw new Error("not used"); },
    async setExecutionLimit() { throw new Error("not used"); },
    subscribe(listener: (message: HostMessageEnvelope) => void) {
      subscriber = listener;
      return () => {
        subscriber = undefined;
      };
    },
    dispose() {},
  } as DesktopRpcClient;
  return {
    client,
    calls,
    approvals,
    submissions,
    currentManifest: () => manifest,
    emit: (message: HostMessageEnvelope) => subscriber?.(message),
  };
}

function renderReview(client: DesktopRpcClient) {
  const projection = inspectorProjection({
    status: "ready_for_review",
    terminalOutcome: "succeeded",
    evidence: true,
  });
  return render(
    <QueryClientProvider client={createDesktopQueryClient()}>
      <CardInspector
        client={client}
        card={projection.card}
        repositoryKey="/Users/name/projects/kitten"
        isOpen
      />
    </QueryClientProvider>,
  );
}

describe("inspector review integration", () => {
  test("loads manifest metadata before a selected-file chunk and approves with exact preconditions", async () => {
    const fake = reviewClient();
    const view = renderReview(fake.client);
    const user = userEvent.setup();

    await user.click(await view.findByRole("button", { name: "Open review" }));
    expect(fake.calls.some((call) => call.startsWith("chunk:"))).toBeFalse();
    await user.click(await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/ }));
    expect(await view.findByText(`patch:${reviewManifest().evidenceId}`)).toBeDefined();
    expect(fake.calls.findIndex((call) => call.startsWith("manifest:"))).toBeLessThan(
      fake.calls.findIndex((call) => call.startsWith("chunk:")),
    );

    await user.click(view.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fake.approvals).toHaveLength(1));
    expect(fake.approvals[0]).toEqual({
      commandId: expect.stringMatching(/^inspector:approve:/),
      boardId: reviewManifest().boardId,
      cardId: reviewManifest().cardId,
      expectedCardVersion: projectionFor(reviewManifest()).card.version,
      disposition: "approved",
      evidence: {
        evidenceId: reviewManifest().evidenceId,
        evidenceDigest: reviewManifest().evidenceDigest,
        attemptId: reviewManifest().attemptId,
        generation: reviewManifest().generation,
        worktreeBindingId: reviewManifest().worktreeBindingId,
      },
    });
    expect(JSON.stringify(fake.approvals[0])).not.toContain("src/old.ts");
    expect(JSON.stringify(fake.approvals[0])).not.toContain("patch:");
  });

  test("traverses file, diff, dispositions, and focused draft in logical keyboard order", async () => {
    const fake = reviewClient();
    const view = renderReview(fake.client);
    const user = userEvent.setup();

    await user.click(await view.findByRole("button", { name: "Open review" }));
    const fileButton = await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/ });
    await user.click(fileButton);
    const patch = await view.findByLabelText(/Patch content for src\/old\.ts → src\/new\.ts/);
    const approve = view.getByRole("button", { name: "Approve" });
    const requestChanges = view.getByRole("button", { name: "Request changes" });

    fileButton.focus();
    await user.tab();
    expect(document.activeElement).toBe(patch);
    await user.tab();
    expect(document.activeElement).toBe(approve);
    await user.tab();
    expect(document.activeElement).toBe(requestChanges);
    await user.keyboard("{Enter}");

    const draft = view.getByLabelText("Message") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe("Please address these review findings:");
    expect(fake.submissions).toHaveLength(0);

    await user.click(draft);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.type(draft, "Revise the selected behavior{Enter}");
    await waitFor(() => expect(fake.submissions).toHaveLength(1));
    expect(fake.submissions[0]?.source).toBe("request_changes");
    expect(fake.submissions[0]?.content).toBe("Revise the selected behavior");
  });

  test("preserves selected file and draft while reloading after host stale rejection", async () => {
    const fake = reviewClient({ rejectFirstRequestChanges: true });
    const view = renderReview(fake.client);
    const user = userEvent.setup();

    await user.click(await view.findByRole("button", { name: "Open review" }));
    const fileButton = await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/ });
    await user.click(fileButton);
    expect(await view.findByText(`patch:${reviewManifest().evidenceId}`)).toBeDefined();
    await user.click(view.getByRole("button", { name: "Request changes" }));

    const draft = view.getByLabelText("Message") as HTMLTextAreaElement;
    await user.click(draft);
    await user.keyboard("{Control>}a{/Control}{Backspace}");
    await user.type(draft, "Preserve this review draft{Enter}");
    await waitFor(() => expect(fake.submissions).toHaveLength(1));
    expect(await view.findByText(/Review evidence changed\. Reload and review the current manifest/)).toBeDefined();

    const nextManifest = fake.currentManifest();
    expect(await view.findByText(`patch:${nextManifest.evidenceId}`)).toBeDefined();
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("Preserve this review draft");
    expect(view.getByRole("button", { name: /src\/old\.ts → src\/new\.ts/ }).getAttribute("aria-pressed")).toBe("true");
    expect(fake.calls).toContain(`manifest:${nextManifest.evidenceId}`);
    expect(fake.submissions).toHaveLength(1);
  });
});
