import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { WorkflowBoardProjection } from "../shared/rpc.ts";
import type { BoardId, BoardProjection } from "../workflow/workflowTypes.ts";

export const PROJECT_BOARD_CONFIG_RELATIVE_PATH = ".kitten/config.json";

export interface ProjectBoardConfig {
  readonly schemaVersion: 1;
  readonly boardId: BoardId;
  readonly workflow: {
    readonly version: number;
    readonly stages: readonly {
      readonly stageId: string;
      readonly name: string;
      readonly position: number;
      readonly defaultSkillId: string | null;
    }[];
    readonly edges: readonly {
      readonly sourceStageId: string;
      readonly targetStageId: string;
    }[];
  };
}

export interface ProjectBoardConfigFileSystem {
  exists(path: string): boolean;
  readText(path: string): string;
  canonicalize(path: string): string;
  writeAtomically(path: string, content: string): void;
}

const nodeFileSystem: ProjectBoardConfigFileSystem = {
  exists: existsSync,
  readText(path) {
    return readFileSync(path, "utf8");
  },
  canonicalize(path) {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  },
  writeAtomically(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, path);
  },
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function projectBoardConfigPath(repositoryPath: string): string {
  return join(repositoryPath, PROJECT_BOARD_CONFIG_RELATIVE_PATH);
}

export function createProjectBoardConfig(
  projection: WorkflowBoardProjection,
): ProjectBoardConfig | null {
  const board = projection.board;
  if (board === null) return null;
  return {
    schemaVersion: 1,
    boardId: board.boardId,
    workflow: {
      version: board.workflowVersion,
      stages: [...projection.stages]
        .sort((left, right) => left.position - right.position || left.stageId.localeCompare(right.stageId))
        .map((stage) => ({
          stageId: stage.stageId,
          name: stage.label,
          position: stage.position,
          defaultSkillId: stage.defaultSkillId,
        })),
      edges: [...projection.edges]
        .sort((left, right) => left.sourceStageId.localeCompare(right.sourceStageId))
        .map((edge) => ({
          sourceStageId: edge.sourceStageId,
          targetStageId: edge.targetStageId,
        })),
    },
  };
}

export function writeProjectBoardConfig(
  projection: WorkflowBoardProjection,
  fileSystem: ProjectBoardConfigFileSystem = nodeFileSystem,
): boolean {
  const config = createProjectBoardConfig(projection);
  if (config === null || projection.board === null) return false;
  fileSystem.writeAtomically(
    projectBoardConfigPath(projection.board.repositoryPath),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return true;
}

export function readProjectBoardConfig(
  repositoryPath: string,
  fileSystem: ProjectBoardConfigFileSystem = nodeFileSystem,
): ProjectBoardConfig | null {
  const path = projectBoardConfigPath(repositoryPath);
  if (!fileSystem.exists(path)) return null;
  try {
    const value = JSON.parse(fileSystem.readText(path)) as unknown;
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.boardId !== "string") return null;
    const workflow = value.workflow;
    if (!isRecord(workflow) || !Number.isSafeInteger(workflow.version)) return null;
    if (!Array.isArray(workflow.stages) || !Array.isArray(workflow.edges)) return null;
    return value as unknown as ProjectBoardConfig;
  } catch {
    return null;
  }
}

export function findBoardForRepository(
  repositoryPath: string,
  boards: readonly BoardProjection[],
  fileSystem: ProjectBoardConfigFileSystem = nodeFileSystem,
): BoardId | null {
  const selectedPath = fileSystem.canonicalize(repositoryPath);
  const configured = readProjectBoardConfig(repositoryPath, fileSystem);
  const configuredBoard = configured === null
    ? undefined
    : boards.find(({ boardId }) => boardId === configured.boardId);
  if (
    configuredBoard !== undefined
    && fileSystem.canonicalize(configuredBoard.repositoryPath) === selectedPath
  ) {
    return configuredBoard.boardId;
  }
  return boards.find((board) => fileSystem.canonicalize(board.repositoryPath) === selectedPath)?.boardId ?? null;
}
