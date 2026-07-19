// Shared two-phase provisioning step used by create-session and reset-session:
// create the workspace volume, run the clone helper, and — only on a clean
// exit — run the main agent container. On clone failure the helper container is
// left in place so list-sessions can surface `clone_failed` (legacy behaviour).

import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { CloneFailedError } from "../domain/errors";
import type { ProviderType } from "../domain/provider-type";
import type { Session } from "../domain/session";
import { buildCloneLabels, buildSessionLabels, workspaceVolumeName } from "../domain/session";
import { buildCloneEnv, buildSessionEnv } from "../domain/session-env";
import type { BrokerSecretRegistry } from "../ports/broker-secret-registry";
import type { ContainerEngine } from "../ports/container-engine";
import type { GitHubTokenIssuer } from "../ports/github-token-issuer";
import type { IdGenerator } from "../ports/id-generator";

export type ProvisionSessionParams = {
  account: Account;
  type: ProviderType;
  name: string;
  repo: string;
  sessionUuid: string;
  permissionMode: string;
  brokerUrl: string;
};

export async function provisionSession(
  engine: ContainerEngine,
  cloneIssuer: GitHubTokenIssuer,
  sessionIssuer: GitHubTokenIssuer,
  ids: IdGenerator,
  secretRegistry: BrokerSecretRegistry,
  params: ProvisionSessionParams,
): Promise<Session> {
  const { account, type, name, repo } = params;
  const workspaceVolume = workspaceVolumeName(name);
  const labelInput = { name, repo, accountId: account.id };

  const { token: cloneToken } = await cloneIssuer.issueToken(repo);
  const { token: sessionToken } = await sessionIssuer.issueToken(repo);

  const brokerSecret = ids.newSecret();
  // Register before the clone starts so the broker is ready the moment the
  // Session container comes up — a token request could arrive immediately.
  secretRegistry.register(brokerSecret, name, repo);

  await engine.createVolume(workspaceVolume);

  await engine.runCloneContainer({
    sessionName: name,
    repo,
    accountId: account.id,
    workspaceVolume,
    env: buildCloneEnv({ githubToken: cloneToken, repo }),
    labels: buildCloneLabels(labelInput),
  });

  const exitCode = await engine.awaitCloneExit(name);
  if (exitCode !== 0) throw new CloneFailedError(name, exitCode);
  await engine.removeCloneContainer(name);

  await engine.runSessionContainer({
    sessionName: name,
    repo,
    accountId: account.id,
    workspaceVolume,
    env: buildSessionEnv({
      type,
      account,
      repo,
      sessionName: name,
      sessionUuid: params.sessionUuid,
      githubToken: sessionToken,
      permissionMode: params.permissionMode,
      brokerSecret,
      brokerUrl: params.brokerUrl,
    }),
    labels: buildSessionLabels(labelInput),
    accountConfigVolume: accountConfigVolumeName(account.id),
    remoteControl: type.remoteControl,
  });

  return { name, repo, accountId: account.id, status: "running" };
}
