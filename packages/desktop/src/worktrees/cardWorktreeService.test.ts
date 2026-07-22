// Suite: card-owned worktree lifecycle
// Invariant: one durable binding is reused across attempts and cleanup is explicit, verified, and refusal-first.
// Boundary IN: real Git repositories, SQLite journal/projections, reopen, and rebuild.
// Boundary OUT: attempt scheduling and review UI, which may consume but never auto-clean this service.

import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventJournal,
  type BoardProjection,
  type CardProjection,
  type EventJournal,
  type StageProjection,
} from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createCardGitWorktrees, type CardGitWorktrees } from "./gitWorktree.ts";
import { createCardWorktreeService } from "./cardWorktreeService.ts";
import { readCardWorktreeBinding, recordCardWorktreeBinding } from "./cardWorktreeProjection.ts";
import type { CardWorktreeBinding, WorktreeUnavailableReason } from "./contracts.ts";

const BOARD_ID = workflowIds.board("board-card-worktrees");
const STAGE_ID = workflowIds.stage("stage-ready");
const CARD_ID = workflowIds.card("card-managed-worktree");

describe("card worktree persistence and fresh-attempt reuse", () => {
  test("reopens and rebuilds the exact binding while preserving the parent checkout", async () => {
    const fixture = await createFixture();
    let database = openSqliteDatabase({ filename: fixture.databaseFilename });
    try {
      migrateDatabase(database);
      let journal = createEventJournal(database);
      seedWorkflow(journal, fixture.repositoryPath);
      const parentHead = await gitOutput(fixture.repositoryPath, ["rev-parse", "HEAD"]);
      const parentBranch = await gitOutput(fixture.repositoryPath, ["branch", "--show-current"]);
      let eventSequence = 0;
      const firstService = createCardWorktreeService(journal, {
        gitWorktrees: createCardGitWorktrees({ createBindingId: () => "kw-persistcard01" }),
        now: () => 1_000 + eventSequence,
        createEventId: () => `worktree-event-${eventSequence++}`,
      });
      const first = await firstService.ensure({ boardId: BOARD_ID, cardId: CARD_ID });
      expect(first.status).toBe("provisioned");
      if (first.status !== "provisioned") return;
      const original = first.binding;
      expect(readCardWorktreeBinding(journal.snapshot(), CARD_ID)).toEqual(original);
      closeSqliteDatabase(database);

      database = openSqliteDatabase({ filename: fixture.databaseFilename });
      expect(migrateDatabase(database).appliedVersions).toEqual([]);
      journal = createEventJournal(database);
      const reopenedBeforeReuse = readCardWorktreeBinding(journal.snapshot(), CARD_ID);
      expect(reopenedBeforeReuse).toEqual(original);
      const reopenedService = createCardWorktreeService(journal, {
        gitWorktrees: createCardGitWorktrees({
          createBindingId() {
            throw new Error("fresh attempt must not allocate another binding");
          },
        }),
        now: () => 2_000,
        createEventId: () => "worktree-event-reconciled",
      });
      const reused = await reopenedService.ensure({ boardId: BOARD_ID, cardId: CARD_ID });
      expect(reused.status).toBe("reused");
      if (reused.status !== "reused") return;
      expect(identity(reused.binding)).toEqual(identity(original));
      expect(reused.binding.updatedAt).toBe(2_000);
      const live = journal.snapshot();

      database.run("DELETE FROM card_worktrees");
      expect(readCardWorktreeBinding(journal.snapshot(), CARD_ID)).toBeNull();
      expect(rebuildProjections(database)).toEqual(live);
      expect(identity(readRequiredBinding(journal))).toEqual(identity(original));
      expect(await gitOutput(fixture.repositoryPath, ["rev-parse", "HEAD"])).toBe(parentHead);
      expect(await gitOutput(fixture.repositoryPath, ["branch", "--show-current"])).toBe(parentBranch);
      expect(await gitOutput(fixture.repositoryPath, [
        "status", "--porcelain", "--untracked-files=all",
      ])).toBe("");
    } finally {
      closeSqliteDatabase(database);
      await fixture.remove();
    }
  });

  test("rejects a second persisted identity for the same card transactionally", async () => {
    const fixture = await createFixture();
    const database = openSqliteDatabase({ filename: fixture.databaseFilename });
    try {
      migrateDatabase(database);
      const journal = createEventJournal(database);
      seedWorkflow(journal, fixture.repositoryPath);
      const service = createCardWorktreeService(journal, {
        gitWorktrees: createCardGitWorktrees({ createBindingId: () => "kw-singlebinding" }),
        now: () => 100,
        createEventId: () => "worktree-single",
      });
      const result = await service.ensure({ boardId: BOARD_ID, cardId: CARD_ID });
      expect(result.status).toBe("provisioned");
      if (result.status !== "provisioned") return;
      const priorEvents = journal.events().length;
      const otherId = "kw-otherbinding01";
      const replacement: CardWorktreeBinding = {
        ...result.binding,
        bindingId: otherId,
        worktreePath: join(result.binding.managedRoot, otherId),
        branch: `kitten/card/${otherId}`,
        updatedAt: 101,
      };
      expect(() => recordCardWorktreeBinding(journal, {
        eventId: "worktree-replacement",
        binding: replacement,
      })).toThrow("identity conflict");
      expect(journal.events()).toHaveLength(priorEvents);
      expect(readRequiredBinding(journal)).toEqual(result.binding);
    } finally {
      closeSqliteDatabase(database);
      await fixture.remove();
    }
  });
});

describe("explicit refusal-first cleanup", () => {
  test("persists live, dirty, unmerged, external, and unverified refusals without removal", async () => {
    const fixture = await createFixture();
    const database = openSqliteDatabase({ filename: fixture.databaseFilename });
    try {
      migrateDatabase(database);
      const journal = createEventJournal(database);
      seedWorkflow(journal, fixture.repositoryPath);
      let event = 0;
      const gitWorktrees = createCardGitWorktrees({ createBindingId: () => "kw-refusalcard1" });
      const options = {
        gitWorktrees,
        now: () => 1_000 + event,
        createEventId: () => `worktree-refusal-${event++}`,
      };
      let service = createCardWorktreeService(journal, options);
      const provisioned = await service.ensure({ boardId: BOARD_ID, cardId: CARD_ID });
      expect(provisioned.status).toBe("provisioned");
      if (provisioned.status !== "provisioned") return;
      const binding = provisioned.binding;

      expect(await service.cleanupExplicit({
        boardId: BOARD_ID,
        cardId: CARD_ID,
        requestedBy: "operator",
        cardSettled: false,
        liveAttemptCount: 1,
      })).toMatchObject({ status: "refused", reason: "live" });
      expect(readRequiredBinding(journal)).toMatchObject({
        lifecycle: "cleanup_refused",
        reason: "live",
      });
      expect((await service.ensure({ boardId: BOARD_ID, cardId: CARD_ID })).status).toBe("reused");

      await writeFile(join(binding.worktreePath, "dirty.txt"), "retain\n");
      expect(await service.cleanupExplicit(settledCleanupInput())).toMatchObject({
        status: "refused",
        reason: "dirty",
      });
      expect(readRequiredBinding(journal)).toMatchObject({
        lifecycle: "cleanup_refused",
        reason: "dirty",
      });
      await rm(join(binding.worktreePath, "dirty.txt"));

      await writeFile(join(binding.worktreePath, "unmerged.txt"), "retain commit\n");
      await runGit(binding.worktreePath, ["add", "unmerged.txt"]);
      await commit(binding.worktreePath, "unmerged card work");
      expect(await service.cleanupExplicit(settledCleanupInput())).toMatchObject({
        status: "refused",
        reason: "unmerged",
      });
      expect(await pathExists(binding.worktreePath)).toBe(true);
      expect(await branchExists(fixture.repositoryPath, binding.branch)).toBe(true);

      service = createCardWorktreeService(journal, {
        ...options,
        gitWorktrees: refusingRemoval(gitWorktrees, "external"),
      });
      expect(await service.cleanupExplicit(settledCleanupInput())).toMatchObject({
        status: "refused",
        reason: "external",
      });
      expect(readRequiredBinding(journal)).toMatchObject({
        lifecycle: "cleanup_refused",
        reason: "external",
      });

      service = createCardWorktreeService(journal, {
        ...options,
        gitWorktrees: refusingRemoval(gitWorktrees, "unverified"),
      });
      expect(await service.cleanupExplicit(settledCleanupInput())).toMatchObject({
        status: "refused",
        reason: "unverified",
      });
      expect(readRequiredBinding(journal)).toMatchObject({
        lifecycle: "cleanup_refused",
        reason: "unverified",
      });
      expect(await pathExists(binding.worktreePath)).toBe(true);
      expect(await branchExists(fixture.repositoryPath, binding.branch)).toBe(true);
    } finally {
      closeSqliteDatabase(database);
      await fixture.remove();
    }
  });

  test("records removal only after the clean branch is merged and operator cleanup is explicit", async () => {
    const fixture = await createFixture();
    const database = openSqliteDatabase({ filename: fixture.databaseFilename });
    try {
      migrateDatabase(database);
      const journal = createEventJournal(database);
      seedWorkflow(journal, fixture.repositoryPath);
      let event = 0;
      const service = createCardWorktreeService(journal, {
        gitWorktrees: createCardGitWorktrees({ createBindingId: () => "kw-removablecard" }),
        now: () => 10_000 + event,
        createEventId: () => `worktree-remove-${event++}`,
      });
      const provisioned = await service.ensure({ boardId: BOARD_ID, cardId: CARD_ID });
      expect(provisioned.status).toBe("provisioned");
      if (provisioned.status !== "provisioned") return;
      await writeFile(join(provisioned.binding.worktreePath, "reviewed.txt"), "reviewed\n");
      await runGit(provisioned.binding.worktreePath, ["add", "reviewed.txt"]);
      await commit(provisioned.binding.worktreePath, "reviewed card work");
      await runGit(fixture.repositoryPath, ["merge", "--ff-only", provisioned.binding.branch]);

      const removed = await service.cleanupExplicit(settledCleanupInput());
      expect(removed).toMatchObject({ status: "removed" });
      expect(readRequiredBinding(journal)).toMatchObject({ lifecycle: "removed", reason: null });
      expect(await pathExists(provisioned.binding.worktreePath)).toBe(false);
      expect(await branchExists(fixture.repositoryPath, provisioned.binding.branch)).toBe(false);
      expect(await service.ensure({ boardId: BOARD_ID, cardId: CARD_ID })).toEqual({
        status: "unavailable",
        reason: "removed",
      });
    } finally {
      closeSqliteDatabase(database);
      await fixture.remove();
    }
  });
});

function seedWorkflow(journal: EventJournal, repositoryPath: string): void {
  const board: BoardProjection = {
    boardId: BOARD_ID,
    repositoryPath,
    workflowVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const stage: StageProjection = {
    stageId: STAGE_ID,
    boardId: BOARD_ID,
    label: "Ready",
    position: 0,
    defaultSkillId: workflowIds.skill(`skill:${"a".repeat(64)}`),
    configured: true,
    workflowVersion: 1,
    updatedAt: 2,
  };
  const card: CardProjection = {
    cardId: CARD_ID,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: "Managed card",
    description: "Keep one worktree across attempts.",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: 3,
    updatedAt: 3,
  };
  journal.append({
    eventId: "seed-board",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "board_upserted",
    occurredAt: 1,
    payload: board,
  });
  journal.append({
    eventId: "seed-stage",
    boardId: BOARD_ID,
    actor: "operator",
    kind: "stage_upserted",
    occurredAt: 2,
    payload: stage,
  });
  journal.append({
    eventId: "seed-card",
    boardId: BOARD_ID,
    cardId: CARD_ID,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3,
    payload: card,
  });
}

function settledCleanupInput() {
  return {
    boardId: BOARD_ID,
    cardId: CARD_ID,
    requestedBy: "operator" as const,
    cardSettled: true,
    liveAttemptCount: 0,
  };
}

function refusingRemoval(
  delegate: CardGitWorktrees,
  reason: WorktreeUnavailableReason,
): CardGitWorktrees {
  return {
    provision: delegate.provision.bind(delegate),
    reconcile: delegate.reconcile.bind(delegate),
    rollbackProvision: delegate.rollbackProvision.bind(delegate),
    async removeExplicit() {
      return { status: "refused", reason };
    },
  };
}

function readRequiredBinding(journal: EventJournal): CardWorktreeBinding {
  const binding = readCardWorktreeBinding(journal.snapshot(), CARD_ID);
  if (binding === null) throw new Error("expected persisted card worktree binding");
  return binding;
}

function identity(binding: CardWorktreeBinding | null) {
  if (binding === null) return null;
  const { lifecycle: _lifecycle, reason: _reason, updatedAt: _updatedAt, ...value } = binding;
  return value;
}

async function createFixture(): Promise<{
  readonly directory: string;
  readonly databaseFilename: string;
  readonly repositoryPath: string;
  remove(): Promise<void>;
}> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "kitten-card-service-")));
  const repositoryPath = join(directory, "repository");
  await mkdir(repositoryPath);
  await runGit(repositoryPath, ["init", "-b", "main"]);
  await writeFile(join(repositoryPath, "README.md"), "# card service fixture\n");
  await runGit(repositoryPath, ["add", "README.md"]);
  await commit(repositoryPath, "initial");
  return {
    directory,
    databaseFilename: join(directory, "desktop.sqlite"),
    repositoryPath: await realpath(repositoryPath),
    async remove() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function commit(cwd: string, message: string): Promise<void> {
  await runGit(cwd, [
    "-c", "user.name=Kitten Test",
    "-c", "user.email=kitten@example.test",
    "commit", "-m", message,
  ]);
}

async function branchExists(repository: string, branch: string): Promise<boolean> {
  return runGit(repository, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], true);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...process.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function runGit(cwd: string, args: readonly string[], allowFailure = false): Promise<boolean> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...process.env },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0 && !allowFailure) throw new Error(`git failed: ${stderr.trim()}`);
  return exitCode === 0;
}
