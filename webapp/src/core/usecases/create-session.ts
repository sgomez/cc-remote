// create-session — pick a ready Account, then provision two-phase (clone helper
// container, then main agent container), mirroring the legacy lifecycle. The
// container carries the `cc-remote-account-id` label (replacing provider-id).

import { AccountNotFoundError, AccountNotReadyError, SessionExistsError } from "../domain/errors";
import { requireProviderType } from "../domain/provider-type";
import type { Session } from "../domain/session";
import { assertValidRepo, assertValidSessionName } from "../domain/session";
import type { AccountRepository } from "../ports/account-repository";
import type { BrokerSecretRegistry } from "../ports/broker-secret-registry";
import type { ContainerEngine } from "../ports/container-engine";
import type { GitHubTokenIssuer } from "../ports/github-token-issuer";
import type { IdGenerator } from "../ports/id-generator";
import { provisionSession } from "./provision-session";

export type CreateSessionInput = {
  name: string;
  repo: string;
  accountId: string;
  permissionMode?: string;
};

export type CreateSessionDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
  ids: IdGenerator;
  cloneIssuer: GitHubTokenIssuer;
  secretRegistry: BrokerSecretRegistry;
  brokerUrl: string;
};

export function makeCreateSession(deps: CreateSessionDeps) {
  return async function createSession(input: CreateSessionInput): Promise<Session> {
    assertValidSessionName(input.name);
    assertValidRepo(input.repo);

    const account = await deps.accounts.findById(input.accountId);
    if (!account) throw new AccountNotFoundError(input.accountId);
    if (account.status !== "ready") throw new AccountNotReadyError(account.id);

    if (await deps.engine.getSessionContainer(input.name)) {
      throw new SessionExistsError(input.name);
    }

    const type = requireProviderType(account.providerType);

    return provisionSession(deps.engine, deps.cloneIssuer, deps.ids, deps.secretRegistry, {
      account,
      type,
      name: input.name,
      repo: input.repo,
      sessionUuid: deps.ids.newId(),
      permissionMode: input.permissionMode ?? "auto",
      brokerUrl: deps.brokerUrl,
    });
  };
}
