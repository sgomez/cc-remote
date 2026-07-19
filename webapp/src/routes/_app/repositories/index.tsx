// Repositories screen (#34): lists the GitHub App installations and their
// granted repositories. Follows the pattern of _app/accounts/index.tsx (card
// list layout) and server/accounts.ts (server fn + guard). The list is
// re-fetched from GitHub on every page load, so changes made directly on
// GitHub's side are reflected without manual intervention.

import { createFileRoute } from "@tanstack/react-router";
import type { GitHubInstallation } from "~/core";
import { getInstallationUrl, listInstallations } from "~/server/repositories";

export const Route = createFileRoute("/_app/repositories/")({
  loader: async () => {
    const [installations, installUrl] = await Promise.all([
      listInstallations(),
      getInstallationUrl(),
    ]);
    return { installations, installUrl };
  },
  pendingMs: 0,
  pendingComponent: RepositoriesPendingPage,
  component: RepositoriesPage,
});

function selectionLabel(mode: "all" | "selected"): string {
  return mode === "all" ? "All repositories" : "Selected repositories";
}

function RepositoriesPage() {
  const { installations, installUrl } = Route.useLoaderData();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/</span>repositories
          </h1>
          <p className="subtle">
            GitHub App installations that grant this deployment access to repositories.
          </p>
        </div>
        <a href={installUrl} className="btn primary" target="_blank" rel="noopener noreferrer">
          Manage on GitHub
        </a>
      </div>

      <div className="card-list">
        {installations.map((inst: GitHubInstallation) => (
          <div key={inst.id} className="card">
            <div className="card-row">
              <img
                src={inst.account.avatarUrl}
                alt=""
                style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0 }}
              />
              <span className="card-title">{inst.account.login}</span>
              <span className="spacer" />
              <span className="badge cap">{selectionLabel(inst.repositorySelection)}</span>
            </div>
            <div className="card-row">
              {inst.repositorySelection === "all" ? (
                <span className="card-meta">
                  Every repository owned by {inst.account.login} or its organisations is accessible.
                </span>
              ) : inst.repositories.length > 0 ? (
                <span className="card-meta">
                  {inst.repositories.length} repository
                  {inst.repositories.length > 1 ? "ies" : "y"} granted
                </span>
              ) : (
                <span className="card-meta">No explicit repositories listed.</span>
              )}
              <span className="spacer" />
              <a
                href={inst.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn small"
              >
                Review on GitHub
              </a>
            </div>
            {inst.repositorySelection === "selected" && inst.repositories.length > 0 && (
              <div className="card-row">
                <span className="card-meta">{inst.repositories.join(", ")}</span>
              </div>
            )}
          </div>
        ))}

        {installations.length === 0 && (
          <div className="empty">
            No GitHub App installations yet.{" "}
            <a href={installUrl} target="_blank" rel="noopener noreferrer">
              Install the GitHub App
            </a>{" "}
            on your account to grant this deployment access to repositories. After completing the
            installation on GitHub, you will be redirected back here automatically.
          </div>
        )}
      </div>
    </>
  );
}

function RepositoriesPendingPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            <span className="path">~/</span>repositories
          </h1>
          <p className="subtle">
            GitHub App installations that grant this deployment access to repositories.
          </p>
        </div>
        <button type="button" className="btn primary" disabled>
          Manage on GitHub
        </button>
      </div>

      <div
        className="card-list"
        style={{ display: "flex", justifyContent: "center", padding: "64px 0" }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <span className="card-meta">Loading installations...</span>
        </div>
      </div>
    </>
  );
}
