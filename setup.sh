#!/usr/bin/env bash

# Exit on interrupt
trap 'echo -e "\n\nSetup aborted."; exit 1' INT

# Color helper variables
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0;m'

echo -e "${BLUE}===============================================${NC}"
echo -e "${BLUE}   Claude Code Remote Setup (Consolidated)     ${NC}"
echo -e "${BLUE}===============================================${NC}"
echo ""

# Host facts config.js cannot see for itself: it runs inside a throwaway container
# (so the wizard needs no Node on the host), and web-manager can't discover them
# at runtime either — `docker info` is blocked on the socket proxy (INFO=0) and
# that stays blocked. So the agent memory/CPU caps are DERIVED HERE, from the real
# host, and compiled into .env. A container's /proc/meminfo shows the host's RAM,
# but nproc inside it is bounded by the container's own cpuset, hence reading both
# out here.
#
# Total RAM in MiB. Linux: /proc/meminfo (MemTotal is in kB). macOS: sysctl.
if [ -r /proc/meminfo ]; then
  HOST_MEM_MB=$(awk '/^MemTotal:/ {printf "%d", $2 / 1024}' /proc/meminfo)
elif command -v sysctl >/dev/null 2>&1; then
  HOST_MEM_MB=$(( $(sysctl -n hw.memsize) / 1048576 ))
fi
HOST_CPUS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)

# Own the wizard's output files as the host user — but ONLY on rootful Docker.
#
# The wizard writes config.json/.env into the bind-mounted repo. On standard
# (rootful) Docker the container's root maps to host root, so those files land
# as root:root 0600 and the host user can't read them — docker compose then
# fails to interpolate .env. Passing --user "$HOST_UID:$HOST_GID" makes the
# container write them as the host user.
#
# On ROOTLESS Docker the mapping is the opposite and this flag would BREAK it:
# container root already maps to the host user, while a non-zero uid maps into
# the subuid range, producing files owned by an unusable (high) uid the host
# user can't touch. So detect rootless and skip --user there.
USER_FLAG=()
if ! docker info -f '{{.SecurityOptions}}' 2>/dev/null | grep -q 'name=rootless'; then
  USER_FLAG=(--user "$(id -u):$(id -g)")
fi

# Run the config script inside a lightweight Node container
docker run --rm -it \
  "${USER_FLAG[@]}" \
  -v "$(pwd)":/app \
  -w /app \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  -e HOST_MEM_MB="${HOST_MEM_MB}" \
  -e HOST_CPUS="${HOST_CPUS}" \
  node:22-slim node config.js "$@"

# Nothing to prepare on the host: agent containers mount named Docker volumes
# exclusively (workspace per Session, config per Account), the web-manager keeps
# Accounts and settings in SQLite on the cc-remote-db volume, and Sessions live
# purely as labelled Docker containers. Accounts are created in the web UI.
if [ $? -eq 0 ] && [ -f .env ]; then
  # Prompt to run container
  echo ""
  echo -e -n "${GREEN}Do you want to build and start the Docker container now?${NC} [Y/n]: "
  read -r user_input
  if [ -z "$user_input" ] || [[ "$user_input" =~ ^[yY]([eE][sS])?$ ]]; then
    echo -e "${BLUE}[Info] Starting Docker containers using docker compose...${NC}"
    docker compose up -d --build
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}[Success] Container started! Run 'docker compose logs -f' to see output.${NC}"
    else
      echo -e "${RED}[Error] Failed to start Docker container.${NC}"
    fi
  else
    echo -e "${BLUE}Setup complete! You can start the agent later by running:${NC}"
    echo -e "  docker compose up -d --build"
  fi
fi
echo ""
