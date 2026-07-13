# Docker adapter

Implements the `ContainerEngine` port (`src/core/ports/container-engine.ts`)
over [dockerode], talking to the **docker-socket-proxy** (`tcp://docker-socket-proxy:2375`)
in production, never the raw socket. It is deliberately thin: all branching and
mapping live in pure, unit-tested functions; the class only issues dockerode
calls.

## Layout

| File | Responsibility |
|------|----------------|
| `config.ts` | `DockerAdapterConfig` + `configFromEnv` — deployment facts (image, network, PUID/PGID, hardening limits, host Claude paths) and the mount-point constants. Pure. |
| `container-mapping.ts` | Container-name derivation, the `cc-remote-session` / `cc-remote-login` label guards, label→`SessionContainer`/`LoginContainer` mapping, and `ttydBasePath` / `loginTerminalBasePath`. Pure, TDD'd. |
| `container-specs.ts` | Build dockerode `ContainerCreateOptions` for the main/clone/login/seed/credential-probe containers. All the mount + env branching. Pure, TDD'd. |
| `docker-container-engine.ts` | `DockerContainerEngine implements ContainerEngine` — thin dockerode calls around the builders. Validated by the integration test, not CI. |
| `graceful-shutdown.ts` | `stopRunningSessions` / `registerGracefulShutdown` — SIGTERM stops running Sessions (legacy behaviour). Tested against the core fake. |
| `login-poller.ts` | `startLoginPoller` — recover-on-start + interval poll that drives the Login Container state machine (#14). Pure orchestration over core use cases; tested against the core fakes with fake timers. |

The domain owns every decision (seeding JSON, status synthesis, which volume to
mount); this adapter only reports raw facts (containers, labels, exit codes) and
executes specs the use cases build.

## Network isolation (the trust boundary)

The deployment runs **two** networks (see `docker-compose.yaml`):

- `cc-remote-control` — `docker-socket-proxy` + `web-manager` + `caddy`.
- `cc-remote-agents` — `web-manager` + **every container this adapter creates**.

web-manager is multi-homed and is the only bridge. The proxy exposes
`POST /containers/create` and does **not** vet request bodies, so a container that
could reach `docker-socket-proxy:2375` could create one with `Binds: ["/:/host"]`
(host root) and read every other container's env — `GITHUB_TOKEN`, `ANTHROPIC_*` —
via `GET /containers/*/json`. Agent containers run untrusted, AI-generated code in
`--permission-mode auto`, so keeping them off the proxy's network is what makes
that acceptable.

Consequence for this adapter: **every** builder in `container-specs.ts` — session,
clone helper, login container, seed helper, credential-probe helper — sets
`NetworkMode: config.network` (the agents net). Omitting it on the short-lived
helpers would drop them on Docker's default bridge: not the proxy's network, so
safe, but safe by accident. A unit test asserts all five. Never set
`config.network` to the control network.

## Volume mount strategy (the open design choice from #13)

An **Account Config Volume** `cc-remote-account-<id>` holds *both* the account's
`~/.claude` directory and its `~/.claude.json`. Two ways to expose them in a
Session container were considered:

- **Two volume-subpath binds** — fragile: Docker requires each subpath to already
  exist in the volume at mount time, but a freshly-seeded api-key volume has only
  `.claude.json` (no `.claude/` until Claude Code first runs), so the `.claude`
  subpath bind fails.
- **Single staging mount + entrypoint symlinks** ← **chosen.**

The whole volume is bind-mounted at a staging path
(`ACCOUNT_CONFIG_MOUNT = /home/node/.claude-config`) and `entrypoint.sh` links
`~/.claude` and `~/.claude.json` into it when `ACCOUNT_CONFIG_DIR` is set:

```
cc-remote-account-<id>  ->  /home/node/.claude-config
  /.claude.json         <-  ~/.claude.json      (seeded wizard-skip JSON)
  /.claude/             <-  ~/.claude           (OAuth credentials land here)
```

`entrypoint.sh` **replaces** the image's default empty `~/.claude` dir with the
symlink (a plain `[ -e ] ||` guard would skip it and silently strip OAuth
credential persistence). Because writes go through the symlinks, credentials
written by a Login Container (#14) persist to the volume, where `hasCredentials`
polls for `.claude/.credentials.json` (`CREDENTIALS_MARKER`).

There is no exception: **every** Account owns a config volume, so every session
container gets `ACCOUNT_CONFIG_DIR` set and mounts named volumes only. No host
path is ever bound into an agent container — `buildSessionCreateOptions` has a
test asserting every bind source is a `cc-remote-*` volume. (The retired
`claude-local` / `host-mount` type bind-mounted the host's `~/.claude` instead;
it is gone, along with `CLAUDE_CONFIG_PATH` / `CLAUDE_JSON_PATH`.)

This is the only `entrypoint.sh` change (the PRD forbids others); the shared
`ttydBasePath` constant is the single source of truth for the terminal base path
(`/api/sessions/<name>/terminal`) the WS proxy (#15) must match.

## Login Container flow (#14)

Registering an `oauth` (`claude`) Account leaves it `pending_login` and starts a
**Login Container** `cc-remote-login-<account-id>`: the agent image, mounting
**only** that Account's config volume (no workspace, no repo, no `GITHUB_TOKEN`),
with its default CMD replaced by a ttyd bound to `loginTerminalBasePath`
(`/api/accounts/<id>/login/terminal`, the login analogue of `ttydBasePath`, which
the WS proxy #15 must match). It carries the `cc-remote-login=true` marker — a
separate guard from `cc-remote-session`, so `listSessionContainers` never
surfaces it.

The entrypoint's `ACCOUNT_CONFIG_DIR` symlinks make the interactive `claude`
login write its credentials into the volume; `hasCredentials` polls for
`CREDENTIALS_MARKER`. All the state-machine logic lives in `src/core` use cases
(`start-login`, `check-login`, `poll-logins`, `recover-logins`); this adapter
only supplies the container primitives (`runLoginContainer` / `getLoginContainer`
/ `listLoginContainers` / `removeLoginContainer`) and `startLoginPoller`, which
runs one recovery pass on boot (rediscover orphaned containers by label / flip
logins that completed while down) then polls on an interval. The DB never stores
Claude credentials — the volume is the only credential store.

## Environment

Read by `configFromEnv` (deployment infra; **not** provider/account data):

| Var | Default | Meaning |
|-----|---------|---------|
| `DOCKER_HOST` | raw socket | `tcp://host:port` of the socket proxy |
| `AGENT_IMAGE` | `cc-remote-claude-agent` | agent image for both phases |
| `AGENT_NETWORK` | `cc-remote-agents` | the **agents** network the siblings join (NETWORKS is disabled on the proxy, so it can't be discovered — it must be set) |
| `PUID` / `PGID` | `1000` | host uid/gid for file ownership |
| `AGENT_PIDS_LIMIT` | `4096` | `PidsLimit` hardening |
| `AGENT_MEMORY_LIMIT` | — | bytes; omitted = no limit |
| `AGENT_RESTART_POLICY` | `unless-stopped` | restart policy |
| `GIT_USER_NAME` / `GIT_USER_EMAIL` | — | git identity injected into containers |

## Integration test (local, not CI)

CI runs unit tests only (`src/**/*.test.ts`) — there is no Docker on the runners.
The dockerode-level behaviour is covered by `test/docker-engine.integration.test.ts`
against a real daemon:

```bash
# Build/tag the agent image first (repo root Dockerfile), then:
cd webapp
RUN_DOCKER_IT=1 AGENT_NETWORK=bridge pnpm test:docker
```

`AGENT_NETWORK=bridge` targets a plain local daemon; in the compose deployment
it is `cc-remote-agents` (never the control network). The suite seeds a volume and verifies the JSON,
exercises credential detection, and runs the full create → list → stop → start →
destroy lifecycle with label/mount assertions, cleaning up all `it-*` resources.

[dockerode]: https://github.com/apocas/dockerode
