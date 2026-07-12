#!/bin/sh
# Container start sequence for the web-manager (issue #17). Fail-fast preflight,
# then idempotent migrations, then the server. Any step failing aborts the
# start (set -e) so a broken deployment is visible in `docker compose logs`
# rather than half-running.
set -e

echo "[entrypoint] validating deployment environment..."
pnpm run --silent validate:env

# Idempotent: MikroORM (domain tables) then better-auth (its own tables) on the
# SAME SQLite file. Safe to run on every boot; no-ops once applied. Chosen over
# a separate release step so a single `docker compose up` is self-sufficient
# (issue #17 "migrations run on container start").
echo "[entrypoint] applying database migrations..."
pnpm run --silent migrate

echo "[entrypoint] starting web-manager on port ${PORT:-4000}..."
exec node .output/server/index.mjs
