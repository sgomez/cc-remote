// Runs the shared AccountRepository contract against both the in-memory fake and
// the real SQLite adapter (temp file per test). Same spec, two implementations —
// this is the acceptance gate that the adapter honours the port (#12).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAccountRepositoryContract } from "../../../test/account-repository-contract";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { MikroOrmAccountRepository } from "./mikro-orm-account-repository";
import { initOrm } from "./orm";

runAccountRepositoryContract("in-memory fake", async () => {
  return { repo: new FakeAccountRepository(), teardown: async () => {} };
});

runAccountRepositoryContract("MikroORM + SQLite (temp file)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-remote-db-"));
  const dbPath = join(dir, "test.db");
  const orm = await initOrm(dbPath);
  await orm.getSchemaGenerator().createSchema();

  return {
    repo: new MikroOrmAccountRepository(orm),
    teardown: async () => {
      await orm.close(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
});
