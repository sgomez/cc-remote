# User guide

Day-to-day use of the web manager: Accounts, Sessions, the terminal, useful commands, and configuration. For installation, see the [install guide](install.md); for the security model, see [Security & sandboxing](security.md).

## Accounts

An **Account** is a set of Claude credentials that Sessions authenticate with. You register one once and reuse it across any number of Sessions.

<p align="center">
  <img src="accounts.png" alt="The Accounts page" width="70%" />
</p>

- **`claude` (OAuth)**: completing the interactive `claude` login in an ephemeral browser terminal (a "Login Container") stores the credentials in the Account's own Docker volume. Your host never needs a `~/.claude`.
- **API key**: DeepSeek, or **Custom** for any Anthropic-compatible endpoint. The key is written into the Account's volume and injected as `ANTHROPIC_*` env vars.

Each Account owns a `cc-remote-account-<id>` volume holding its `~/.claude` config; it is mounted into every Session of that Account, so a config change made in one Session applies to all of them. Accounts (and your login sessions) survive `docker compose down && up`: they live on the persisted `cc-remote-db` volume.

**Deleting** an Account is refused while any Session still uses it; once none do, its credentials volume is removed with it.

## Sessions

A **Session** is one sandboxed agent: a container running Claude Code with Remote Control, plus its own workspace volume `cc-remote-workspace-<name>` holding a clone of the GitHub repo you picked.

- **Creating** shows a **cloning** status while a helper container populates the workspace; the agent starts when the clone finishes. A failed clone shows **clone_failed** with a *Retry* button.
- **Git access just works**: your GitHub login's OAuth token is injected into the container, so the agent can clone, pull and push the repos you can reach, with no SSH keys. (Understand [what that grant means](security.md#2-a-sessions-github_token-is-your-full-oauth-token) first.)
- **Remote Control survives restarts**: each Session pins a stable Claude session id, so the pairing outlives container restarts and resets.

### Stop vs. Reset vs. Destroy

| Action | Container | Workspace volume | Use when |
|---|---|---|---|
| **Stop** | stopped, kept | **kept** | Free up RAM/CPU; start it again later. |
| **Reset** | recreated | **deleted**, re-cloned fresh | You want a clean slate. |
| **Destroy** | removed | **deleted** | You're done with the Session. |

**Reset and Destroy are destructive: anything not pushed to GitHub is gone.** Both sit behind a confirmation dialog that says so. If you only want to pause a Session, use **Stop**.

### The web terminal

Every Session page has a built-in terminal attached to the *same* Claude that Remote Control drives. The agent runs inside a tmux session, so closing the browser tab just detaches; Claude keeps running as long as the container does.

## Useful commands

| Action | Command |
|---|---|
| Start the stack | `docker compose up -d` |
| Stop the stack | `docker compose down` |
| View manager logs | `docker compose logs -f` |
| Rebuild images from scratch | `docker compose build --no-cache` |
| Shell into a Session | `docker exec -it cc-remote-session-<session_name> bash` |

> [!IMPORTANT]
> **`docker compose down` does not stop your Sessions.** Session containers are siblings created through the Docker API, not compose services: compose doesn't know they exist, so they keep running (and consuming RAM/CPU) after the stack is down. For a full teardown, stop the Sessions from the web UI first. This cuts both ways, deliberately: updating the manager with `docker compose up -d --build` leaves running agents untouched.

## Configuration

All configuration lives in **`config.json`**; apply changes by rerunning `./setup.sh`. **Never edit `.env`**: it is compiled from `config.json` on every run and your edits will be overwritten.

### Resource limits

Every agent container is capped in memory, CPU and process count (see [why](security.md#resource-limits-memory-cpu-pids)). The wizard derives sensible values from your host's RAM and cores; to override:

```json
"resources": { "agentMemoryLimit": "2g", "agentCpuLimit": 2 }
```

Memory accepts human units (`512m`, `2g`, `1.5g`) or raw bytes. Invalid values are rejected loudly (by the wizard and again by the manager at startup) rather than silently running agents unbounded. `0` disables a limit (not recommended). The default assumes about two Sessions are memory-hot at once; it caps *one* container, it does not stop you from overcommitting the host with many.

### Permission mode

Sessions run `--permission-mode auto` by default. To change it for every Session (e.g. `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`):

```json
"permissions": { "mode": "auto" }
```

### Auto Mode rules

You can tune the Auto Mode classifier (e.g. declare trusted repos or domains to avoid false-positive blocks) with an `autoMode` block in the Account's Claude config. That config lives in the Account's volume. Edit it from any of its Sessions' web terminals, and it applies to every Session of that Account:

```json
{
  "permissions": { "defaultMode": "auto" },
  "autoMode": {
    "environment": [
      "$defaults",
      "Source control: github.com/your-org and all repos under it",
      "Trusted internal domains: *.internal.example.com"
    ]
  }
}
```

## Custom skills and rules (`.agents/`)

To give the agent repo-specific instructions (TDD conventions, code style, custom skills), put them under the **`.agents/` folder of the repository the Session clones**. The agent discovers and loads them automatically from `/workspace`. They travel with the repo: commit them once, and every Session created from it picks them up. Nothing is configured on the host.
