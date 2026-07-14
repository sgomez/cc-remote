# Security & sandboxing

This deployment runs Claude Code in **Auto Mode** (`--permission-mode auto`): untrusted, AI-generated code executes without interactive approval prompts. This page explains the isolation that makes that acceptable and, just as importantly, [what it does *not* protect you from](#what-this-does-not-protect-you-from).

## Why Auto Mode?

Auto Mode replaces routine permission prompts with a background safety classifier that approves safe operations (reading/editing workspace files, standard git operations) and blocks actions that look destructive, irreversible, or outside the scope of the request. There is no TTY approval loop available remotely, and answering prompts from a phone defeats the point of Remote Control. So the deployment leans on container isolation instead of prompts.

## The sandbox: no host paths, ever

Every agent container mounts exactly two things: the Session's own workspace volume and its Account's config volume. **No host path is ever bind-mounted.** Filesystem changes, commands and tool executions cannot reach the VPS's files or configuration. Containers also run with `no-new-privileges`.

## Network isolation (two networks, one trust boundary)

Filesystem isolation is not enough on its own: an agent that could reach the `docker-socket-proxy` would escape the sandbox entirely. The proxy exposes `POST /containers/create` and does not inspect request bodies, so a single `curl` could create a container with `Binds: ["/:/host"]` (root on the host) and `GET /containers/*/json` would hand over every other container's environment, including your `GITHUB_TOKEN` and `ANTHROPIC_*` keys. A malicious npm dependency or a prompt injection in something the agent reads is enough to try it.

The deployment therefore runs **two** Docker networks:

| Network | Members |
|---|---|
| `cc-remote-control` | `docker-socket-proxy`, `web-manager`, `caddy` |
| `cc-remote-agents` | `web-manager`, every agent container (Sessions, clone helpers, Login Containers, seed helpers) |

`web-manager` is multi-homed and is the **only** bridge between the two: it drives the Docker API over the control network and dials each Session's web terminal over the agents network. From an agent container the proxy does not resolve by name, and a connection to its control-network IP is dropped by the bridge.

## Resource limits (memory, CPU, PIDs)

Isolation stops an agent from reaching *out*. It does nothing about an agent eating the box it sits on: an unbounded container that allocates until the kernel gives up takes down every other Session **and the web manager itself**, the thing you'd open on your phone to stop it. Every container the manager creates therefore carries:

| Limit | Env var | What it stops |
|---|---|---|
| `Memory` + `MemorySwap` | `AGENT_MEMORY_LIMIT` | one runaway agent OOM-ing the host |
| `NanoCpus` | `AGENT_CPU_LIMIT` | a runaway build starving the manager of CPU |
| `PidsLimit` | `AGENT_PIDS_LIMIT` | fork bombs |

`MemorySwap` is pinned **equal** to `Memory`: Docker's way of saying "no swap". Left unset, Docker allows swap up to 2× the limit, so a 2 GiB container could still touch 4 GiB and thrash the host's disk: the cap would look real without being one. (If your kernel has swap accounting disabled, Docker prints a warning at container start; the memory cap still applies.)

**Where the value comes from.** `./setup.sh` reads the host's real RAM and core count and derives the caps:

```
memory = (total RAM − 1 GiB reserved for the host and the stack) / 2, clamped to [512m, 8g]
cpus   = half the host's cores, minimum 1
```

The encoded assumption, so you can disagree with it: **about two Sessions are memory-hot at once**. A 2 GiB VPS lands on the 512 MiB floor, which is about the least Claude Code is usable in. Override via `config.json` (see the [user guide](usage.md#resource-limits)).

A Session the kernel OOM-kills is reported honestly: a red **crashed** badge in the UI, not a mysterious stop.

## What this does not protect you from

The isolation above is real, and it is also **finite**. These are its known limits: deliberate decisions for a **single-user deployment**, not oversights. Read them before you trust this with anything.

### 1. Sessions can reach each other

Every Session exposes an unauthenticated, writable `ttyd` shell on port `7681`, and all Sessions share the `cc-remote-agents` network, so one Session can open a root-equivalent shell in another. Fine when every Session is yours (the premise of a single-user deployment); **not safe for multi-tenant use**. Do not hand Sessions to people you would not hand a shell to.

> The obvious fix does not work: `enable_icc=false` on the agents bridge was tested and rejected: Docker then drops **all** container-to-container traffic on that bridge, with no way to exempt one container, which kills the web terminal itself. Closing this properly needs a network per Session or `DOCKER-USER` iptables rules; neither is implemented.

### 2. What a compromised Session actually gets

The original architecture review finding **S3** ("The injected `GITHUB_TOKEN` is the user's full repo-scoped OAuth token") was the last accepted-risk item of its class. It is now **closed**: Sessions no longer carry a durable `GITHUB_TOKEN`.

What changed:

* A **GitHub App** replaces the OAuth App. Sign-in works identically (better-auth's `github` provider uses the same endpoints), but the `repo` scope is removed from the authorization URL because GitHub Apps ignore it — permissions come from the App's own configuration.
* Git credentials are fetched on **demand** from the **credential broker**: an internal HTTP server on the agents network (`:4001`) that is never exposed through Caddy or the compose published ports. It mints per-repository **installation tokens** that expire one hour after being issued.
* The Session environment carries `CC_BROKER_SECRET` (a random per-Session value generated at provision time) and `CC_BROKER_URL` (the broker's address on the agents network). It carries **no** `GITHUB_TOKEN`.
* The credential helper in `entrypoint.sh` calls the broker on each git operation, caches the returned token in memory, and renews it with a 5-minute safety margin before expiry. A token that has expired is never handed to git.
* The clone helper (ephemeral, single-purpose, lives for the duration of one clone) still receives a one-shot installation token via `GITHUB_TOKEN`. The Login Container receives no GitHub credential of any kind.

#### Honest limits of the new design

What was bought is a **reduction in blast radius and lifetime**, not the elimination of secrets from agent containers:

* The broker secret is **still a durable value** inside the container. A compromised Session can still reach the broker and obtain a valid installation token for its repository. It cannot reach a different Session's repository, and the token it gets covers **only** this Session's repository with **only** the permissions the App declares (contents write + pull requests write).
* A compromised Session **cannot** obtain a token for any other repository. The broker reads the Session's own repository from its provisioning record, never from the request. Every refusal returns the same `403` with no indication of which condition failed (unknown secret, destroyed Session, mismatched repo).
* The broker is **unreachable from outside the agents network**. It binds to all interfaces on `:4001` but that port is not published in the compose file or exposed through Caddy. A Session on the agents network can reach it by Docker's internal DNS; nothing on the control network or the public internet can.
* The one-hour expiry means a leaked token from a compromised Session is only usable for that window — but within that window it grants the full declared permissions on the repository.
* Revoking the GitHub App installation on GitHub stops new tokens from being issued immediately. Existing minted tokens continue to be valid until they expire naturally.
* Pre-existing Sessions created before the migration keep their old `GITHUB_TOKEN` until they are reset. Only Sessions created after the migration benefit from the new model.

### 3. The resource cap is a blast-radius limit, not a fleet total

It bounds *one* container. Nothing stops you from starting ten Sessions, and enough concurrent heavy ones can still overcommit the host. If "~2 memory-hot Sessions at once" is not how you work, override the limits in `config.json` rather than discovering it under load.

## WebSocket, cookie and edge hardening (S4)

A few smaller items from the 2026-07-13 architecture review, closed rather than left open:

- **Origin check on WebSocket upgrades.** The terminal and Login Container WS proxies (`server/routes/ws/terminal/[name].ts`, `server/routes/ws/login/[id].ts`) now reject the upgrade (before any session lookup) unless the `Origin` header matches the deployment's own public URL (`BETTER_AUTH_URL`, the same origin better-auth signs cookies against). A missing `Origin` is rejected too — every browser sends it on a WS handshake, so its absence means the caller isn't the app's own UI. Previously the only defense against cross-site WebSocket hijacking was better-auth's implicit `SameSite=Lax` cookie default; this adds a second, independent check. See `src/server/ws-origin.ts`.
- **Explicit better-auth cookie/origin config.** `trustedOrigins` is now pinned to `BETTER_AUTH_URL` explicitly, and cookie attributes (`sameSite: "lax"`, `httpOnly: true`, and a `BETTER_AUTH_URL`-scheme-derived `useSecureCookies`) are set explicitly in `src/adapters/auth/auth.ts` instead of relying on better-auth's implicit per-environment defaults.
- **Security headers at the edge.** The `Caddyfile` now sends `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'`, and `Referrer-Policy: no-referrer` on every response, and drops the `Server` header.
- **0600 on generated secrets.** `config.js` now `chmod`s both `config.json` and the compiled `.env` to `0600` right after writing them — both hold plaintext secrets (`BETTER_AUTH_SECRET`, the GitHub OAuth client secret) and previously landed at the process's default mode.

## Sibling containers, not Docker-in-Docker

For completeness, the architecture the above protects: the web manager never mounts the raw Docker socket and never runs Docker-in-Docker. It talks to the host daemon through a read-only, route-filtered `docker-socket-proxy` over TCP, and therefore runs unprivileged. Sessions are **sibling** containers created through that proxy, joined only to the agents network.
