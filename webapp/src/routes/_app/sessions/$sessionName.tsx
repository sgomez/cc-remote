// Session detail (#16): a web terminal for EVERY session (WS proxy #15), a
// Remote Control panel shown ONLY when the Account's Provider Type has
// remoteControl (else an explicit "not available" note), a clone_failed error
// panel with retry, and stop/start/reset/destroy actions — the destructive ones
// (reset/destroy) behind a confirmation. Status tracks the #15 SSE stream live.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { requireProviderType } from "~/core";
import { listAccounts } from "~/server/accounts";
import {
  destroySession,
  listSessions,
  resetSession,
  startSession,
  stopSession,
} from "~/server/sessions";
import { ProviderBadge, StatusPill } from "~/ui/components/badges";
import { Terminal } from "~/ui/components/Terminal";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { sessionStatusBadge } from "~/ui/view-models/badges";
import { remoteControlPanel, sessionActions } from "~/ui/view-models/capabilities";
import type { AccountRow, SessionRow } from "~/ui/view-models/rows";

export const Route = createFileRoute("/_app/sessions/$sessionName")({
  loader: async () => ({
    sessions: await listSessions(),
    accounts: await listAccounts(),
  }),
  component: SessionDetailPage,
});

function SessionDetailPage() {
  const { sessionName } = Route.useParams();
  const { sessions: initial, accounts } = Route.useLoaderData();
  const router = useRouter();
  const sessions = useLiveSnapshot<SessionRow[]>("/api/sessions/status", "sessions", initial);
  const session = sessions.find((s) => s.name === sessionName);

  if (!session) {
    return (
      <div className="empty">
        Session not found (destroyed?). <Link to="/sessions">Back to sessions</Link>
      </div>
    );
  }

  const account = accounts.find((a: AccountRow) => a.id === session.accountId);
  const type = account ? requireProviderType(account.providerType) : undefined;
  const badge = sessionStatusBadge(session.status);
  const actions = sessionActions(session.status);
  const rc = type ? remoteControlPanel(type) : undefined;

  const run = async (fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    await fn();
    router.invalidate();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ viewTransitionName: `sess-title-${session.name}` }}>
            <span className="path">~/sessions/</span>
            {session.name}
          </h1>
          <p className="subtle">
            {session.repo} · account: {account?.displayName ?? session.accountId}{" "}
            {account && <ProviderBadge providerType={account.providerType} />}
          </p>
        </div>
        <StatusPill badge={badge} vtName={`sess-status-${session.name}`} />
      </div>

      {session.status === "clone_failed" && (
        <div className="panel error">
          <h2 className="error-text">Clone failed</h2>
          <p className="subtle">
            The clone helper container exited non-zero. Check the repo exists and your token can
            read it, then retry (re-runs the two-phase clone).
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => run(() => resetSession({ data: { name: session.name } }))}
            >
              Retry clone
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Terminal</h2>
        {session.status === "running" ? (
          <Terminal
            title={`cc-remote-session-${session.name} — /workspace`}
            wsPath={`/ws/terminal/${encodeURIComponent(session.name)}`}
          />
        ) : (
          <p className="subtle">
            {session.status === "cloning"
              ? "Cloning the repository… the terminal attaches once the agent container is running."
              : "Container is stopped — start it to attach a terminal."}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Remote Control</h2>
        {rc?.available ? (
          <p className="subtle">
            This account's provider type supports Claude Remote Control. Pair from claude.ai or the
            mobile app; pairing persists across container recreations (pinned session UUID).
            Complete pairing from inside the web terminal above.
          </p>
        ) : (
          <p className="subtle">
            Not available: <strong>{type?.label ?? "this provider"}</strong> does not support Remote
            Control. Use the web terminal above.
          </p>
        )}
      </div>

      <div className="actions">
        <Link to="/sessions" className="btn">
          ← Back
        </Link>
        <span className="spacer" />
        {actions.canStop && (
          <button
            type="button"
            className="btn"
            onClick={() => run(() => stopSession({ data: { name: session.name } }))}
          >
            Stop
          </button>
        )}
        {actions.canStart && (
          <button
            type="button"
            className="btn"
            onClick={() => run(() => startSession({ data: { name: session.name } }))}
          >
            Start
          </button>
        )}
        {actions.canReset && (
          <button
            type="button"
            className="btn"
            title="Destroys container + workspace volume, re-clones with a fresh session UUID"
            onClick={() =>
              run(
                () => resetSession({ data: { name: session.name } }),
                `Reset "${session.name}"? This destroys the container and its workspace volume, then re-clones with a fresh session UUID.`,
              )
            }
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className="btn danger"
          onClick={() =>
            run(async () => {
              await destroySession({ data: { name: session.name } });
              router.navigate({ to: "/sessions" });
            }, `Destroy "${session.name}"? This removes the container and its workspace volume permanently.`)
          }
        >
          Destroy
        </button>
      </div>
    </>
  );
}
