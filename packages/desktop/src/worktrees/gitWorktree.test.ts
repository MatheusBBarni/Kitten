// Suite: desktop card Git worktrees
// Invariant: only canonical, contained, clean, Git-authoritative card worktrees are reusable or removable.
// Boundary IN: real temporary Git repositories plus the injected process boundary.
// Boundary OUT: SQLite lifecycle persistence, owned by cardWorktreeService.test.ts.

import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { MANAGED_WORKTREE_ROOT_RELATIVE } from "./contracts.ts";
import {
  createCardGitWorktrees,
  type CardGitWorktrees,
  type GitWorktreeSpawn,
  type GitWorktreeSpawnOptions,
} from "./gitWorktree.ts";

const encoder = new TextEncoder();
const BOARD_ID = workflowIds.board("board-worktrees");

describe("card Git worktree provisioning", () => {
  test("provisions unique canonical siblings without changing the parent checkout", async () => {
    const repository = await createRepository();
    const ids = ["kw-cardbinding01", "kw-cardbinding02"];
    let index = 0;
    try {
      const beforeHead = await gitOutput(repository.path, ["rev-parse", "HEAD"]);
      const beforeBranch = await gitOutput(repository.path, ["branch", "--show-current"]);
      const worktrees = createCardGitWorktrees({
        createBindingId: () => ids[index++] ?? "kw-unexpected000",
      });

      const first = await worktrees.provision({
        boardId: BOARD_ID,
        cardId: workflowIds.card("card-one"),
        trustedRepositoryPath: repository.path,
        createdAt: 100,
      });
      const second = await worktrees.provision({
        boardId: BOARD_ID,
        cardId: workflowIds.card("card-two"),
        trustedRepositoryPath: repository.path,
        createdAt: 101,
      });

      expect(first.status).toBe("provisioned");
      expect(second.status).toBe("provisioned");
      if (first.status !== "provisioned" || second.status !== "provisioned") return;
      const managedRoot = join(repository.path, ...MANAGED_WORKTREE_ROOT_RELATIVE.split("/"));
      expect(first.binding.bindingId).not.toBe(second.binding.bindingId);
      expect(first.binding.managedRoot).toBe(managedRoot);
      expect(first.binding.worktreePath).toBe(join(managedRoot, ids[0]!));
      expect(second.binding.worktreePath).toBe(join(managedRoot, ids[1]!));
      expect(first.binding.branch).toBe(`kitten/card/${ids[0]}`);
      expect(first.binding.baselineCommit).toBe(beforeHead);
      expect(first.binding.repositoryRoot).toBe(await realpath(repository.path));
      expect(await gitOutput(repository.path, ["rev-parse", "HEAD"])).toBe(beforeHead);
      expect(await gitOutput(repository.path, ["branch", "--show-current"])).toBe(beforeBranch);
      expect(await gitOutput(repository.path, ["status", "--porcelain", "--untracked-files=all"])).toBe("");
      expect(await gitOutput(repository.path, ["check-ignore", MANAGED_WORKTREE_ROOT_RELATIVE])).toBe(
        MANAGED_WORKTREE_ROOT_RELATIVE,
      );
    } finally {
      await repository.remove();
    }
  });

  test("rejects non-repositories, detached parents, and tracked gitlinks with bounded reasons", async () => {
    const nonRepository = await mkdtemp(join(tmpdir(), "kitten-card-nonrepo-"));
    const detached = await createRepository();
    const gitlink = await createRepository();
    try {
      expect(await provision(createCardGitWorktrees(), nonRepository, "kw-nonrepo00001")).toEqual({
        status: "unavailable",
        reason: "not_git_repository",
      });
      await runGit(detached.path, ["checkout", "--detach"]);
      expect(await provision(createCardGitWorktrees(), detached.path, "kw-detached0001")).toEqual({
        status: "unavailable",
        reason: "detached",
      });
      await runGit(gitlink.path, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${gitlink.sha},vendor/child`,
      ]);
      expect(await provision(createCardGitWorktrees(), gitlink.path, "kw-gitlink00001")).toEqual({
        status: "unavailable",
        reason: "gitlink",
      });
    } finally {
      await Promise.all([
        rm(nonRepository, { recursive: true, force: true }),
        detached.remove(),
        gitlink.remove(),
      ]);
    }
  });

  test("rejects symlinked managed ancestors before creating anything through them", async () => {
    const repository = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "kitten-card-external-root-"));
    try {
      await mkdir(join(repository.path, ".kitten"));
      await symlink(external, join(repository.path, ".kitten", "worktrees"));
      expect(await provision(createCardGitWorktrees(), repository.path, "kw-symlinkroot01")).toEqual({
        status: "unavailable",
        reason: "symlink",
      });
      expect(await lstat(join(external, "cards")).catch(() => null)).toBeNull();
    } finally {
      await Promise.all([repository.remove(), rm(external, { recursive: true, force: true })]);
    }
  });

  test("rolls back only clean artifacts created by a failed authoritative verification", async () => {
    const cleanRepository = await createRepository();
    const dirtyRepository = await createRepository();
    try {
      const cleanId = "kw-cleanrollback1";
      const cleanPath = join(
        cleanRepository.path,
        ...MANAGED_WORKTREE_ROOT_RELATIVE.split("/"),
        cleanId,
      );
      let cleanLists = 0;
      const cleanSpawn = interceptSpawn((options) => {
        if (options.cmd.slice(1).join(" ") === "worktree list --porcelain -z") {
          cleanLists += 1;
          if (cleanLists === 2) {
            return processResult(worktreePorcelain([
              { path: cleanRepository.path, head: cleanRepository.sha, branch: "main" },
              { path: cleanPath, head: "0".repeat(40), branch: `kitten/card/${cleanId}` },
            ]));
          }
        }
        return null;
      });
      const clean = await provision(
        createCardGitWorktrees({ spawn: cleanSpawn, createBindingId: () => cleanId }),
        cleanRepository.path,
        cleanId,
      );
      expect(clean).toEqual({ status: "unavailable", reason: "branch_mismatch" });
      expect(await pathExists(cleanPath)).toBe(false);
      expect(await branchExists(cleanRepository.path, `kitten/card/${cleanId}`)).toBe(false);

      const dirtyId = "kw-dirtyrollback";
      const dirtyPath = join(
        dirtyRepository.path,
        ...MANAGED_WORKTREE_ROOT_RELATIVE.split("/"),
        dirtyId,
      );
      let dirtyLists = 0;
      const dirtySpawn = interceptSpawn((options) => {
        if (options.cmd.slice(1).join(" ") === "worktree list --porcelain -z") {
          dirtyLists += 1;
          if (dirtyLists === 2) {
            writeFileSync(join(dirtyPath, "retain.txt"), "operator data\n");
            return processResult(worktreePorcelain([
              { path: dirtyRepository.path, head: dirtyRepository.sha, branch: "main" },
              { path: dirtyPath, head: "0".repeat(40), branch: `kitten/card/${dirtyId}` },
            ]));
          }
        }
        return null;
      });
      const dirty = await provision(
        createCardGitWorktrees({ spawn: dirtySpawn, createBindingId: () => dirtyId }),
        dirtyRepository.path,
        dirtyId,
      );
      expect(dirty).toEqual({ status: "unavailable", reason: "branch_mismatch" });
      expect(await readFile(join(dirtyPath, "retain.txt"), "utf8")).toBe("operator data\n");
      expect(await branchExists(dirtyRepository.path, `kitten/card/${dirtyId}`)).toBe(true);
    } finally {
      await Promise.all([cleanRepository.remove(), dirtyRepository.remove()]);
    }
  });
});

describe("card Git worktree reconciliation and removal", () => {
  test("fails closed for dirty, divergent, gitlink, detached, and mismatched bindings", async () => {
    const repositories = await Promise.all([
      createRepository(),
      createRepository(),
      createRepository(),
      createRepository(),
    ]);
    try {
      const dirty = await provisionBinding(repositories[0]!, "kw-dirtybinding1");
      await writeFile(join(dirty.binding.worktreePath, "dirty.txt"), "retain\n");
      expect(await dirty.worktrees.reconcile(dirty.binding, repositories[0]!.path)).toEqual({
        status: "unavailable",
        reason: "dirty",
      });

      const divergent = await provisionBinding(repositories[1]!, "kw-divergent001");
      const unrelated = await gitOutput(divergent.binding.worktreePath, [
        "-c", "user.name=Kitten Test",
        "-c", "user.email=kitten@example.test",
        "commit-tree", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "-m", "unrelated",
      ]);
      await runGit(divergent.binding.worktreePath, ["reset", "--hard", unrelated]);
      expect(await divergent.worktrees.reconcile(divergent.binding, repositories[1]!.path)).toEqual({
        status: "unavailable",
        reason: "divergent",
      });

      const gitlink = await provisionBinding(repositories[2]!, "kw-gitlinkbind1");
      await runGit(gitlink.binding.worktreePath, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${repositories[2]!.sha},vendor/child`,
      ]);
      expect(await gitlink.worktrees.reconcile(gitlink.binding, repositories[2]!.path)).toEqual({
        status: "unavailable",
        reason: "gitlink",
      });

      const detached = await provisionBinding(repositories[3]!, "kw-detachedbind");
      await runGit(detached.binding.worktreePath, ["checkout", "--detach"]);
      expect(await detached.worktrees.reconcile(detached.binding, repositories[3]!.path)).toEqual({
        status: "unavailable",
        reason: "detached",
      });
      expect(await dirty.worktrees.reconcile(
        { ...dirty.binding, branch: "kitten/card/kw-mismatch0001" },
        repositories[0]!.path,
      )).toEqual({ status: "unavailable", reason: "branch_mismatch" });
      expect(await dirty.worktrees.reconcile(
        { ...dirty.binding, baselineCommit: "0".repeat(40) },
        repositories[0]!.path,
      )).toEqual({ status: "unavailable", reason: "baseline_mismatch" });
      expect(await dirty.worktrees.reconcile(
        { ...dirty.binding, repositoryRoot: repositories[1]!.path },
        repositories[0]!.path,
      )).toEqual({ status: "unavailable", reason: "external" });
    } finally {
      await Promise.all(repositories.map((repository) => repository.remove()));
    }
  });

  test("refuses missing, symlink, unverified, dirty, and unmerged cleanup without destructive commands", async () => {
    const repository = await createRepository();
    const external = await mkdtemp(join(tmpdir(), "kitten-card-external-"));
    try {
      const dirty = await provisionBinding(repository, "kw-cleanupdirty");
      await writeFile(join(dirty.binding.worktreePath, "dirty.txt"), "retain\n");
      expect(await dirty.worktrees.removeExplicit(dirty.binding, repository.path)).toEqual({
        status: "refused",
        reason: "dirty",
      });
      expect(await pathExists(dirty.binding.worktreePath)).toBe(true);

      await rm(join(dirty.binding.worktreePath, "dirty.txt"));
      await writeFile(join(dirty.binding.worktreePath, "committed.txt"), "unmerged\n");
      await runGit(dirty.binding.worktreePath, ["add", "committed.txt"]);
      await commit(dirty.binding.worktreePath, "unmerged card work");
      expect(await dirty.worktrees.removeExplicit(dirty.binding, repository.path)).toEqual({
        status: "refused",
        reason: "unmerged",
      });
      expect(await branchExists(repository.path, dirty.binding.branch)).toBe(true);

      await runGit(repository.path, ["worktree", "remove", dirty.binding.worktreePath]);
      expect(await dirty.worktrees.removeExplicit(dirty.binding, repository.path)).toEqual({
        status: "refused",
        reason: "missing",
      });
      await symlink(external, dirty.binding.worktreePath);
      expect(await dirty.worktrees.removeExplicit(dirty.binding, repository.path)).toEqual({
        status: "refused",
        reason: "symlink",
      });
      expect(await pathExists(dirty.binding.worktreePath)).toBe(true);

      await rm(dirty.binding.worktreePath);
      await runGit(repository.path, [
        "worktree",
        "add",
        dirty.binding.worktreePath,
        dirty.binding.branch,
      ]);

      const unverified = createCardGitWorktrees({
        spawn: interceptSpawn((options) => (
          options.cmd.slice(1).join(" ") === "worktree list --porcelain -z"
            ? processResult("private git output", 1)
            : null
        )),
      });
      expect(await unverified.removeExplicit(dirty.binding, repository.path)).toEqual({
        status: "refused",
        reason: "unverified",
      });
    } finally {
      await Promise.all([repository.remove(), rm(external, { recursive: true, force: true })]);
    }
  });

  test("removes only a freshly verified clean branch already merged into its baseline branch", async () => {
    const repository = await createRepository();
    try {
      const fixture = await provisionBinding(repository, "kw-cleanmerged01");
      await writeFile(join(fixture.binding.worktreePath, "reviewed.txt"), "reviewed\n");
      await runGit(fixture.binding.worktreePath, ["add", "reviewed.txt"]);
      await commit(fixture.binding.worktreePath, "reviewed card work");
      await runGit(repository.path, ["merge", "--ff-only", fixture.binding.branch]);

      expect(await fixture.worktrees.removeExplicit(fixture.binding, repository.path)).toEqual({
        status: "removed",
      });
      expect(await pathExists(fixture.binding.worktreePath)).toBe(false);
      expect(await branchExists(repository.path, fixture.binding.branch)).toBe(false);
    } finally {
      await repository.remove();
    }
  });
});

async function provision(
  worktrees: CardGitWorktrees,
  repositoryPath: string,
  bindingId: string,
) {
  return worktrees.provision({
    boardId: BOARD_ID,
    cardId: workflowIds.card(`card-${bindingId}`),
    trustedRepositoryPath: repositoryPath,
    createdAt: 100,
  });
}

async function provisionBinding(
  repository: Awaited<ReturnType<typeof createRepository>>,
  bindingId: string,
): Promise<{ readonly worktrees: CardGitWorktrees; readonly binding: import("./contracts.ts").CardWorktreeBinding }> {
  const worktrees = createCardGitWorktrees({ createBindingId: () => bindingId });
  const result = await worktrees.provision({
    boardId: BOARD_ID,
    cardId: workflowIds.card(`card-${bindingId}`),
    trustedRepositoryPath: repository.path,
    createdAt: 100,
  });
  if (result.status !== "provisioned") throw new Error(`fixture failed: ${result.reason}`);
  return { worktrees, binding: result.binding };
}

function interceptSpawn(
  intercept: (options: GitWorktreeSpawnOptions) => ReturnType<GitWorktreeSpawn> | null,
): GitWorktreeSpawn {
  return (options) => intercept(options) ?? Bun.spawn(options);
}

function processResult(stdout: string, exitCode = 0): ReturnType<GitWorktreeSpawn> {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new Response(encoder.encode(stdout)).body!,
  };
}

function worktreePorcelain(
  entries: readonly { readonly path: string; readonly head: string; readonly branch: string }[],
): string {
  return entries.map((entry) => (
    `worktree ${entry.path}\0HEAD ${entry.head}\0branch refs/heads/${entry.branch}\0\0`
  )).join("");
}

async function createRepository(): Promise<{
  readonly path: string;
  readonly sha: string;
  remove(): Promise<void>;
}> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "kitten-card-worktree-")));
  await runGit(path, ["init", "-b", "main"]);
  await writeFile(join(path, "README.md"), "# card worktree fixture\n");
  await runGit(path, ["add", "README.md"]);
  await commit(path, "initial");
  const sha = await gitOutput(path, ["rev-parse", "HEAD"]);
  return {
    path,
    sha,
    async remove() {
      await rm(path, { recursive: true, force: true });
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
