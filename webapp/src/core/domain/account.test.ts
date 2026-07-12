import { describe, expect, it } from "vitest";
import { accountConfigVolumeName } from "./account";

describe("Account", () => {
  it("names the config volume after the account id", () => {
    expect(accountConfigVolumeName("abc123")).toBe("cc-remote-account-abc123");
  });
});
