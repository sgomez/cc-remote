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
| `container-mapping.ts` | Container-name derivation, the `cc-remote-session` label guard, label→`SessionContainer` mapping, and `ttydBasePath`. Pure, TDD'd. |
| `container-specs.ts` | Build dockerode `ContainerCreateOptions` for the main/clone/seed/credential-probe containers. All the mount + env branching. Pure, TDD'd. |
| `docker-container-engine.ts` | `DockerContainerEngine implements ContainerEngine` — thin dockerode calls around the builders. Validated by the integration test, not CI. |
| `graceful-shutdown.ts` | `stopRunningSessions` / `registerGracefulShutdown` — SIGTERM stops running Sessions (legacy behaviour). Tested against the core fake. |

The domain owns every decision (seeding JSON, status synthesis, which volume to
mount); this adapter only reports raw facts (containers, labels, exit codes) and
executes specs the use cases build.

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

`claude-local` (Provider Type `seeding: host-mount`) is the exception: no config
volume, `ACCOUNT_CONFIG_DIR` unset, and the host's onboarded config bind-mounted
directly at `~/.claude` + `~/.claude.json` (paths from `CLAUDE_CONFIG_PATH` /
`CLAUDE_JSON_PATH`). A deployment without those env vars simply cannot run
claude-local Sessions — building such a spec throws.

This is the only `entrypoint.sh` change (the PRD forbids others); the shared
`ttydBasePath` constant is the single source of truth for the terminal base path
(`/api/sessions/<name>/terminal`) the WS proxy (#15) must match.

## Environment

Read by `configFromEnv` (deployment infra; **not** provider/account data):

| Var | Default | Meaning |
|-----|---------|---------|
| `DOCKER_HOST` | raw socket | `tcp://host:port` of the socket proxy |
| `AGENT_IMAGE` | `cc-remote-claude-agent` | agent image for both phases |
| `AGENT_NETWORK` | `cc-remote_default` | compose network the siblings join (NETWORKS is disabled on the proxy, so it can't be discovered — it must be set) |
| `PUID` / `PGID` | `1000` | host uid/gid for file ownership |
| `AGENT_PIDS_LIMIT` | `4096` | `PidsLimit` hardening |
| `AGENT_MEMORY_LIMIT` | — | bytes; omitted = no limit |
| `AGENT_RESTART_POLICY` | `unless-stopped` | restart policy |
| `GIT_USER_NAME` / `GIT_USER_EMAIL` | — | git identity injected into containers |
| `CLAUDE_CONFIG_PATH` / `CLAUDE_JSON_PATH` | — | host-mount sources for claude-local |

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
use the real network name. The suite seeds a volume and verifies the JSON,
exercises credential detection, and runs the full create → list → stop → start →
destroy lifecycle with label/mount assertions, cleaning up all `it-*` resources.

[dockerode]: https://github.com/apocas/dockerode
