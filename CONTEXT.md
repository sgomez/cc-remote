# Domain Glossary: cc-remote

This document defines the core domain concepts and terminology for the `cc-remote` codebase.

## Concepts

### Setup & Configuration Module
The module responsible for gathering environment variables, validating paths, and building the environment. Consolidates both host-side preparations and container-side environments through a single schema-validated interface (`config.json` and compiled `.env`).

### User Identity Adapter
A dynamic adapter at the entrypoint seam. It detects the host user's UID and GID at runtime and configures the container's running user to match. This ensures all generated filesystem changes inside `/workspace` are owned by the host user, avoiding root-permission leakage.

### Reverse Proxy Module
The network seam (optionally managed by Caddy) that handles public HTTPS traffic, provisions Let's Encrypt certificates automatically, and reverse proxies web management actions to the Node.js backend.

### Provider Type
A code-defined catalogue entry describing a kind of AI provider a session can run on. Each type declares its capabilities: whether it supports Remote Control, its Seeding Method, and which fields an Account of this type must supply. The catalogue holds curated entries (`claude`, `deepseek`) plus a generic `custom` entry for any Anthropic-compatible endpoint.

### Account
A user-registered instance of a Provider Type: "my personal DeepSeek", "work Claude". There may be many Accounts per Provider Type. Creating a Session means picking an Account, never a Provider Type directly. An Account is `pending_login` until its credentials are in place, then `ready`. An Account cannot be deleted while Sessions using it exist.

### Account Config Volume
The Docker volume owned by an Account, holding that account's Claude configuration. **Every** Account owns one: it is mounted into every Session of the Account and is the canonical store of the account's credentials and Claude state. Nothing of it is duplicated into the database, and no credential ever comes from the host. It is created and seeded when the Account is registered and destroyed with the Account.

### Seeding Method
How an Account's Claude configuration initially gets into its Account Config Volume so that sessions start without the onboarding wizard. One of: `api-key` (write the minimal wizard-skip config; credentials travel as environment variables), or `oauth` (seed the minimal config, then complete an interactive login in a Login Container).

A third method, `host-mount`, once existed for a singleton `claude-local` Provider Type that bind-mounted the host's `~/.claude` instead of owning a volume. It was removed: the Login Container reaches the same "log in as me" outcome without coupling the deployment to a host path, and the host mount forced a recursive `chown` across a bind mount on every container start. No agent container mounts a host path any more.

### Login Container
An ephemeral container created during registration of an `oauth` Account. It mounts the Account Config Volume and exposes a web terminal where the user completes the interactive Claude login; once credentials appear in the volume the Account becomes `ready` and the container is destroyed.

### Session
A work environment: one agent container plus its own workspace volume, created from a repository and an Account. Docker itself is the source of truth for Sessions: they exist exactly as long as their labelled container exists, and the database stores nothing about them. Every Session offers a web terminal; Sessions whose Account's Provider Type supports it additionally run Remote Control.

### GitHub App
Authenticates the deployment against GitHub as a single entity rather than impersonating a user. A GitHub App replaces the previous OAuth App: its user-to-server flow uses the same OAuth endpoints and is handled by the same better-auth `github` provider, but the `repo` scope is removed from the authorization URL because GitHub Apps ignore scope — permissions come from the App's own configuration. The App owns a private key that is used server-side to mint installation tokens, and this key never enters any agent container.

### Installation Token
A short-lived credential (one hour) scoped to a single GitHub repository. It carries only the permissions the App declares — repository contents write and pull requests write — and is minted by the `GitHubTokenIssuer` port against GitHub's `POST /app/installations/{id}/access_tokens` endpoint. Installation tokens expire after one hour and are never stored; they are fetched on demand from the credential broker.

### Credential Broker
A separate HTTP server (`webapp/server/plugins/broker.ts`) that runs inside the web-manager process on port `4001`, reachable only from the agents network. It accepts a per-Session broker secret and returns a freshly minted installation token scoped to that Session's repository. The broker is never published through Caddy or the compose ports and is unreachable from the control network or the public internet. Its decision logic lives in the `mint-broker-token` core use case, which validates the secret against the `BrokerSecretRegistry`, verifies the Session still exists, and delegates to the `GitHubTokenIssuer` port.

### Per-Session Broker Secret (`CC_BROKER_SECRET`)
A random value generated at Session provision time, recorded by the `BrokerSecretRegistry` port (in-memory), and injected into the Session container's environment alongside the broker's address (`CC_BROKER_URL`). It replaces the durable `GITHUB_TOKEN` as what the container carries. Its blast radius is bounded to "this Session's repository, for one hour at a time" — a compromised Session can call the broker to mint installation tokens only for its own repository. The broker refuses all requests without disclosing which condition failed (unknown secret, destroyed Session, or mismatched repo). The clone helper bypasses the broker and carries a one-shot installation token via `GITHUB_TOKEN` directly, since it is ephemeral and single-purpose.

### Repositories Screen
A UI page in web-manager listing which repositories the deployment's GitHub App has been granted access to. It shows the installation's `repository_selection` (`all` or `selected`) and offers a button that opens GitHub's own installation flow. Creating a Session refuses repositories outside the granted set with an error directing the user to this screen.

### GitHubTokenIssuer
A core port (`core/ports/github-token-issuer.ts`) exposing `issueToken(repo)` returning `{ token, expiresAt }` and `listInstallations()` returning `GitHubInstallation[]`. The port abstracts whether tokens come from the GitHub App or the previous OAuth token adapter; the adapter implementing it signs a JWT with the App's private key and calls GitHub's REST API. This is the only component that can mint tokens — it lives in web-manager, never in an agent container.

### BrokerSecretRegistry
A core port (`core/ports/broker-secret-registry.ts`) that stores per-Session broker secrets in memory. Secrets are registered at Session provision time and looked up by the `mint-broker-token` use case when the broker receives a request. The registry is in-memory only: on a web-manager restart all registered secrets are lost and running Sessions must reconnect. This is acceptable because the agent's credential helper retries on failure and the Session is recreated on the next start.
