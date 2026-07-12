// recover-logins — startup reconciliation for the Login Container flow, so a
// web-manager restart never strands a pending login. For every Account still
// `pending_login`: flip it if credentials already appeared while the process
// was down; otherwise (idempotently) re-attach to an orphaned Login Container
// or recreate a crashed one. Resuming the poll afterwards is the interval's
// job. Composes check-login + start-login so all the state logic stays here and
// stays tested.

import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";
import { makeCheckLogin } from "./check-login";
import { makeStartLogin } from "./start-login";

export type RecoverLoginsDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makeRecoverLogins(deps: RecoverLoginsDeps) {
  const checkLogin = makeCheckLogin(deps);
  const startLogin = makeStartLogin(deps);

  return async function recoverLogins(): Promise<void> {
    const accounts = await deps.accounts.findAll();
    const pending = accounts.filter((a) => a.status === "pending_login");

    for (const account of pending) {
      const result = await checkLogin({ accountId: account.id });
      // Completed-while-down accounts are already flipped; the rest need a
      // running container (reused if orphaned, recreated if the crash took it).
      if (!result.flipped) await startLogin({ accountId: account.id });
    }
  };
}
