import { afterEach, describe, expect, test } from "bun:test";
import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import "../../settings/testDom.ts";
import type { DesktopRpcClient } from "../../client.ts";
import type { ReviewDispositionInput, SubmitCardPromptInput } from "../../../shared/rpc.ts";
import { createDesktopQueryClient } from "../../query/desktopQueries.ts";
import {
  attentionBlocker,
  inspectorCard,
  reviewManifest,
  TEST_ATTEMPT_ID,
  TEST_GENERATION,
} from "./testSupport.ts";
import { useInspectorCommands, type InspectorFeedback } from "./useInspectorCommands.ts";

afterEach(cleanup);

function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={createDesktopQueryClient()}>{children}</QueryClientProvider>;
}

function ok(commandId: string, kind: "inspector_command_result") {
  return { kind, commandId, result: { status: "ok" as const } };
}

describe("inspector command mutations", () => {
  test("routes start, immediate direction, and attention commands through React Query", async () => {
    const calls: string[] = [];
    const feedback: InspectorFeedback[] = [];
    let refreshes = 0;
    let consumed = 0;
    const client = {
      async submitCardPrompt(input: Parameters<DesktopRpcClient["submitCardPrompt"]>[0]) {
        calls.push(input.source);
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "ok" as const,
            outcome: input.source === "initial" ? "admitted" as const : "queued" as const,
            cardVersion: input.expectedCardVersion,
            attemptId: TEST_ATTEMPT_ID,
            generation: TEST_GENERATION,
          },
        };
      },
      async answerAttention(commandId: string) { calls.push("attention"); return ok(commandId, "inspector_command_result"); },
    } as unknown as DesktopRpcClient;
    const base = {
      client,
      card: inspectorCard("running"),
      attempt: { attemptId: TEST_ATTEMPT_ID, generation: TEST_GENERATION },
      queueVersion: 0,
      blocker: null,
      reviewEvidence: null,
      refresh: async () => { refreshes += 1; },
      onFeedback: (entry: InspectorFeedback) => { feedback.push(entry); },
      onDraftConsumed: () => { consumed += 1; },
    };
    const view = renderHook(() => useInspectorCommands(base), { wrapper });

    act(() => {
      view.result.current.startAttempt("Start message");
      view.result.current.sendDirection("Next message");
    });
    await waitFor(() => expect(calls).toEqual(["initial", "composer"]));
    await waitFor(() => expect(refreshes).toBe(2));
    expect(consumed).toBe(2);
    expect(feedback.every(({ tone }) => tone === "status")).toBeTrue();

    const manifest = reviewManifest();
    const review = renderHook(() => useInspectorCommands({
      ...base,
      card: inspectorCard("ready_for_review"),
      attempt: null,
      reviewEvidence: {
        evidenceId: manifest.evidenceId,
        evidenceDigest: manifest.evidenceDigest,
        attemptId: manifest.attemptId,
        generation: manifest.generation,
        worktreeBindingId: manifest.worktreeBindingId,
      },
    }), { wrapper });
    act(() => review.result.current.requestChanges("Please revise"));
    await waitFor(() => expect(calls.at(-1)).toBe("request_changes"));

    const attention = renderHook(() => useInspectorCommands({ ...base, blocker: attentionBlocker() }), { wrapper });
    act(() => attention.result.current.answerAttention({ kind: "skipped" }));
    await waitFor(() => expect(calls.at(-1)).toBe("attention"));
  });

  test("reports local guards, transport failures, and typed conflicts without consuming the draft", async () => {
    const feedback: InspectorFeedback[] = [];
    let consumed = 0;
    const client = {
      async submitCardPrompt(input: Parameters<DesktopRpcClient["submitCardPrompt"]>[0]) {
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "rejected" as const,
            error: { code: "stale_projection" as const, recoveryHint: "refresh_projection" as const },
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const view = renderHook(() => useInspectorCommands({
      client,
      card: inspectorCard("idle"),
      attempt: null,
      queueVersion: 0,
      blocker: null,
      reviewEvidence: null,
      refresh: async () => {},
      onFeedback: (entry) => { feedback.push(entry); },
      onDraftConsumed: () => { consumed += 1; },
    }), { wrapper });

    act(() => {
      view.result.current.startAttempt("Start");
      view.result.current.sendDirection("No attempt");
      view.result.current.answerAttention({ kind: "cancelled" });
    });
    await waitFor(() => expect(feedback).toHaveLength(3));
    expect(feedback.some(({ message }) => message.includes("task changed"))).toBeTrue();
    expect(feedback.filter(({ message }) => message.includes("desktop host did not finish"))).toHaveLength(2);
    expect(consumed).toBe(0);
  });

  test("clears only durable acceptance and retains drafts for every retryable rejection", async () => {
    const codes = [
      "submission_interrupted",
      "stale_projection",
      "evidence_stale",
      "evidence_missing",
      "evidence_oversized",
      "evidence_unsafe",
      "worktree_binding_mismatch",
      "attempt_active",
      "blocker_active",
    ] as const;
    let index = 0;
    let consumed = 0;
    const feedback: InspectorFeedback[] = [];
    const client = {
      async submitCardPrompt(input: Parameters<DesktopRpcClient["submitCardPrompt"]>[0]) {
        const code = codes[index++];
        if (code !== undefined) {
          return {
            kind: "submit_card_prompt_result" as const,
            commandId: input.commandId,
            result: {
              status: "rejected" as const,
              error: { code, recoveryHint: "none" as const },
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
            attemptId: TEST_ATTEMPT_ID,
            generation: TEST_GENERATION,
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const view = renderHook(() => useInspectorCommands({
      client,
      card: inspectorCard("idle"),
      attempt: null,
      queueVersion: 0,
      blocker: null,
      reviewEvidence: null,
      refresh: async () => {},
      onFeedback: (entry) => feedback.push(entry),
      onDraftConsumed: () => { consumed += 1; },
    }), { wrapper });

    for (const code of codes) {
      act(() => view.result.current.startAttempt(`Retain ${code}`));
      await waitFor(() => expect(feedback).toHaveLength(index));
    }
    expect(consumed).toBe(0);

    act(() => view.result.current.startAttempt("Accepted"));
    await waitFor(() => expect(consumed).toBe(1));
  });

  test("submits the exact evidence precondition for approval and reloads after stale review rejection", async () => {
    const manifest = reviewManifest();
    const precondition = {
      evidenceId: manifest.evidenceId,
      evidenceDigest: manifest.evidenceDigest,
      attemptId: manifest.attemptId,
      generation: manifest.generation,
      worktreeBindingId: manifest.worktreeBindingId,
    };
    const approvals: ReviewDispositionInput[] = [];
    const submissions: SubmitCardPromptInput[] = [];
    const rejected: string[] = [];
    let approvalCount = 0;
    const client = {
      async reviewCard(input: ReviewDispositionInput) {
        approvals.push(input);
        approvalCount += 1;
        return approvalCount === 1
          ? {
              kind: "review_approval_result" as const,
              commandId: input.commandId,
              result: {
                status: "rejected" as const,
                error: {
                  code: "evidence_stale" as const,
                  recoveryHint: "reload_evidence" as const,
                },
              },
            }
          : {
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
        return {
          kind: "submit_card_prompt_result" as const,
          commandId: input.commandId,
          result: {
            status: "ok" as const,
            outcome: "admitted" as const,
            cardVersion: input.expectedCardVersion + 1,
            attemptId: TEST_ATTEMPT_ID,
            generation: TEST_GENERATION,
          },
        };
      },
    } as unknown as DesktopRpcClient;
    const view = renderHook(() => useInspectorCommands({
      client,
      card: inspectorCard("ready_for_review"),
      attempt: null,
      queueVersion: 0,
      blocker: null,
      reviewEvidence: precondition,
      refresh: async () => {},
      onFeedback: () => {},
      onDraftConsumed: () => {},
      onReviewRejected: (code) => rejected.push(code),
    }), { wrapper });

    act(() => view.result.current.approveReview());
    await waitFor(() => expect(approvals).toHaveLength(1));
    expect(approvals[0]).toEqual({
      commandId: expect.stringMatching(/^inspector:approve:/),
      boardId: inspectorCard().boardId,
      cardId: inspectorCard().cardId,
      expectedCardVersion: inspectorCard().version,
      disposition: "approved",
      evidence: precondition,
    });
    expect(rejected).toEqual(["evidence_stale"]);

    act(() => view.result.current.approveReview());
    await waitFor(() => expect(approvals).toHaveLength(2));

    act(() => view.result.current.requestChanges("Keep the exact evidence"));
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toEqual({
      commandId: expect.stringMatching(/^inspector:request-changes:/),
      boardId: inspectorCard().boardId,
      cardId: inspectorCard().cardId,
      expectedCardVersion: inspectorCard().version,
      content: "Keep the exact evidence",
      source: "request_changes",
      evidence: precondition,
    });
  });
});
