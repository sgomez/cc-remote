# Claude Code Remote Session Manager (VPS Setup)

This project provides a fully configurable Docker setup to run [Claude Code](https://github.com/anthropics/claude-code) with **Remote Control** enabled on a Virtual Private Server (VPS). It includes transparent GitHub authentication, Git identity mapping, and automated session backups.

<p align="center">
  <img src="docs/portal.png" alt="Claude Code Remote Session Manager" width="49%" />
  <img src="docs/claude-code.png" alt="Claude Code Remote Interface" width="49%" />
</p>

> [!WARNING]
> The `main` branch is under active development and may be unstable. For deployment, use the latest tagged release (currently `v0.1.0`) instead of `main` — see [Getting Started](#1-install-or-download-on-vps).

---

## Features

- **Multi-Session Web Manager:** A beautiful, responsive glassmorphic dark-mode web portal to create, start, stop, and destroy sibling Claude Code container sessions on-demand.
- **GitHub OAuth & ACL Security:** Exposes the web manager securely behind a single-button "Sign In with GitHub" login flow, restricting access to whitelisted accounts specified in `ALLOWED_GITHUB_USERS`.
- **Automatic HTTPS reverse proxy:** Includes Caddy to automatically provision Let's Encrypt SSL certificates and proxy incoming traffic on ports 80/443 directly to the web portal.
- **Sandboxed Workspaces (Volumes):** Each session is allocated an isolated Docker volume for its workspace, cloned automatically from GitHub on startup. Deleting a session gives you the option to wipe the volume to conserve space.
- **VPS-Ready:** Easily host your Claude Code agent on any Linux VPS.
- **Secure GitHub Auth:** Uses the dynamically obtained GitHub OAuth token to authenticate git clone/push/pull commands transparently, avoiding exposing SSH keys inside the container.
- **Dockerized Sandbox:** Runs in an isolated Docker container with essential tools (`git`, `curl`, `gh` CLI).
- **Auto Mode Integration:** Configured to run in Claude's Auto Mode (`--permission-mode auto`) by default, utilizing an AI safety classifier to auto-approve safe tasks and eliminate prompt fatigue.

- **User Identity Adapter:** Dynamically maps the running container user (UID/GID) to match your host system user. This prevents files created by the agent inside the shared `/workspace` from being owned by `root` on the host.
- **Session & Connection Persistence:** Configures a persistent session name (defaults to the repository name) and an optional unique static UUID, allowing your Remote Control session connection to persist across container re-creations without re-pairing.
- **Interactive Config-Backed Setup:** A clean configuration setup (`setup.sh` + `config.js`) verifies host paths, writes to a schema-validated `config.json`, and compiles variables to `.env` automatically.
- **Auto-Restore Session:** Restores the Claude authentication state from the host machine backups (`.claude.json`) if it gets lost during container recreation.

---

## Prerequisites

Ensure the following tools are installed and configured on your VPS host machine:

- **Docker** and **Docker Compose**
- **Git**
- **No Claude Code CLI on the host.** Nothing about your host's Claude config is used: each Account authenticates inside its own Docker volume, either from an API key or by completing an interactive `claude` login in an ephemeral Login Container from the browser.
- A **GitHub OAuth Application**:
  - To enable "Sign In with GitHub", you must register an OAuth application on your GitHub developer settings page: [GitHub OAuth Apps](https://github.com/settings/developers).
  - Configure the application:
    - **Homepage URL**: `https://<your-vps-domain>` (or `http://localhost:4000` for local test)
    - **Authorization callback URL**: `https://<your-vps-domain>/api/auth/callback/github` (or `http://localhost:4000/api/auth/callback/github` for local test)
  - Copy the generated **Client ID** and **Client Secret** keys to use during the configuration wizard.

---

## Getting Started

### 1. Install or Download on VPS

Choose one of the following methods to deploy the codebase to your VPS:

> **Note:** `main` is the active development branch and may be unstable. For a stable deployment, use the latest tagged release (currently `v0.1.0`) as shown below.

#### Option A: Clone the Repository (Recommended)
If you have Git installed on your VPS, clone the latest stable release directly:
```bash
git clone --branch v0.1.0 https://github.com/sgomez/cc-remote.git
cd cc-remote
```

#### Option B: Download as a ZIP Archive
If you do not want to configure Git on your VPS, download and extract the ZIP archive for the latest stable release:
```bash
curl -L -o cc-remote.zip https://github.com/sgomez/cc-remote/archive/refs/tags/v0.1.0.zip
unzip cc-remote.zip
cd cc-remote-0.1.0
```

#### Updating / Overwriting an Existing Installation
When a new version is released, you can overwrite the previous one while preserving your settings (`config.json` and `.env`, which are ignored by Git and not part of the source):

* **If you cloned via Git:**
  ```bash
  git fetch --tags
  git checkout v0.1.0
  docker compose down
  docker compose up -d --build
  ```

* **If you downloaded via ZIP:**
  ```bash
  # Download the latest release archive
  curl -L -o cc-remote-new.zip https://github.com/sgomez/cc-remote/archive/refs/tags/v0.1.0.zip
  
  # Extract and overwrite the files (unzip -o overwrites existing files without prompting)
  unzip -o cc-remote-new.zip
  rm cc-remote-new.zip
  
  # Rebuild and restart the container
  docker compose down
  docker compose up -d --build
  ```

##### One-time step when upgrading across the network split

The stack used to put `web-manager`, the `docker-socket-proxy` and every agent container on a single `cc-remote` network. It now uses two (`cc-remote-control` and `cc-remote-agents` — see [Network isolation](#network-isolation-two-networks-one-trust-boundary)). New Sessions land on `cc-remote-agents` automatically; **Sessions you created before the upgrade are still on the old network**, so `web-manager` can no longer reach their web terminal.

Attach each pre-existing Session to the new agents network once — this is safe and preserves the workspace:

```bash
docker network connect cc-remote-agents cc-remote-session-<session_name>
```

Do **not** use *Reset* or *Destroy* for this: both delete the Session's workspace volume. (If you would rather start clean, destroying and recreating the Session also works — but only if you do not need what is in its workspace.)

---

### 2. Configure and Prepare

Run the interactive setup script:
```bash
./setup.sh
```

This script runs the interactive setup wizard (`config.js`) inside a temporary Node Docker container to query your VPS settings, validate paths, generate a schema-validated **`config.json`**, and compile the **`.env`** file automatically.

During setup, you will be prompted for:
- Whether to enable the **Caddy** reverse proxy.
- Your **VPS Domain Name** (e.g., `cc.example.com` or `localhost:4000`).
- The **Caddy HTTP and HTTPS ports** (if Caddy is enabled, HTTP can be disabled with port `0`).
- Your **GitHub OAuth Client ID**.
- Your **GitHub OAuth Client Secret**.
- Whitelisted GitHub usernames (`ALLOWED_GITHUB_USERS`, comma-separated) allowed to access the system (e.g. `sgomez`).

Note that:
- The script automatically outputs a link and a step-by-step console guide to register the GitHub OAuth Application correctly based on the domain you enter.
- Paths for the project directory, Claude configuration directory (`~/.claude`), and session credentials file (`~/.claude.json`) are resolved automatically.
- Git identity (name and email) is automatically resolved from your host's global Git settings or falls back to defaults.

### 3. Run the Container

If you did not opt to launch the container automatically at the end of `setup.sh`, you can build and start it manually:

```bash
docker compose up -d --build
```

### 4. Check Logs and Authenticate

If you followed the prerequisites and logged in to Claude on your VPS host (`claude` or `claude login`), your authentication state (`~/.claude.json`) is mounted automatically, and the agent will start authenticated.

Otherwise, if you need to authenticate inside the container, view the container logs to find the authentication URL:

```bash
docker compose logs -f
```

Click the provided URL, sign in with your Anthropic account, copy the authentication token, and execute it into the container (if the remote control asks for it), or ensure your host configuration (`~/.claude.json`) is correctly populated under the same user running the docker commands.

---

## Web Manager & Multi-Session Portal

The project features a built-in web management interface (`web-manager` service) proxy-routed securely behind Caddy. It allows you to dynamically spin up, start, stop, and destroy Claude Code container sessions from your browser, each with a built-in web terminal. Each session gets its own isolated Docker volume and workspace sandbox.

The `web-manager` is a self-contained TanStack Start + Nitro app (`webapp/`) built into a single Node 24 image serving the UI, API, SSE status streams and the terminal WebSocket proxy on one port (4000).

### Deployment flow

1. `./setup.sh` — the wizard collects **infrastructure** only: your domain, the GitHub OAuth app, the allow-list, and whether to run Caddy. Everything else is derived (auth secret, PUID/PGID, git identity, permission mode). It asks nothing about repos, sessions, providers or host paths — those are per-Session or per-Account state created in the UI.
2. `docker compose up -d --build` — builds the agent image, then brings up `caddy` + `docker-socket-proxy` + `web-manager`. On start the container validates its environment (failing fast and listing every problem if misconfigured) and applies database migrations idempotently.
3. Open the web UI, sign in with GitHub, and **create Accounts** — an OAuth `claude` Account (you complete the `claude` login in an ephemeral Login Container's web terminal, right from the browser) or an API-key one (DeepSeek, or any Anthropic-compatible endpoint via `custom`). Then create Sessions against an Account.

Accounts and login sessions are stored in **SQLite** on the persisted `cc-remote-db` Docker volume, so they survive `docker compose down && up`. Per-Account Claude configuration lives in its own `cc-remote-account-<id>` volume. There is no on-disk provider config file and no host Claude config — everything provider/account related lives in the database and its volume.

### Accessing the Web Manager

1. Open your browser and navigate to `https://<your-vps-domain>` (or `http://localhost:4000` for local test environments).
2. Click **Sign In with GitHub**.
3. Authorize the application. The backend verifies your GitHub username against the whitelisted `ALLOWED_GITHUB_USERS` (fail-closed: an empty list denies everyone). If allowed, a secure session cookie is created.

### Sibling Container Architecture

To avoid heavy nesting, performance hits, and security vulnerabilities associated with Docker-in-Docker (DinD), this project uses a **Sibling Containers** architecture:
- The `web-manager` container never mounts the raw Docker socket. It talks to the host daemon through the read-only `docker-socket-proxy` over TCP (`tcp://docker-socket-proxy:2375`), and therefore runs unprivileged.
- When you create a Session, the web manager calls the Docker API to create and start a sibling container running the `cc-remote-claude-agent` image, joined to the **`cc-remote-agents`** network so the terminal WebSocket proxy can reach it. The `docker-socket-proxy` is **not** on that network — it lives on `cc-remote-control` with `web-manager` and Caddy, so no agent container can reach the Docker API (see [Network isolation](#network-isolation-two-networks-one-trust-boundary)).
- Claude credentials always come from the Session's **Account Config Volume** (API-key seeding or an OAuth login). **No agent container ever bind-mounts a host path** — the only mounts are that Account's config volume and the Session's own workspace volume.

### Session Workspace Lifecycle

- **Isolation**: Each container session runs in isolation, mounting a dedicated Docker volume named `cc-remote-workspace-<session_name>`.
- **Auto-Cloning**: The entrypoint script automatically clones the specified GitHub repository into the empty volume on container startup.
- **Teardown**: When you delete a session from the web dashboard, you are prompted with a checkbox to also delete the associated workspace volume. Keeping the volume unchecked preserves the code state for future runs.
- **Dynamic GitHub Authentication**: The OAuth token obtained during your login is dynamically injected as the `GITHUB_TOKEN` environment variable in the dynamically generated Claude Code session containers, allowing seamless access to clone, fetch, and pull all repositories (personal and organizational) you have access to in your account.

---

## Management Commands

| Action | Command |
|---|---|
| **Start in background** | `docker compose up -d` |
| **Stop container** | `docker compose down` |
| **View logs** | `docker compose logs -f` |
| **Rebuild container** | `docker compose build --no-cache` |
| **Open container terminal (web session)** | `docker exec -it cc-remote-session-<session_name> bash` |

---



## Auto Mode & Container Sandboxing

By default, the container runs Claude Code in **Auto Mode** (`--permission-mode auto`).

### Why Auto Mode?
Auto Mode replaces routine permission prompts with a background safety classifier. This classifier evaluates pending tool actions and automatically approves safe operations (like reading or editing files in the workspace and running standard git operations) while blocking actions that appear destructive, irreversible, or outside the scope of your request. This significantly reduces "approval fatigue" during remote control sessions.

### Security & Isolation (The Sandbox)
Because the Claude Code agent runs entirely inside an isolated Docker container, the container acts as a secure sandbox. It mounts **no host path at all** — only its own two named volumes (the Session's workspace and its Account's config) — so filesystem changes, commands, and tool executions cannot reach the host VPS's files or configuration. This sandboxed architecture is what makes running in Auto Mode acceptable.

### Network isolation (two networks, one trust boundary)

Filesystem isolation is not enough on its own: an agent that could open a TCP connection to the `docker-socket-proxy` would escape the sandbox entirely. The proxy exposes `POST /containers/create` and **does not inspect request bodies**, so a single `curl` could create a container with `Binds: ["/:/host"]` — root on the host — and `GET /containers/*/json` would hand over every other container's environment, including your `GITHUB_TOKEN` and any `ANTHROPIC_*` keys. Agent containers run untrusted, AI-generated code, so a malicious npm dependency or a prompt injection in something the agent reads is enough to try it.

The deployment therefore runs **two** Docker networks:

| Network | Members |
|---|---|
| `cc-remote-control` | `docker-socket-proxy`, `web-manager`, `caddy` |
| `cc-remote-agents` | `web-manager`, every agent container (Sessions, clone helpers, Login Containers, seed helpers) |

`web-manager` is multi-homed and is the **only** bridge between the two: it drives the Docker API over the control network and dials each Session's web terminal (`<container>:7681`) over the agents network. From an agent container the proxy does not resolve by name, and a connection to its control-network IP is dropped by the bridge. This — together with the mount policy above, `no-new-privileges` and `PidsLimit` — is what makes Auto Mode acceptable.

### Resource limits (memory, CPU, PIDs)

Isolation stops an agent from reaching *out*. It does nothing about an agent eating the box it sits on: an unbounded container that allocates until the kernel gives up takes down every other Session **and `web-manager` itself** — the thing you would open on your phone to stop it. AI-generated code in Auto Mode gets to run `make -j`, install dependencies and write loops, so this is an availability problem, not a hypothetical one.

Every container the manager creates — Sessions, clone helpers, Login Containers, and the short-lived volume helpers — therefore carries:

| Limit | Env var | What it stops |
|---|---|---|
| `Memory` + `MemorySwap` | `AGENT_MEMORY_LIMIT` | one runaway agent OOM-ing the host |
| `NanoCpus` | `AGENT_CPU_LIMIT` | a runaway build starving `web-manager` of CPU |
| `PidsLimit` | `AGENT_PIDS_LIMIT` | fork bombs |

`MemorySwap` is pinned **equal** to `Memory`, which is Docker's way of saying "no swap". Left unset, Docker allows swap up to 2× the limit, so a 2 GiB container could still touch 4 GiB and thrash the host's disk — the cap would look real without being one. (If your kernel has swap accounting disabled, Docker prints a warning at container start; the memory cap still applies.)

**Where the value comes from.** There is no universal default — it depends on your VPS. `./setup.sh` reads the host's real RAM and core count and **derives** the caps for you (no prompt, like the auth secret and PUID/PGID):

```
memory = (total RAM − 1 GiB reserved for the host, web-manager, Caddy and the socket proxy) / 2
         clamped to [512m, 8g]
cpus   = half the host's cores, minimum 1
```

The assumption being encoded, so you can disagree with it: **about two Sessions are memory-hot at once**. This is a **per-container** cap, not a fleet total — it limits the blast radius of *one* bad agent; it is not an admission controller, and enough simultaneous heavy Sessions can still overcommit the host. A 2 GiB VPS lands on the 512 MiB floor, which is about the least Claude Code is usable in; below that, don't bother.

**How to change it.** Edit the `resources` block in `config.json` and rerun `./setup.sh`:

```json
"resources": { "agentMemoryLimit": "2g", "agentCpuLimit": 2 }
```

Do **not** edit `.env` — it is *compiled* from `config.json` on every `./setup.sh` run and your edit will be overwritten. Memory accepts human units (`512m`, `2g`, `1.5g`) or raw bytes; the minimum is Docker's own 6 MiB. An invalid value is rejected by the wizard, and `web-manager` refuses to start on one rather than silently running every agent unbounded. Setting `0` disables a limit — you are then back to the failure mode this section exists to prevent.

A Session the kernel OOM-kills is reported honestly: it shows up as a red **crashed** badge in the UI, not as a mysterious stop.

Two deliberate non-goals, stated plainly:

- **No `enable_icc=false` on the agents network.** It looks like the obvious extra hardening, but on an ICC-disabled bridge Docker drops *all* container-to-container traffic (DNS still resolves; connections just hang), and there is no way to exempt one container. It would break `web-manager` → ttyd, i.e. the web terminal, while adding nothing the network split does not already provide.
- **Agent ↔ agent traffic is still possible.** Sessions share the agents network, so one Session can reach another Session's ttyd (an unauthenticated shell) on port 7681. That is accepted for a single-user deployment: every Session belongs to the same operator. Closing it would need a network per Session (or `DOCKER-USER` iptables rules) and is not implemented.

### Customizing Auto Mode Rules
You can customize the classifier's behavior (e.g. telling it which repositories, buckets, or domains are trusted to avoid false-positive blocks on routine tasks) by defining an `autoMode` settings block in your user configuration.

That configuration lives in the Account's own `cc-remote-account-<id>` volume (seeded at registration and, for OAuth Accounts, populated by the Login Container). Edit it from inside any session's web terminal — the change applies to every Session of that Account.

Example block:

```json
{
  "permissions": {
    "defaultMode": "auto"
  },
  "autoMode": {
    "environment": [
      "$defaults",
      "Source control: github.com/your-org and all repos under it",
      "Trusted internal domains: *.internal.example.com"
    ]
  }
}
```

You can change the permission mode to other values (e.g., `default`, `acceptEdits`, `plan`, `dontAsk`, or `bypassPermissions` if you want to bypass prompts entirely in your sandbox) by setting the `PERMISSION_MODE` environment variable in your `.env` or during the interactive `./setup.sh` configuration.

---

## Custom Skills and Rules (.agents)

For custom agent instructions, workflows, or rules (such as TDD guidelines, code style rules, or custom skills) to be loaded and used by the agent inside the container, they must be located inside the project repository under the `.agents/` folder.

Since the container mounts your project repository to `/workspace`, the agent will automatically discover, load, and follow these rules and skills when it initializes.


