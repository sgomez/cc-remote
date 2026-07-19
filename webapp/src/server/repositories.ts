// Repository server functions (#34): thin delivery glue that lists the GitHub
// App installations and their granted repositories, using the App's own
// credentials — no signed-in user token is involved. Follows the pattern of
// server/accounts.ts (server fn + guard). No domain logic here; that lives in
// the GitHubTokenIssuer port adapter.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSession } from "~/adapters/auth";
import { createGitHubAppTokenIssuer } from "~/adapters/github/github-app-token-issuer";
import { loadDeploymentConfig } from "~/config/deployment";
import type { GitHubInstallation } from "~/core/ports/github-token-issuer";

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

/**
 * GitHub App token issuer for installation listing. Minted lazily so a
 * misconfigured deployment fails at first page load rather than at process
 * start, which would crash the server.
 */
let _issuer: ReturnType<typeof createGitHubAppTokenIssuer> | undefined;
function appIssuer() {
  if (!_issuer) {
    const config = loadDeploymentConfig();
    _issuer = createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
    });
  }
  return _issuer;
}

export const listInstallations = createServerFn({ method: "GET" }).handler(
  async (): Promise<GitHubInstallation[]> => {
    await guard();
    return appIssuer().listInstallations();
  },
);

/** Build the GitHub App installation URL for the "Manage" button. */
export const getInstallationUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<string> => {
    await guard();
    const config = loadDeploymentConfig();
    return `https://github.com/apps/${config.githubAppSlug}/installations/new`;
  },
);
