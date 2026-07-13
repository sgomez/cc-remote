# Install guide

Every step from an empty VPS to your first running Session. No prior knowledge assumed beyond being able to SSH into your server and paste commands.

## What you need

- A **VPS** (or any Linux box) with **Docker**, **Docker Compose** and **Git** installed.
- A **domain name** pointing at the VPS if you want HTTPS (recommended). For a local test, `localhost` works with no domain.
- A **GitHub account**. You'll use it both to sign in to the manager and to clone repos into Sessions.
- **Nothing else.** No Node, no Claude Code CLI, no `~/.claude` on the host: Claude authentication happens later, in the browser.

## Step 1: Create a GitHub OAuth App

The manager's "Sign In with GitHub" button needs an OAuth App registered under your GitHub account:

1. Go to <https://github.com/settings/developers> and click **New OAuth App**.
2. Fill in the form:
   - **Application name**: anything, e.g. `cc-remote`.
   - **Homepage URL**: `https://<your-domain>` (or `http://localhost:4000` for a local test).
   - **Authorization callback URL**: `https://<your-domain>/api/auth/callback/github` (or `http://localhost:4000/api/auth/callback/github` for a local test).
3. Click **Register application**.
4. Copy the **Client ID** shown on the app page.
5. Click **Generate a new client secret** and copy the **Client Secret** (GitHub shows it only once).

Keep both values handy: the setup wizard asks for them in Step 3.

## Step 2: Get the code

Clone the latest tagged release (not `main`, which may be unstable):

```bash
git clone --branch v1.0.0-alpha.1 https://github.com/sgomez/cc-remote.git
cd cc-remote
```

No Git on the VPS? Download the release as a ZIP instead:

```bash
curl -L -o cc-remote.zip https://github.com/sgomez/cc-remote/archive/refs/tags/v1.0.0-alpha.1.zip
unzip cc-remote.zip
cd cc-remote-1.0.0-alpha.1
```

## Step 3: Run the setup wizard

```bash
./setup.sh
```

The wizard runs inside a temporary Docker container (that's why no Node is needed on the host), asks a handful of questions, and writes two gitignored files: `config.json` (your answers) and `.env` (compiled from it).

It asks about **infrastructure only**:

| Question | What to answer |
|---|---|
| Enable **Caddy**? | Yes for a real deployment with HTTPS; no if you bring your own reverse proxy or are testing locally. |
| **Domain name** | e.g. `cc.example.com`, or `localhost:4000` for a local test. |
| Caddy **HTTP/HTTPS ports** | The defaults (80/443) are fine; enter `0` for HTTP to disable it. |
| GitHub OAuth **Client ID** | From Step 1. |
| GitHub OAuth **Client Secret** | From Step 1. |
| **Allowed GitHub users** | Comma-separated GitHub usernames allowed to sign in, e.g. `sgomez`. **Leave it empty and nobody can sign in**: the allow-list fails closed. |

Everything else (auth secret, container user IDs, git identity, permission mode, per-agent resource limits) is derived automatically, with no prompt. You can change those later in `config.json` (see the [user guide](usage.md#configuration)); never edit `.env` by hand, it's regenerated on every `./setup.sh` run.

The wizard asks **nothing** about repositories, sessions or Claude accounts: those live in the web UI, not in deployment config.

## Step 4: Start the stack

The wizard offers to start everything at the end. If you declined, or want to do it later:

```bash
docker compose up -d --build
```

This builds two images (the web manager and the agent image Sessions run on) and starts the manager, the Docker socket proxy and, if enabled, Caddy. Watch it come up with:

```bash
docker compose logs -f
```

The manager validates its environment on start and **fails fast with a list of every problem** if something is misconfigured; if it's up and quiet, it's healthy.

## Step 5: Sign in and create your first Session

Everything from here happens **in the browser**:

1. Open `https://<your-domain>` (or `http://localhost:4000`) and click **Sign In with GitHub**. Only usernames on the allow-list get in.
2. Go to **Accounts** and register one, which is what Sessions authenticate Claude with:
   - **`claude` (OAuth)**: the manager opens a terminal in your browser running the normal interactive `claude` login. Complete it once; the credentials are stored in that Account's own Docker volume and the temporary login container is thrown away.
   - **API key**: DeepSeek, or **Custom** for any Anthropic-compatible endpoint (API key, base URL, model).
3. Create a **Session**: give it a name, pick the Account, pick the GitHub repository to clone. The manager clones the repo into a fresh volume, then starts the agent with Remote Control enabled.
4. Drive it from the **Claude Code Remote Control app**, or open the Session's **web terminal**: both show the *same* running Claude.

That's it. Day-to-day operation is covered in the [user guide](usage.md).
