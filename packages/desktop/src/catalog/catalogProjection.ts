import type { BoardId } from "../workflow/workflowTypes.ts";
import type {
  CatalogProjection,
  EventJournal,
  PersistenceSnapshot,
  ProjectionDelta,
  StoredSkillSnapshot,
} from "../persistence/eventJournal.ts";
import type { SkillCatalog, SkillSnapshot } from "./contracts.ts";

export interface ReplaceCatalogProjectionInput {
  readonly eventId: string;
  readonly catalogId: string;
  readonly catalog: SkillCatalog;
  readonly occurredAt: number;
}

export interface StoreSkillSnapshotInput {
  readonly eventId: string;
  readonly catalogId: string;
  readonly snapshot: SkillSnapshot;
  readonly storedAt: number;
}

export type StoreSkillSnapshotResult =
  | { readonly status: "stored"; readonly value: StoredSkillSnapshot; readonly delta: ProjectionDelta }
  | { readonly status: "existing"; readonly value: StoredSkillSnapshot };

function catalogProjection(catalogId: string, catalog: SkillCatalog): CatalogProjection {
  return {
    catalogId,
    roots: catalog.roots,
    entries: catalog.entries,
    diagnostics: catalog.diagnostics,
  };
}

/** Appends one authoritative replacement event and updates the disposable catalog projection. */
export function replaceCatalogProjection(
  journal: EventJournal,
  input: ReplaceCatalogProjectionInput,
): ProjectionDelta {
  return journal.append({
    eventId: input.eventId,
    boardId: input.catalogId as BoardId,
    actor: "system",
    kind: "catalog_projection_replaced",
    occurredAt: input.occurredAt,
    payload: catalogProjection(input.catalogId, input.catalog),
  });
}

/** Stores exact validated bytes once; repeated use of the same identity is idempotent. */
export function storeSkillSnapshot(
  journal: EventJournal,
  input: StoreSkillSnapshotInput,
): StoreSkillSnapshotResult {
  const existing = journal.snapshot().skillSnapshots.find(
    ({ snapshot }) => snapshot.snapshotId === input.snapshot.snapshotId,
  );
  if (existing !== undefined) {
    if (JSON.stringify(existing.snapshot) !== JSON.stringify(input.snapshot)) {
      throw new Error(`Skill snapshot identity conflict: ${input.snapshot.snapshotId}`);
    }
    return { status: "existing", value: existing };
  }

  const value: StoredSkillSnapshot = {
    catalogId: input.catalogId,
    snapshot: input.snapshot,
    storedAt: input.storedAt,
  };
  return {
    status: "stored",
    value,
    delta: journal.append({
      eventId: input.eventId,
      boardId: input.catalogId as BoardId,
      actor: "system",
      kind: "skill_snapshot_stored",
      occurredAt: input.storedAt,
      payload: value,
    }),
  };
}

export function readCatalogProjection(
  snapshot: PersistenceSnapshot,
  catalogId: string,
): CatalogProjection {
  return {
    catalogId,
    roots: snapshot.catalogRoots
      .filter((root) => root.catalogId === catalogId)
      .map(({ catalogId: _catalogId, ...root }) => root),
    entries: snapshot.catalogEntries
      .filter((entry) => entry.catalogId === catalogId)
      .map(({ catalogId: _catalogId, ...entry }) => entry),
    diagnostics: snapshot.catalogDiagnostics
      .filter((entry) => entry.catalogId === catalogId)
      .map(({ catalogId: _catalogId, ...entry }) => entry),
  };
}
