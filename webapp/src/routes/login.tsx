// Public login screen (#16): GitHub sign-in via better-auth (#12). The only app
// route NOT behind the /_app auth guard. An already-authenticated visitor is
// redirected straight to /sessions. While the deployment is unconfigured this
// redirects to /bootstrap instead — sign-in cannot work without a GitHub identity.
// Access is still gated server-side by the fail-closed allow-list.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { signInWithGithub } from "~/adapters/auth/client";
import { fetchSession } from "~/server/auth";
import { fetchDeploymentState } from "~/server/bootstrap";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { configured } = await fetchDeploymentState();
    if (!configured) throw redirect({ to: "/bootstrap" });
    const session = await fetchSession();
    if (session) throw redirect({ to: "/sessions" });
  },
  component: LoginPage,
});

function LoginPage() {
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      await signInWithGithub("/sessions");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <div className="logo-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <title>Terminal</title>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <h1>cc-remote</h1>
        <p className="subtle" style={{ margin: "8px auto 24px" }}>
          Sign in with GitHub to manage your Claude Code sessions.
        </p>
        <button
          type="button"
          className="btn github"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={signIn}
        >
          {busy ? "Redirecting…" : "Sign in with GitHub"}
        </button>
      </div>
    </div>
  );
}
