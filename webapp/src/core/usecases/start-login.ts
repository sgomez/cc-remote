// start-login — ensure a Login Container is running for a `pending_login`
// (oauth) Account. Idempotent: it reuses an existing container (re-entry into a
// still-pending flow, restart recovery) rather than creating a duplicate. A
// non-oauth account has no login flow (throws); an already-`ready` account has
// nothing to log in and yields no container.

import { accountConfigVolumeName } from "../domain/account";
import { AccountNotFoundError, LoginNotSupportedError } from "../domain/errors";
import { buildLoginLabels, type LoginContainer } from "../domain/login";
import { requireProviderType } from "../domain/provider-type";
import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";

export type StartLoginInput = { accountId: string };

export type StartLoginDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makeStartLogin(deps: StartLoginDeps) {
  return async function startLogin(input: StartLoginInput): Promise<LoginContainer | null> {
    const account = await deps.accounts.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);

    const type = requireProviderType(account.providerType);
    if (type.seeding !== "oauth") throw new LoginNotSupportedError(account.id);

    // Already logged in — nothing to start.
    if (account.status === "ready") return null;

    // Idempotent re-entry / recovery: reuse a still-running orphaned container
    // instead of spawning a second one on the same volume. A crashed login
    // leaves an `exited` container present (Login Containers have no
    // AutoRemove), and re-attaching to it would strand the flow behind a dead
    // terminal the poll can never complete — so treat any non-`running`
    // container as absent and recreate it.
    const existing = await deps.engine.getLoginContainer(account.id);
    if (existing?.state === "running") return existing;
    if (existing) await deps.engine.removeLoginContainer(account.id);

    await deps.engine.runLoginContainer({
      accountId: account.id,
      accountConfigVolume: accountConfigVolumeName(account.id),
      labels: buildLoginLabels({ accountId: account.id }),
    });
    return (
      (await deps.engine.getLoginContainer(account.id)) ?? {
        accountId: account.id,
        state: "running",
      }
    );
  };
}
