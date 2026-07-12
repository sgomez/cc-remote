// Honest in-memory AccountRepository. Reused across core sub-issues — keep it a
// faithful implementation of the port's contract, not a per-test mock.

import type { Account } from "../src/core/domain/account";
import type { AccountRepository } from "../src/core/ports/account-repository";

function clone(account: Account): Account {
  return {
    ...account,
    credentials: { ...account.credentials },
    config: { ...account.config },
    createdAt: new Date(account.createdAt.getTime()),
  };
}

export class FakeAccountRepository implements AccountRepository {
  private readonly rows = new Map<string, Account>();

  constructor(seed: Account[] = []) {
    for (const a of seed) this.rows.set(a.id, clone(a));
  }

  async create(account: Account): Promise<Account> {
    if (this.rows.has(account.id)) {
      throw new Error(`duplicate account id: ${account.id}`);
    }
    this.rows.set(account.id, clone(account));
    return clone(account);
  }

  async findById(id: string): Promise<Account | null> {
    const found = this.rows.get(id);
    return found ? clone(found) : null;
  }

  async findAll(): Promise<Account[]> {
    return [...this.rows.values()].map(clone);
  }

  async update(account: Account): Promise<Account> {
    if (!this.rows.has(account.id)) {
      throw new Error(`unknown account id: ${account.id}`);
    }
    this.rows.set(account.id, clone(account));
    return clone(account);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
