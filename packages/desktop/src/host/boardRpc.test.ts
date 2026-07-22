import { afterEach, describe, expect, test } from "bun:test";
import { createEventJournal } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createDesktopBoardRpc } from "./boardRpc.ts";

const databases: ReturnType<typeof openSqliteDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

describe("DesktopBoardRpc workspace projection", () => {
  test("lists multiple boards for one project and exposes a blank board setup projection", async () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    let now = 10;
    const repositoryBindings: string[] = [];
    const mirroredBoardIds: string[] = [];
    const rpc = createDesktopBoardRpc(
      journal,
      createWorkflowCommandHandler(journal, { now: () => ++now }),
      {
        onRepositoryBound: (repositoryPath) => repositoryBindings.push(repositoryPath),
        onProjectionCommitted: (projection) => {
          if (projection.board !== null) mirroredBoardIds.push(projection.board.boardId);
        },
      },
    );

    const firstBoardId = workflowIds.board("board-first");
    const secondBoardId = workflowIds.board("board-second");
    await rpc.executeWorkflowCommand({
      commandId: "bind-first",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-first"),
        boardId: firstBoardId,
        repositoryPath: "/Users/name/projects/kitten",
      },
    });
    await rpc.executeWorkflowCommand({
      commandId: "bind-second",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-second"),
        boardId: secondBoardId,
        repositoryPath: "/Users/name/projects/kitten",
      },
    });

    const workspace = await rpc.getWorkspace?.({});
    expect(workspace).toMatchObject({
      result: {
        status: "ok",
        projection: {
          boards: [
            { boardId: secondBoardId, repositoryPath: "/Users/name/projects/kitten", createdAt: 12 },
            { boardId: firstBoardId, repositoryPath: "/Users/name/projects/kitten", createdAt: 11 },
          ],
        },
      },
    });
    expect(await rpc.getBoard({ mode: "new" })).toMatchObject({
      result: { status: "ok", projection: { board: null, stages: [], edges: [], cards: [] } },
    });
    expect(repositoryBindings).toEqual([
      "/Users/name/projects/kitten",
      "/Users/name/projects/kitten",
    ]);
    expect(mirroredBoardIds).toEqual([firstBoardId, secondBoardId]);
  });
});
