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

# Run the config script inside a lightweight Node container
docker run --rm -it \
  -v "$(pwd)":/app \
  -w /app \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
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
