import { describe, expect, it } from "vitest";
import { GITHUB_OAUTH_SCOPE } from "./github-scope";

describe("GITHUB_OAUTH_SCOPE", () => {
  it("includes user:email (mandatory for better-auth's GitHub provider)", () => {
    expect(GITHUB_OAUTH_SCOPE).toContain("user:email");
  });

  it("does NOT include repo (GitHub Apps ignore authorisation-URL scopes)", () => {
    expect(GITHUB_OAUTH_SCOPE).not.toContain("repo");
  });
});
