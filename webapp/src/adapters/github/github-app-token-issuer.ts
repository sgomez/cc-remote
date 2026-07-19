// GitHub App installation token issuer. Implements the GitHubTokenIssuer port
// by signing a JWT (RS256) with the App private key and calling GitHub's REST
// API to resolve the installation for a repository and mint a single-repository,
// time-limited token. Uses only Node built-ins (crypto, fetch) so it adds no
// runtime dependency.
//
// The adapter is stateless: every issueToken call mints a fresh JWT and token.
// It holds the private key in memory; nothing caches to disk.

import { createSign } from "node:crypto";
import { RepositoryNotGrantedError } from "../../core/domain/errors";
import type {
  GitHubInstallation,
  GitHubTokenCredential,
  GitHubTokenIssuer,
} from "../../core/ports/github-token-issuer";

/** Configuration for the GitHub App JWT issuer. */
export type GitHubAppTokenIssuerConfig = {
  /** Numeric GitHub App ID (used as JWT `iss` claim). */
  appId: string;
  /** Base64-encoded PEM private key. Decoded at construction. */
  privateKey: string;
};

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Mint a short-lived RS256 JWT signed with the App private key. */
function signAppJwt(appId: string, privateKeyPem: string): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(JSON.stringify({ iat: now, exp: now + 600, iss: appId }));
  const signInput = `${header}.${payload}`;

  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  sign.end();
  const signature = sign
    .sign(privateKeyPem, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signInput}.${signature}`;
}

/** Minimum permissions the installation token asks for. */
const TOKEN_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
} as const;

/** Per-spec: an installation token lasts one hour. */
function parseExpiry(expiresAt: string): Date {
  return new Date(expiresAt);
}

/**
 * Create an adapter that mints repo-scoped installation tokens via the GitHub
 * App REST API. Throws RepositoryNotGrantedError when no installation covers
 * the requested repository.
 */
export function createGitHubAppTokenIssuer(config: GitHubAppTokenIssuerConfig): GitHubTokenIssuer {
  const privateKeyPem = Buffer.from(config.privateKey, "base64").toString("utf8");

  return {
    async issueToken(repo: string): Promise<GitHubTokenCredential> {
      const jwt = signAppJwt(config.appId, privateKeyPem);

      // Resolve the installation for this repository. Uses the App's own
      // credentials; no signed-in user token is involved, keeping this ticket
      // independent of the auth migration.
      const installationRes = await fetch(`https://api.github.com/repos/${repo}/installation`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (installationRes.status === 404) {
        throw new RepositoryNotGrantedError(repo);
      }

      if (!installationRes.ok) {
        const body = await installationRes.text().catch(() => "");
        throw new Error(
          `GitHub App: failed to resolve installation for ${repo} (HTTP ${installationRes.status})${body ? `: ${body}` : ""}`,
        );
      }

      const installation = (await installationRes.json()) as { id: number };
      const [, repoName] = repo.split("/");

      // Mint a repo-scoped installation token with only the permissions this
      // deployment declares. GitHub enforces the token cannot exceed the
      // installation's grant.
      const tokenRes = await fetch(
        `https://api.github.com/app/installations/${installation.id}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repositories: [repoName],
            permissions: TOKEN_PERMISSIONS,
          }),
        },
      );

      if (!tokenRes.ok) {
        if (tokenRes.status === 422) {
          throw new RepositoryNotGrantedError(repo);
        }
        const body = await tokenRes.text().catch(() => "");
        throw new Error(
          `GitHub App: failed to mint installation token for ${repo} (HTTP ${tokenRes.status})${body ? `: ${body}` : ""}`,
        );
      }

      const tokenData = (await tokenRes.json()) as { token: string; expires_at: string };

      return {
        token: tokenData.token,
        expiresAt: parseExpiry(tokenData.expires_at),
      };
    },

    async listInstallations(): Promise<GitHubInstallation[]> {
      const jwt = signAppJwt(config.appId, privateKeyPem);

      const res = await fetch("https://api.github.com/app/installations", {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `GitHub App: failed to list installations (HTTP ${res.status})${body ? `: ${body}` : ""}`,
        );
      }

      const installations = (await res.json()) as Array<{
        id: number;
        account: { login: string; avatar_url: string; type: "User" | "Organization" };
        repository_selection: "all" | "selected";
        html_url: string;
      }>;

      const result: GitHubInstallation[] = [];

      for (const inst of installations) {
        const repos: string[] = [];

        if (inst.repository_selection === "selected") {
          // Mint a short-lived installation token to list the granted repos.
          // We scope it minimally: no specific repository, no extra permissions
          // beyond what the app already declares.
          const tokenRes = await fetch(
            `https://api.github.com/app/installations/${inst.id}/access_tokens`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${jwt}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({}),
            },
          );

          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as { token: string };
            const reposRes = await fetch("https://api.github.com/installation/repositories", {
              headers: {
                Authorization: `Bearer ${tokenData.token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            });

            if (reposRes.ok) {
              const reposData = (await reposRes.json()) as {
                repositories: Array<{ full_name: string }>;
              };
              repos.push(...reposData.repositories.map((r) => r.full_name));
            }
            // If repository listing fails for one installation, skip it and
            // continue with the rest — an empty repo list is still informative.
          }
        }

        result.push({
          id: inst.id,
          account: {
            login: inst.account.login,
            avatarUrl: inst.account.avatar_url,
            type: inst.account.type,
          },
          repositorySelection: inst.repository_selection,
          repositories: repos,
          htmlUrl: inst.html_url,
        });
      }

      return result;
    },
  };
}
