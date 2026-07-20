// Runs the shared SettingRepository contract against both the in-memory fake and
// the real SQLite adapter (temp file per test). Same spec, two implementations.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSettingRepository } from "../../../test/fake-setting-repository";
import { runSettingRepositoryContract } from "../../../test/setting-repository-contract";
import { MikroOrmSettingRepository } from "./mikro-orm-setting-repository";
import { initOrm } from "./orm";

runSettingRepositoryContract("in-memory fake", async () => {
  return { repo: new FakeSettingRepository(), teardown: async () => {} };
});

runSettingRepositoryContract("MikroORM + SQLite (temp file)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-remote-db-"));
  const dbPath = join(dir, "test.db");
  const orm = await initOrm(dbPath);
  await orm.schema.create();

  return {
    repo: new MikroOrmSettingRepository(orm),
    teardown: async () => {
      await orm.close(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
});
