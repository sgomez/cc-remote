#!/bin/sh
# The long-lived agent process, run inside the container's tmux session (see
# entrypoint.sh). It is what actually connects the Session to Remote Control:
# `--remote-control=$SESSION_NAME` names the pairing, `--session-id=$SESSION_UUID`
# pins it so a reset/recreate keeps the same Claude session id.
#
# This runs detached at container start, NOT per web-terminal connection: ttyd
# spawns its command once per client, so a Session whose terminal nobody has
# opened would otherwise have no `claude` running at all, and closing the browser
# tab would kill it. console-entrypoint.sh attaches to this tmux session instead.

echo "===================================================="
echo "             Claude Code Remote Console             "
echo "===================================================="
echo ""
if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo " Provider: DeepSeek / Custom (${ANTHROPIC_BASE_URL})"
else
    echo " Provider: Claude (OAuth)"
fi
echo " Session: ${SESSION_NAME}"
echo " Permission Mode: ${PERMISSION_MODE:-auto}"
echo " Working Directory: /workspace"
echo "===================================================="
echo ""

if [ -n "$SESSION_UUID" ]; then
    # --session-id claims the UUID as a NEW session and dies with "Session ID
    # already in use" once its transcript exists — which is exactly what a
    # container restart finds on the Account Config Volume. Resume the pinned
    # session in that case; only a UUID with no transcript yet (fresh create or
    # reset, which mints a new UUID) may claim it as new.
    TRANSCRIPT="$HOME/.claude/projects/-workspace/$SESSION_UUID.jsonl"
    if [ -f "$TRANSCRIPT" ]; then
        claude --resume "$SESSION_UUID" \
            --remote-control="$SESSION_NAME" \
            --permission-mode="${PERMISSION_MODE:-auto}"
    else
        claude --session-id="$SESSION_UUID" \
            --remote-control="$SESSION_NAME" \
            --permission-mode="${PERMISSION_MODE:-auto}"
    fi
else
    claude --remote-control="$SESSION_NAME" \
        --permission-mode="${PERMISSION_MODE:-auto}"
fi

echo ""
echo "Claude Code has exited. You are now in a fallback bash shell."
# The --permission-mode flag is NOT optional in this hint. Nothing writes the
# mode into ~/.claude.json any more (it lives on the shared Account Config
# Volume, where a sibling Session would overwrite it), so a relaunch without the
# flag would run under Claude's own default rather than this Session's mode.
echo "Run 'claude --remote-control=$SESSION_NAME --permission-mode=${PERMISSION_MODE:-auto}' to reconnect Remote Control."
exec bash
