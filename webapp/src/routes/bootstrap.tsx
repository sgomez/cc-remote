// Bootstrap screen (#54, #55): gated by the Claim Token, served only while the
// deployment is unconfigured. This route sits outside the /_app auth guard
// (like /login) because it configures the identity that makes sign-in possible.
// Once the deployment is configured this route redirects to /login.
//
// Two phases:
// 1. Token verification — the operator proves they own the host.
// 2. Configuration form — the operator provides their GitHub App identity.
//    On save the Bootstrap File is written and the process exits; the restart
//    policy brings it back with the new configuration. The browser polls a
//    health endpoint during the restart window and redirects to /login when
//    the deployment is back.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  fetchDeploymentState,
  saveBootstrapConfig,
  verifyClaimTokenServerFn,
} from "~/server/bootstrap";

export const Route = createFileRoute("/bootstrap")({
  beforeLoad: async () => {
    const { configured } = await fetchDeploymentState();
    if (configured) throw redirect({ to: "/login" });
  },
  component: BootstrapPage,
});

function BootstrapPage() {
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<"token" | "form" | "restarting">("token");
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
        setPhase("form");
      } else {
        setError("Invalid token.");
      }
    } finally {
      setBusy(false);
    }
  };

  // Token entry screen
  if (phase === "token") {
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

  // Restarting screen — poll the health endpoint and redirect when ready
  if (phase === "restarting") {
    return <RestartingScreen />;
  }

  // Configuration form
  return <BootstrapForm token={token} onSaved={() => setPhase("restarting")} />;
}

// ---- Restarting screen -------------------------------------------------------

function RestartingScreen() {
  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch("/api/health");
        if (!stopped && res.ok) {
          window.location.href = "/login";
        }
      } catch {
        // Server not back yet — keep polling.
      }
    };

    // First poll after a short delay to let the old process finish exiting.
    const initial = setTimeout(poll, 3000);
    const interval = setInterval(poll, 2000);

    return () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

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
        <p className="subtle" style={{ margin: "16px auto 8px" }}>
          Configuration saved. The deployment is restarting to apply the new identity.
        </p>
        <p className="card-meta">
          You will be redirected automatically when it is back. This usually takes a few seconds.
        </p>
      </div>
    </div>
  );
}

// ---- Configuration form ------------------------------------------------------

function BootstrapForm({ token, onSaved }: { token: string; onSaved: () => void }) {
  const [appId, setAppId] = useState("");
  const [appSlug, setAppSlug] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [privateKeyBase64, setPrivateKeyBase64] = useState("");
  const [privateKeyFileName, setPrivateKeyFileName] = useState("");
  const [allowedUsers, setAllowedUsers] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      // Encode the PEM text as base64 for transport and storage. TextEncoder
      // handles the UTF-8 encoding; String.fromCharCode bridges the byte
      // array to btoa (which operates on Latin-1 strings). PEM keys are ASCII
      // so this round-trips cleanly through Buffer.from(x, "base64") on the
      // server.
      const bytes = new TextEncoder().encode(reader.result);
      const binary = String.fromCharCode(...bytes);
      setPrivateKeyBase64(btoa(binary));
      setPrivateKeyFileName(file.name);
    };
    reader.readAsText(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const result = await saveBootstrapConfig({
        data: {
          token: token.trim(),
          appId,
          appSlug,
          clientId,
          clientSecret,
          privateKeyBase64,
          allowedUsers,
        },
      });
      if (result.ok) {
        onSaved();
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const complete = Boolean(
    appId.trim() &&
      appSlug.trim() &&
      clientId.trim() &&
      clientSecret.trim() &&
      privateKeyBase64 &&
      allowedUsers.trim(),
  );

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
          Enter your GitHub App credentials. The App needs repository contents and pull requests
          write permissions.
        </p>

        <form onSubmit={submit} style={{ width: "100%" }}>
          <div className="field">
            <label htmlFor="field-appId">GitHub App ID</label>
            <input
              id="field-appId"
              type="text"
              className="input"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="e.g. 123456"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="field-appSlug">App slug</label>
            <input
              id="field-appSlug"
              type="text"
              className="input"
              value={appSlug}
              onChange={(e) => setAppSlug(e.target.value)}
              placeholder="e.g. cc-remote-web-manager"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="field-clientId">OAuth client ID</label>
            <input
              id="field-clientId"
              type="text"
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="e.g. Iv1.abc123"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="field-clientSecret">OAuth client secret</label>
            <input
              id="field-clientSecret"
              type="password"
              className="input"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client secret"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="field-privateKey">Private key (.pem file)</label>
            <input
              ref={fileInputRef}
              id="field-privateKey"
              type="file"
              accept=".pem,.txt,application/x-pem-file"
              onChange={handleFile}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                {privateKeyFileName ? "Change file" : "Choose file"}
              </button>
              <span className="card-meta">{privateKeyFileName || "No file selected"}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="field-allowedUsers">
              Sign-in allow-list (comma-separated GitHub usernames)
            </label>
            <input
              id="field-allowedUsers"
              type="text"
              className="input"
              value={allowedUsers}
              onChange={(e) => setAllowedUsers(e.target.value)}
              placeholder="e.g. sgomez, alice"
              autoComplete="off"
            />
            <p className="card-meta" style={{ marginTop: 4 }}>
              Must include at least one username. An empty allow-list denies everyone.
            </p>
          </div>

          {errors.length > 0 && (
            <div
              style={{
                color: "var(--color-danger, #e74c3c)",
                margin: "12px 0",
                fontSize: "0.85rem",
              }}
            >
              {errors.map((msg) => (
                <p key={msg} style={{ margin: "4px 0" }}>
                  {msg}
                </p>
              ))}
            </div>
          )}

          <button
            type="submit"
            className="btn primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={!complete || busy}
          >
            {busy ? "Validating…" : "Save & restart"}
          </button>
        </form>
      </div>
    </div>
  );
}
