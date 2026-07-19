// Credential broker: a separate HTTP server on the agents network that accepts
// a per-Session secret and returns a freshly minted installation token. The
// decision logic lives in the core use case; this file is thin glue.
//
// It runs as a Nitro plugin rather than a server route so that Caddy/routing
// never touches it: the broker binds to `0.0.0.0` on a dedicated port
// (BROKER_PORT, default 4001) that is NOT exposed through the compose
// published ports or the reverse proxy. Sessions reach it directly via Docker's
// internal DNS on the agents network.

import { createServer } from "node:http";
import { definePlugin } from "nitro";
// The GitHub App token issuer: minted lazily so a misconfigured deployment
// fails at the first broker request rather than at process start, matching the
// pattern in sessions.ts. The adapter is stateless — the same instance is reused.
import { createGitHubAppTokenIssuer } from "~/adapters/github/github-app-token-issuer";
import { loadDeploymentConfig } from "~/config/deployment";
import { BrokerTokenRefusedError, makeMintBrokerToken } from "~/core";
import type { GitHubTokenIssuer } from "~/core/ports/github-token-issuer";
import { brokerSecretRegistry, containerEngine } from "~/server/runtime";

let _tokenIssuer: GitHubTokenIssuer | undefined;

function tokenIssuer(): GitHubTokenIssuer {
  if (!_tokenIssuer) {
    const config = loadDeploymentConfig();
    _tokenIssuer = createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
    });
  }
  return _tokenIssuer;
}

export default definePlugin((nitro) => {
  const port = Number.parseInt(process.env.BROKER_PORT ?? "4001", 10);

  const server = createServer(async (req, res) => {
    // Only POST is accepted.
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", async () => {
      let secret: unknown;
      try {
        secret = JSON.parse(body).secret;
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "bad_request" }));
        return;
      }

      if (typeof secret !== "string" || secret.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "bad_request" }));
        return;
      }

      const mint = makeMintBrokerToken({
        engine: containerEngine(),
        tokenIssuer: tokenIssuer(),
        secretRegistry: brokerSecretRegistry(),
      });

      try {
        const credential = await mint({ brokerSecret: secret });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            token: credential.token,
            expiresAt: credential.expiresAt.toISOString(),
          }),
        );
      } catch (err) {
        if (err instanceof BrokerTokenRefusedError) {
          console.error(
            `[broker] refused secret prefix=${secret.slice(0, 4)}… ` +
              `remote=${req.socket.remoteAddress}`,
          );
          // Indistinguishable from unknown to avoid information leakage.
          res.writeHead(403);
          res.end(JSON.stringify({ error: "forbidden" }));
        } else {
          console.error("[broker] mint failed:", err);
          res.writeHead(502);
          res.end(JSON.stringify({ error: "token_mint_failed" }));
        }
      }
    });
  });

  server.listen(port, () => {
    console.log(`[broker] listening on :${port}`);
  });

  nitro.hooks.hook("close", () => {
    server.close();
  });
});
