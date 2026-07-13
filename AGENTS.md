# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Dockerized deployment for running [Claude Code](https://github.com/anthropics/claude-code) with Remote Control on a VPS. It has two halves:

1. **`claude-agent` image** (root `Dockerfile` + `entrypoint.sh` + `agent-session.sh` + `console-entrypoint.sh`): a sandboxed container that runs `claude --remote-control`, auto-clones a GitHub repo into `/workspace`, maps its Docker user to the host user, and ships `ttyd` so every session exposes a web terminal.
2. **`web-manager`** (`webapp/`): a self-contained [TanStack Start](https://tanstack.com/start) + [Nitro](https://nitro.build/) app (React SSR + API + SSE + WebSocket terminal proxy on one port, ports-and-adapters core) that lets an authenticated user register **Accounts** and spin up, stop, reset, and destroy many `claude-agent` containers ("Sessions") from a browser, each with its own isolated workspace volume and a built-in web terminal.

The `webapp/` has a full test/lint/type gate (`pnpm test`/`lint`/`check`) run in CI on every PR that touches it (`.github/workflows/ci.yml`); the framework-free `src/core/` is 100% test-driven. The Docker half (images, entrypoints, compose, Caddy) has no automated suite: validate those changes by running the stack (see below) and exercising the affected flow manually.

### Testing policy: respect the pyramid

Unit and integration tests against the **ports and fakes** (`webapp/test/fake-container-engine.ts`) are the normal gate: they are what `pnpm test` runs and what you iterate against. Tests that touch **real infrastructure** (the Docker daemon, better-auth/OAuth, a live WebSocket round-trip) are deliberately *not* in that gate. They live behind a flag (`RUN_DOCKER_IT=1 pnpm exec vitest run --config vitest.integration.config.ts`) and are meant to be run **once, before delivering** a change, not on every iteration.

The recurring cost of infra/port tests is not acceptable, and neither is looping to make a flaky daemon-dependent test pass. Keep end-to-end coverage to the bare minimum that earns its keep, and gate any new infra-touching suite behind the flag from the start. If that suite's cost grows, the sanctioned move is to tag those tests off by default and switch them on all at once for extreme cases, not to keep paying for them on every run. Test the application/port boundary thoroughly, and document infra risk rather than chasing coverage of it.

## Commands

```bash
./setup.sh                          # interactive config wizard -> config.json + .env
docker compose up -d --build        # build and start web-manager (+ caddy, + docker-socket-proxy)
docker compose logs -f              # tail logs
docker compose down                 # stop the stack (running Sessions survive it; stop them from the UI first for a full teardown)
docker compose build --no-cache     # rebuild images from scratch

# web-manager, iterating outside Docker (pnpm workspace; run from the repo root):
pnpm install                        # one lockfile at the root installs the whole workspace
pnpm dev                            # dev server on :4000 (needs env from .env / docker-compose.yaml)
pnpm test                           # vitest (root scripts delegate via `pnpm -F cc-remote-webapp ...`)
pnpm lint                           # biome check
pnpm check                          # tsc --noEmit
pnpm build                          # production build -> webapp/.output/ (node .output/server/index.mjs)

# Shell into a web-manager-created session container:
docker exec -it cc-remote-session-<session_name> bash
```

The `claude-agent` compose service exists **only to build the agent image** (`deploy.replicas: 0`, so `up` never starts it): every agent container is created as a sibling by web-manager. It deliberately carries no compose profile: a profiled service is skipped by `docker compose build`, which used to leave a fresh deployment without the agent image. There is no manually-run single-container flow any more; create Sessions in the web UI.

`setup.sh` itself runs `config.js` inside a throwaway `node:22-slim` container (mounting the repo at `/app`) so the wizard doesn't require Node on the host; it then writes `config.json` (schema-ish record of choices) and compiles `.env` from it, and offers to `docker compose up -d --build` at the end. The wizard asks for **infrastructure only** (domain, GitHub OAuth app, allow-list, Caddy toggle) and derives the rest (auth secret, PUID/PGID, git identity, permission mode). It has no repo, session, or host-path questions: Sessions name themselves and pick their repo in the web UI.

## Architecture

### Sibling containers, not Docker-in-Docker

`web-manager` never runs Docker-in-Docker. It talks to the host's Docker daemon through a **`docker-socket-proxy`** service (`tecnativa/docker-socket-proxy`, read-only bind of `/var/run/docker.sock`, only `CONTAINERS`/`VOLUMES`/`POST`/`EXEC` enabled; `EXEC` because the workspace git probe starts an exec, and `/exec/{id}/start` is not a `/containers` route) reachable at `tcp://docker-socket-proxy:2375` on the **control** network only. No ports are published to the host. The Docker adapter (`webapp/src/adapters/docker/`, `dockerode`) works against that proxy to create/start/stop/remove **sibling** `claude-agent` containers and their volumes. This keeps the web-manager container from needing the raw socket mounted directly, so it runs unprivileged.

### Two networks: the trust boundary

The compose stack declares **two** networks and `web-manager` is multi-homed across both; it is the only bridge:

- **`cc-remote-control`**: `docker-socket-proxy` + `web-manager` + `caddy`.
- **`cc-remote-agents`**: `web-manager` + **every** container the Docker adapter creates (Sessions, clone helpers, Login Containers, the seed/credential-probe helpers). This is what `AGENT_NETWORK` points at, and what `configFromEnv` defaults to.

Why: the socket proxy accepts `POST /containers/create` and does **not** vet request bodies, so a container that can reach `:2375` can create one with `Binds: ["/:/host"]` (host root) and can read every other container's env (`GITHUB_TOKEN`, `ANTHROPIC_*`) via `GET /containers/*/json`. Agent containers run untrusted, AI-generated code in `--permission-mode auto`, so they must never share a network with the proxy. Verified against this daemon: from the agents net the proxy neither resolves by name nor answers on its control-net IP, while multi-homed web-manager reaches both sides.

Do **not** add `com.docker.network.bridge.enable_icc=false` to the agents net: on an ICC-off bridge Docker drops *all* container-to-container traffic (DNS still resolves), which kills `web-manager` → ttyd too, and there is no per-container exemption; it would break the web terminal without adding anything the split does not already give. Consequence, accepted deliberately for a single-user deployment: Sessions can still reach each other's ttyd on the agents net. Closing that needs a network per Session or `DOCKER-USER` rules.

Every builder in `container-specs.ts` sets `NetworkMode: config.network`, including the short-lived helpers, which need no network at all (omitting it would drop them on Docker's default bridge: safe, but safe by accident). A unit test asserts all five.

Upgrading a live deployment: Sessions created before the split are still on the old `cc-remote` network and web-manager can no longer reach their terminal. The migration is `docker network connect cc-remote-agents cc-remote-session-<name>`, **never** `reset`/`destroy`, which delete the workspace volume.

### webapp/ layout (ports and adapters)

The webapp is hexagonal; the Biome `noRestrictedImports` rule forbids `core/` from importing `adapters/`.

- `src/core/` is framework-free and 100% TDD: `domain/` (Provider Type catalogue, Account, Session, seeding), `ports/` (`ContainerEngine`, `AccountRepository`, `Clock`, `IdGenerator`), `usecases/` (create/reset/stop/destroy session, register/delete account, login flow).
- `src/adapters/` is thin, with no business logic: `docker/` (dockerode), `db/` (MikroORM over SQLite), `auth/` (better-auth).
- `src/routes/` holds TanStack Start file routes: UI pages plus API/SSE endpoints (the auth catch-all lives at `src/routes/api/auth/$.ts`).
- `server/routes/` holds Nitro server routes, **WebSocket handlers only** (terminal + login-container proxy).

The repo is a **pnpm workspace** (pnpm 11, pinned in the root `package.json` `packageManager`): the root `pnpm-workspace.yaml` lists `webapp` as the only package and holds all pnpm settings (`allowBuilds` for the native `better-sqlite3`/`esbuild` builds, `overrides`). There is **no `pnpm` field in `webapp/package.json`**. One lockfile lives at the root; install and run scripts from the root (`pnpm -F cc-remote-webapp …`, aliased by the root scripts). The web-manager image builds from the **repo-root context** (`build.context: .`, `dockerfile: webapp/Dockerfile`) so the Dockerfile can see the workspace manifest and the single lockfile.

### Session lifecycle

Every Session is a Docker container named `cc-remote-session-<name>` plus a named volume `cc-remote-workspace-<name>`, tagged with labels including `cc-remote-session=true` and **`cc-remote-account-id`** (the label moved from the legacy `provider-id`). **Docker is the source of truth** for Sessions: they exist exactly as long as their labelled container exists, and the DB stores nothing about them; there is no DB↔Docker reconciliation. Every guarded operation inspects the container and refuses to act unless the session label is present, keeping the API from touching arbitrary containers on the host.

Creating a Session is two-phase because cloning a large repo shouldn't block the main agent container from existing: a lightweight clone-helper container (`cc-remote-session-clone-<name>`, same image with the entrypoint overridden to `git clone … && chown`, labeled `cc-remote-cloning=true`) runs first; on its successful exit the helper is removed and the real `cc-remote-session-<name>` container starts with the full entrypoint. `list-sessions` reports the synthetic `cloning` / `clone_failed` status from the clone-labeled container while the main container doesn't yet exist, and the SSE status stream surfaces the transition. `reset` tears down container + volume and re-runs the two-phase create with a fresh `SESSION_UUID`, giving Claude Code a clean session id and recreating the Remote Control pairing.

Session/repo name inputs are validated against the domain `NAME_REGEX` / `REPO_REGEX` (`src/core/domain/session.ts`) before being interpolated into container/volume names or the clone helper's shell command, which is built from `$GITHUB_REPO`/`$GITHUB_TOKEN` env vars rather than string-concatenating request input.

### Accounts and Account Config Volumes

Creating a Session always picks an **Account** (a user-registered instance of a code-defined Provider Type), never a Provider Type directly. **Every** Account owns an **Account Config Volume** `cc-remote-account-<id>` holding its `~/.claude` + `~/.claude.json`, mounted into every Session of that Account; it is the canonical credential store (nothing is duplicated into the DB) and is seeded at registration per the Provider Type's Seeding Method: `api-key` (write the wizard-skip JSON + inject `ANTHROPIC_*` env) or `oauth` (seed JSON then complete an interactive login in a Login Container). Deleting an Account is blocked while labelled Sessions exist and otherwise removes its volume. See `CONTEXT.md` for the full domain glossary.

**No agent container mounts a host path.** The `claude-local` Provider Type and its `host-mount` Seeding Method were removed (migration `Migration20260712130000` deletes any leftover row, which would otherwise throw `UnknownProviderTypeError` in the accounts UI): the OAuth Login Container gives the same "log in as me" outcome without coupling the deployment to the host's `~/.claude`, and that bind mount was what made `entrypoint.sh`'s recursive `chown` slow on every start. Workspace isolation lives in `cc-remote-workspace-<name>`, identity in `cc-remote-account-<id>`. Volumes, both.

### Auth

Auth is **better-auth v1.6** (`webapp/src/adapters/auth/auth.ts`): GitHub social login (`scope: ["repo", "user:email"]`) served from the TSS catch-all `src/routes/api/auth/$.ts`; the public GitHub OAuth callback is `/api/auth/callback/github`. Access is gated by `ALLOWED_GITHUB_USERS` and **fails closed**: an empty allow-list denies everyone. The allow-list is keyed on the GitHub `login` (captured via `mapProfileToUser` into a `githubLogin` user field) and enforced in a `databaseHooks.session.create.before` hook that runs on **every** sign-in (returning-user included, so removing someone from the list locks them out), with a `user.create.before` belt for the first sign-up. better-auth persists users, sessions and the GitHub access token in **its own tables on the same SQLite file** as the MikroORM domain tables (WAL mode, two connections); sessions therefore survive a container restart. `BETTER_AUTH_SECRET` must be stable in `.env` or every restart invalidates all sessions. `@better-auth/cli generate|migrate` owns better-auth's schema (`auth:*` scripts); MikroORM migrations own the domain tables (`db:migrate`); `pnpm migrate` runs both, applied idempotently by the container entrypoint on start.

The GitHub access token is retrieved server-side (`auth.api.getAccessToken`) and injected as `GITHUB_TOKEN` into spawned agent/clone containers so each can clone/push/pull without SSH keys (see `entrypoint.sh`'s git credential helper, which reads `GITHUB_TOKEN` from the environment at use time instead of writing it into `~/.gitconfig`). The token itself never reaches the browser.

### `entrypoint.sh`: the User Identity Adapter

Runs as root first specifically to `usermod`/`groupmod` the container's `node` user to match host `PUID`/`PGID`, then re-execs itself via `gosu node` so everything after that point (git config, cloning, launching `claude`) runs unprivileged. This is what keeps files written into `/workspace` owned by the host user instead of root. It also: restores `~/.claude.json` from `~/.claude/backups/` if missing, and via a small inline Node script marks `/workspace` as a trusted project, sets `permissions.defaultMode`, `hasCompletedOnboarding` and a default `theme` (every first-run modal blocks startup before Claude reaches the Remote Control bridge, and no one can answer a prompt in a headless container), and sets `remoteControlAtStartup`.

### Remote Control lives in a tmux session, not in the web terminal

`entrypoint.sh` starts the agent **detached in tmux** (`$TMUX_AGENT_SESSION`, defined once as an `ENV` in the Dockerfile) before `exec`ing the container CMD, running `agent-session.sh` → `claude --remote-control=$SESSION_NAME --session-id=$SESSION_UUID --permission-mode=$PERMISSION_MODE` (the `--session-id` pin is what keeps the Remote Control pairing across recreations). `console-entrypoint.sh`, which is what `ttyd` spawns, **attaches** to that session rather than starting Claude.

That split is the whole point: `ttyd -W <cmd>` runs its command **once per connected client**, so an agent started from `console-entrypoint.sh` would only exist while somebody had the browser tab open, and would die on close; Remote Control would never come up on its own. With tmux, Claude is alive for as long as the container is, the web terminal shows the *same* Claude that Remote Control is paired with, and closing the tab merely detaches.

`SESSION_NAME` is the discriminator for "this is an agent Session". A **Login Container** has no Session identity and so gets no tmux session; `console-entrypoint.sh` falls through to a plain interactive `claude`, which is what drives its OAuth login.

### Keep the root-block chowns narrow

They are scoped to `/home/node/.local` (the `claude` symlink root creates) plus a single non-recursive `chown` of the `$ACCOUNT_CONFIG_DIR` mount point (a fresh Docker volume is root-owned there, so the node user could not otherwise write into it). A blanket `chown -R /home/node` (what this used to do) recurses into whatever is mounted under HOME, so it walked the Account Config Volume on **every** container start; back when `claude-local` bind-mounted the host's `~/.claude` it walked that too, which is what made starts slow and silently rewrote host file ownership. `usermod -u` already re-owns home-tree files belonging to the old uid, so the recursion bought nothing.

### Auto Mode

Agent containers default to `claude --permission-mode auto`, which relies on Claude's background safety classifier rather than interactive prompts (there's no TTY approval loop available remotely). Container-level isolation (mounts limited to the session's own workspace + account config volumes, `no-new-privileges`, the two-network split, and the resource limits below) is what makes running unattended in that mode acceptable. See docs/security.md for the full rationale before changing defaults here.

### Resource limits are hardening, and they live in ONE place

`baseHostConfig` (`container-specs.ts`) applies `Memory` + `MemorySwap` + `NanoCpus` + `PidsLimit` + `no-new-privileges` + `NetworkMode` to **all five** builders (session, clone, login, seed, has-credentials). It is one function on purpose: these used to be five inline `HostConfig` literals, and the drift was exactly what you'd predict: only the Session ever got `Memory`, and the clone helper, which unpacks arbitrary repos, had **no `PidsLimit` at all**. Add a limit there, never at a call site. Unit tests assert the full table.

- `MemorySwap` is pinned **equal** to `Memory`: unset, Docker allows 2× the limit in swap, so the cap would not be a cap. `NanoCpus` is applied even to the trivial helpers; "only where it matters" is the reasoning that lost the `PidsLimit`.
- The **value** is derived host-side by `setup.sh`/`config.js` (per-container, ~half of RAM-minus-1GiB, clamped to `[512m, 8g]`; CPU = half the cores). web-manager **cannot** discover host RAM: `docker info` is blocked on the socket proxy (`INFO=0`) and that stays blocked. Override via `config.json` → `resources`, never `.env` (which is recompiled from it).
- `AGENT_MEMORY_LIMIT` / `AGENT_CPU_LIMIT` accept human units (`2g`, `512m`, `1.5g`). Parsing them is not optional: the old code `parseInt`-ed the value, so `2g` silently became a **2-byte** limit. An unparseable value now throws (`AgentLimitError`) from `configFromEnv` *and* from the `validate:env` preflight: fail loud, never fall back to unlimited.
- An OOM-killed Session surfaces honestly: `inspect` reads `State.OOMKilled` → `dead` → the red `error` ("crashed") badge. `listContainers` cannot see that flag (documented in the code); only the inspect path can.

### Config generation flow

`setup.sh` → `config.js` (interactive prompts) → `config.json` (source of truth, gitignored) → compiled `.env` (gitignored, consumed by `docker-compose.yaml`). Don't hand-edit `.env` expecting it to persist across `./setup.sh` reruns; edit `config.json` or answer the prompts instead.

**Host facts are injected as env, because `config.js` cannot see the host**: it runs inside a throwaway `node:22-slim` container (so the wizard needs no Node on the host), which sees neither the host's filesystem layout nor its CPU count. `setup.sh` reads them and passes them in: `HOST_UID`/`HOST_GID` (→ `PUID`/`PGID`) and `HOST_MEM_MB`/`HOST_CPUS` (→ the derived `AGENT_MEMORY_LIMIT`/`AGENT_CPU_LIMIT`). Anything else the wizard must know about the machine goes the same way. This is the *only* place the host's RAM is visible: web-manager can't ask Docker for it (`INFO=0` on the socket proxy).

## Custom agent skills (`.agents/`)

Project-specific agent skills/rules live under `.agents/skills/`. Because `/workspace` inside every agent container is the bind-mounted project repo, any agent running inside a `claude-agent` container automatically discovers and loads these. This is the mechanism for giving remotely-run sessions repo-specific instructions (TDD conventions, review checklists, etc.), not `CLAUDE.md` conventions from other repos.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues (via the `gh` CLI); PRs are not treated as a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
