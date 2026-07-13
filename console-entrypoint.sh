#!/bin/sh
# ttyd's per-client command: what you get when you open a Session's web terminal.
#
# It does NOT start Claude for an agent Session — entrypoint.sh already did, in a
# detached tmux session that lives as long as the container. Attaching means the
# browser sees the same Claude that Remote Control is paired with, and closing the
# tab detaches instead of killing the agent.
#
# A Login Container has no tmux session (and no SESSION_NAME): it falls through to
# a plain interactive `claude`, which is what drives its OAuth login.

if tmux has-session -t "$TMUX_AGENT_SESSION" 2>/dev/null; then
    # -u forces UTF-8 (a non-UTF-8 locale makes tmux draw Claude's TUI with "_"
    # placeholders); -d detaches any stale client, so the window sizes to this one
    # instead of being clamped to the smallest attached terminal.
    exec tmux -u attach-session -d -t "$TMUX_AGENT_SESSION"
fi

echo "===================================================="
echo "             Claude Code Remote Console             "
echo "===================================================="
echo ""
if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo " Provider: DeepSeek / Custom (${ANTHROPIC_BASE_URL})"
else
    echo " Provider: Claude (OAuth)"
fi
echo " Permission Mode: ${PERMISSION_MODE:-auto}"
echo " Working Directory: /workspace"
echo "===================================================="
echo ""
echo "Starting Claude Code..."
echo ""

claude --permission-mode="${PERMISSION_MODE:-auto}"

echo ""
echo "Claude Code has exited. You are now in a fallback bash shell."
exec bash
