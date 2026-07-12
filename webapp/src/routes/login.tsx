// Public login screen (#16): GitHub sign-in via better-auth (#12). The only app
// route NOT behind the /_app auth guard. An already-authenticated visitor is
// redirected straight to /sessions. Access is still gated server-side by the
// fail-closed allow-list — a non-listed user completes the OAuth round-trip and
// is rejected by better-auth's session hook, landing back here.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { signInWithGithub } from "~/adapters/auth/client";
import { fetchSession } from "~/server/auth";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
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
        <div className="logo-icon">◐</div>
        <h1>cc-remote</h1>
        <p className="subtle" style={{ margin: "8px auto 24px" }}>
          Sign in with GitHub to manage your agent sessions and provider accounts. Access is limited
          to the configured allow-list.
        </p>
        <button
          type="button"
          className="btn github"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={signIn}
        >
          {busy ? "redirecting…" : "Sign in with GitHub"}
        </button>
      </div>
    </div>
  );
}
