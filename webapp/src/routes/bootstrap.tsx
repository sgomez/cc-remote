// Bootstrap screen (#54, #55, #56): gated by the Claim Token, served only
// while the deployment is unconfigured. This route sits outside the /_app
// auth guard (like /login) because it configures the identity that makes
// sign-in possible. Once the deployment is configured this route redirects to
// /login.
//
// Three phases:
// 1. Token verification — the operator proves they own the host.
// 2. Choice — register a new GitHub App via the App Manifest Flow, or enter
//    an existing App's credentials manually.
// 3. Configuration form — the operator provides their GitHub App identity
//    (manual path) or reviews the pre-filled fields from the manifest flow.
//    On save the Bootstrap File is written and the process exits; the restart
//    policy brings it back with the new configuration. The browser polls a
//    health endpoint during the restart window and redirects to /login when
//    the deployment is back.

import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  fetchDeploymentState,
  getManifestRegistrationUrl,
  loadManifestResult,
  saveBootstrapConfig,
  verifyClaimTokenServerFn,
} from "~/server/bootstrap";

export const Route = createFileRoute("/bootstrap")({
  beforeLoad: async ({ location }) => {
    const { configured } = await fetchDeploymentState();
    if (configured) throw redirect({ to: "/login" });

    // When a manifest key is present from the App Manifest Flow callback,
    // load the pre-filled data on the server so the form renders immediately
    // without an extra client-side fetch.
    const params = new URLSearchParams(String(location.search).replace(/^\?/, ""));
    const key = params.get("manifest");
    if (key) {
      const result = await loadManifestResult({ data: { key } });
      if (result.ok) {
        return {
          manifestKey: key,
          prefill: {
            appId: result.githubAppId,
            appSlug: result.githubAppSlug,
            clientId: result.githubClientId,
            clientSecret: result.githubClientSecret,
            allowedUsers: result.allowedGithubUsers.join(", "),
          },
        };
      }
    }
    return {};
  },
  component: BootstrapPage,
});

function BootstrapPage() {
  const routeContext = Route.useRouteContext() as {
    manifestKey?: string;
    prefill?: {
      appId: string;
      appSlug: string;
      clientId: string;
      clientSecret: string;
      allowedUsers: string;
    };
  };

  const { search } = useLocation();
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  const searchError = params.get("manifestError");

  // When returning from the App Manifest Flow, start directly in the form
  // phase with pre-filled data.
  const initialPhase = routeContext.manifestKey ? "form" : "token";

  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<"token" | "choose" | "form" | "restarting">(initialPhase);
  const [error, setError] = useState(searchError || "");
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
        // After verifying the token, give the operator the choice between
        // registering a new App and entering an existing one.
        setPhase("choose");
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
              {busy ? "Verifying..." : "Continue"}
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

  // Choice screen — after token verification, the operator picks how to
  // configure their GitHub identity.
  if (phase === "choose") {
    return <ChoiceScreen onRegister={registerNewApp} onManual={() => setPhase("form")} />;
  }

  // Configuration form
  return (
    <BootstrapForm
      token={token}
      prefill={routeContext.prefill}
      manifestKey={routeContext.manifestKey}
      onSaved={() => setPhase("restarting")}
    />
  );
}

// ---- Choice screen -----------------------------------------------------------

function ChoiceScreen({ onRegister, onManual }: { onRegister: () => void; onManual: () => void }) {
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
          Configure your deployment's GitHub identity. Your GitHub App needs repository contents and
          pull requests write permissions.
        </p>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%" }}
            onClick={onRegister}
          >
            Register a new GitHub App
          </button>
          <p className="card-meta" style={{ textAlign: "center", margin: "4px 0" }}>
            GitHub creates the App for you. The private key stays on the server.
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              margin: "8px 0",
            }}
          >
            <div style={{ flex: 1, height: "1px", background: "var(--color-border, #333)" }} />
            <span className="card-meta">or</span>
            <div style={{ flex: 1, height: "1px", background: "var(--color-border, #333)" }} />
          </div>

          <button type="button" className="btn" style={{ width: "100%" }} onClick={onManual}>
            I already have a GitHub App
          </button>
          <p className="card-meta" style={{ textAlign: "center", margin: "4px 0" }}>
            Enter your App ID, slug, OAuth credentials and private key.
          </p>
        </div>
      </div>
    </div>
  );
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

function BootstrapForm({
  token,
  prefill,
  manifestKey,
  onSaved,
}: {
  token: string;
  prefill?: {
    appId: string;
    appSlug: string;
    clientId: string;
    clientSecret: string;
    allowedUsers: string;
  };
  manifestKey?: string;
  onSaved: () => void;
}) {
  const [appId, setAppId] = useState(prefill?.appId ?? "");
  const [appSlug, setAppSlug] = useState(prefill?.appSlug ?? "");
  const [clientId, setClientId] = useState(prefill?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState(prefill?.clientSecret ?? "");
  const [privateKeyBase64, setPrivateKeyBase64] = useState("");
  const [privateKeyFileName, setPrivateKeyFileName] = useState("");
  const [allowedUsers, setAllowedUsers] = useState(prefill?.allowedUsers ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isManifestFlow = Boolean(manifestKey);

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
          // In the manifest flow, the GitHub identity fields (appId, appSlug,
          // clientId, clientSecret, privateKeyBase64) are overridden by the
          // temp file values on the server. The private key never reaches the
          // browser. Only the allow-list comes from the form.
          manifestKey,
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

  const complete = isManifestFlow
    ? Boolean(allowedUsers.trim())
    : Boolean(
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
        {isManifestFlow ? (
          <p className="subtle" style={{ margin: "8px auto 24px" }}>
            Your new GitHub App has been registered. Review the settings below and save.
          </p>
        ) : (
          <p className="subtle" style={{ margin: "8px auto 24px" }}>
            Enter your GitHub App credentials. The App needs repository contents and pull requests
            write permissions.
          </p>
        )}

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
              readOnly={isManifestFlow}
              style={isManifestFlow ? { opacity: 0.6, cursor: "default" } : undefined}
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
              readOnly={isManifestFlow}
              style={isManifestFlow ? { opacity: 0.6, cursor: "default" } : undefined}
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
              readOnly={isManifestFlow}
              style={isManifestFlow ? { opacity: 0.6, cursor: "default" } : undefined}
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
              readOnly={isManifestFlow}
              style={isManifestFlow ? { opacity: 0.6, cursor: "default" } : undefined}
            />
          </div>

          {isManifestFlow ? (
            <div className="field">
              <span>Private key</span>
              <p className="card-meta" style={{ marginTop: 4 }}>
                Uploaded via the App Manifest Flow. The private key is stored securely on the server
                and was never transmitted to your browser.
              </p>
            </div>
          ) : (
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
          )}

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
            {busy ? "Validating..." : "Save & restart"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---- App Manifest Flow registration ------------------------------------------

/**
 * Redirect the browser to GitHub's App creation page with the deployment's
 * manifest pre-filled. This function is separated from the component so it
 * can use server function RPC from the client.
 */
async function registerNewApp() {
  const url = await getManifestRegistrationUrl();
  window.location.href = url;
}
