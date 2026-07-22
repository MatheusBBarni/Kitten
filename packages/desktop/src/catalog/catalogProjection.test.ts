import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { JournalValidationError, createEventJournal } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { rebuildProjections } from "../persistence/projectionRebuilder.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import {
  readCatalogProjection,
  replaceCatalogProjection,
  storeSkillSnapshot,
} from "./catalogProjection.ts";
import { createCatalogRoot, skillContent, withCatalogFixture, writeSkill } from "./fixtures.ts";
import { createSkillSnapshot, discoverSkillCatalog } from "./skillCatalog.ts";

describe("catalog journal projection", () => {
  test("reopens and rebuilds entries and diagnostics without changing order or identity", () => {
    withCatalogFixture((directory) => {
      const projectRoot = createCatalogRoot(directory, "project");
      const userRoot = createCatalogRoot(directory, "user");
      writeSkill(projectRoot, "shared-project", skillContent("shared", "Project body."));
      writeSkill(userRoot, "shared-user", skillContent("shared", "User body."));
      const missingRoot = join(directory, "missing");
      const catalog = discoverSkillCatalog({
        projectRoots: [projectRoot, missingRoot],
        userRoots: [userRoot],
      });
      const selected = catalog.entries[0];
      if (selected === undefined) throw new Error("fixture catalog has no entry");
      const skillSnapshot = createSkillSnapshot(catalog, selected.skillId);
      const filename = join(directory, "desktop.sqlite");

      const database = openSqliteDatabase({ filename });
      migrateDatabase(database);
      const journal = createEventJournal(database);
      replaceCatalogProjection(journal, {
        eventId: "catalog-refresh-1",
        catalogId: "board-catalog",
        catalog,
        occurredAt: 100,
      });
      expect(storeSkillSnapshot(journal, {
        eventId: "snapshot-store-1",
        catalogId: "board-catalog",
        snapshot: skillSnapshot,
        storedAt: 101,
      }).status).toBe("stored");
      const live = journal.snapshot();
      const projected = readCatalogProjection(live, "board-catalog");
      expect(projected.entries.map(({ skillId, order }) => [skillId, order])).toEqual(
        catalog.entries.map(({ skillId, order }) => [skillId, order]),
      );
      expect(projected.diagnostics).toEqual(catalog.diagnostics);
      closeSqliteDatabase(database);

      const reopened = openSqliteDatabase({ filename });
      try {
        expect(migrateDatabase(reopened).appliedVersions).toEqual([]);
        const reopenedJournal = createEventJournal(reopened);
        expect(reopenedJournal.snapshot()).toEqual(live);

        reopened.run("DELETE FROM skill_catalog_diagnostics");
        reopened.run("DELETE FROM skill_catalog_entries");
        expect(readCatalogProjection(reopenedJournal.snapshot(), "board-catalog")).not.toEqual(projected);
        expect(rebuildProjections(reopened)).toEqual(live);
        expect(readCatalogProjection(reopenedJournal.snapshot(), "board-catalog")).toEqual(projected);

        expect(() => reopened.run(
          "UPDATE skill_snapshots SET content = ? WHERE snapshot_id = ?",
          [new TextEncoder().encode("rewritten"), skillSnapshot.snapshotId],
        )).toThrow("skill snapshots are immutable");
        expect(() => reopened.run(
          "DELETE FROM skill_snapshots WHERE snapshot_id = ?",
          [skillSnapshot.snapshotId],
        )).toThrow("skill snapshots are immutable");
      } finally {
        closeSqliteDatabase(reopened);
      }
    });
  });

  test("keeps an earlier persisted snapshot exact after catalog bytes change", () => {
    withCatalogFixture((directory) => {
      const projectRoot = createCatalogRoot(directory, "project");
      const firstContent = `\uFEFF${skillContent("execute", "First body.")}`;
      const filename = writeSkill(projectRoot, "execute", firstContent);
      const firstCatalog = discoverSkillCatalog({ projectRoots: [projectRoot], userRoots: [] });
      const firstEntry = firstCatalog.entries[0];
      if (firstEntry === undefined) throw new Error("fixture catalog has no entry");
      const firstSnapshot = createSkillSnapshot(firstCatalog, firstEntry.skillId);
      const database = openSqliteDatabase({ filename: ":memory:" });
      migrateDatabase(database);
      const journal = createEventJournal(database);
      try {
        replaceCatalogProjection(journal, {
          eventId: "catalog-refresh-first",
          catalogId: "catalog",
          catalog: firstCatalog,
          occurredAt: 10,
        });
        expect(storeSkillSnapshot(journal, {
          eventId: "snapshot-first",
          catalogId: "catalog",
          snapshot: firstSnapshot,
          storedAt: 11,
        }).status).toBe("stored");
        expect(() => journal.append({
          eventId: "snapshot-tampered",
          boardId: "catalog",
          actor: "system",
          kind: "skill_snapshot_stored",
          occurredAt: 12,
          payload: {
            catalogId: "catalog",
            snapshot: { ...firstSnapshot, content: "tampered" },
            storedAt: 12,
          },
        })).toThrow(JournalValidationError);

        writeFileSync(filename, skillContent("execute", "Second body."));
        const secondCatalog = discoverSkillCatalog({ projectRoots: [projectRoot], userRoots: [] });
        const secondEntry = secondCatalog.entries[0];
        if (secondEntry === undefined) throw new Error("updated fixture catalog has no entry");
        const secondSnapshot = createSkillSnapshot(secondCatalog, secondEntry.skillId);
        replaceCatalogProjection(journal, {
          eventId: "catalog-refresh-second",
          catalogId: "catalog",
          catalog: secondCatalog,
          occurredAt: 13,
        });
        expect(storeSkillSnapshot(journal, {
          eventId: "snapshot-second",
          catalogId: "catalog",
          snapshot: secondSnapshot,
          storedAt: 14,
        }).status).toBe("stored");
        expect(storeSkillSnapshot(journal, {
          eventId: "snapshot-first-repeat",
          catalogId: "catalog",
          snapshot: firstSnapshot,
          storedAt: 15,
        }).status).toBe("existing");

        const persistedSnapshots = journal.snapshot().skillSnapshots;
        expect(persistedSnapshots.find(
          ({ snapshot }) => snapshot.snapshotId === firstSnapshot.snapshotId,
        )?.snapshot.content).toBe(firstContent);
        expect(persistedSnapshots.find(
          ({ snapshot }) => snapshot.snapshotId === secondSnapshot.snapshotId,
        )?.snapshot.content).toBe(secondSnapshot.content);
        expect(journal.events().filter(({ kind }) => kind === "skill_snapshot_stored")).toHaveLength(2);
      } finally {
        closeSqliteDatabase(database);
      }
    });
  });
});
