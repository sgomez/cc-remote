#!/bin/sh
echo "===================================================="
echo "             Claude Code Remote Console             "
echo "===================================================="
echo ""
if [ -n "$ANTHROPIC_BASE_URL" ]; then
    echo " Provider: DeepSeek / Custom (${ANTHROPIC_BASE_URL})"
else
    echo " Provider: Claude (Local / OAuth)"
fi
echo " Permission Mode: ${PERMISSION_MODE:-auto}"
echo " Working Directory: /workspace"
echo "===================================================="
echo ""
echo "Starting Claude Code..."
echo ""

# Start Claude Code
claude --permission-mode="${PERMISSION_MODE:-auto}"

echo ""
echo "Claude Code has exited. You are now in a fallback bash shell."
exec bash
