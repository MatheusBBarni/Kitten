import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkflowBoardProjection } from "../shared/rpc.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import {
  findBoardForRepository,
  projectBoardConfigPath,
  readProjectBoardConfig,
  writeProjectBoardConfig,
} from "./projectBoardConfig.ts";

describe("project-local board configuration", () => {
  test("writes the board identity and workflow configuration to .kitten/config.json", () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "kitten-board-config-"));
    const boardId = workflowIds.board("board-project-config");
    const first = workflowIds.stage("stage-backlog");
    const second = workflowIds.stage("stage-doing");
    const projection: WorkflowBoardProjection = {
      kind: "workflow_board_projection",
      revision: 4,
      board: { boardId, repositoryPath, workflowVersion: 4, createdAt: 1, updatedAt: 4 },
      stages: [
        { stageId: second, boardId, label: "Doing", position: 1, defaultSkillId: null, configured: false, workflowVersion: 4, updatedAt: 4 },
        { stageId: first, boardId, label: "Backlog", position: 0, defaultSkillId: null, configured: false, workflowVersion: 4, updatedAt: 4 },
      ],
      edges: [{ boardId, sourceStageId: first, targetStageId: second, workflowVersion: 4 }],
      cards: [],
    };

    expect(writeProjectBoardConfig(projection)).toBeTrue();
    expect(JSON.parse(readFileSync(projectBoardConfigPath(repositoryPath), "utf8"))).toEqual({
      schemaVersion: 1,
      boardId,
      workflow: {
        version: 4,
        stages: [
          { stageId: first, name: "Backlog", position: 0, defaultSkillId: null },
          { stageId: second, name: "Doing", position: 1, defaultSkillId: null },
        ],
        edges: [{ sourceStageId: first, targetStageId: second }],
      },
    });
    expect(readProjectBoardConfig(repositoryPath)?.boardId).toBe(boardId);
  });

  test("resolves a saved board by config identity and falls back to canonical repository path", () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "kitten-board-open-"));
    mkdirSync(join(repositoryPath, ".kitten"));
    const boardId = workflowIds.board("board-open-config");
    const board = { boardId, repositoryPath, workflowVersion: 1, createdAt: 1, updatedAt: 1 };

    expect(findBoardForRepository(repositoryPath, [board])).toBe(boardId);
    expect(findBoardForRepository(mkdtempSync(join(tmpdir(), "kitten-other-")), [board])).toBeNull();
  });
});
