// Session server functions (#16): thin delivery glue over the core session use
// cases, wired through the Docker engine, the SQLite AccountRepository, and the
// GitHub credential issuer. The GitHub token for cloning/pushing is read
// server-side from better-auth's stored OAuth account (never sent to the
// client) and obtained through the GitHubTokenIssuer port rather than being
// passed as a raw string — later sub-issues swap the OAuth adapter for one
// that mints installation tokens. Every function is auth-guarded (defence in
// depth over the route guard).

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGithubAccessToken, requireSession } from "~/adapters/auth";
import { createGitHubAppTokenIssuer } from "~/adapters/github/github-app-token-issuer";
import { uuidGenerator } from "~/adapters/system";
import { loadDeploymentConfig } from "~/config/deployment";
import {
  makeCreateSession,
  makeDestroySession,
  makeListSessions,
  makeReadWorkspaceState,
  makeResetSession,
  makeStartSession,
  makeStopSession,
  type WorkspaceState,
} from "~/core";
import type { GitHubTokenIssuer } from "~/core/ports/github-token-issuer";
import type { SessionRow } from "~/ui/view-models/rows";
import { accountRepository, containerEngine, permissionMode } from "./runtime";

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

/** Adapter: resolve a credential from the signed-in user's stored OAuth token. */
function oauthTokenIssuer(): GitHubTokenIssuer {
  return {
    async issueToken(_repo: string) {
      const token = await getGithubAccessToken(getRequest().headers);
      if (!token) throw new Error("No GitHub access token for the current session.");
      // OAuth tokens do not expire — use a far-future sentinel.
      return { token, expiresAt: new Date("2099-01-01T00:00:00.000Z") };
    },
    // This issuer is for Session credentials only; installation listing uses
    // the App JWT adapter in server/repositories.ts.
    async listInstallations() {
      return [];
    },
  };
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
  .validator((data: { name: string; repo: string; accountId: string }) => data)
  .handler(async ({ data }): Promise<{ name: string }> => {
    await guard();
    const create = makeCreateSession({
      accounts: await accountRepository(),
      engine: containerEngine(),
      ids: uuidGenerator,
      cloneIssuer: cloneTokenIssuer(),
      sessionIssuer: oauthTokenIssuer(),
    });
    const session = await create({
      name: data.name,
      repo: data.repo,
      accountId: data.accountId,
      permissionMode: permissionMode(),
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
      sessionIssuer: oauthTokenIssuer(),
    });
    await reset({
      name: data.name,
      permissionMode: permissionMode(),
    });
  });

export const destroySession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    await makeDestroySession({ engine: containerEngine() })({ name: data.name });
  });
