import { Database } from "bun:sqlite";

export interface SqliteDatabaseOptions {
  readonly filename: string;
  readonly readonly?: boolean;
  readonly create?: boolean;
  readonly openDatabase?: (
    filename: string,
    options: { readonly: boolean; create: boolean; strict: true },
  ) => Database;
}

/** Opens the desktop host's package-local SQLite authority. */
export function openSqliteDatabase(options: SqliteDatabaseOptions): Database {
  if (options.filename.trim().length === 0) {
    throw new Error("SQLite filename must not be empty");
  }

  const readonly = options.readonly ?? false;
  const create = options.create ?? !readonly;
  const openDatabase = options.openDatabase ?? ((filename, databaseOptions) => (
    new Database(filename, databaseOptions)
  ));
  const database = openDatabase(options.filename, { readonly, create, strict: true });

  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA busy_timeout = 5000");
  return database;
}

export function closeSqliteDatabase(database: Database): void {
  database.close(true);
}
