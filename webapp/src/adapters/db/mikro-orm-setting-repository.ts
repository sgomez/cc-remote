// SettingRepository over the `setting` key/value table. Thin by design: the
// "absent key means the domain default" rule lives in the settings use cases,
// not here, so it is covered by core tests rather than a DB-touching one.

import type { MikroORM } from "@mikro-orm/sqlite";
import type { SettingRepository } from "../../core/ports/setting-repository";
import { Setting } from "./entities";

export class MikroOrmSettingRepository implements SettingRepository {
  constructor(private readonly orm: MikroORM) {}

  // A fresh fork per call keeps the identity map from leaking state between
  // operations (the repository is long-lived, requests are not).
  private fork() {
    return this.orm.em.fork();
  }

  async get(key: string): Promise<string | null> {
    const row = await this.fork().findOne(Setting, { key });
    return row ? row.value : null;
  }

  async set(key: string, value: string): Promise<void> {
    const em = this.fork();
    const existing = await em.findOne(Setting, { key });
    if (existing) {
      em.assign(existing, { value });
    } else {
      em.create(Setting, { key, value });
    }
    await em.flush();
  }
}
