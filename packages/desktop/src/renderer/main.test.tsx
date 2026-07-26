import { afterEach, describe, expect, test } from "bun:test";
import "./settings/testDom.ts";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AttemptGeneration, ProfileId } from "@kitten/engine";
import type { DesktopRpcClient } from "./client.ts";
import {
  createBootstrapEnvelope,
  createCardInspectorEnvelope,
  createEmptyDesktopSnapshot,
  createEmptySupervisionProjection,
  createReviewDiffChunkEnvelope,
  createReviewManifestEnvelope,
  createSettingsEnvelope,
  createSupervisionEnvelope,
  createWorkflowBoardEnvelope,
  createWorkflowCatalogEnvelope,
  createWorkspaceEnvelope,
  type WorkflowBoardProjection,
} from "../shared/rpc.ts";
import type { DesktopSettingsProjection } from "../shared/desktopRpc.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import {
  TEST_ATTEMPT_ID,
  TEST_BOARD_ID,
  TEST_CARD_ID,
  TEST_EVIDENCE_ID,
  inspectorCard,
  inspectorProjection,
  reviewManifest,
} from "./features/inspector/testSupport.ts";
import { resetDesktopViewStore, useDesktopViewStore } from "./state/desktopViewStore.ts";

const stageId = workflowIds.stage("stage-doing");
const card = { ...inspectorCard("ready_for_review"), stageId };
const board: WorkflowBoardProjection = {
  kind: "workflow_board_projection",
  revision: 12,
  board: {
    boardId: TEST_BOARD_ID,
    repositoryPath: "/projects/kitten",
    workflowVersion: 3,
    createdAt: 1,
    updatedAt: 12,
  },
  stages: [{
    stageId,
    boardId: TEST_BOARD_ID,
    label: "Doing",
    position: 0,
    defaultSkillId: null,
    configured: true,
    workflowVersion: 3,
    updatedAt: 12,
  }],
  edges: [],
  cards: [card],
};

function settingsProjection(): DesktopSettingsProjection {
  return {
    kind: "desktop_settings_projection",
    revision: 1,
    preferences: { theme: "system", workflowMeasurementEnabled: false },
    profileDefaults: { profileId: null, model: null, effort: null, appliesTo: "future_cards" },
    acpProviders: [],
    profiles: [{
      profileId: "profile-codex" as ProfileId,
      provider: "Codex",
      models: ["gpt-5"],
      efforts: ["high"],
      readiness: { ready: true, protocolVersion: 1 },
    }],
    catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
    scheduler: { automaticExecutionLimit: 1, activeCount: 0 },
    historyPolicy: "future_cards_only",
  };
}

function fakeClient(): DesktopRpcClient {
  const emptySupervision = createEmptySupervisionProjection(12);
  const item = {
    boardId: TEST_BOARD_ID,
    cardId: TEST_CARD_ID,
    cardVersion: card.version,
    attemptId: TEST_ATTEMPT_ID,
    generation: 2 as AttemptGeneration,
    status: "ready_for_review" as const,
    priority: 1 as const,
    evidenceAvailability: reviewManifest().availability,
    actionableAt: 12,
    updatedAt: 12,
  };
  const supervision = {
    ...emptySupervision,
    groups: emptySupervision.groups.map((group) => ({
      ...group,
      items: group.status === "ready_for_review" ? [item] : [],
    })),
    counts: {
      needs_attention: 0,
      ready_for_review: 1,
      failed: 0,
      running: 0,
      settled: 0,
    },
  };
  return {
    async getDesktopSnapshot() {
      return createBootstrapEnvelope({ status: "ok", projection: createEmptyDesktopSnapshot() });
    },
    async getCardInspector() {
      return createCardInspectorEnvelope({
        status: "ok",
        projection: inspectorProjection({
          status: "ready_for_review",
          terminalOutcome: "succeeded",
          evidence: true,
        }),
      });
    },
    async getBoard() {
      return createWorkflowBoardEnvelope({ status: "ok", projection: board });
    },
    async getWorkspace() {
      return createWorkspaceEnvelope({
        status: "ok",
        projection: {
          kind: "workspace_projection",
          revision: 12,
          boards: [{
            boardId: TEST_BOARD_ID,
            repositoryPath: board.board!.repositoryPath,
            createdAt: 1,
            updatedAt: 12,
            workflowVersion: 3,
          }],
        },
      });
    },
    async getSupervision() {
      return createSupervisionEnvelope({ status: "ok", projection: supervision });
    },
    async getReviewManifest() {
      return createReviewManifestEnvelope({ status: "ok", projection: reviewManifest() });
    },
    async getReviewDiffChunk() {
      return createReviewDiffChunkEnvelope({
        status: "rejected",
        error: { code: "evidence_missing", recoveryHint: "retry_evidence_capture" },
      });
    },
    async getCatalog() {
      return createWorkflowCatalogEnvelope({
        status: "ok",
        projection: {
          kind: "workflow_catalog_projection",
          revision: 1,
          catalog: { catalogId: "default", roots: [], entries: [], diagnostics: [] },
        },
      });
    },
    async getSettings() {
      return createSettingsEnvelope({ status: "ok", projection: settingsProjection() });
    },
    async pickRepositoryDirectory() {
      throw new Error("not used");
    },
    async executeWorkflowCommand() {
      throw new Error("not used");
    },
    async submitCardPrompt() {
      throw new Error("not used");
    },
    async answerAttention() {
      throw new Error("not used");
    },
    async updatePreferences() {
      throw new Error("not used");
    },
    async updateProfileDefaults() {
      throw new Error("not used");
    },
    async updateCatalogRoots() {
      throw new Error("not used");
    },
    async setExecutionLimit() {
      throw new Error("not used");
    },
    subscribe() {
      return () => {};
    },
    dispose() {},
  };
}

afterEach(() => {
  cleanup();
  resetDesktopViewStore();
  window.localStorage.clear();
});

describe("desktop critical-path keyboard and Settings navigation", () => {
  test("uses host order to open work, focuses composer and review in desktop and narrow modes", async () => {
    const { DesktopApp } = await import("./main.tsx");
    const view = render(<DesktopApp client={fakeClient()} />);
    await view.findByRole("heading", { name: "kitten" });

    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    await view.findByRole("heading", { name: "Implement supervision surface" });
    await view.findByRole("button", { name: "Open review" });

    fireEvent.keyDown(document, { key: "j", metaKey: true });
    expect(document.activeElement?.id).toBe("card-composer-draft");

    fireEvent.keyDown(document, { key: "r", metaKey: true, shiftKey: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("review-panel"));

    act(() => useDesktopViewStore.getState().setWorkbenchMode("narrow"));
    fireEvent.keyDown(document, { key: "j", metaKey: true });
    expect(document.activeElement?.id).toBe("card-composer-draft");
    fireEvent.keyDown(document, { key: "r", metaKey: true, shiftKey: true });
    expect(document.activeElement?.id).toBe("review-panel");
  });

  test("round-trips board, workbench, attempt, review file, draft namespace, landmarks, and focus through Settings", async () => {
    const { DesktopApp } = await import("./main.tsx");
    const user = userEvent.setup();
    const view = render(<DesktopApp client={fakeClient()} />);
    await view.findByRole("heading", { name: "kitten" });
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    await view.findByRole("heading", { name: "Implement supervision surface" });
    await view.findByRole("button", { name: "Open review" });
    fireEvent.keyDown(document, { key: "r", metaKey: true, shiftKey: true });
    const file = await view.findByRole("button", { name: /src\/old\.ts → src\/new\.ts/i });
    await user.click(file);

    const before = useDesktopViewStore.getState();
    expect(before.selectedAttemptId).toBe(TEST_ATTEMPT_ID);
    expect(before.selectedReview).toEqual({
      evidenceId: TEST_EVIDENCE_ID,
      attemptId: TEST_ATTEMPT_ID,
      fileId: "file-inspector-renderer",
    });
    expect(before.activeDraftNamespace?.cardId).toBe(TEST_CARD_ID);

    fireEvent.keyDown(document, { key: ",", metaKey: true });
    await waitFor(() => expect(document.activeElement?.id).toBe("settings-heading"));
    expect(view.getByRole("navigation", { name: "Application views" })).toBeDefined();
    expect(view.getByRole("button", { name: /Settings/ }).getAttribute("aria-current")).toBe("page");
    expect(view.getByRole("main").getAttribute("class")).toContain("settings-shell");

    await user.click(view.getByRole("button", { name: "Board" }));
    await view.findByRole("heading", { name: "Implement supervision surface" });
    await view.findByRole("heading", { name: "Changed files" });
    const restored = useDesktopViewStore.getState();
    expect(restored.route).toBe("board");
    expect(restored.selectedCard?.cardId).toBe(TEST_CARD_ID);
    expect(restored.selectedAttemptId).toBe(TEST_ATTEMPT_ID);
    expect(restored.selectedReview).toEqual({
      evidenceId: TEST_EVIDENCE_ID,
      attemptId: TEST_ATTEMPT_ID,
      fileId: "file-inspector-renderer",
    });
    expect(view.getAllByRole("status").some(({ textContent }) => (
      textContent?.includes("Returned from Settings") === true
    ))).toBeTrue();
  });

  test("renders help from the registry and gives modal input precedence", async () => {
    const { DesktopApp } = await import("./main.tsx");
    const user = userEvent.setup();
    const view = render(<DesktopApp client={fakeClient()} />);
    await view.findByRole("heading", { name: "kitten" });
    fireEvent.keyDown(document, { key: "/", metaKey: true });
    const dialog = await view.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.textContent).toContain("Focus card composer");
    expect(dialog.textContent).toContain("⌘J");

    fireEvent.keyDown(document, { key: ",", metaKey: true });
    expect(useDesktopViewStore.getState().route).toBe("board");
    await user.keyboard("{Escape}");
    expect(view.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });
});
