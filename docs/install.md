# Install guide

Every step from an empty VPS to your first running Session. No prior knowledge assumed beyond being able to SSH into your server and paste commands.

## What you need

- A **VPS** (or any Linux box) with **Docker**, **Docker Compose** and **Git** installed.
- A **domain name** pointing at the VPS if you want HTTPS (recommended). For a local test, `localhost` works with no domain.
- A **GitHub account**. You'll use it both to sign in to the manager and to clone repos into Sessions.
- **Nothing else.** No Node, no Claude Code CLI, no `~/.claude` on the host: Claude authentication happens later, in the browser.

## Step 1: Create a GitHub App

The manager signs you in and clones repositories through a **GitHub App** registered under your GitHub account. A single GitHub App handles both authentication and repository access — unlike the previous OAuth App, permissions come from the App's own configuration rather than from the OAuth scope, and credentials minted for Sessions are short-lived installation tokens scoped to single repositories.

1. Go to <https://github.com/settings/apps/new> and fill in the form:
   - **GitHub App name**: anything, e.g. `cc-remote`.
   - **Homepage URL**: `https://<your-domain>` (or `http://localhost:4000` for a local test).
   - **Callback URL**: `https://<your-domain>/api/auth/callback/github` (or `http://localhost:4000/api/auth/callback/github` for a local test).
   - **Post installation**: leave **Redirect on update** unchecked.
   - **Webhook**: uncheck **Active** — this deployment does not use webhooks.
2. Under **Repository permissions**, set:
   - **Contents** → **Read and write**
   - **Pull requests** → **Read and write**
   - **Metadata** → **Read-only** (required by GitHub)
   - Leave all other permissions at **Read-only** or **No access**.
3. Under **Where can this GitHub App be installed?**, choose **Any account** (you install it on your own repositories later from the web manager's Repositories screen).
4. Click **Create GitHub App**. After creation, you see the App's settings page.
5. Copy these values — the setup wizard asks for them in Step 3:
   - **Client ID** (near the top of the page, above "App ID")
   - **App ID** (the numeric ID at the top of the page)
   - **Client secret**: click **Generate a new client secret** and copy it (shown only once)
   - **Private key**: scroll to the bottom, click **Generate a private key**, download the `.pem` file, and keep it safe — you will paste its contents into the wizard
   - **App slug**: the part of the GitHub URL path after `/apps/` (e.g. `cc-remote` if your app is at `github.com/apps/cc-remote`)
6. Don't install the App yet — you do that from the web manager's **Repositories** screen after the stack is running.

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
| GitHub App **Client ID** | From Step 1. |
| GitHub App **Client Secret** | From Step 1. |
| GitHub App **App ID** (numeric) | From Step 1. |
| GitHub App **Private Key** | Paste the full contents of the downloaded `.pem` file. The wizard supports multi-line pasting (paste the whole file). |
| GitHub App **Slug** | From Step 1 — used to build the installation URL. |
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

## Migrating from the OAuth App

If you are upgrading an existing deployment that was set up with the previous OAuth App, follow these steps:

1. **Create a GitHub App** following [Step 1](#step-1-create-a-github-app) above — use the same name and callback URL as your existing OAuth App for a clean transition.
2. **Update your configuration**: run `./setup.sh` again. The wizard detects existing `config.json` and offers its values as defaults; update them to point at the new GitHub App values (Client ID, Client Secret, App ID, Private Key, App Slug).
3. **Rebuild and restart**:
   ```bash
   docker compose up -d --build
   ```
4. **Re-sign in**: the GitHub App uses different credentials from the OAuth App, so every user signs in once more. The allow-list and existing Accounts are untouched.
5. **Install the App on your repositories**: go to the web manager's **Repositories** screen and click the button to open GitHub's installation flow. Select the repositories you want Sessions to access.
6. **Pre-existing Sessions** created before the migration keep their old static `GITHUB_TOKEN` until they are **reset**. New Sessions created after the migration use the new installation token model automatically. To migrate an existing Session, reset it from the web UI — this recreates its container and workspace with the new credential model.

### Rollback

If the GitHub App misbehaves in production, you can revert to the OAuth App:

1. Run `./setup.sh` again and enter your old GitHub OAuth App Client ID and Client Secret (or keep them saved from the original setup).
2. Rebuild and restart the stack: `docker compose up -d --build`.
3. Users sign in once more (the rollback is another credential change).
4. Sessions created under the GitHub App keep their broker credential path until they are **reset** — roll them back individually from the web UI if needed.
5. The GitHub App's private key is no longer loaded; the Repositories screen shows no installations. Session creation works as before using the OAuth token.
