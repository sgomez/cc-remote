# Install guide

Every step from an empty VPS to your first running Session. No prior knowledge assumed beyond being able to SSH into your server and paste commands.

## What you need

- A **VPS** (or any Linux box) with **Docker**, **Docker Compose** and **Git** installed.
- A **domain name** pointing at the VPS if you want HTTPS (recommended). For a local test, `localhost` works with no domain.
- A **GitHub account**. You'll use it both to sign in to the manager and to clone repos into Sessions.
- **Nothing else.** No Node, no Claude Code CLI, no `~/.claude` on the host: Claude authentication happens later, in the browser.

## Two-phase bootstrap

Installation happens in two phases.

**Phase 1** runs in the terminal (the setup wizard). You answer only what the host alone can answer: your domain, whether you want the built-in Caddy reverse proxy, and which ports to use. The wizard derives everything else (auth signing secret, container user IDs, git identity, agent resource limits) automatically. No GitHub App creation, no private key handling, no allow-list.

**Phase 2** happens in the browser, after the stack is running. You open your deployment's URL and complete the bootstrap through a web screen: either register a new GitHub App with a single click via GitHub's App Manifest Flow, or manually enter an existing App's details. The private key is uploaded as a file or handled entirely by GitHub -- never pasted into a terminal prompt.

## Step 1: Get the code

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

## Step 2: Run the setup wizard (Phase 1)

```bash
./setup.sh
```

The wizard runs inside a temporary Docker container (that's why no Node is needed on the host), asks about infrastructure only, and writes two gitignored files: `config.json` (your answers) and `.env` (compiled from it).

The Phase 1 wizard asks about **infrastructure only**:

| Question | What to answer |
|---|---|
| Enable **Caddy**? | Yes for a real deployment with HTTPS; no if you bring your own reverse proxy or are testing locally. |
| **Domain name** | e.g. `cc.example.com`, or `localhost:4000` for a local test. |
| Caddy **HTTP/HTTPS ports** | The defaults (80/443) are fine; enter `0` for HTTP to disable it. |

Everything else (auth secret, container user IDs, git identity, per-agent resource limits) is derived automatically, with no prompt. You can change those later in `config.json` (see the [user guide](usage.md#configuration)); never edit `.env` by hand, it's regenerated on every `./setup.sh` run.

The wizard asks **nothing** about GitHub Apps, OAuth credentials, private keys, allow-lists, repositories, sessions or Claude accounts. Those are configured in Phase 2, from the browser.

## Step 3: Start the stack

```bash
docker compose up -d --build
```

This builds two images (the web manager and the agent image Sessions run on) and starts the manager, the Docker socket proxy and, if enabled, Caddy. Watch it come up with:

```bash
docker compose logs -f
```

The manager validates its environment on start and reports every problem. On a fresh Phase 1 deployment the manager has no GitHub identity configured yet, so it serves the bootstrap screen only -- that is expected behaviour. 

### Finding the Claim Token

The container entrypoint generates a **Claim Token** when the deployment has no GitHub identity configured. Find it in the start logs:

```bash
docker compose logs web-manager | grep "Claim Token"
```

You will see output like:

```
Claim Token: ABC123def456
```

The token is also written to a file on the data volume at `/data/claim-token` with `0600` permissions. You need this token to access the bootstrap screen -- possession of the token proves you are the deployment's owner.

## Step 4: Bootstrap from the browser (Phase 2)

Once the stack is running and you have the Claim Token, open your deployment's URL in a browser:

```
https://<your-domain>
```

The deployment is unconfigured, so every page redirects to the **bootstrap screen**. Enter your Claim Token to proceed.

### Option A: Register a new GitHub App (recommended)

Click the button to register a new GitHub App through GitHub's **App Manifest Flow**. GitHub creates the App from a declarative manifest with the correct permissions and callback URL already filled in. After approval, GitHub redirects back to your deployment with the App's credentials -- no values are copied or pasted.

The manifest declares:
- Homepage URL: your deployment's URL
- OAuth callback URL: `/api/auth/callback/github`
- Repository permissions: **Contents: write**, **Pull requests: write**

After GitHub returns the App credentials, you see a pre-filled form with:
- The App's owner (your GitHub login or organisation name)
- The allow-list pre-seeded with that owner's login

Edit the allow-list if needed (an App registered under an organisation seeds the organisation name, not your personal login). Save the configuration. The deployment validates the values and applies them by restarting itself. When it comes back, you will be signed in automatically.

### Option B: Enter an existing GitHub App manually

If you already have a GitHub App (or want to use the same App across deployments), choose the manual path and enter:

- **Client ID** and **Client Secret** (from the App's "Identification" section)
- **App ID** (the numeric ID at the top of the App's settings page)
- **App Slug** (the part of the GitHub URL path after `/apps/`, e.g. `cc-remote`)
- **Private key** (upload the `.pem` file from the App's "Private keys" section -- no pasting)
- **Allowed GitHub usernames** (comma-separated, fail-closed: an empty list denies everyone)

### What happens next

After saving, the deployment:
1. Validates the configuration in memory
2. Writes the Bootstrap File to the data volume
3. Exits cleanly -- the `restart: unless-stopped` policy brings it back with the new configuration
4. The bootstrap screen polls for the restart and redirects you to the sign-in page

Sign in with GitHub, and you are taken to the **Repositories screen** to install the App on your repositories. From there, [create your first Session](usage.md#creating-a-session).

> **The Claim Token stops working after your first successful sign-in.** If sign-in fails for any reason, the token remains valid and you can retry.

## Step 5: Install the App and create your first Session

After signing in:

1. Go to **Repositories** and click the button to install the App on your GitHub account. Select the repositories you want Sessions to access.
2. Go to **Accounts** and register one, which is what Sessions authenticate Claude with:
   - **`claude` (OAuth)**: the manager opens a terminal in your browser running the normal interactive `claude` login. Complete it once; the credentials are stored in that Account's own Docker volume and the temporary login container is thrown away.
   - **API key**: DeepSeek, or **Custom** for any Anthropic-compatible endpoint (API key, base URL, model).
3. Create a **Session**: give it a name, pick the Account, pick the GitHub repository to clone. The manager clones the repo into a fresh volume, then starts the agent with Remote Control enabled.
4. Drive it from the **Claude Code Remote Control app**, or open the Session's **web terminal**: both show the *same* running Claude.

That's it. Day-to-day operation is covered in the [user guide](usage.md).

## Reopening bootstrap

To change the GitHub App, update the allow-list, or rotate credentials, run the following command on the host to reopen bootstrap and issue a fresh Claim Token:

```bash
docker compose exec web-manager sh -c 'rm -f /data/bootstrap.json /data/claim-token && kill 1'
```

Wait for the container to restart (`restart: unless-stopped`), then fetch the new token:

```bash
docker compose logs web-manager | grep "Claim Token"
```

Open your deployment's URL and complete Phase 2 again. Running Sessions survive the restart.

## Migrating from the single-phase setup

If you are upgrading an existing deployment that was set up with the single-phase wizard (the old `config.js` that asked for the GitHub App ID, private key, OAuth credentials and allow-list through the terminal):

1. **Run `./setup.sh` again.** The wizard detects existing `config.json` and offers its values as defaults. Answer the infrastructure-only questions (Caddy, domain, ports) -- the old GitHub identity values in `config.json` are ignored and the wizard no longer prompts for them.
2. **Rebuild and restart**:
   ```bash
   docker compose up -d --build
   ```
3. **Complete Phase 2 from the browser.** Open your deployment's URL, enter the Claim Token (from `docker compose logs web-manager | grep "Claim Token"`), and use the **manual path** to enter your existing GitHub App's details. This is the migration route: the old `config.json` and `.env` no longer carry these values, and the Bootstrap File on the data volume becomes the single source of truth.
4. The private key and OAuth client secret now live on the data volume (alongside the signed-in users' GitHub access tokens that better-auth already stores there) rather than in a plaintext `.env` file on the host. **Existing Sessions keep working** through the restart; no Session needs to be reset.

After migration, run `./setup.sh` again only to change infrastructure settings (domain, ports, Caddy toggle, resource caps). GitHub identity changes go through the browser bootstrap screen using `docker compose exec ...` to reopen it.
