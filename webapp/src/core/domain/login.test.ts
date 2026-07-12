import { describe, expect, it } from "vitest";
import { buildLoginLabels, LOGIN_LABELS } from "./login";
import { SESSION_LABELS } from "./session";

describe("login container labels", () => {
  it("carries the login marker, never the session marker", () => {
    const labels = buildLoginLabels({ accountId: "acc-1" });
    expect(labels[LOGIN_LABELS.marker]).toBe("true");
    // Critical: a Login Container must be excluded from session listings.
    expect(labels[SESSION_LABELS.marker]).toBeUndefined();
  });

  it("tags the account with the shared account-id label key", () => {
    expect(LOGIN_LABELS.accountId).toBe(SESSION_LABELS.accountId);
    const labels = buildLoginLabels({ accountId: "acc-1" });
    expect(labels[LOGIN_LABELS.accountId]).toBe("acc-1");
  });
});
