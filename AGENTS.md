# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Dockerized deployment for running [Claude Code](https://github.com/anthropics/claude-code) with Remote Control on a VPS. It has two halves:

1. **`claude-agent` image** (root `Dockerfile` + `entrypoint.sh`) — a sandboxed container that runs `claude --remote-control`, auto-clones a GitHub repo into `/workspace`, and maps its Docker user to the host user.
2. **`web-manager`** (`web/`) — a Node/Express backend + vanilla-JS frontend that lets an authenticated user spin up, stop, and destroy many `claude-agent` containers ("sessions") from a browser, each with its own isolated workspace volume.

There is no application test suite or linter configured (`web/package.json` only defines a `start` script). Validate changes by running the stack (see below) and exercising the affected flow manually.

## Commands

```bash
./setup.sh                          # interactive config wizard -> config.json + .env
docker compose up -d --build        # build and start web-manager (+ caddy, + docker-socket-proxy)
docker compose logs -f              # tail logs
docker compose down                 # stop the stack
docker compose build --no-cache     # rebuild images from scratch

# Web manager backend, iterating outside Docker:
cd web && npm install && npm start  # requires env vars from .env / docker-compose.yaml to be set manually

# Single manually-run agent container (not the web-managed multi-session flow):
docker compose --profile agent up -d claude-agent
docker compose --profile agent exec claude-agent bash

# Shell into a web-manager-created session container:
docker exec -it cc-remote-session-<session_name> bash
```

`setup.sh` itself runs `config.js` inside a throwaway `node:22-slim` container (mounting the repo at `/app`) so the wizard doesn't require Node on the host; it then writes `config.json` (schema-ish record of choices) and compiles `.env` from it, and offers to `docker compose up -d --build` at the end.

## Architecture

### Sibling containers, not Docker-in-Docker

`web-manager` never runs Docker-in-Docker. It talks to the host's Docker daemon through a **`docker-socket-proxy`** service (`tecnativa/docker-socket-proxy`, read-only bind of `/var/run/docker.sock`, only `CONTAINERS`/`VOLUMES`/`POST` enabled) reachable at `tcp://docker-socket-proxy:2375` on the compose network only — no ports are published to the host. `web/server.js` uses `dockerode` against that proxy to create/start/stop/remove **sibling** `claude-agent` containers and their volumes. This keeps the web-manager container from needing the raw socket mounted directly.

### Session lifecycle (`web/server.js`)

Every session is a Docker container named `cc-remote-session-<name>` plus a named volume `cc-remote-workspace-<name>`, tagged with labels `cc-remote-session=true`, `cc-remote-session-name`, `cc-remote-repo`. Anything that operates on a session (`getSessionContainer`) inspects the container and refuses to act unless that label is present — this is the boundary that keeps the API from touching arbitrary containers on the host.

Creating a session is two-phase because cloning a large repo shouldn't block the main agent container from existing:
1. `startSessionCloning` creates a lightweight helper container `cc-remote-session-clone-<name>` (same `claude-agent` image, but with `Entrypoint` overridden to just run `git clone ... && chown`), labeled `cc-remote-cloning=true`.
2. The backend awaits the helper container's exit asynchronously; on success it removes the helper and calls `createMainAgentContainer` to start the real `cc-remote-session-<name>` container with the full entrypoint (`claude --remote-control`).

`GET /api/sessions` reports a synthetic `cloning` / `clone_failed` status by looking for the clone-labeled container when the main container doesn't exist yet. `reset` tears down both the container and its volume and re-runs the two-phase create with a fresh `SESSION_UUID`, giving Claude Code a clean session id.

Session/repo name inputs are validated against `NAME_REGEX` / `REPO_REGEX` before being interpolated into container names or shell commands (the clone helper's `Cmd` is a shell string built from `$GITHUB_REPO`/`$GITHUB_TOKEN` env vars, not string concatenation of the request body).

### Auth

GitHub OAuth (`/api/auth/login` → GitHub → `/api/auth/github/callback`), CSRF-protected via a random `state` bound to an `oauth_state` cookie. Access is gated by `ALLOWED_GITHUB_USERS` and **fails closed**: an empty allow-list denies everyone rather than admitting everyone. On success the backend keeps `{ username, accessToken, expiresAt }` in an in-memory `sessions` Map keyed by a random `sid`, and issues a JWT cookie (`auth_token`) that carries only `{ authenticated, username, sid }` — the GitHub access token itself never leaves the server. `requireAuth` re-resolves `req.user.accessToken` from that server-side map on every request. Session state is process-local (a restart invalidates all logged-in users); `JWT_SECRET` should be set in `.env` or every restart also invalidates sessions by generating a fresh random secret.

The GitHub access token captured at login is later injected as `GITHUB_TOKEN` into spawned agent/clone containers so each one can clone/push/pull without SSH keys (see `entrypoint.sh`'s git credential helper, which reads `GITHUB_TOKEN` from the environment at use time instead of writing it into `~/.gitconfig`).

### `entrypoint.sh` — User Identity Adapter

Runs as root first specifically to `usermod`/`groupmod` the container's `node` user to match host `PUID`/`PGID`, then re-execs itself via `gosu node` so everything after that point (git config, cloning, launching `claude`) runs unprivileged. This is what keeps files written into the bind-mounted `/workspace` owned by the host user instead of root. It also: restores `~/.claude.json` from `~/.claude/backups/` if missing, marks `/workspace` as a trusted project and sets `permissions.defaultMode` directly in `~/.claude.json` via a small inline Node script, then execs `claude --remote-control[=SESSION_NAME] --permission-mode=$PERMISSION_MODE` (with `--session-id` pinned when `SESSION_UUID` is set, for remote-control pairing persistence across recreations).

### Shared host mounts

`CLAUDE_CONFIG_PATH` (`~/.claude`) and `CLAUDE_JSON_PATH` (`~/.claude.json`) are bind-mounted **read-write** into every agent/web-manager container so all sessions share one authenticated Claude identity from the host. This is a deliberate tradeoff documented inline in `docker-compose.yaml`: a compromised session container can alter the host's Claude config. Per-session isolation instead lives in the dedicated `cc-remote-workspace-<name>` volume.

### Auto Mode

Agent containers default to `claude --permission-mode auto`, which relies on Claude's background safety classifier rather than interactive prompts (there's no TTY approval loop available remotely). Container-level isolation (bind mounts limited to workspace + Claude config, `no-new-privileges`, `PidsLimit`) is what makes running unattended in that mode acceptable — see README "Auto Mode & Container Sandboxing" for the full rationale before changing defaults here.

### Config generation flow

`setup.sh` → `config.js` (interactive prompts) → `config.json` (source of truth, gitignored) → compiled `.env` (gitignored, consumed by `docker-compose.yaml`). Don't hand-edit `.env` expecting it to persist across `./setup.sh` reruns; edit `config.json` or answer the prompts instead. `config.js`'s `resolvePath` resolves `~` against `HOST_HOME` and relative paths against `HOST_PWD`, both injected by `setup.sh` since `config.js` itself runs inside a throwaway container that doesn't see the real host filesystem layout.

## Custom agent skills (`.agents/`)

Project-specific agent skills/rules live under `.agents/skills/`. Because `/workspace` inside every agent container is the bind-mounted project repo, any agent running inside a `claude-agent` container automatically discovers and loads these — this is the mechanism for giving remotely-run sessions repo-specific instructions (TDD conventions, review checklists, etc.), not `CLAUDE.md` conventions from other repos.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues (via the `gh` CLI); PRs are not treated as a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
