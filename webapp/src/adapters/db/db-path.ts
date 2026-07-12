// Single source of truth for the SQLite file location, shared by the two
// engines that open it: MikroORM (domain tables) and better-auth (its own
// tables via Kysely). Both open the SAME file with WAL enabled (PRD §3/§4).

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * DB file path. Defaults under a `data/` dir that deployment (#17) mounts as a
 * volume so Accounts and auth sessions survive container recreation.
 */
export const DB_PATH = process.env.DATABASE_PATH ?? "./data/cc-remote.db";

/** Create the parent directory (0700) so the SQLite drivers can create the file. */
export function ensureDbDir(dbPath: string = DB_PATH): void {
  if (dbPath === ":memory:") return;
  const dir = dirname(dbPath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}
