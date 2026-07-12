// MikroOrmAccountRepository — the SQLite-backed implementation of the
// AccountRepository port (#11). Thin: it only maps between the domain `Account`
// and the `provider_account` row and delegates persistence to MikroORM. No
// business logic lives here (that stays in the core use cases).

import type { MikroORM } from "@mikro-orm/sqlite";
import type { Account, AccountStatus } from "~/core/domain/account";
import type { AccountRepository } from "~/core/ports/account-repository";
import { ProviderAccount, type ProviderAccountRow } from "./entities";

function toRow(account: Account): ProviderAccountRow {
  return {
    id: account.id,
    providerType: account.providerType,
    displayName: account.displayName,
    credentials: { ...account.credentials },
    config: { ...account.config },
    status: account.status,
    createdAt: account.createdAt.toISOString(),
  };
}

function toAccount(row: ProviderAccountRow): Account {
  return {
    id: row.id,
    providerType: row.providerType,
    displayName: row.displayName,
    credentials: { ...row.credentials },
    config: { ...row.config },
    status: row.status as AccountStatus,
    createdAt: new Date(row.createdAt),
  };
}

export class MikroOrmAccountRepository implements AccountRepository {
  constructor(private readonly orm: MikroORM) {}

  // A fresh fork per call keeps the identity map from leaking state between
  // operations (the repository is long-lived, requests are not).
  private fork() {
    return this.orm.em.fork();
  }

  async create(account: Account): Promise<Account> {
    const em = this.fork();
    em.create(ProviderAccount, toRow(account));
    await em.flush(); // duplicate id -> unique-constraint error (fails loudly)
    return toAccount(toRow(account));
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.fork().findOne(ProviderAccount, { id });
    return row ? toAccount(row) : null;
  }

  async findAll(): Promise<Account[]> {
    const rows = await this.fork().find(ProviderAccount, {});
    return rows.map(toAccount);
  }

  async update(account: Account): Promise<Account> {
    const em = this.fork();
    const existing = await em.findOne(ProviderAccount, { id: account.id });
    if (!existing) throw new Error(`unknown account id: ${account.id}`);
    em.assign(existing, toRow(account));
    await em.flush();
    return toAccount(toRow(account));
  }

  async delete(id: string): Promise<void> {
    const em = this.fork();
    await em.nativeDelete(ProviderAccount, { id });
  }
}
