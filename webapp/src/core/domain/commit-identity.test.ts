import { describe, expect, it } from "vitest";
import { buildCommitIdentity, githubNoreplyEmail } from "./commit-identity";
import { InvalidCommitIdentityError } from "./errors";

describe("githubNoreplyEmail", () => {
  it("builds the id-qualified noreply address GitHub attributes to the profile", () => {
    expect(githubNoreplyEmail("580701", "sgomez")).toBe("580701+sgomez@users.noreply.github.com");
  });

  // The legacy `<login>@users.noreply.github.com` form only links commits on
  // accounts old enough to predate the id-qualified address. Emitting it for a
  // modern account leaves the commit authored by nobody, which is the whole
  // failure this module exists to prevent.
  it("never emits the legacy login-only form", () => {
    expect(githubNoreplyEmail("1", "a")).not.toBe("a@users.noreply.github.com");
  });
});

describe("buildCommitIdentity", () => {
  it("takes the display name from the account and the email from id + login", () => {
    expect(
      buildCommitIdentity({ name: "Sergio Gómez", githubId: "580701", githubLogin: "sgomez" }),
    ).toEqual({
      name: "Sergio Gómez",
      email: "580701+sgomez@users.noreply.github.com",
    });
  });

  // better-auth defaults `user.name` to `profile.name || profile.login`, so it is
  // populated in practice; falling back to the login keeps a blank display name
  // from producing a commit with an empty author.
  it("falls back to the login when the display name is blank", () => {
    expect(buildCommitIdentity({ name: "  ", githubId: "580701", githubLogin: "sgomez" })).toEqual({
      name: "sgomez",
      email: "580701+sgomez@users.noreply.github.com",
    });
  });

  // Fail loud rather than silently authoring commits as nobody. Both values are
  // invariants by the time a Session can be created: the fail-closed allow-list
  // rejects a sign-in without `githubLogin`, and better-auth writes `accountId`
  // on every sign-in.
  it.each([
    ["githubId", { name: "S", githubId: "", githubLogin: "sgomez" }],
    ["githubLogin", { name: "S", githubId: "580701", githubLogin: "" }],
  ])("throws when %s is missing", (_field, input) => {
    expect(() => buildCommitIdentity(input)).toThrow(InvalidCommitIdentityError);
  });

  it("rejects a non-numeric GitHub id", () => {
    expect(() =>
      buildCommitIdentity({ name: "S", githubId: "not-a-number", githubLogin: "sgomez" }),
    ).toThrow(InvalidCommitIdentityError);
  });
});
