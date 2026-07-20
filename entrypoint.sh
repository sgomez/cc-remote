#!/bin/sh

# 1. Root pre-initialization block (runs when container starts as root)
if [ "$(id -u)" = "0" ]; then
    echo " [Info] Container started as root. Initializing User Identity Adapter..."

    # Fallback to defaults if PUID/PGID are empty or invalid
    PUID=${PUID:-1000}
    PGID=${PGID:-1000}

    # Adjust node user's UID to match host UID
    if [ "$PUID" -ne 0 ] && [ "$(id -u node 2>/dev/null)" != "$PUID" ]; then
        echo " [Info] Adjusting node user UID to $PUID"
        usermod -u "$PUID" node 2>/dev/null || echo " [Warning] Could not change node user UID"
    fi

    # Adjust node user's GID to match host GID
    if [ "$PGID" -ne 0 ] && [ "$(id -g node 2>/dev/null)" != "$PGID" ]; then
        echo " [Info] Adjusting node user GID to $PGID"
        groupmod -g "$PGID" node 2>/dev/null || echo " [Warning] Could not change node user GID"
    fi

    # Ensure the local bin path exists and is owned by the node user. Scope this
    # narrowly: a `chown -R /home/node` would recurse into whatever is mounted
    # under HOME (the Account Config Volume), and walking a volume on every
    # container start is pure latency. `usermod -u` above already re-owns the
    # files in the home tree that belonged to the old uid.
    mkdir -p /home/node/.local/bin
    ln -sf /usr/local/bin/claude /home/node/.local/bin/claude
    chown -R node:node /home/node/.local 2>/dev/null
    chown node:node /home/node 2>/dev/null

    # A freshly created Docker volume is root-owned at its mount point, so the
    # node user could not write into it. Fix just that one inode — never recurse:
    # the volume's contents were already chowned when it was seeded.
    if [ -n "$ACCOUNT_CONFIG_DIR" ] && [ -d "$ACCOUNT_CONFIG_DIR" ]; then
        chown node:node "$ACCOUNT_CONFIG_DIR" 2>/dev/null
    fi

    # A Session created in bypassPermissions hits a blocking acceptance dialog on
    # startup ("WARNING: Claude Code running in Bypass Permissions mode"), which
    # nobody can answer in a headless container: Claude would sit on it forever
    # and never reach Remote Control. Pre-accept it.
    #
    # This goes in the POLICY settings layer, at a container-local path, and NOT
    # in ~/.claude/settings.json — that file lives on the Account Config Volume,
    # which every Session of the Account shares. Written here it is per-Session,
    # exactly like the mode it accompanies, and a filtered Session never gets it.
    # (Claude Code reads the flag from any settings layer; the legacy
    # `bypassPermissionsModeAccepted` key in ~/.claude.json no longer works.)
    if [ "$PERMISSION_MODE" = "bypassPermissions" ]; then
        mkdir -p /etc/claude-code
        printf '{\n  "skipDangerousModePermissionPrompt": true\n}\n' \
            > /etc/claude-code/managed-settings.json
        echo " [Info] Pre-accepted the bypass-permissions disclaimer for this Session."
    fi

    # Re-execute this script as the node user with corrected HOME environment variable
    echo " [Info] Dropping privileges to node user..."
    export HOME=/home/node
    exec gosu node "$0" "$@"
fi

# 2. User initialization block (runs as non-root user 'node')
echo " [Info] Running as non-root user node (UID: $(id -u), GID: $(id -g))"

export PATH="/home/node/.local/bin:$PATH"

# Commit Identity: the git author this container commits as. web-manager sets it
# per-Session from the GitHub profile of the signed-in user who provisioned it,
# so it is NOT a deployment-wide value and is re-applied on every start from the
# container's env (a reset is what changes it).
#
# The guards stay because not every container is a Session: a Login Container has
# no Session identity and never commits, so it legitimately arrives with neither
# variable set. A Session always carries both.
if [ -n "$GIT_USER_NAME" ]; then
    git config --global user.name "$GIT_USER_NAME"
fi

if [ -n "$GIT_USER_EMAIL" ]; then
    git config --global user.email "$GIT_USER_EMAIL"
fi

# Claude Code writes runtime artifacts into the repo's .claude/ while a session
# runs (settings.local.json on permission grants, worktrees/ for agent
# isolation). Ignore them globally so `git status` inside /workspace stays
# clean in every cloned repo, whether or not it gitignores them itself.
cat > /home/node/.gitignore_global <<'EOF'
**/.claude/settings.local.json
**/.claude/worktrees/
EOF
git config --global core.excludesFile /home/node/.gitignore_global

# Account Config Volume: the whole volume is bind-mounted at $ACCOUNT_CONFIG_DIR (see
# webapp src/adapters/docker), holding both the account's .claude/ dir and .claude.json.
# Link ~/.claude and ~/.claude.json into it so writes (e.g. OAuth credentials from a
# Login Container) persist to the volume and the seeded wizard-skip .claude.json is
# picked up. Every Account owns one — no agent container ever mounts a host path.
if [ -n "$ACCOUNT_CONFIG_DIR" ]; then
    echo " [Info] Linking Claude config to Account Config Volume at $ACCOUNT_CONFIG_DIR"
    mkdir -p "$ACCOUNT_CONFIG_DIR/.claude"
    # Replace the image's default ~/.claude (an empty dir) and any stale
    # ~/.claude.json with symlinks into the mounted volume, so every write
    # (OAuth credentials from a Login Container, session state) persists to the
    # volume rather than the container's ephemeral layer.
    rm -rf "/home/node/.claude" "/home/node/.claude.json"
    ln -s "$ACCOUNT_CONFIG_DIR/.claude" "/home/node/.claude"
    ln -s "$ACCOUNT_CONFIG_DIR/.claude.json" "/home/node/.claude.json"
fi

# Restore Claude session file if it doesn't exist but a backup is available
if [ ! -f "/home/node/.claude.json" ]; then
    # Look for the most recent backup in the mounted .claude config directory
    BACKUP_FILE=$(ls -t /home/node/.claude/backups/.claude.json.backup.* 2>/dev/null | head -n 1)
    
    if [ -n "$BACKUP_FILE" ]; then
        echo " [Info] Restoring Claude configuration from backup: $BACKUP_FILE"
        cp "$BACKUP_FILE" "/home/node/.claude.json"
    elif [ -f "/home/node/.claude/.claude.json" ]; then
        # Check parent folder fallback
        cp "/home/node/.claude/.claude.json" "/home/node/.claude.json"
    fi
fi

# Git credential helper that obtains installation tokens from the broker on demand
# instead of carrying a durable GITHUB_TOKEN in the environment. The token is cached
# in memory (via a temp file) and renewed 5 minutes before the stated expiry, so a
# long push does not hand an already-expired credential to Git.
#
# Runs when the Session carries the broker secret and URL (issue #32/33). The clone
# helper gets a one-shot token via GITHUB_TOKEN directly; this path is for the
# long-running Session container.
if [ -n "$CC_BROKER_SECRET" ] && [ -n "$CC_BROKER_URL" ]; then
    cat > /home/node/.local/bin/git-credential-broker <<'BROKER_EOF'
#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { request } = require(
  process.env.CC_BROKER_URL.startsWith("https") ? "https" : "http",
);

const cacheFile = "/tmp/gh-token-cache.json";
const now = Date.now();
const marginMs = 5 * 60 * 1000; // renew 5 min before expiry

// Return a cached token if it is still fresh.
try {
  if (existsSync(cacheFile)) {
    const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    const expiresAt = new Date(cache.expiresAt).getTime();
    if (cache.token && expiresAt - marginMs > now) {
      console.log("username=x-access-token");
      console.log("password=" + cache.token);
      process.exit(0);
    }
  }
} catch (_) { /* corrupt cache -- refetch */ }

// Fetch a fresh token from the broker.
const url = new URL(process.env.CC_BROKER_URL);
const body = JSON.stringify({ secret: process.env.CC_BROKER_SECRET });

const opts = {
  hostname: url.hostname,
  port: url.port || (url.protocol === "https:" ? 443 : 80),
  path: url.pathname || "/",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  },
};

const req = request(opts, function (res) {
  let data = "";
  res.on("data", function (chunk) { data += chunk; });
  res.on("end", function () {
    if (res.statusCode !== 200) {
      process.stderr.write(
        "credential-broker: refused (HTTP " + res.statusCode + ")\n",
      );
      process.exit(1);
    }
    try {
      const cred = JSON.parse(data);
      if (!cred.token) throw new Error("no token in response");
      writeFileSync(cacheFile, JSON.stringify(cred), "utf8");
      console.log("username=x-access-token");
      console.log("password=" + cred.token);
    } catch (e) {
      process.stderr.write(
        "credential-broker: bad response: " + e.message + "\n",
      );
      process.exit(1);
    }
  });
});
req.on("error", function (e) {
  process.stderr.write(
    "credential-broker: unreachable: " + e.message + "\n",
  );
  process.exit(1);
});
req.write(body);
req.end();
BROKER_EOF
    chmod +x /home/node/.local/bin/git-credential-broker

    # gh CLI wrapper to inject the token from the broker dynamically
    cat > /home/node/.local/bin/gh <<'GH_EOF'
#!/usr/bin/env bash
TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill 2>/dev/null | awk -F= '/password/ {print $2}')
if [ -n "$TOKEN" ]; then
    export GITHUB_TOKEN="$TOKEN"
    export GH_TOKEN="$TOKEN"
fi
exec /usr/bin/gh "$@"
GH_EOF
    chmod +x /home/node/.local/bin/gh

    git config --global credential."https://github.com".helper "/home/node/.local/bin/git-credential-broker"
    git config --global url."https://github.com/".insteadOf "git@github.com:"
fi

# Clone repository if the workspace directory is empty (no .git folder)
if [ ! -d ".git" ]; then
    if [ -n "$GITHUB_REPO" ]; then
        echo " [Info] No Git repository detected. Cloning ${GITHUB_REPO}..."
        git clone "https://github.com/${GITHUB_REPO}.git" .
    else
        echo " [Warning] The workspace folder is empty but no GITHUB_REPO was specified."
    fi
else
    echo " [Info] Git repository already exists. Skipping clone."
fi

# Automatically mark /workspace as a trusted directory in Claude settings.
#
# `permissions.defaultMode` is deliberately NOT written here. This file lives on
# the Account Config Volume, which every Session of the Account shares, so the
# key is a shared mutable cell: the last container to start would decide the mode
# for its siblings, and a Session created as filtered could end up unfiltered.
# The mode reaches the agent from this container's own PERMISSION_MODE env var,
# passed explicitly as --permission-mode by agent-session.sh (and by the fallback
# hint printed when Claude exits). See CLAUDE.md.
node -e '
const fs = require("fs");
const path = "/home/node/.claude.json";
try {
  let config = {};
  if (fs.existsSync(path)) {
    try {
      config = JSON.parse(fs.readFileSync(path, "utf8"));
    } catch (parseErr) {
      // A corrupt ~/.claude.json must NOT block the required keys below from
      // being written: without hasCompletedOnboarding / hasTrustDialogAccepted /
      // remoteControlAtStartup, Claude sits on a
      // first-run modal in a headless container and Remote Control never comes
      // up. Recover by starting fresh (same philosophy as config.js on a corrupt
      // config.json). The prior file is overwritten by the writeFileSync below.
      console.warn(" [Warning] ~/.claude.json was corrupt and could not be parsed; starting from a fresh config:", parseErr.message);
      config = {};
    }
  }
  if (!config.projects) config.projects = {};
  if (!config.projects["/workspace"]) config.projects["/workspace"] = {};
  config.projects["/workspace"].hasTrustDialogAccepted = true;

  // Belt to the --remote-control flag in agent-session.sh: any `claude` started
  // by hand inside the container (fallback shell, manual restart) also brings the
  // Remote Control bridge up instead of sitting unreachable.
  config.remoteControlAtStartup = true;

  // Any blocking first-run modal stops Claude before it reaches the Remote
  // Control bridge, so neither of these may be left to chance in a container the
  // user cannot answer prompts in. The theme is asked for separately from
  // onboarding, so both keys are needed. Default the theme rather than force it:
  // a theme the user picked themselves must survive.
  config.hasCompletedOnboarding = true;
  if (!config.theme) config.theme = "dark";

  fs.writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  console.log(" [Info] Automatically trusted /workspace in Claude settings.");
} catch (e) {
  console.error(" [Error] Could not configure Claude settings:", e.message);
}
'

# Start the agent in a detached tmux session, so `claude` (and with it the Remote
# Control bridge) is alive for as long as the container is — independently of
# whether anyone has the web terminal open. ttyd spawns its command once per
# connected client, so leaving Claude to console-entrypoint.sh would mean a
# Session only ran while a browser tab watched it. console-entrypoint.sh attaches
# to this session instead of starting a second Claude.
#
# SESSION_NAME is the discriminator for "this is an agent Session": a Login
# Container has no Session identity, and must keep getting a plain interactive
# `claude` from console-entrypoint.sh so its OAuth login can run.
if [ -n "$SESSION_NAME" ]; then
    echo " [Info] Starting Remote Control session: $SESSION_NAME (UUID: ${SESSION_UUID:-dynamic}) in ${PERMISSION_MODE:-auto} mode"
    # -u forces UTF-8 regardless of what tmux infers from the locale: without it
    # every non-ASCII glyph in Claude's TUI comes out as "_". Size the detached
    # window generously too — until a client attaches, tmux would default to 80x24
    # and Claude would render its TUI wrapped to that.
    tmux -u new-session -d -s "$TMUX_AGENT_SESSION" -x 200 -y 50 /usr/local/bin/agent-session.sh
    tmux set-option -g default-terminal "xterm-256color"
    tmux set-option -g status off
    tmux set-option -g history-limit 10000
fi

exec "$@"
