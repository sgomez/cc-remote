// MikroORM configuration for the domain tables. Shared by the runtime factory
// (orm.ts) and the `mikro-orm` CLI (migration:up / migration:create — wired via
// the `mikro-orm.configPaths` field in package.json).
//
// better-auth manages ITS OWN tables on the SAME SQLite file via its built-in
// Kysely engine + `@better-auth/cli migrate` (#5: the community MikroORM adapter
// was rejected). MikroORM therefore only ever creates/alters `provider_account`,
// `setting` and its own migration bookkeeping table — never better-auth's.

import { Migrator } from "@mikro-orm/migrations";
import { defineConfig } from "@mikro-orm/sqlite";
import { DB_PATH } from "./db-path";
import { ProviderAccount, Setting } from "./entities";

/** Re-exported for the runtime factory and tests. See ./db-path.ts. */
export const DEFAULT_DB_PATH = DB_PATH;

export default defineConfig({
  dbName: DEFAULT_DB_PATH,
  entities: [ProviderAccount, Setting],
  extensions: [Migrator],
  migrations: {
    path: "./src/adapters/db/migrations",
    // The migrations glob resolves .ts under the CLI (tsx) and .js under a
    // compiled build; keep both so deployment can run either.
    glob: "!(*.d).{js,ts}",
    tableName: "mikro_orm_migrations",
    transactional: true,
  },
  // Domain tables are simple; no debug logging in the adapter.
  debug: false,
});
