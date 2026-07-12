# Production image for the new web-manager (webapp/). Multi-stage: build the
# self-contained TanStack Start + Nitro output, then ship a slim Node 24 runtime
# that serves static + SSR + API + SSE + WS on ONE port (4000) via
# `node .output/server/index.mjs` (PRD §4/§9, issue #17).
#
# The runtime keeps the full install (including the dev-time CLIs) and the src/
# tree on purpose: migrations are TypeScript (src/adapters/db/migrations/*.ts +
# the MikroORM/better-auth configs) and run at container start via the
# entrypoint. Image size is a non-concern for a single-user VPS; a correct,
# idempotent migrate-on-start is.

# ---- Stage 1: build ---------------------------------------------------------
FROM node:24-slim AS builder

# corepack ships pnpm with Node; activate the pinned version so both stages use
# the same package manager offline (no runtime registry access needed).
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# better-sqlite3 is a native module (onlyBuiltDependencies rebuilds it) — needs
# a C++ toolchain to compile against Node 24's ABI.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cache layer keyed on the manifests only).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the Nitro output (also generates src/routeTree.gen.ts).
COPY . .
RUN pnpm build

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:24-slim AS runtime

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

ENV NODE_ENV=production
# Nitro's node server binds process.env.PORT (Caddy proxies to web-manager:4000).
ENV PORT=4000

WORKDIR /app

# Runtime carries: the built output, the full node_modules (native better-sqlite3
# binding + the migration/validate CLIs), the source (TS migrations + configs the
# CLIs load), and the manifests (mikro-orm.configPaths lives in package.json).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/tsconfig.json ./

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# DATABASE_PATH default lives here; deployment mounts a named volume over /data
# so Accounts and auth sessions survive recreation. Owned by the non-root user.
ENV DATABASE_PATH=/data/cc-remote.db
RUN mkdir -p /data && chown -R node:node /app /data

# Runs unprivileged: the app reaches Docker over the socket PROXY (TCP), never a
# mounted socket, so it needs no elevated rights (unlike the legacy root image).
USER node

EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
