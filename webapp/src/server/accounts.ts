// Account server functions (#16): the thin delivery glue between the client UI
// and the core account use cases, wired through the SQLite AccountRepository and
// the Docker engine from the composition root. Every function is auth-guarded
// (requireSession) — the route layer also redirects unauthenticated users to
// /login, this is defence in depth. No domain logic here; that lives in core.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSession } from "~/adapters/auth";
import { systemClock, uuidGenerator } from "~/adapters/system";
import {
  accountConfigVolumeName,
  makeDeleteAccount,
  makeRegisterAccount,
  makeStartLogin,
  toSessionStatus,
} from "~/core";
import type { AccountDetail, AccountRow, SessionRow } from "~/ui/view-models/rows";
import { accountRepository, containerEngine, permissionMode } from "./runtime";

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

/** Session counts per account id, from Docker (the source of truth for sessions). */
async function sessionCountsByAccount(): Promise<Map<string, number>> {
  const containers = await containerEngine().listSessionContainers();
  const byAccount = new Map<string, Set<string>>();
  for (const c of containers) {
    if (!byAccount.has(c.accountId)) byAccount.set(c.accountId, new Set());
    byAccount.get(c.accountId)?.add(c.name);
  }
  return new Map([...byAccount].map(([id, names]) => [id, names.size]));
}

export const listAccounts = createServerFn({ method: "GET" }).handler(
  async (): Promise<AccountRow[]> => {
    await guard();
    const [accounts, counts] = await Promise.all([
      accountRepository().then((r) => r.findAll()),
      sessionCountsByAccount(),
    ]);
    return accounts
      .map((a) => ({
        id: a.id,
        providerType: a.providerType,
        displayName: a.displayName,
        status: a.status,
        sessionsInUse: counts.get(a.id) ?? 0,
      }))
      .sort((x, y) => x.displayName.localeCompare(y.displayName));
  },
);

export const getAccount = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<AccountDetail | null> => {
    await guard();
    const account = await accountRepository().then((r) => r.findById(data.id));
    if (!account) return null;

    const containers = await containerEngine().listSessionContainers();
    const sessions: SessionRow[] = [];
    const seen = new Set<string>();
    for (const c of containers) {
      if (c.accountId !== account.id || c.cloning || seen.has(c.name)) continue;
      seen.add(c.name);
      sessions.push({
        name: c.name,
        repo: c.repo,
        accountId: c.accountId,
        // One derivation for every surface — a Session must not read "stopped"
        // here while the sessions list calls the same container "error".
        status: toSessionStatus(c),
      });
    }

    return {
      id: account.id,
      providerType: account.providerType,
      displayName: account.displayName,
      status: account.status,
      sessionsInUse: sessions.length,
      configVolume: accountConfigVolumeName(account.id),
      config: account.config,
      sessions,
    };
  });

export const registerAccount = createServerFn({ method: "POST" })
  .validator(
    (data: { providerType: string; displayName: string; fields: Record<string, string> }) => data,
  )
  .handler(async ({ data }): Promise<{ id: string; oauth: boolean }> => {
    await guard();
    const register = makeRegisterAccount({
      accounts: await accountRepository(),
      engine: containerEngine(),
      clock: systemClock,
      ids: uuidGenerator,
      permissionMode: permissionMode(),
    });
    const account = await register({
      providerType: data.providerType,
      displayName: data.displayName,
      fields: data.fields,
    });
    return { id: account.id, oauth: account.status === "pending_login" };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    const remove = makeDeleteAccount({
      accounts: await accountRepository(),
      engine: containerEngine(),
    });
    await remove({ accountId: data.id });
  });

export const startLogin = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<void> => {
    await guard();
    const start = makeStartLogin({
      accounts: await accountRepository(),
      engine: containerEngine(),
    });
    await start({ accountId: data.id });
  });
