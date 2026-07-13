FROM node:22-slim

# 1. Install dependencies, add the official GitHub CLI repo, and install packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    gosu \
    tmux \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Claude Code globally and download ttyd (architecture-aware)
RUN npm install -g @anthropic-ai/claude-code && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then TTYD_ARCH="x86_64"; \
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then TTYD_ARCH="aarch64"; \
    else TTYD_ARCH="x86_64"; fi && \
    curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.${TTYD_ARCH}" && \
    chmod +x /usr/local/bin/ttyd

# 3. Create working directories and config folders with proper permissions
RUN mkdir -p /workspace /home/node/.claude && chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

# 4. Copy the entrypoint scripts
COPY --chown=node:node entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY --chown=node:node console-entrypoint.sh /usr/local/bin/console-entrypoint.sh
RUN chmod +x /usr/local/bin/console-entrypoint.sh

COPY --chown=node:node agent-session.sh /usr/local/bin/agent-session.sh
RUN chmod +x /usr/local/bin/agent-session.sh

# Name of the tmux session holding the long-lived agent. entrypoint.sh creates it,
# console-entrypoint.sh attaches to it — one definition, both sides.
ENV TMUX_AGENT_SESSION=claude

# The base image leaves LANG unset, which makes LC_CTYPE fall back to POSIX. tmux
# reads the locale to decide whether its client is UTF-8 capable, and in a non-UTF-8
# locale it renders every non-ASCII character of Claude's TUI as "_". TERM matters
# for the same reason on the other end: ttyd's client is xterm.js, so claim its
# capabilities rather than the "screen" default tmux would otherwise assume.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sh", "-c", "ttyd -p 7681 --base-path /api/sessions/${SESSION_NAME}/terminal -W /usr/local/bin/console-entrypoint.sh"]
