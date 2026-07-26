import { describe, expect, test } from "bun:test";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import type { DesktopAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import { createAttentionFixture } from "../src/attention/testSupport.ts";
import { createDesktopBoardRpc } from "../src/host/boardRpc.ts";
import {
  createDesktopPromptSubmissionRpc,
  createDesktopReviewRpc,
} from "../src/host/desktopRpc.ts";
import { createDesktopSettingsRpc } from "../src/host/settingsRpc.ts";
import {
  createMemoryWorkflowMeasurementStorage,
  createWorkflowMeasurement,
} from "../src/host/workflowMeasurement.ts";
import type { ReviewDispositionService } from "../src/host/reviewDisposition.ts";
import type {
  ReviewDispositionInput,
  SubmitCardPromptInput,
} from "../src/shared/rpc.ts";
import { createWorkflowCommandHandler } from "../src/workflow/workflowCommands.ts";

const reviewInput: ReviewDispositionInput = {
  commandId: "review-command",
  boardId: "board-measurement" as never,
  cardId: "card-measurement" as never,
  expectedCardVersion: 1,
  disposition: "approved",
  evidence: {
    evidenceId: "evidence-measurement",
    evidenceDigest: "digest-measurement",
    attemptId: "attempt-measurement" as AttemptId,
    generation: 1 as AttemptGeneration,
    worktreeBindingId: "binding-measurement",
  },
};

const promptInput: SubmitCardPromptInput = {
  commandId: "prompt-command",
  boardId: "board-measurement" as never,
  cardId: "card-measurement" as never,
  expectedCardVersion: 1,
  content: "content remains inside the authoritative prompt boundary",
  source: "composer",
};

function promptCoordinator(): DesktopAttemptCoordinator {
  return {
    async start() {
      throw new Error("not used");
    },
    async submitCardPrompt() {
      return {
        status: "ok",
        outcome: "queued",
        cardVersion: 1,
        attemptId: "attempt-measurement" as AttemptId,
        generation: 1 as AttemptGeneration,
      };
    },
    async stop() {
      throw new Error("not used");
    },
    async release() {
      return false;
    },
  };
}

function reviewService(): ReviewDispositionService {
  return {
    async reviewCard() {
      return { status: "ok", outcome: "approved", cardVersion: 2 };
    },
    currentRevision() {
      return 2;
    },
  };
}

describe("workflow measurement integration", () => {
  test("records supervision, submission, and review outcomes only during the revision-fenced opt-in window", async () => {
    const fixture = createAttentionFixture();
    const storage = createMemoryWorkflowMeasurementStorage();
    const measurement = createWorkflowMeasurement({ storage });
    const settings = createDesktopSettingsRpc({
      onWorkflowMeasurementEnabledChanged: measurement.setEnabled,
    });
    const board = createDesktopBoardRpc(
      fixture.journal,
      createWorkflowCommandHandler(fixture.journal),
      { measurement, now: () => 20 },
    );
    const prompts = createDesktopPromptSubmissionRpc(promptCoordinator(), measurement);
    const reviews = createDesktopReviewRpc(reviewService(), measurement);

    await board.getSupervision({});
    await prompts.submitCardPrompt(promptInput);
    await reviews.reviewCard(reviewInput);
    expect(storage.events).toEqual([]);

    await settings.updatePreferences({
      commandId: "measurement-enable",
      input: {
        expectedRevision: 0,
        theme: "system",
        workflowMeasurementEnabled: true,
      },
    });
    await board.getSupervision({});
    await prompts.submitCardPrompt(promptInput);
    await reviews.reviewCard(reviewInput);
    expect(storage.events.map((event) => (event as { name: string }).name)).toEqual([
      "supervision_projection",
      "prompt_admission",
      "evidence_revalidation",
      "review_disposition",
    ]);
    expect(JSON.stringify(storage.events)).not.toContain(promptInput.content);

    await settings.updatePreferences({
      commandId: "measurement-disable",
      input: {
        expectedRevision: 1,
        theme: "system",
        workflowMeasurementEnabled: false,
      },
    });
    await board.getSupervision({});
    await prompts.submitCardPrompt(promptInput);
    await reviews.reviewCard(reviewInput);
    expect(storage.events).toHaveLength(4);

    fixture.database.close();
  });

  test("keeps authoritative RPC results unchanged when a measurement sink throws", async () => {
    const throwing = {
      record() {
        throw new Error("measurement storage failed");
      },
    };
    const promptResult = await createDesktopPromptSubmissionRpc(
      promptCoordinator(),
      throwing,
    ).submitCardPrompt(promptInput);
    const reviewResult = await createDesktopReviewRpc(
      reviewService(),
      throwing,
    ).reviewCard(reviewInput);
    expect(promptResult.result).toMatchObject({ status: "ok", outcome: "queued" });
    expect(reviewResult.result).toMatchObject({ status: "ok", outcome: "approved" });
  });

  test("records packaged results without paths or machine content and performs no network request", async () => {
    const storage = createMemoryWorkflowMeasurementStorage();
    const measurement = createWorkflowMeasurement({ storage, enabled: true });
    let networkRequests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      networkRequests += 1;
      throw new Error("network request forbidden");
    }) as unknown as typeof fetch;
    try {
      measurement.record({
        schemaVersion: 1,
        name: "packaged_verification",
        outcome: "passed",
        fixture: "ready_for_review",
        keyboardOnly: true,
      });
      await createDesktopPromptSubmissionRpc(
        promptCoordinator(),
        measurement,
      ).submitCardPrompt(promptInput);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(networkRequests).toBe(0);
    const serialized = JSON.stringify(storage.events);
    expect(serialized).not.toContain("/");
    expect(serialized).not.toContain(promptInput.content);
    expect(serialized).toContain("\"fixture\":\"ready_for_review\"");
  });
});
