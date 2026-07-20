// Honest in-memory SettingRepository. Keep it a faithful implementation of the
// port's contract, not a per-test mock — the shared contract test runs against
// both this and the MikroORM adapter.

import type { SettingRepository } from "../src/core/ports/setting-repository";

export class FakeSettingRepository implements SettingRepository {
  private readonly rows = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.rows.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.rows.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.rows.set(key, value);
  }
}
