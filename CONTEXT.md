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
