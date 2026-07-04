# Claude Code Remote with Headroom Support (VPS Setup)

This project provides a fully configurable Docker setup to run [Claude Code](https://github.com/anthropics/claude-code) with **Remote Control** enabled on a Virtual Private Server (VPS). It includes transparent GitHub authentication, Git identity mapping, automated session backups, and optional context compression via [Headroom](https://github.com/chopratejas/headroom).

---

## Features

- **Multi-Session Web Manager:** A beautiful, responsive glassmorphic dark-mode web portal to create, start, stop, and destroy sibling Claude Code container sessions on-demand.
- **GitHub OAuth & ACL Security:** Exposes the web manager securely behind a single-button "Sign In with GitHub" login flow, restricting access to whitelisted accounts specified in `ALLOWED_GITHUB_USERS`.
- **Automatic HTTPS reverse proxy:** Includes Caddy to automatically provision Let's Encrypt SSL certificates and proxy incoming traffic on ports 80/443 directly to the web portal.
- **Sandboxed Workspaces (Volumes):** Each session is allocated an isolated Docker volume for its workspace, cloned automatically from GitHub on startup. Deleting a session gives you the option to wipe the volume to conserve space.
- **VPS-Ready:** Easily host your Claude Code agent on any Linux VPS.
- **Secure GitHub Auth:** Uses a GitHub Personal Access Token to authenticate all git clone/push/pull commands without exposing SSH keys inside the container.
- **Dockerized Sandbox:** Runs in an isolated Docker container with essential tools (`git`, `curl`, `gh` CLI).
- **Auto Mode Integration:** Configured to run in Claude's Auto Mode (`--permission-mode auto`) by default, utilizing an AI safety classifier to auto-approve safe tasks and eliminate prompt fatigue.
- **Context Compression (Experimental/Optional):** Integrates [Headroom](https://github.com/chopratejas/headroom) to compress tool outputs, command logs, and file structures. This reduces token consumption by **60% to 95%** while retaining answer quality. *Warning: Headroom is experimental, should be used under supervision, and can increase cache write operations.*
- **User Identity Adapter:** Dynamically maps the running container user (UID/GID) to match your host system user. This prevents files created by the agent inside the shared `/workspace` from being owned by `root` on the host.
- **Session & Connection Persistence:** Configures a persistent session name (defaults to the repository name) and an optional unique static UUID, allowing your Remote Control session connection to persist across container re-creations without re-pairing.
- **Interactive Config-Backed Setup:** A clean configuration setup (`setup.sh` + `config.js`) verifies host paths, writes to a schema-validated `config.json`, and compiles variables to `.env` automatically.
- **Auto-Restore Session:** Restores the Claude authentication state from the host machine backups (`.claude.json`) if it gets lost during container recreation.

---

## Prerequisites

Ensure the following tools are installed and configured on your VPS host machine:

- **Docker** and **Docker Compose**
- **Git**
- **Claude Code CLI (`@anthropic-ai/claude-code`)**: Before running the sandbox, you must install the Claude Code client on your VPS host and authenticate (by running `claude` and completing the login process) under the same user account that will execute the container. The Docker setup mounts and reads the session configuration (including `~/.claude.json`) directly from this user's home directory.
- A **GitHub OAuth Application**:
  - To enable "Sign In with GitHub", you must register an OAuth application on your GitHub developer settings page: [GitHub OAuth Apps](https://github.com/settings/developers).
  - Configure the application:
    - **Homepage URL**: `https://<your-vps-domain>` (or `http://localhost:4000` for local test)
    - **Authorization callback URL**: `https://<your-vps-domain>/api/auth/github/callback` (or `http://localhost:4000/api/auth/github/callback` for local test)
  - Copy the generated **Client ID** and **Client Secret** keys to use during the configuration wizard.
- A **GitHub Personal Access Token (PAT)** (optional fallback for non-OAuth listings/manual overrides).

---

## Getting Started

### 1. Install or Download on VPS

Choose one of the following methods to deploy the codebase to your VPS:

#### Option A: Clone the Repository (Recommended)
If you have Git installed on your VPS, clone the repository directly:
```bash
git clone https://github.com/sgomez/cc-remote.git
cd cc-remote
```

#### Option B: Download as a ZIP Archive
If you do not want to configure Git on your VPS, download and extract the ZIP archive:
```bash
curl -L -o cc-remote.zip https://github.com/sgomez/cc-remote/archive/refs/heads/main.zip
unzip cc-remote.zip
cd cc-remote-main
```

#### Updating / Overwriting an Existing Installation
When a new version is released, you can overwrite the previous one while preserving your settings (`config.json` and `.env`, which are ignored by Git and not part of the source):

* **If you cloned via Git:**
  ```bash
  git pull
  docker compose down
  docker compose up -d --build
  ```

* **If you downloaded via ZIP:**
  ```bash
  # Download the latest archive
  curl -L -o cc-remote-new.zip https://github.com/sgomez/cc-remote/archive/refs/heads/main.zip
  
  # Extract and overwrite the files (unzip -o overwrites existing files without prompting)
  unzip -o cc-remote-new.zip
  rm cc-remote-new.zip
  
  # Rebuild and restart the container
  docker compose down
  docker compose up -d --build
  ```

---

### 2. Configure and Prepare

Run the interactive setup script:
```bash
./setup.sh
```

This script runs the interactive setup wizard (`config.js`) inside a temporary Node Docker container to query your VPS settings, validate paths, generate a schema-validated **`config.json`**, and compile the **`.env`** file automatically.

During setup, you will be prompted for:
- Your **GitHub Personal Access Token** (Optional fallback to set name/email).
- Your **VPS Domain Name** (e.g., `cc.example.com`).
- Your **GitHub OAuth Client ID**.
- Your **GitHub OAuth Client Secret**.
- Whitelisted GitHub usernames (`ALLOWED_GITHUB_USERS`, comma-separated) allowed to access the system (e.g. `sgomez`).
- The script automatically outputs a link and a step-by-step console guide to register the GitHub OAuth Application correctly based on the domain you enter.
- Paths for the project directory, Claude configuration directory (`~/.claude`), and session credentials file (`~/.claude.json`) are resolved automatically.
- Whether to enable **Headroom** context compression (experimental, disabled by default). If enabled, the project name for Headroom stats will default to your Session Name.

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

The project features a built-in web management interface (`web-manager` service) proxy-routed securely behind Caddy. It allows you to dynamically spin up, start, stop, and destroy Claude Code container sessions from your browser. Each session gets its own isolated Docker volume and workspace sandbox.

### Accessing the Web Manager

1. Open your browser and navigate to `https://<your-vps-domain>` (or `http://localhost:4000` for local test environments).
2. Click **Sign In with GitHub**.
3. Authorize the application. The backend will verify if your GitHub username is configured in the whitelisted `ALLOWED_GITHUB_USERS` environment variable. If so, a secure signed session cookie is created.

### Sibling Container Architecture

To avoid heavy nesting, performance hits, and security vulnerabilities associated with Docker-in-Docker (DinD), this project uses a **Sibling Containers** architecture:
- The `web-manager` container mounts the host's `/var/run/docker.sock`.
- When you click "Launch Container", the web manager calls the Docker API to create and start a sibling container running the `cc-remote-claude-agent` image.
- Claude credentials (`~/.claude.json` and `~/.claude`) are safely mounted from the host, allowing all dynamically spawned containers to share the same authentication state.

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
| **Open container terminal** | `docker compose exec claude-agent bash` |

---

## How Headroom Integration Works

> [!WARNING]
> **Experimental Feature:** Headroom integration is experimental and should be used under supervision. An increase in cache write operations has been observed when Headroom is enabled. It is disabled by default in the configuration.

When Headroom context compression is enabled during the interactive `setup.sh` script:
1. **Multi-Container Layout:** Docker Compose loads the `headroom` profile (`COMPOSE_PROFILES="headroom"`), spinning up the official `ghcr.io/chopratejas/headroom:latest` proxy container alongside the `claude-agent`.
2. **Transparent Routing:** The `claude-agent` container is configured with the `ANTHROPIC_BASE_URL` environment variable pointing to `http://headroom:8787`. All of Claude Code's Anthropic API requests are automatically routed through the Headroom proxy.
3. **Context Compression:** Headroom intercepts the traffic, compressing large tool outputs, file AST trees, and logs on-the-fly to reduce token usage by **60% to 95%** before transmitting the data to Anthropic.
4. **Metrics Persistence:** Headroom persistent savings statistics and learning logs are saved in `/root/.headroom` within the `headroom` container. By mounting the host folder defined in `HEADROOM_CONFIG_PATH`, all metrics are preserved between container restarts.

If Headroom is disabled:
1. The `headroom` service profile is not loaded, saving host memory and CPU resources.
2. The `claude-agent` container communicates directly with the official Anthropic API endpoint (`https://api.anthropic.com`) as standard.

### Port Safety & Security

By default, the Headroom container port mapping in `docker-compose.yaml` is bound strictly to **`127.0.0.1`** (localhost on your VPS host):
```yaml
ports:
  - "127.0.0.1:${HEADROOM_HOST_PORT:-8787}:8787"
```
This ensures the compression proxy is **not exposed to the public internet** or external networks, maintaining a secure sandbox environment on your VPS.

### Monitoring Metrics & Savings Data

Headroom tracks metrics including token savings, compression ratios, latency overhead, and cost savings in USD. For a detailed guide on the available telemetry and metrics, consult the official [Headroom Metrics Documentation](https://headroom-docs.vercel.app/docs/metrics).

You can monitor and view these metrics in two ways:

#### Option 1: Directly on the VPS Host (CLI)
You can use `curl` to query the proxy's endpoints directly from your VPS command line:

* **Get instant JSON statistics** (lifetime token savings, USD saved, compression ratios):
  ```bash
  curl http://127.0.0.1:8787/stats
  ```
* **Get Prometheus-compatible metrics**:
  ```bash
  curl http://127.0.0.1:8787/metrics
  ```
* **Get durable savings history** (hourly/daily/weekly rollups):
  ```bash
  curl http://127.0.0.1:8787/stats-history
  ```

#### Option 2: From your local Web Browser (Secure SSH Tunnel)
Since the port is bound to `127.0.0.1` and not exposed to the internet, you can access it securely from your local browser via an SSH port-forwarding tunnel:

1. **Establish the tunnel** from your local machine:
   ```bash
   ssh -L 8787:127.0.0.1:8787 user@vps-ip-address
   ```
2. **Access the endpoints in your browser**:
   - Live metrics summary: `http://localhost:8787/stats`
   - Prometheus metrics raw data: `http://localhost:8787/metrics`

---

## Auto Mode & Container Sandboxing

By default, the container runs Claude Code in **Auto Mode** (`--permission-mode auto`).

### Why Auto Mode?
Auto Mode replaces routine permission prompts with a background safety classifier. This classifier evaluates pending tool actions and automatically approves safe operations (like reading or editing files in the workspace and running standard git operations) while blocking actions that appear destructive, irreversible, or outside the scope of your request. This significantly reduces "approval fatigue" during remote control sessions.

### Security & Isolation (The Sandbox)
Because the Claude Code agent runs entirely inside an isolated Docker container, the container acts as a secure sandbox. Any filesystem changes, commands, or tool executions occur within this sandbox and cannot access or modify the host VPS system files or configurations directly. This sandboxed architecture makes running in Auto Mode highly secure and safe.

### Customizing Auto Mode Rules
You can customize the classifier's behavior (e.g. telling it which repositories, buckets, or domains are trusted to avoid false-positive blocks on routine tasks) by defining an `autoMode` settings block in your user configuration.

Since the container automatically mounts your host's Claude credentials file (`CLAUDE_JSON_PATH` which defaults to `~/.claude.json`), you can customize the configuration directly in `~/.claude.json` on the host:

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


