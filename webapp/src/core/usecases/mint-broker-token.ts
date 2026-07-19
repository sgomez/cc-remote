// mint-broker-token — the core decision logic the broker endpoint delegates to.
// Validates a per-Session broker secret, resolves the Session's repository,
// and mints a scoped installation token — or refuses, with no information
// about which condition failed. The route is thin glue around this.

import type { BrokerSecretRegistry } from "../ports/broker-secret-registry";
import type { ContainerEngine } from "../ports/container-engine";
import type { GitHubTokenCredential, GitHubTokenIssuer } from "../ports/github-token-issuer";

export type MintBrokerTokenInput = {
  brokerSecret: string;
};

export type MintBrokerTokenDeps = {
  engine: ContainerEngine;
  tokenIssuer: GitHubTokenIssuer;
  secretRegistry: BrokerSecretRegistry;
};

export class BrokerTokenRefusedError extends Error {
  constructor() {
    super("broker token refused");
    this.name = "BrokerTokenRefusedError";
  }
}

/**
 * Look up the broker secret, verify the Session still exists and its repo is
 * grantable, then mint a token. Every refusal path returns the same error so
 * the caller cannot distinguish "unknown secret" from "wrong repo" — the
 * endpoint cannot be used to probe for valid secrets.
 */
export function makeMintBrokerToken(deps: MintBrokerTokenDeps) {
  return async function mintBrokerToken(
    input: MintBrokerTokenInput,
  ): Promise<GitHubTokenCredential> {
    const entry = await deps.secretRegistry.lookup(input.brokerSecret);
    if (!entry) throw new BrokerTokenRefusedError();

    // Verify the Session still exists (it may have been destroyed).
    const container = await deps.engine.getSessionContainer(entry.sessionName);
    if (!container) throw new BrokerTokenRefusedError();

    // The repository is read from the Session's own record, never from the
    // request. A caller cannot ask for a different repository.
    return deps.tokenIssuer.issueToken(entry.repo);
  };
}
