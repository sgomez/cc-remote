// Session detail (#16): a web terminal for EVERY session (WS proxy #15), a
// Remote Control panel shown ONLY when the Account's Provider Type has
// remoteControl (else an explicit "not available" note), a clone_failed error
// panel with retry, an `error` panel that says the container crashed (U2 —
// honest status: distinct from a deliberate stop), and stop/start/reset/destroy
// actions — the destructive ones (reset/destroy) behind a confirmation. Status
// tracks the #15 SSE stream live.

import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { requireProviderType, type WorkspaceState } from "~/core";
import { listAccounts } from "~/server/accounts";
import {
  destroySession,
  listSessions,
  readWorkspaceState,
  resetSession,
  startSession,
  stopSession,
} from "~/server/sessions";
import { PermissionModePill, StatusPill } from "~/ui/components/badges";
import { type ConfirmOptions, useFeedback } from "~/ui/components/feedback";
import { LogsModal } from "~/ui/components/LogsModal";
import { Spinner } from "~/ui/components/Spinner";
import { Terminal } from "~/ui/components/Terminal";
import { useLiveSnapshot } from "~/ui/live/live-status";
import { sessionStatusBadge } from "~/ui/view-models/badges";
import {
  remoteControlPanel,
  type SessionActionButton,
  type SessionActionKind,
  sessionActionState,
} from "~/ui/view-models/capabilities";
import { permissionModeBadge } from "~/ui/view-models/permission-mode";
import type { AccountRow, SessionRow } from "~/ui/view-models/rows";
import { workspaceSummary } from "~/ui/view-models/workspace";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Uncommitted-work notice for the Destroy/Reset confirm dialogs (I2). Fetches
 * the workspace git state when the dialog mounts it and fills in — it never
 * blocks the dialog opening: while the probe is in flight it shows a loading
 * placeholder, then the summary (dirty warnings styled amber). A probe failure
 * degrades to a neutral "unknown", never a fake "clean".
 */
function WorkspaceLossNotice({ sessionName }: { sessionName: string }) {
  const [state, setState] = useState<WorkspaceState | null>(null);

  useEffect(() => {
    let alive = true;
    readWorkspaceState({ data: { name: sessionName } })
      .then((s) => alive && setState(s))
      .catch(() => alive && setState({ kind: "unknown", reason: "unavailable" }));
    return () => {
      alive = false;
    };
  }, [sessionName]);

  if (state === null) {
    return (
      <span className="workspace-notice">
        <Spinner /> Checking workspace…
      </span>
    );
  }
  const summary = workspaceSummary(state);
  return (
    <span className={`workspace-notice${summary.dirty ? " warn-text" : ""}`}>{summary.text}</span>
  );
}

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
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState<SessionActionKind | null>(null);
  // Logs are a diagnostic you reach for, not a panel that squats on the page —
  // so they live behind a button, available in every status.
  const [logsOpen, setLogsOpen] = useState(false);

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
  const permBadge = permissionModeBadge(session.permissionMode);
  const rc = type ? remoteControlPanel(type) : undefined;
  const buttons = sessionActionState(session.status, busy);

  const dispatch: Record<SessionActionKind, () => Promise<unknown>> = {
    stop: () => stopSession({ data: { name: session.name } }),
    start: () => startSession({ data: { name: session.name } }),
    reset: () => resetSession({ data: { name: session.name } }),
    destroy: () => destroySession({ data: { name: session.name } }),
  };

  const confirmCopy: Partial<Record<SessionActionKind, ConfirmOptions>> = {
    reset: {
      title: `Reset "${session.name}"?`,
      body: (
        <>
          This destroys the container and its workspace volume, then re-clones with a fresh session
          UUID.
          {permBadge && (
            <p className="subtle">
              It will come back in <strong>{permBadge.label}</strong> permission mode, the one it
              was created in.
            </p>
          )}
          <WorkspaceLossNotice sessionName={session.name} />
        </>
      ),
      confirmLabel: "Reset",
      danger: true,
    },
    destroy: {
      title: `Destroy "${session.name}"?`,
      body: (
        <>
          This removes the container and its workspace volume permanently.
          <WorkspaceLossNotice sessionName={session.name} />
        </>
      ),
      confirmLabel: "Destroy",
      danger: true,
    },
  };

  // Runs a lifecycle action with confirmation (unless skipped, e.g. clone retry),
  // a busy state that blocks double-submits, and a toast on success/failure —
  // the SSE stream still drives the status pill as the container transitions.
  const runAction = async (action: SessionActionKind, opts?: { skipConfirm?: boolean }) => {
    const ask = opts?.skipConfirm ? undefined : confirmCopy[action];
    if (ask && !(await confirm(ask))) return;
    setBusy(action);
    try {
      await dispatch[action]();
      if (action === "destroy") {
        toast.success(`Session "${session.name}" destroyed.`);
        router.navigate({ to: "/sessions" });
        return;
      }
      router.invalidate();
    } catch (err) {
      toast.error(`Couldn't ${action} "${session.name}": ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  // One renderer for every lifecycle button; the action row splits them into
  // a plain group and a right-aligned danger zone by the confirm flag.
  const actionButton = (b: SessionActionButton) => (
    <button
      key={b.action}
      type="button"
      className={`btn${b.action === "destroy" ? " danger" : ""}`}
      disabled={b.disabled}
      onClick={() => runAction(b.action)}
    >
      {b.busy && <Spinner />}
      {b.label}
    </button>
  );

  return (
    <>
      <div className="page-head" style={{ viewTransitionName: `sess-card-${session.name}` }}>
        <div>
          <h1>
            <Link to="/sessions" className="path">
              ~/sessions/
            </Link>
            <span style={{ viewTransitionName: `sess-title-${session.name}` }}>{session.name}</span>
          </h1>
          <p className="subtle">
            {session.repo} · account:{" "}
            {account ? (
              <Link to="/accounts/$accountId" params={{ accountId: session.accountId }}>
                {account.displayName}
              </Link>
            ) : (
              session.accountId
            )}
          </p>
        </div>
        <div className="head-badges">
          <PermissionModePill badge={permBadge} />
          <StatusPill badge={badge} vtName={`sess-status-${session.name}`} />
        </div>
      </div>

      {session.status === "clone_failed" && (
        <div className="panel error">
          <h2 className="error-text">Clone failed</h2>
          <p className="subtle">
            Cloning the repository failed. Check that the repo exists and your GitHub token can read
            it, then retry.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => runAction("reset", { skipConfirm: true })}
            >
              {busy === "reset" && <Spinner />}
              {busy === "reset" ? "Retrying…" : "Retry clone"}
            </button>
          </div>
        </div>
      )}

      {session.status === "error" && (
        <div className="panel error">
          <h2 className="error-text">Container crashed</h2>
          <p className="subtle">
            This session's container exited on its own — it wasn't stopped by you. Start it again
            below, or reset it for a clean workspace and a fresh session id.
          </p>
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
        {buttons.filter((b) => !b.confirm).map(actionButton)}
        <button type="button" className="btn" onClick={() => setLogsOpen(true)}>
          Logs
        </button>
        <span className="danger-zone">{buttons.filter((b) => b.confirm).map(actionButton)}</span>
      </div>

      {/* Mounted only while open, so closing it unmounts the EventSource — which
          is what aborts the request and tears down the Docker follow. */}
      {logsOpen && <LogsModal sessionName={session.name} onClose={() => setLogsOpen(false)} />}
    </>
  );
}
