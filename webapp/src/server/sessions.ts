// Session server functions (#16): thin delivery glue over the core session use
// cases, wired through the Docker engine, the SQLite AccountRepository, and the
// GitHub App token issuer. Clone helpers receive a one-shot installation token;
// the Session container obtains git credentials on demand from the broker (#33)
// and carries no durable GitHub token. Every function is auth-guarded (defence in
// depth over the route guard).

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getCommitIdentity, requireSession } from "~/adapters/auth";
import { createGitHubAppTokenIssuer } from "~/adapters/github/github-app-token-issuer";
import { uuidGenerator } from "~/adapters/system";
import { loadDeploymentConfig } from "~/config/deployment";
import {
  makeCreateSession,
  makeDestroySession,
  makeGetSettings,
  makeListSessions,
  makeReadWorkspaceState,
  makeResetSession,
  makeStartSession,
  makeStopSession,
  type WorkspaceState,
} from "~/core";
import type { GitHubTokenIssuer } from "~/core/ports/github-token-issuer";
import type { SessionRow } from "~/ui/view-models/rows";
import {
  accountRepository,
  brokerSecretRegistry,
  brokerUrl,
  containerEngine,
  settingRepository,
} from "./runtime";

/**
 * The deployment default. Local rather than imported from `./settings` on
 * purpose: that module may only export server functions (see its header).
 */
async function deploymentDefaultPermissionMode(): Promise<string> {
  const settings = await makeGetSettings({ settings: await settingRepository() })();
  return settings.defaultPermissionMode;
}

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

/**
 * GitHub App token issuer for the clone helper. Minted lazily so a misconfigured
 * deployment fails at the first session create rather than at process start, which
 * would crash the server. The adapter is stateless; the same instance is reused.
 */
let _cloneIssuer: GitHubTokenIssuer | undefined;
function cloneTokenIssuer(): GitHubTokenIssuer {
  if (!_cloneIssuer) {
    const config = loadDeploymentConfig();
    _cloneIssuer = createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
    });
  }
  return _cloneIssuer;
}

export const listSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionRow[]> => {
    await guard();
    const list = makeListSessions({ engine: containerEngine() });
    return (await list()).sort((a, b) => a.name.localeCompare(b.name));
  },
);

export const createSession = createServerFn({ method: "POST" })
  .validator(
    (data: { name: string; repo: string; accountId: string; permissionMode?: string }) => data,
  )
  .handler(async ({ data }): Promise<{ name: string }> => {
    await guard();
    const create = makeCreateSession({
      accounts: await accountRepository(),
      engine: containerEngine(),
      ids: uuidGenerator,
      cloneIssuer: cloneTokenIssuer(),
      secretRegistry: brokerSecretRegistry(),
      brokerUrl: brokerUrl(),
    });
    const session = await create({
      name: data.name,
      repo: data.repo,
      accountId: data.accountId,
      // The operator's choice, falling back to the stored Deployment Setting.
      // The core validates it and rejects anything outside the valid set before
      // a Session exists.
      permissionMode: data.permissionMode ?? (await deploymentDefaultPermissionMode()),
      commitIdentity: await getCommitIdentity(getRequest().headers),
    });
    return { name: session.name };
  });

/**
 * Workspace git state for the Destroy/Reset confirm dialogs (I2). Read-only and
 * auth-guarded like everything else; the core use case is label-guarded and
 * never reports a fake "clean" for a stopped container or a failed probe.
 */
export const readWorkspaceState = createServerFn({ method: "GET" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<WorkspaceState> => {
    await guard();
    return makeReadWorkspaceState({ engine: containerEngine() })({ name: data.name });
  });

export const startSession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    await makeStartSession({ engine: containerEngine() })({ name: data.name });
  });

export const stopSession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    await makeStopSession({ engine: containerEngine() })({ name: data.name });
  });

export const resetSession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    const reset = makeResetSession({
      accounts: await accountRepository(),
      engine: containerEngine(),
      ids: uuidGenerator,
      cloneIssuer: cloneTokenIssuer(),
      secretRegistry: brokerSecretRegistry(),
      brokerUrl: brokerUrl(),
    });
    await reset({
      name: data.name,
      // Only a fallback: reset prefers the mode recorded on the Session's own
      // container label, so resetting never changes its security posture. This
      // applies to Sessions created before that label existed.
      permissionMode: await deploymentDefaultPermissionMode(),
      // The identity of whoever performs the reset, not the original creator:
      // container env is fixed at create time, so a reset is the only point at
      // which a Session's Commit Identity can change.
      commitIdentity: await getCommitIdentity(getRequest().headers),
    });
  });

export const destroySession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    await makeDestroySession({ engine: containerEngine() })({ name: data.name });
  });
