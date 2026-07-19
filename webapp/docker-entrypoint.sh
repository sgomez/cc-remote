#!/bin/sh
# Container start sequence for the web-manager (issue #17). Fail-fast preflight,
# then idempotent migrations, then the server. Any step failing aborts the
# start (set -e) so a broken deployment is visible in `docker compose logs`
# rather than half-running.
set -e

echo "[entrypoint] validating deployment environment..."
pnpm run --silent validate:env

# After validation: check whether this is an unconfigured deployment.
# When no Bootstrap File exists yet, issue a Claim Token so the operator
# can prove host ownership and reach the bootstrap screen (issue #54).
# The token is surfaced in the logs AND written to a 0600 file on the data
# volume so it survives log rotation.
BOOTSTRAP_FILE="/data/bootstrap.json"
CLAIM_TOKEN_FILE="/data/claim-token"

if [ -f "$BOOTSTRAP_FILE" ]; then
  echo "[entrypoint] deployment is configured (bootstrap file found)"
  # Clean up any leftover claim token from an earlier unconfigured state.
  rm -f "$CLAIM_TOKEN_FILE"
else
  echo "[entrypoint] deployment is unconfigured — issuing claim token..."
  CLAIM_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo ""
  echo "  ================================================================"
  echo "   CLAIM TOKEN"
  echo "   ${CLAIM_TOKEN}"
  echo ""
  echo "   Open your deployment in a browser and enter this token to"
  echo "   claim the deployment and set up your GitHub identity."
  echo "   Token also saved to ${CLAIM_TOKEN_FILE}"
  echo "  ================================================================"
  echo ""
  printf '%s' "$CLAIM_TOKEN" > "$CLAIM_TOKEN_FILE"
  chmod 600 "$CLAIM_TOKEN_FILE"
fi

# Idempotent: MikroORM (domain tables) then better-auth (its own tables) on the
# SAME SQLite file. Safe to run on every boot; no-ops once applied. Chosen over
# a separate release step so a single `docker compose up` is self-sufficient
# (issue #17 "migrations run on container start").
echo "[entrypoint] applying database migrations..."
pnpm run --silent migrate

echo "[entrypoint] starting web-manager on port ${PORT:-4000}..."
exec node .output/server/index.mjs
