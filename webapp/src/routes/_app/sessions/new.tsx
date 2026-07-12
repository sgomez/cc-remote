// New-session flow (#16): repo + Account → two-phase provision (clone helper →
// agent container). The Account picker is radio cards with `pending_login`
// accounts greyed out (shown, not hidden). The repo is entered as `owner/name`
// (validated against the domain repo shape) with a native autocomplete of the
// user's GitHub repos (loaded server-side, `listRepos`). On submit the
// create-session use case runs server-side and the user lands on the new
// session's detail page, where the clone streams.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { listAccounts } from "~/server/accounts";
import { listRepos } from "~/server/github";
import { createSession, listSessions } from "~/server/sessions";
import { ProviderBadge, StatusPill } from "~/ui/components/badges";
import { accountStatusBadge } from "~/ui/view-models/badges";
import {
  accountPickerOptions,
  canCreateSession,
  repoValid,
  sessionNameState,
} from "~/ui/view-models/forms";
import type { AccountRow } from "~/ui/view-models/rows";

export const Route = createFileRoute("/_app/sessions/new")({
  loader: async () => {
    const [accounts, sessions, repos] = await Promise.all([
      listAccounts(),
      listSessions(),
      listRepos(),
    ]);
    return { accounts, sessions, repos };
  },
  component: NewSessionPage,
});

function NewSessionPage() {
  const { accounts, sessions, repos } = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existingNames = sessions.map((s) => s.name);
  const nameState = sessionNameState(name, existingNames);
  const options = accountPickerOptions(accounts as AccountRow[]);
  const selected = accounts.find((a) => a.id === accountId);
  const valid = canCreateSession({ nameState, repo, selectedAccount: selected });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createSession({ data: { name: nameState.slug, repo: repo.trim(), accountId } });
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
            <span className="path">~/sessions/</span>new
          </h1>
          <p className="subtle">Repo + account → clone helper container → agent container.</p>
        </div>
        <Link to="/sessions" className="btn">
          ← Back
        </Link>
      </div>

      <div className="panel" style={{ maxWidth: 640 }}>
        <div className="field">
          <label htmlFor="session-name">Session name</label>
          <input
            id="session-name"
            placeholder="api-refactor"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="hint">
            container <code className="inline">cc-remote-session-{nameState.slug || "…"}</code> ·
            volume <code className="inline">cc-remote-workspace-{nameState.slug || "…"}</code>
            {nameState.taken && <span className="error-text"> — name already in use</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="session-repo">Repository (owner/name)</label>
          <input
            id="session-repo"
            list="repo-options"
            placeholder="sgomez/cc-remote"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <datalist id="repo-options">
            {repos.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {repos.length > 0 && (
            <div className="hint">Start typing to pick from your GitHub repositories.</div>
          )}
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

        {error && <p className="error-text">{error}</p>}

        <div className="actions">
          <button type="button" className="btn primary" disabled={!valid || busy} onClick={create}>
            {busy ? "Creating…" : "Create session"}
          </button>
          {selected && selected.status !== "ready" && (
            <span className="warn-text" style={{ fontSize: 12 }}>
              That account is still pending_login
            </span>
          )}
        </div>
      </div>
    </>
  );
}
