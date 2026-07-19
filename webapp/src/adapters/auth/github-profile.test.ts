import { parseAdditionalUserInputFromProviderProfile } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { githubAdditionalFields, mapGithubProfileToUser } from "./github-profile";

describe("mapGithubProfileToUser", () => {
  it("maps the GitHub login onto githubLogin and synthesizes email if missing", () => {
    expect(mapGithubProfileToUser({ login: "sgomez" })).toEqual({
      githubLogin: "sgomez",
      email: "sgomez@users.noreply.github.com",
    });
    expect(mapGithubProfileToUser({ login: "sgomez", email: "sgomez@example.com" })).toEqual({
      githubLogin: "sgomez",
      email: "sgomez@example.com",
    });
  });
});

describe("githubAdditionalFields wiring", () => {
  // Regression guard for the fail-closed allow-list: better-auth strips profile
  // fields declared `input: false` before persisting them (see
  // parseAdditionalUserInputFromProviderProfile). If githubLogin were dropped
  // here, every sign-in would be denied. This drives the *real* better-auth
  // parser against our config so it can't drift.
  it("keeps githubLogin when better-auth parses the provider profile", () => {
    const mapped = mapGithubProfileToUser({ login: "sgomez" });

    const persisted = parseAdditionalUserInputFromProviderProfile(
      { user: { additionalFields: githubAdditionalFields }, plugins: [] },
      mapped,
      "create",
    );

    expect(persisted).toEqual({ githubLogin: "sgomez" });
  });
});
