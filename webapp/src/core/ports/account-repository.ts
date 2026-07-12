// AccountRepository — persistence port for `provider_account` rows. The DB
// adapter (#12, MikroORM/SQLite) implements it; use cases depend only on this.

import type { Account } from "../domain/account";

export interface AccountRepository {
  create(account: Account): Promise<Account>;
  findById(id: string): Promise<Account | null>;
  findAll(): Promise<Account[]>;
  update(account: Account): Promise<Account>;
  delete(id: string): Promise<void>;
}
