// Session server functions (#16): thin delivery glue over the core session use
// cases, wired through the Docker engine and the SQLite AccountRepository. The
// GitHub token for cloning/pushing is read server-side from better-auth's stored
// OAuth account (never sent to the client) and injected at container-create
// time. Every function is auth-guarded (defence in depth over the route guard).

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGithubAccessToken, requireSession } from "~/adapters/auth";
import { uuidGenerator } from "~/adapters/system";
import {
  makeCreateSession,
  makeDestroySession,
  makeListSessions,
  makeReadSessionLogs,
  makeReadWorkspaceState,
  makeResetSession,
  makeStartSession,
  makeStopSession,
  type SessionLogs,
  type WorkspaceState,
} from "~/core";
import type { SessionRow } from "~/ui/view-models/rows";
import { accountRepository, containerEngine, permissionMode } from "./runtime";

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

/** GitHub token for cloning — required to create/reset a session. */
async function githubToken(): Promise<string> {
  const token = await getGithubAccessToken(getRequest().headers);
  if (!token) throw new Error("No GitHub access token for the current session.");
  return token;
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
    });
    const session = await create({
      name: data.name,
      repo: data.repo,
      accountId: data.accountId,
      githubToken: await githubToken(),
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

/**
 * Container logs for the session detail page's Logs panel. Deliberately NOT
 * gated on the container running: a crashed agent or a failed clone is exactly
 * when the user needs this, and for a `clone_failed` session the core use case
 * falls back to the clone helper (whose output is the git error). Label-guarded
 * and auth-guarded like every other session read.
 */
export const readSessionLogs = createServerFn({ method: "GET" })
  .validator((data: { name: string; tail?: number }) => data)
  .handler(async ({ data }): Promise<SessionLogs> => {
    await guard();
    return makeReadSessionLogs({ engine: containerEngine() })({
      name: data.name,
      tail: data.tail,
    });
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
    });
    await reset({
      name: data.name,
      githubToken: await githubToken(),
      permissionMode: permissionMode(),
    });
  });

export const destroySession = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    await makeDestroySession({ engine: containerEngine() })({ name: data.name });
  });
