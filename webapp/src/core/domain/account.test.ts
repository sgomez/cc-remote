import { describe, expect, it } from "vitest";
import { accountConfigVolumeName, ownsConfigVolume } from "./account";
import { requireProviderType } from "./provider-type";

describe("Account", () => {
  it("names the config volume after the account id", () => {
    expect(accountConfigVolumeName("abc123")).toBe("cc-remote-account-abc123");
  });

  it("owns a config volume for volume-backed seeding methods", () => {
    expect(ownsConfigVolume(requireProviderType("deepseek"))).toBe(true);
    expect(ownsConfigVolume(requireProviderType("custom"))).toBe(true);
    expect(ownsConfigVolume(requireProviderType("claude"))).toBe(true);
  });

  it("host-mount types own no config volume", () => {
    expect(ownsConfigVolume(requireProviderType("claude-local"))).toBe(false);
  });
});
