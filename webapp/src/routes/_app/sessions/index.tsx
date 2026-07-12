// Sessions list (#16). Loader seeds the session + account snapshots; the list
// then tracks the #15 SSE stream live so a `cloning`→`running`/`clone_failed`
// transition morphs in place. Each card carries per-element
// view-transition-names for the list→detail morph. "New session" is disabled
// until at least one ready Account exists.

import { createFileRoute, Link } from "@tanstack/react-router";
import { listAccounts } from "~/server/accounts";
import { listSessions } from "~/server/sessions";
import { ProviderBadge, StatusPill } from "~/ui/components/badges";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { sessionStatusBadge } from "~/ui/view-models/badges";
import type { AccountRow, SessionRow } from "~/ui/view-models/rows";

export const Route = createFileRoute("/_app/sessions/")({
  loader: async () => ({
    sessions: await listSessions(),
    accounts: await listAccounts(),
  }),
  component: SessionsPage,
});

function SessionsPage() {
  const { sessions: initial, accounts } = Route.useLoaderData();
  const sessions = useLiveSnapshot<SessionRow[]>("/api/sessions/status", "sessions", initial);
  const accountsById = new Map(accounts.map((a: AccountRow) => [a.id, a]));
  const hasReadyAccount = accounts.some((a: AccountRow) => a.status === "ready");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/</span>sessions
          </h1>
          <p className="subtle">
            One agent container + workspace volume each. Docker is the source of truth — this list
            is what the labels say exists.
          </p>
        </div>
        <Link to="/sessions/new" className="btn primary" aria-disabled={!hasReadyAccount}>
          + new session
        </Link>
      </div>

      <div className="card-list">
        {sessions.map((s) => {
          const account = accountsById.get(s.accountId);
          const badge = sessionStatusBadge(s.status);
          return (
            <Link
              key={s.name}
              to="/sessions/$sessionName"
              params={{ sessionName: s.name }}
              className="card"
              style={{ viewTransitionName: `sess-card-${s.name}` }}
            >
              <div className="card-row">
                <span className="card-title" style={{ viewTransitionName: `sess-title-${s.name}` }}>
                  <span className="prefix">session/</span>
                  {s.name}
                </span>
                <span className="card-meta">{s.repo}</span>
                <span className="spacer" />
                <StatusPill badge={badge} vtName={`sess-status-${s.name}`} />
              </div>
              <div className="card-row" style={{ marginTop: 8 }}>
                <span className="card-meta">account: {account?.displayName ?? s.accountId}</span>
                {account && <ProviderBadge providerType={account.providerType} />}
              </div>
            </Link>
          );
        })}
        {sessions.length === 0 && (
          <div className="empty">
            {hasReadyAccount
              ? "No sessions yet. Create one from a repo + a ready account."
              : "No sessions. Add a ready account first, then create a session."}
          </div>
        )}
      </div>
    </>
  );
}
