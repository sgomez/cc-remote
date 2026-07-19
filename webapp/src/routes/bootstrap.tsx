// Bootstrap screen (#54): gated by the Claim Token, served only while the
// deployment is unconfigured. This route sits outside the /_app auth guard
// (like /login) because it configures the identity that makes sign-in possible.
// Once the deployment is configured this route redirects to /login.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { fetchDeploymentState, verifyClaimTokenServerFn } from "~/server/bootstrap";

export const Route = createFileRoute("/bootstrap")({
  beforeLoad: async () => {
    const { configured } = await fetchDeploymentState();
    if (configured) throw redirect({ to: "/login" });
  },
  component: BootstrapPage,
});

function BootstrapPage() {
  const [token, setToken] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submitToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError("Enter the claim token shown in the container start logs.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await verifyClaimTokenServerFn({ data: { token: token.trim() } });
      if (result.valid) {
        setVerified(true);
      } else {
        setError("Invalid token.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
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
          <h1>cc-remote Setup</h1>
          <p className="subtle" style={{ margin: "8px auto 24px" }}>
            Token verified. You can now configure your deployment's GitHub identity.
          </p>
          <p className="subtle">App registration will be available in the next step.</p>
        </div>
      </div>
    );
  }

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
        <h1>cc-remote Setup</h1>
        <p className="subtle" style={{ margin: "8px auto 24px" }}>
          Enter the claim token shown in the container start logs to begin.
        </p>
        <form onSubmit={submitToken} style={{ width: "100%" }}>
          <input
            type="text"
            className="input"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Claim token"
            autoComplete="off"
            spellCheck={false}
            style={{ width: "100%", marginBottom: error ? "8px" : "16px" }}
          />
          {error && (
            <p
              className="card-meta"
              style={{ color: "var(--color-danger, #e74c3c)", marginBottom: "12px" }}
            >
              {error}
            </p>
          )}
          <button type="submit" className="btn" style={{ width: "100%" }} disabled={busy}>
            {busy ? "Verifying…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
