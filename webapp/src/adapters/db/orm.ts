// Runtime MikroORM bootstrap: open the SQLite file, enable WAL (two writers —
// MikroORM for domain tables, better-auth for its own — share this file), and
// lock the file down to 0600 since it holds plaintext credentials and OAuth
// tokens (PRD §3, non-goal: encryption-at-rest).

import { chmodSync, existsSync } from "node:fs";
import { MikroORM } from "@mikro-orm/sqlite";
import { ensureDbDir } from "./db-path";
import config, { DEFAULT_DB_PATH } from "./mikro-orm.config";

/** Best-effort 0600 on the DB file and its WAL/SHM sidecars. */
function lockDownPermissions(dbPath: string): void {
  if (dbPath === ":memory:") return;
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dbPath}${suffix}`;
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}

/**
 * Initialise MikroORM against `dbPath` (defaults to `DATABASE_PATH`/`./data`).
 * Enables WAL and applies strict file permissions. Callers own the returned
 * instance and must `close()` it. Schema is applied out of band — migrations in
 * deployment (#17), the schema generator in tests.
 */
export async function initOrm(dbPath: string = DEFAULT_DB_PATH): Promise<MikroORM> {
  ensureDbDir(dbPath);
  const orm = await MikroORM.init({ ...config, dbName: dbPath });
  await orm.em.getConnection().execute("PRAGMA journal_mode = WAL;");
  lockDownPermissions(dbPath);
  return orm;
}
