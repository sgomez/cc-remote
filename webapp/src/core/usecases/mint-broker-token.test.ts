import { beforeEach, describe, expect, it } from "vitest";
import { FakeBrokerSecretRegistry } from "../../../test/fake-broker-secret-registry";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { FakeGitHubTokenIssuer } from "../../../test/fake-github-token-issuer";
import { BrokerTokenRefusedError, makeMintBrokerToken } from "./mint-broker-token";

function setup() {
  const engine = new FakeContainerEngine();
  const tokenIssuer = new FakeGitHubTokenIssuer();
  const secretRegistry = new FakeBrokerSecretRegistry();
  const mint = makeMintBrokerToken({ engine, tokenIssuer, secretRegistry });
  return { engine, tokenIssuer, secretRegistry, mint };
}

describe("mint-broker-token", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("returns a credential for a known secret whose session exists", async () => {
    ctx.secretRegistry.seed("sec-1", "s1", "o/r");
    ctx.engine.seedRunningSession({ name: "s1", repo: "o/r", accountId: "acc-1" });
    ctx.tokenIssuer.nextCredential = {
      token: "ghs_inst",
      expiresAt: new Date("2026-01-01T01:00:00Z"),
    };

    const cred = await ctx.mint({ brokerSecret: "sec-1" });

    expect(cred).toEqual({ token: "ghs_inst", expiresAt: new Date("2026-01-01T01:00:00Z") });
    // The repo is derived from the Session's own record, not the request.
    expect(ctx.tokenIssuer.issuedRepos).toEqual(["o/r"]);
  });

  it("refuses an unknown secret", async () => {
    await expect(ctx.mint({ brokerSecret: "unknown" })).rejects.toThrow(BrokerTokenRefusedError);
    // No token was minted.
    expect(ctx.tokenIssuer.issuedRepos).toHaveLength(0);
  });

  it("refuses a secret whose session no longer exists", async () => {
    ctx.secretRegistry.seed("sec-1", "s1", "o/r");
    // The session was destroyed — no container in the engine.
    await expect(ctx.mint({ brokerSecret: "sec-1" })).rejects.toThrow(BrokerTokenRefusedError);
    expect(ctx.tokenIssuer.issuedRepos).toHaveLength(0);
  });

  it("propagates a token-minting failure from the port", async () => {
    ctx.secretRegistry.seed("sec-1", "s1", "o/r");
    ctx.engine.seedRunningSession({ name: "s1", repo: "o/r", accountId: "acc-1" });
    ctx.tokenIssuer.thenFail(new Error("upstream 502"));

    await expect(ctx.mint({ brokerSecret: "sec-1" })).rejects.toThrow("upstream 502");
  });

  it("refusals look identical regardless of the underlying reason", async () => {
    // unknown secret
    const p1 = ctx.mint({ brokerSecret: "unknown" });
    // known secret, destroyed session
    ctx.secretRegistry.seed("sec-2", "s2", "o/r");
    const p2 = ctx.mint({ brokerSecret: "sec-2" });

    const [r1, r2] = await Promise.allSettled([p1, p2]);
    expect((r1 as PromiseRejectedResult).reason).toBeInstanceOf(BrokerTokenRefusedError);
    expect((r2 as PromiseRejectedResult).reason).toBeInstanceOf(BrokerTokenRefusedError);
    // Same error class, same message — indistinguishable.
    expect((r1 as PromiseRejectedResult).reason.message).toBe(
      (r2 as PromiseRejectedResult).reason.message,
    );
  });
});
