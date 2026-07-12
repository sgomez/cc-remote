// mark-account-ready — flips pending_login -> ready once credentials appear in
// the Account Config Volume. Driven by the Login Container flow (#14).

import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { AccountNotFoundError, CredentialsNotFoundError } from "../domain/errors";
import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";

export type MarkAccountReadyInput = { accountId: string };

export type MarkAccountReadyDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makeMarkAccountReady(deps: MarkAccountReadyDeps) {
  return async function markAccountReady(input: MarkAccountReadyInput): Promise<Account> {
    const account = await deps.accounts.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);

    if (account.status === "ready") return account;

    const hasCredentials = await deps.engine.hasCredentials(accountConfigVolumeName(account.id));
    if (!hasCredentials) throw new CredentialsNotFoundError(account.id);

    const updated: Account = { ...account, status: "ready" };
    await deps.accounts.update(updated);
    return updated;
  };
}
