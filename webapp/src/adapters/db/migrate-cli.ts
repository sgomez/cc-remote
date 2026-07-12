// Programmatic MikroORM migration runner (issue #17). Applies all pending
// domain-table migrations, then closes. Used by the container entrypoint at
// start (`pnpm db:migrate`).
//
// Deliberately NOT the `mikro-orm` yargs CLI: that pulls in figlet/yargonaut,
// whose banner code calls `fileURLToPath(import.meta.url)` in a CJS context and
// crashes with ERR_INVALID_ARG_TYPE under Node 24 (the runtime image's base).
// The Migrator API reuses initOrm() (WAL + strict file perms) and the same
// migrations glob from mikro-orm.config, so it stays in lockstep with the CLI's
// `migration:create` used in development.

import { initOrm } from "./orm";

async function main(): Promise<void> {
  const orm = await initOrm();
  try {
    const migrator = orm.getMigrator();
    const applied = await migrator.up();
    if (applied.length === 0) {
      console.log("[migrate] no pending MikroORM migrations");
    } else {
      console.log(`[migrate] applied ${applied.length} MikroORM migration(s):`);
      for (const m of applied) console.log(`  - ${m.name}`);
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((error) => {
  console.error("[migrate] MikroORM migration failed:", error);
  process.exit(1);
});
