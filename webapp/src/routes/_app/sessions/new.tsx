// New-session flow (#16): repo + Account → two-phase provision (clone helper →
// agent container). The Account picker is radio cards with `pending_login`
// accounts greyed out (shown, not hidden); it tracks the #15 accounts SSE
// stream live so an Account completing OAuth login in another tab enables its
// radio without a reload. The repo is entered as `owner/name` (validated
// against the domain repo shape) through a real combobox (~/ui/components/
// Combobox) over the user's GitHub repos (loaded server-side, `listRepos`) —
// free text is still submittable, the list is just a shortcut. On submit the
// create-session use case runs server-side and the user lands on the new
// session's detail page, where the clone streams.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { AccountStatus } from "~/core";
import { listAccounts } from "~/server/accounts";
import { listRepos } from "~/server/github";
import { createSession, listSessions } from "~/server/sessions";
import { fetchSettings } from "~/server/settings";
import { ProviderBadge, StatusPill } from "~/ui/components/badges";
import { Combobox } from "~/ui/components/Combobox";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { accountStatusBadge } from "~/ui/view-models/badges";
import {
  accountPickerOptions,
  canCreateSession,
  repoValid,
  sessionNameState,
} from "~/ui/view-models/forms";
import { permissionModeOptions, prefilledPermissionMode } from "~/ui/view-models/permission-mode";
import type { AccountRow } from "~/ui/view-models/rows";

type LiveStatus = { id: string; status: AccountStatus };

export const Route = createFileRoute("/_app/sessions/new")({
  loader: async () => {
    const [accounts, sessions, repos, settings] = await Promise.all([
      listAccounts(),
      listSessions(),
      listRepos(),
      fetchSettings(),
    ]);
    return { accounts, sessions, repos, settings };
  },
  component: NewSessionPage,
});

function NewSessionPage() {
  const { accounts, sessions, repos, settings } = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [accountId, setAccountId] = useState("");
  // Prefilled with the deployment default, so the common case is creating a
  // Session without touching this at all.
  const [permissionMode, setPermissionMode] = useState(() =>
    prefilledPermissionMode(settings.defaultPermissionMode),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const seed: LiveStatus[] = accounts.map((a) => ({ id: a.id, status: a.status }));
  const live = useLiveSnapshot<LiveStatus[]>("/api/accounts/status", "accounts", seed);
  const statusById = new Map(live.map((l) => [l.id, l.status]));
  const liveAccounts = (accounts as AccountRow[]).map((a) => ({
    ...a,
    status: statusById.get(a.id) ?? a.status,
  }));

  const existingNames = sessions.map((s) => s.name);
  const nameState = sessionNameState(name, existingNames);
  const options = accountPickerOptions(liveAccounts);
  const selected = liveAccounts.find((a) => a.id === accountId);
  const valid = canCreateSession({ nameState, repo, selectedAccount: selected });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createSession({
        data: { name: nameState.slug, repo: repo.trim(), accountId, permissionMode },
      });
      router.navigate({ to: "/sessions/$sessionName", params: { sessionName: nameState.slug } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <Link to="/sessions" className="path">
              ~/sessions/
            </Link>
            new
          </h1>
          <p className="subtle">
            Clone a repo and start an agent container with one of your accounts.
          </p>
        </div>
      </div>

      <div className="panel narrow">
        <div className="field">
          <label htmlFor="session-name">Session name</label>
          <input
            id="session-name"
            placeholder="api-refactor"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {nameState.taken && <div className="hint error-text">Name already in use.</div>}
        </div>

        <div className="field">
          <label htmlFor="session-repo">Repository (owner/name)</label>
          <Combobox
            id="session-repo"
            value={repo}
            onChange={setRepo}
            options={repos}
            placeholder="sgomez/cc-remote"
            noOptionsLabel="No GitHub repositories loaded — you can still type owner/name by hand."
            noMatchesLabel={`No repositories match "${repo.trim()}" — you can still submit it as typed.`}
          />
          {repo.trim() !== "" && !repoValid(repo) && (
            <div className="hint error-text">Expected owner/name, e.g. sgomez/cc-remote</div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Account (only ready accounts can run sessions)</span>
          <div className="card-list">
            {options.map((o) => {
              const badge = accountStatusBadge(o.status);
              const cls = `card radio-card${!o.selectable ? " disabled" : ""}${
                accountId === o.id ? " selected" : ""
              }`;
              return (
                <label key={o.id} className={cls}>
                  <div className="card-row">
                    <input
                      type="radio"
                      name="account"
                      disabled={!o.selectable}
                      checked={accountId === o.id}
                      onChange={() => setAccountId(o.id)}
                    />
                    <span className="card-title">{o.displayName}</span>
                    <ProviderBadge providerType={o.providerType} />
                    <span className="spacer" />
                    <StatusPill badge={badge} />
                  </div>
                </label>
              );
            })}
            {options.length === 0 && (
              <div className="empty">
                No accounts yet.{" "}
                <Link to="/accounts/new" search={{ type: undefined }}>
                  Add one
                </Link>{" "}
                to create sessions.
              </div>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Permission mode</span>
          <div className="card-list">
            {permissionModeOptions().map((o) => (
              <label
                key={o.value}
                className={`card radio-card${permissionMode === o.value ? " selected" : ""}`}
              >
                <div className="card-row">
                  <input
                    type="radio"
                    name="permission-mode"
                    checked={permissionMode === o.value}
                    onChange={() => setPermissionMode(o.value)}
                  />
                  <span className="card-title">{o.label}</span>
                </div>
                <div className="hint">{o.description}</div>
                {o.notice && permissionMode === o.value && (
                  <div className="hint subtle">{o.notice}</div>
                )}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="actions">
          <button type="button" className="btn primary" disabled={!valid || busy} onClick={create}>
            {busy ? "Creating…" : "Create session"}
          </button>
        </div>
      </div>
    </>
  );
}
