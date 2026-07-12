// poll-logins — one sweep over every Account still awaiting login. The delivery
// layer runs it on an interval (see the docker adapter's login-poller); the
// core keeps the decision (which accounts, and the per-account flip) so the
// whole state machine stays TDD'd against the fakes. Returns the accounts that
// flipped to `ready` on this pass.

import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";
import { type CheckLoginResult, makeCheckLogin } from "./check-login";

export type PollLoginsDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makePollLogins(deps: PollLoginsDeps) {
  const checkLogin = makeCheckLogin(deps);

  return async function pollLogins(): Promise<CheckLoginResult[]> {
    const accounts = await deps.accounts.findAll();
    // Only oauth accounts ever reach `pending_login`, so status is the filter.
    const pending = accounts.filter((a) => a.status === "pending_login");

    const flipped: CheckLoginResult[] = [];
    for (const account of pending) {
      const result = await checkLogin({ accountId: account.id });
      if (result.flipped) flipped.push(result);
    }
    return flipped;
  };
}
