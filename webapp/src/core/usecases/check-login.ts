// check-login — one credential poll for a single Account. When the Login
// Container has written credentials into the Account Config Volume, flip the
// Account to `ready` (delegating to mark-account-ready, the single flip path)
// and destroy the Login Container. Otherwise leave the flow untouched. The
// "not yet" path returns without throwing — this runs on every poll tick.

import { accountConfigVolumeName } from "../domain/account";
import { AccountNotFoundError } from "../domain/errors";
import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";
import { makeMarkAccountReady } from "./mark-account-ready";

export type CheckLoginInput = { accountId: string };
export type CheckLoginResult = { accountId: string; flipped: boolean };

export type CheckLoginDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makeCheckLogin(deps: CheckLoginDeps) {
  const markReady = makeMarkAccountReady(deps);

  return async function checkLogin(input: CheckLoginInput): Promise<CheckLoginResult> {
    const account = await deps.accounts.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);

    if (account.status === "ready") {
      // Defensive cleanup: a container left over from a completed login is gone.
      await deps.engine.removeLoginContainer(account.id);
      return { accountId: account.id, flipped: false };
    }

    const hasCredentials = await deps.engine.hasCredentials(accountConfigVolumeName(account.id));
    if (!hasCredentials) return { accountId: account.id, flipped: false };

    // Pre-checked, so mark-account-ready cannot throw CredentialsNotFound here.
    await markReady({ accountId: account.id });
    await deps.engine.removeLoginContainer(account.id);
    return { accountId: account.id, flipped: true };
  };
}
