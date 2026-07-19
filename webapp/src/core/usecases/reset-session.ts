// reset-session — tear down the container + workspace volume and re-provision
// with a fresh SESSION_UUID (so Claude Code starts on a clean session id and
// remote-control pairing is recreated). Repo and Account are read from the
// existing container's labels. Refuses any container lacking the session label.

import { AccountNotFoundError, SessionNotFoundError } from "../domain/errors";
import { requireProviderType } from "../domain/provider-type";
import type { Session } from "../domain/session";
import { workspaceVolumeName } from "../domain/session";
import type { AccountRepository } from "../ports/account-repository";
import type { BrokerSecretRegistry } from "../ports/broker-secret-registry";
import type { ContainerEngine } from "../ports/container-engine";
import type { GitHubTokenIssuer } from "../ports/github-token-issuer";
import type { IdGenerator } from "../ports/id-generator";
import { provisionSession } from "./provision-session";

export type ResetSessionInput = {
  name: string;
  permissionMode?: string;
};

export type ResetSessionDeps = {
  accounts: AccountRepository;
  engine: ContainerEngine;
  ids: IdGenerator;
  cloneIssuer: GitHubTokenIssuer;
  secretRegistry: BrokerSecretRegistry;
  brokerUrl: string;
};

export function makeResetSession(deps: ResetSessionDeps) {
  return async function resetSession(input: ResetSessionInput): Promise<Session> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    const account = await deps.accounts.findById(container.accountId);
    if (!account) throw new AccountNotFoundError(container.accountId);
    const type = requireProviderType(account.providerType);

    if (container.state === "running") {
      await deps.engine.stopContainer(input.name);
    }
    await deps.engine.removeContainer(input.name);
    await deps.engine.removeVolume(workspaceVolumeName(input.name));

    return provisionSession(deps.engine, deps.cloneIssuer, deps.ids, deps.secretRegistry, {
      account,
      type,
      name: input.name,
      repo: container.repo,
      sessionUuid: deps.ids.newId(),
      permissionMode: input.permissionMode ?? "auto",
      brokerUrl: deps.brokerUrl,
    });
  };
}
