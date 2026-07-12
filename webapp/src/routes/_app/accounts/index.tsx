// Accounts list (#16). Provider Type badge + capabilities (remote control,
// Seeding Method), status (ready green / pending_login pulsing amber), and the
// sessions-in-use count. Status tracks the accounts SSE stream live so a
// `pending_login`→`ready` flip (Login-Container poller) morphs in place.

import { createFileRoute, Link } from "@tanstack/react-router";
import type { AccountStatus } from "~/core";
import { requireProviderType } from "~/core";
import { listAccounts } from "~/server/accounts";
import { Capability, ProviderBadge, StatusPill } from "~/ui/components/badges";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { accountStatusBadge } from "~/ui/view-models/badges";
import { accountCapabilities } from "~/ui/view-models/capabilities";
import type { AccountRow } from "~/ui/view-models/rows";

type LiveStatus = { id: string; status: AccountStatus };

export const Route = createFileRoute("/_app/accounts/")({
  loader: async () => ({ accounts: await listAccounts() }),
  component: AccountsPage,
});

function AccountsPage() {
  const { accounts } = Route.useLoaderData();
  const seed: LiveStatus[] = accounts.map((a) => ({ id: a.id, status: a.status }));
  const live = useLiveSnapshot<LiveStatus[]>("/api/accounts/status", "accounts", seed);
  const statusById = new Map(live.map((l) => [l.id, l.status]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/</span>accounts
          </h1>
          <p className="subtle">
            Provider accounts. Creating a session always picks an account, never a provider type
            directly.
          </p>
        </div>
        <Link to="/accounts/new" search={{ type: undefined }} className="btn primary">
          + Add account
        </Link>
      </div>

      <div className="card-list">
        {accounts.map((a: AccountRow) => {
          const type = requireProviderType(a.providerType);
          const caps = accountCapabilities(type);
          const status = statusById.get(a.id) ?? a.status;
          const badge = accountStatusBadge(status);
          return (
            <Link
              key={a.id}
              to="/accounts/$accountId"
              params={{ accountId: a.id }}
              className="card"
              style={{ viewTransitionName: `acct-card-${a.id}` }}
            >
              <div className="card-row">
                <span className="card-title" style={{ viewTransitionName: `acct-title-${a.id}` }}>
                  {a.displayName}
                </span>
                <ProviderBadge providerType={a.providerType} />
                <span className="spacer" />
                <span className="card-meta">
                  {a.sessionsInUse > 0
                    ? `${a.sessionsInUse} session${a.sessionsInUse > 1 ? "s" : ""}`
                    : "unused"}
                </span>
                <StatusPill badge={badge} vtName={`acct-status-${a.id}`} />
              </div>
              <div className="card-row" style={{ marginTop: 8 }}>
                <Capability on={caps.remoteControl} label="remote control" />
                <span className="badge cap">seeding: {caps.seedingLabel}</span>
              </div>
            </Link>
          );
        })}
        {accounts.length === 0 && (
          <div className="empty">No accounts yet. Add one to be able to create sessions.</div>
        )}
      </div>
    </>
  );
}
