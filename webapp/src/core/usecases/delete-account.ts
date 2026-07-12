// delete-account — refused while any Session is labelled with the Account
// (Docker is the source of truth for that check); otherwise removes the row and
// its Account Config Volume (#5: blocked, never cascade).

import { accountConfigVolumeName } from "../domain/account";
import { AccountInUseError, AccountNotFoundError } from "../domain/errors";
import type { AccountRepository } from "../ports/account-repository";
import type { ContainerEngine } from "../ports/container-engine";

export type DeleteAccountInput = { accountId: string };

export type DeleteAccountDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
};

export function makeDeleteAccount(deps: DeleteAccountDeps) {
  return async function deleteAccount(input: DeleteAccountInput): Promise<void> {
    const account = await deps.accounts.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);

    const containers = await deps.engine.listSessionContainers();
    const usingSessions = [
      ...new Set(containers.filter((c) => c.accountId === account.id).map((c) => c.name)),
    ];
    if (usingSessions.length > 0) {
      throw new AccountInUseError(account.id, usingSessions);
    }

    await deps.accounts.delete(account.id);

    // A `pending_login` Account may still have a Login Container attached to its
    // volume; tear it down before the volume goes (idempotent — a no-op once the
    // login completed and the poll already removed it) (#14).
    await deps.engine.removeLoginContainer(account.id);

    await deps.engine.removeVolume(accountConfigVolumeName(account.id));
  };
}
