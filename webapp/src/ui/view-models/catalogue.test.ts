import { describe, expect, it } from "vitest";
import { listProviderTypes, requireProviderType } from "~/core";
import { accountFormComplete, accountFormSpec, catalogueCards } from "./catalogue";

describe("catalogueCards", () => {
  it("returns one card per catalogue entry", () => {
    const cards = catalogueCards(listProviderTypes());
    expect(cards).toHaveLength(listProviderTypes().length);
  });

  it("surfaces capabilities on each card", () => {
    const cards = catalogueCards(listProviderTypes());
    const custom = cards.find((c) => c.id === "custom");
    expect(custom?.remoteControl).toBe(false);
    expect(custom?.seedingLabel).toBe("API key");
  });
});

describe("accountFormSpec", () => {
  it("prepends the account-name field to the provider's own fields", () => {
    const spec = accountFormSpec(requireProviderType("custom"));
    expect(spec.fields[0].name).toBe("displayName");
    expect(spec.fields.map((f) => f.name)).toEqual(["displayName", "apiKey", "baseUrl", "model"]);
  });

  it("flags the oauth Login-Container notice for claude, not for deepseek", () => {
    expect(accountFormSpec(requireProviderType("claude")).oauthNotice).toBe(true);
    expect(accountFormSpec(requireProviderType("deepseek")).oauthNotice).toBe(false);
  });

  it("gives an oauth type only the name field", () => {
    const spec = accountFormSpec(requireProviderType("claude"));
    expect(spec.fields.map((f) => f.name)).toEqual(["displayName"]);
  });

  it("carries deepseek presets", () => {
    const spec = accountFormSpec(requireProviderType("deepseek"));
    expect(spec.presets?.baseUrl).toBe("https://api.deepseek.com/anthropic");
  });
});

describe("accountFormComplete", () => {
  it("requires every required field to be non-blank", () => {
    const spec = accountFormSpec(requireProviderType("deepseek"));
    expect(accountFormComplete(spec, { displayName: "x" })).toBe(false);
    expect(accountFormComplete(spec, { displayName: "x", apiKey: " " })).toBe(false);
    expect(accountFormComplete(spec, { displayName: "x", apiKey: "sk-1" })).toBe(true);
  });

  it("is complete for an oauth type once the name is filled", () => {
    const spec = accountFormSpec(requireProviderType("claude"));
    expect(accountFormComplete(spec, {})).toBe(false);
    expect(accountFormComplete(spec, { displayName: "Personal" })).toBe(true);
  });
});
