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
import type { ContainerEngine } from "../ports/container-engine";

export type ProvisionSessionParams = {
  account: Account;
  type: ProviderType;
  name: string;
  repo: string;
  githubToken: string;
  sessionUuid: string;
  permissionMode: string;
};

export async function provisionSession(
  engine: ContainerEngine,
  params: ProvisionSessionParams,
): Promise<Session> {
  const { account, type, name, repo } = params;
  const workspaceVolume = workspaceVolumeName(name);
  const labelInput = { name, repo, accountId: account.id };

  await engine.createVolume(workspaceVolume);

  await engine.runCloneContainer({
    sessionName: name,
    repo,
    accountId: account.id,
    workspaceVolume,
    env: buildCloneEnv({ githubToken: params.githubToken, repo }),
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
      githubToken: params.githubToken,
      permissionMode: params.permissionMode,
    }),
    labels: buildSessionLabels(labelInput),
    accountConfigVolume: accountConfigVolumeName(account.id),
    remoteControl: type.remoteControl,
  });

  return { name, repo, accountId: account.id, status: "running" };
}
