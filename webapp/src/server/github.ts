// GitHub repo listing for the new-session repo autocomplete (restores the
// legacy searchable combobox). The authenticated user's repos are read
// server-side with their stored OAuth token — the token never reaches the
// browser. Any failure (rate limit, network, revoked token) degrades to an
// empty list so the form still accepts a hand-typed `owner/name`.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getGithubAccessToken, requireSession } from "~/adapters/auth";

const REPOS_URL =
  "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member";

export const listRepos = createServerFn({ method: "GET" }).handler(async (): Promise<string[]> => {
  const { headers } = getRequest();
  await requireSession(headers);
  const token = await getGithubAccessToken(headers);
  if (!token) return [];

  try {
    const res = await fetch(REPOS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "cc-remote-web-manager",
      },
    });
    if (!res.ok) return [];
    const repos = (await res.json()) as Array<{ full_name?: unknown }>;
    return repos.map((r) => r.full_name).filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
});
