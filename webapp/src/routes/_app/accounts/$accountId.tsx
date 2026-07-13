// Account detail (#16): volume name, capabilities, the Sessions using the
// Account, and — for a `pending_login` oauth account — the Login Container panel
// with an embedded terminal (real #14 flow, WS proxy from this issue). On mount
// of a pending account we ensure its Login Container is running (idempotent
// start-login), then embed the terminal; the accounts SSE stream flips the page
// to `ready` when the poller detects credentials. Delete is blocked with the
// reason while Sessions exist, and confirmed otherwise.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { AccountStatus } from "~/core";
import { requireProviderType } from "~/core";
import { deleteAccount, getAccount, startLogin } from "~/server/accounts";
import { Capability, ProviderBadge, StatusPill } from "~/ui/components/badges";
import { useFeedback } from "~/ui/components/feedback";
import { Spinner } from "~/ui/components/Spinner";
import { Terminal } from "~/ui/components/Terminal";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { accountStatusBadge, sessionStatusBadge } from "~/ui/view-models/badges";
import { accountCapabilities, deleteGuard } from "~/ui/view-models/capabilities";

type LiveStatus = { id: string; status: AccountStatus };

export const Route = createFileRoute("/_app/accounts/$accountId")({
  loader: async ({ params }) => ({ account: await getAccount({ data: { id: params.accountId } }) }),
  component: AccountDetailPage,
});

function AccountDetailPage() {
  const { accountId } = Route.useParams();
  const { account } = Route.useLoaderData();
  const router = useRouter();

  const seed: LiveStatus[] = account ? [{ id: account.id, status: account.status }] : [];
  const live = useLiveSnapshot<LiveStatus[]>("/api/accounts/status", "accounts", seed);
  const status = live.find((l) => l.id === accountId)?.status ?? account?.status;

  // Ensure the Login Container is running for a pending account (idempotent).
  const pending = status === "pending_login";
  useEffect(() => {
    if (pending) startLogin({ data: { id: accountId } }).catch(() => {});
  }, [pending, accountId]);

  // A flip to ready refreshes the loader so the volume/session panels reflect it.
  useEffect(() => {
    if (account && status && status !== account.status) router.invalidate();
  }, [status, account, router]);

  const { confirm, toast } = useFeedback();
  const [deleting, setDeleting] = useState(false);

  if (!account) {
    return (
      <div className="empty">
        Account not found (deleted?). <Link to="/accounts">Back to accounts</Link>
      </div>
    );
  }

  const type = requireProviderType(account.providerType);
  const caps = accountCapabilities(type);
  const guard = deleteGuard(account.sessions.length);
  const badge = accountStatusBadge(status ?? account.status);

  const remove = async () => {
    const ok = await confirm({
      title: `Delete account "${account.displayName}"?`,
      body: "This cannot be undone, and its config volume is removed too.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAccount({ data: { id: account.id } });
      toast.success(`Account "${account.displayName}" deleted.`);
      router.navigate({ to: "/accounts" });
    } catch (err) {
      toast.error(
        `Couldn't delete "${account.displayName}": ${err instanceof Error ? err.message : String(err)}`,
      );
      setDeleting(false);
      router.invalidate();
    }
  };

  return (
    <>
      <div className="page-head" style={{ viewTransitionName: `acct-card-${account.id}` }}>
        <div>
          <h1 style={{ viewTransitionName: `acct-title-${account.id}` }}>
            <span className="path">~/accounts/</span>
            {account.displayName}
          </h1>
          <p className="subtle">
            <ProviderBadge providerType={account.providerType} />
          </p>
        </div>
        <StatusPill badge={badge} vtName={`acct-status-${account.id}`} />
      </div>

      {pending && (
        <div className="panel warn">
          <h2>Login Container</h2>
          <p className="subtle" style={{ marginBottom: 4 }}>
            An ephemeral container has this account's config volume mounted. Complete{" "}
            <code className="inline">claude</code> login below; when credentials appear in the
            volume the account flips to <code className="inline">ready</code> and the container is
            destroyed. The volume is the canonical credential store — nothing is copied into the
            database.
          </p>
          <Terminal
            title={`cc-remote-login-${account.id} — claude /login`}
            wsPath={`/ws/login/${encodeURIComponent(account.id)}`}
          />
        </div>
      )}

      <div className="panel">
        <h2>Provider</h2>
        <dl className="kv">
          <dt>type</dt>
          <dd>
            <ProviderBadge providerType={type.id} />
          </dd>
          <dt>capabilities</dt>
          <dd>
            <span className="actions" style={{ marginTop: 0 }}>
              <Capability on={caps.remoteControl} label="remote control" />
              <span className="badge cap">seeding: {caps.seedingLabel}</span>
            </span>
          </dd>
          <dt>config volume</dt>
          <dd>
            <code className="inline">{account.configVolume}</code>
          </dd>
          {(type.presets || account.config.baseUrl) && (
            <>
              <dt>base URL</dt>
              <dd>{account.config.baseUrl ?? type.presets?.baseUrl}</dd>
              <dt>model</dt>
              <dd>{account.config.model ?? type.presets?.model}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="panel">
        <h2>Sessions using this account ({account.sessions.length})</h2>
        {account.sessions.length === 0 ? (
          <p className="subtle">None.</p>
        ) : (
          <div className="card-list">
            {account.sessions.map((s) => (
              <Link
                key={s.name}
                to="/sessions/$sessionName"
                params={{ sessionName: s.name }}
                className="card"
              >
                <div className="card-row">
                  <span className="card-title">
                    <span className="prefix">session/</span>
                    {s.name}
                  </span>
                  <span className="card-meta">{s.repo}</span>
                  <span className="spacer" />
                  <StatusPill badge={sessionStatusBadge(s.status)} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="actions">
        <Link to="/accounts" className="btn">
          ← Back
        </Link>
        <span className="spacer" />
        <button
          type="button"
          className="btn danger"
          disabled={!guard.deletable || deleting}
          title={guard.deletable ? "Deletes the account and its config volume" : guard.reason}
          onClick={remove}
        >
          {deleting && <Spinner />}
          {deleting ? "Deleting…" : "Delete account + volume"}
        </button>
      </div>
      {!guard.deletable && (
        <p className="subtle" style={{ textAlign: "right" }}>
          {guard.reason}
        </p>
      )}
    </>
  );
}
