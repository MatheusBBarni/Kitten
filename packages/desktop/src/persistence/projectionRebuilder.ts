import type { Database } from "bun:sqlite";
import {
  applyProjectionEvent,
  readOrderedJournalEvents,
  readPersistenceSnapshot,
  type PersistenceSnapshot,
} from "./eventJournal.ts";

/** Replaces disposable current-state rows with a deterministic replay of the immutable journal. */
export function rebuildProjections(database: Database): PersistenceSnapshot {
  const rebuild = database.transaction(() => {
    const events = readOrderedJournalEvents(database);
    const journalOrders = database.query<{ readonly journalOrder: number }, []>(
      "SELECT journal_order AS journalOrder FROM journal_events ORDER BY journal_order",
    ).all();
    if (events.length !== journalOrders.length) {
      throw new Error("Journal order metadata does not match persisted events");
    }

    database.run("DELETE FROM cards");
    database.run("DELETE FROM workflow_edges");
    database.run("DELETE FROM workflow_stages");
    database.run("DELETE FROM boards");
    database.run("UPDATE projection_metadata SET revision = 0, last_journal_order = 0 WHERE singleton = 1");

    events.forEach((event, index) => {
      applyProjectionEvent(database, event);
      const journalOrder = journalOrders[index]?.journalOrder;
      if (journalOrder === undefined) throw new Error("Journal order is missing during rebuild");
      database.query<void, [number]>(`
        UPDATE projection_metadata
        SET revision = revision + 1, last_journal_order = ?
        WHERE singleton = 1
      `).run(journalOrder);
    });
  });
  rebuild.immediate();
  return readPersistenceSnapshot(database);
}
