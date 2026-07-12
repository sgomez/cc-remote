// register-account — validate against the catalogue, persist the row, then
// provision the Account Config Volume per the Provider Type's Seeding Method
// (PRD §3). Catalogue capabilities drive the branch; no per-provider ifs.

import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { MissingAccountFieldError } from "../domain/errors";
import { buildLoginLabels } from "../domain/login";
import { requireProviderType } from "../domain/provider-type";
import { ACCOUNT_CONFIG_FILE, wizardSkipConfig } from "../domain/seeding";
import type { AccountRepository } from "../ports/account-repository";
import type { Clock } from "../ports/clock";
import type { ContainerEngine } from "../ports/container-engine";
import type { IdGenerator } from "../ports/id-generator";

export type RegisterAccountInput = {
  providerType: string;
  displayName: string;
  /** Values for the Provider Type's accountFields (e.g. apiKey, baseUrl). */
  fields: Record<string, string>;
};

export type RegisterAccountDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
  clock: Clock;
  ids: IdGenerator;
  /** Permission mode baked into the seeded wizard-skip config. */
  permissionMode?: string;
};

export function makeRegisterAccount(deps: RegisterAccountDeps) {
  const permissionMode = deps.permissionMode ?? "auto";

  return async function registerAccount(input: RegisterAccountInput): Promise<Account> {
    const type = requireProviderType(input.providerType);

    for (const field of type.accountFields) {
      if (field.required && !input.fields[field.name]) {
        throw new MissingAccountFieldError(field.name);
      }
    }

    const credentials: Record<string, string> = {};
    const config: Record<string, string> = {};
    for (const field of type.accountFields) {
      const value = input.fields[field.name];
      if (value === undefined) continue;
      (field.store === "credentials" ? credentials : config)[field.name] = value;
    }

    const account: Account = {
      id: deps.ids.newId(),
      providerType: type.id,
      displayName: input.displayName,
      credentials,
      config,
      // oauth accounts must complete a Login Container before use.
      status: type.seeding === "oauth" ? "pending_login" : "ready",
      createdAt: deps.clock.now(),
    };

    await deps.accounts.create(account);

    // Every Account owns an Account Config Volume, and every Seeding Method
    // starts from the wizard-skip config; oauth then completes the login in a
    // Login Container (#14).
    const volume = accountConfigVolumeName(account.id);
    await deps.engine.createVolume(volume);
    await deps.engine.seedVolume(
      volume,
      ACCOUNT_CONFIG_FILE,
      JSON.stringify(wizardSkipConfig(permissionMode), null, 2),
    );

    if (type.seeding === "oauth") {
      // Spin up the Login Container so the user can complete the interactive
      // `claude` login; the background poll flips the Account to `ready` (#14).
      await deps.engine.runLoginContainer({
        accountId: account.id,
        accountConfigVolume: accountConfigVolumeName(account.id),
        labels: buildLoginLabels({ accountId: account.id }),
      });
    }

    return account;
  };
}
