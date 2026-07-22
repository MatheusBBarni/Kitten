import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  type ActivityEventId,
  type AttemptId,
  type ProfileId,
} from "@kitten/engine";
import { createActivityIngestor, getCardInspectorProjection } from "../src/attempts/activityIngestor.ts";
import { createAttemptCoordinator } from "../src/attempts/attemptCoordinator.ts";
import type { CertifiedDirectAcpProfile } from "../src/attempts/contracts.ts";
import { createDirectAcpAttemptStarter, type DirectAcpConnectionFactory } from "../src/attempts/directAcpAttempt.ts";
import { createGlobalAttemptScheduler } from "../src/attempts/scheduler.ts";
import type { SkillCatalog, SkillCatalogEntry } from "../src/catalog/contracts.ts";
import { startDesktopShell, type DesktopWindowFactory } from "../src/main.ts";
import { createEventJournal } from "../src/persistence/eventJournal.ts";
import { migrateDatabase } from "../src/persistence/migrations.ts";
import { rebuildProjections } from "../src/persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../src/persistence/sqliteDatabase.ts";
import {
  assertProjectionPayload,
  createAttemptActivityMessage,
  type BootstrapEnvelope,
  type CardInspectorEnvelope,
  type HostMessageEnvelope,
} from "../src/shared/rpc.ts";
import { workflowIds, type CardId, type CardProjection } from "../src/workflow/workflowTypes.ts";
import type { CardWorktreeBinding } from "../src/worktrees/contracts.ts";

const temporaryDirectories: string[] = [];
afterEach(() => {
  while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

const BOARD_ID = workflowIds.board("board-integration");
const STAGE_ID = workflowIds.stage("stage-integration");
const CARD_ID = workflowIds.card("card-integrated-attempt");
const OTHER_CARD_ID = workflowIds.card("card-isolated");
const SKILL_ID = workflowIds.skill(`skill:${"d".repeat(64)}`);
const PROFILE_ID = "profile-integrated-codex" as ProfileId;

class FakeWindowFactory implements DesktopWindowFactory {
  inspectorHandler?: (params: { readonly cardId: string }) => Promise<CardInspectorEnvelope>;
  readonly messages: HostMessageEnvelope[] = [];

  open(options: {
    onGetDesktopSnapshot(params: { readonly knownRevision?: number }): Promise<BootstrapEnvelope>;
    onGetCardInspector(params: { readonly cardId: string }): Promise<CardInspectorEnvelope>;
  }) {
    this.inspectorHandler = options.onGetCardInspector;
    return {
      sendHostMessage: (message: HostMessageEnvelope) => this.messages.push(message),
      removeHandlers: () => { this.inspectorHandler = undefined; },
      close() {},
    };
  }
}

describe("fake ACP to durable inspector and typed RPC", () => {
  test("commits before notification, rebuilds after reopen, and isolates card-safe projections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-attempt-inspector-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "desktop.sqlite");
    const database = openSqliteDatabase({ filename });
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    seedCards(journal);

    const factory = new FakeWindowFactory();
    const shell = startDesktopShell({
      windowFactory: factory,
      getCardInspector: (cardId) => getCardInspectorProjection(journal, cardId),
    });
    const notificationOrder: string[] = [];
    const ingestor = createActivityIngestor({
      journal,
      onCommitted({ event, inspector, delta }) {
        expect(journal.eventById(event.eventId)).not.toBeNull();
        expect(journal.snapshot().attemptInspectors.at(-1)).toEqual(inspector);
        notificationOrder.push(`committed:${event.eventId}`);
        shell.publish(createAttemptActivityMessage({
          messageId: `message:${event.eventId}`,
          revision: delta.revision,
          boardId: inspector.boardId,
          cardId: inspector.cardId,
          attemptId: inspector.attemptId,
          generation: inspector.generation,
          sequence: event.sequence,
          projection: inspector,
        }));
        notificationOrder.push(`published:${event.eventId}`);
      },
    });

    let emitActivity: (input: unknown) => Promise<void> = async () => { throw new Error("not subscribed"); };
    let closeCalls = 0;
    let unsubscribeCalls = 0;
    const directFactory: DirectAcpConnectionFactory = {
      async connect() {
        return {
        async newSession() {
            return { sessionId: "fresh-integrated-session" };
        },
        async prompt() { return { stopReason: "end_turn" }; },
          subscribeActivity(listener) {
            emitActivity = async (input) => { await listener(input); };
            return () => { unsubscribeCalls += 1; };
          },
          close() { closeCalls += 1; },
        };
      },
    };
    const scheduler = createGlobalAttemptScheduler();
    const coordinator = createAttemptCoordinator({
      journal,
      scheduler,
      worktrees: {
        async ensure() { return { status: "reused", binding: worktree() }; },
        async cleanupExplicit() { return { status: "refused", reason: "live" }; },
      },
      directAcp: createDirectAcpAttemptStarter(directFactory),
      activityIngestor: ingestor,
      getCatalog: () => catalog(),
      resolveProfile: () => profile(),
      verifyRepository: () => ({
        trusted: true,
        canonicalPath: "/trusted/repository",
        checkedAt: 50,
        message: "verified",
      }),
      now: (() => { let value = 100; return () => ++value; })(),
      createAttemptId: () => "attempt-integrated",
      createEventId: (operation) => `lifecycle:${operation}`,
    });

    const started = await coordinator.start(CARD_ID);
    if (started.status === "rejected") throw new Error(`attempt rejected: ${started.reason.code} ${started.reason.message}`);
    expect(started.status).toBe("started");
    if (started.status !== "started") throw new Error("attempt did not start");
    const attemptId = started.attempt.attemptId;
    const generation = started.attempt.generation;
    const normalized = (sequence: number, activity: unknown) => ({
      eventId: toOpaqueId<ActivityEventId>(`activity:${sequence}`)!,
      attemptId,
      generation,
      sequence: toActivitySequence(sequence)!,
      occurredAt: 200 + sequence,
      activity,
    });

    await emitActivity(normalized(2, { kind: "agent_message", messageId: "agent-1", textDelta: "Hello" }));
    await emitActivity(normalized(3, {
      kind: "tool_call",
      call: { toolCallId: "tool-1", kind: "read", status: "completed", locations: ["src/index.ts"] },
    }));
    await emitActivity(normalized(4, { kind: "attempt_state", state: "succeeded" }));

    expect(notificationOrder).toEqual([
      "committed:activity:2", "published:activity:2",
      "committed:activity:3", "published:activity:3",
      "committed:activity:4", "published:activity:4",
    ]);
    expect(factory.messages).toHaveLength(3);
    expect(factory.messages.every((message) => message.kind === "attempt_activity")).toBeTrue();
    expect(closeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(1);
    expect(scheduler.activeCount).toBe(0);

    const ownEnvelope = await factory.inspectorHandler?.({ cardId: CARD_ID });
    expect(ownEnvelope?.result.status).toBe("ok");
    if (ownEnvelope?.result.status !== "ok") throw new Error("inspector query unavailable");
    expect(ownEnvelope.result.projection.attempts).toHaveLength(1);
    expect(ownEnvelope.result.projection.attempts[0]).toMatchObject({
      attemptId,
      terminalOutcome: "succeeded",
      entries: [{ kind: "agent" }, { kind: "tool" }, { kind: "terminal" }],
    });
    expect(assertProjectionPayload(ownEnvelope)).toBe(ownEnvelope);
    const serializedRpc = JSON.stringify({ ownEnvelope, messages: factory.messages });
    expect(serializedRpc).not.toContain(directory);
    expect(serializedRpc).not.toContain("Execute the private fixture workflow");
    expect(serializedRpc).not.toContain("worktreePath");
    expect(serializedRpc).not.toContain("sqlite");

    const isolatedEnvelope = await factory.inspectorHandler?.({ cardId: OTHER_CARD_ID });
    expect(isolatedEnvelope?.result).toEqual({
      status: "ok",
      projection: { schemaVersion: 1, cardId: OTHER_CARD_ID, revision: journal.snapshot().revision, attempts: [] },
    });

    const live = journal.snapshot();
    expect(() => database.run(
      "UPDATE run_contexts SET context_json = '{}' WHERE attempt_id = ?",
      [attemptId],
    )).toThrow("Run Contexts are immutable");
    shell.stop();
    closeSqliteDatabase(database);

    const reopened = openSqliteDatabase({ filename });
    try {
      migrateDatabase(reopened);
      const reopenedJournal = createEventJournal(reopened);
      expect(reopenedJournal.snapshot()).toEqual(live);
      reopened.run("DELETE FROM attempt_inspector_projections");
      expect(reopenedJournal.snapshot().attemptInspectors).toEqual([]);
      const rebuilt = rebuildProjections(reopened);
      expect(rebuilt).toEqual(live);
      expect(getCardInspectorProjection(reopenedJournal, CARD_ID)?.attempts[0]?.context).toEqual(
        ownEnvelope.result.projection.attempts[0]?.context,
      );
    } finally {
      closeSqliteDatabase(reopened);
    }
  });
});

function seedCards(journal: ReturnType<typeof createEventJournal>): void {
  journal.append({
    eventId: "seed-board", boardId: BOARD_ID, actor: "operator", kind: "board_upserted", occurredAt: 1,
    payload: { boardId: BOARD_ID, repositoryPath: "/trusted/repository", workflowVersion: 1, createdAt: 1, updatedAt: 1 },
  });
  journal.append({
    eventId: "seed-stage", boardId: BOARD_ID, actor: "operator", kind: "stage_upserted", occurredAt: 2,
    payload: {
      stageId: STAGE_ID, boardId: BOARD_ID, label: "Doing", position: 0, defaultSkillId: SKILL_ID,
      configured: true, workflowVersion: 1, updatedAt: 2,
    },
  });
  [CARD_ID, OTHER_CARD_ID].forEach((cardId, index) => journal.append({
    eventId: `seed-card-${index}`,
    boardId: BOARD_ID,
    cardId,
    actor: "operator",
    kind: "card_upserted",
    occurredAt: 3 + index,
    payload: card(cardId, 3 + index),
  }));
}

function card(cardId: CardId, timestamp: number): CardProjection {
  return {
    cardId,
    boardId: BOARD_ID,
    stageId: STAGE_ID,
    title: `Card ${cardId}`,
    description: "Integration fixture",
    provider: "codex",
    model: "gpt-5",
    effort: "high",
    skillOverrideId: null,
    runnable: true,
    executionStatus: "idle",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function catalog(): SkillCatalog {
  const entry: SkillCatalogEntry = {
    skillId: SKILL_ID,
    canonicalPath: "/trusted/repository/.agents/skills/integration/SKILL.md",
    rootClass: "project",
    rootPath: "/trusted/repository/.agents/skills",
    digest: "d".repeat(64),
    metadata: { name: "integration", description: "Fixture", frontmatter: { name: "integration" } },
    order: 0,
    hasNameCollision: false,
    diagnostics: [],
  };
  return {
    roots: [],
    entries: [entry],
    diagnostics: [],
    resolvedSkills: new Map([[SKILL_ID, { entry, validatedContent: "Execute the private fixture workflow" }]]),
  };
}

function profile(): CertifiedDirectAcpProfile {
  return {
    profileId: PROFILE_ID,
    provider: "codex",
    models: ["gpt-5"],
    efforts: ["high"],
    readiness: { profileId: PROFILE_ID, ready: true, protocolVersion: 1 },
    certification: { recipeId: "codex-acp", adapterVersion: "1.2.3", checkedAt: 50 },
  };
}

function worktree(): CardWorktreeBinding {
  const repository = "/trusted/repository";
  const bindingId = "kw-integration001";
  return {
    bindingVersion: 1,
    bindingId,
    boardId: BOARD_ID,
    cardId: CARD_ID,
    repositoryRoot: repository,
    repositoryGitDir: `${repository}/.git`,
    managedRoot: `${repository}/.kitten/worktrees/cards`,
    worktreePath: `${repository}/.kitten/worktrees/cards/${bindingId}`,
    branch: `kitten/card/${bindingId}`,
    baselineBranch: "main",
    baselineCommit: "b".repeat(40),
    lifecycle: "active",
    reason: null,
    createdAt: 50,
    updatedAt: 50,
  };
}
