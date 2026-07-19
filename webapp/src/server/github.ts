// GitHub repo listing for the new-session repo autocomplete (restores the
// legacy searchable combobox). The list is now derived from the GitHub App
// installations: "selected" installations contribute their explicit repository
// list, while "all" installations fall back to the signed-in user's own
// repositories (enumerated via their OAuth token, which never reaches the
// browser). Any failure degrades to an empty list so the form still accepts a
// hand-typed `owner/name`.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGithubAccessToken, requireSession } from "~/adapters/auth";
import { createGitHubAppTokenIssuer } from "~/adapters/github/github-app-token-issuer";
import { loadDeploymentConfig } from "~/config/deployment";

const REPOS_URL =
  "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";
const REPOS_PER_PAGE = 100;

/**
 * GitHub App token issuer for listing installations. Minted lazily so a
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

export const listRepos = createServerFn({ method: "GET" }).handler(async (): Promise<string[]> => {
  const { headers } = getRequest();
  await requireSession(headers);

  try {
    const installations = await appIssuer().listInstallations();
    const repos = new Set<string>();

    // "selected" installations contribute their explicit repository list.
    for (const inst of installations) {
      if (inst.repositorySelection === "selected") {
        for (const r of inst.repositories) repos.add(r);
      }
    }

    // "all" installations fall back to the OAuth token to enumerate repos.
    const hasAllInstallation = installations.some((i) => i.repositorySelection === "all");
    if (hasAllInstallation) {
      const token = await getGithubAccessToken(headers);
      if (token) {
        try {
          // Paginate: /user/repos returns at most 100 per page, and a user with
          // more than 100 repos would otherwise get a truncated autocomplete.
          // Follow pages until a short page ends the list.
          for (let page = 1; ; page++) {
            const res = await fetch(`${REPOS_URL}&page=${page}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "cc-remote-web-manager",
              },
            });
            if (!res.ok) break;
            const data = (await res.json()) as Array<{ full_name?: unknown }>;
            for (const r of data) {
              if (typeof r.full_name === "string") repos.add(r.full_name);
            }
            if (data.length < REPOS_PER_PAGE) break;
          }
        } catch {
          // Ignore — the autocomplete degrades gracefully to whatever
          // "selected" installation repos were collected above.
        }
      }
    }

    return [...repos].sort();
  } catch {
    return [];
  }
});
