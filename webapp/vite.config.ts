import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Optional knex SQL dialect drivers we never install. MikroORM's better-sqlite
// driver drags in knex, which statically references every dialect's client
// module; only better-sqlite3 is present, so the Nitro server bundle cannot
// resolve the rest and the build fails. knex loads a dialect driver lazily and
// only for the configured client, so for our SQLite connection these are never
// required at runtime — alias them to an empty stub so the graph resolves.
const emptyDriver = fileURLToPath(new URL("./build/empty-driver.mjs", import.meta.url));
const UNUSED_KNEX_DRIVERS = [
  "mysql",
  "mysql2",
  "oracledb",
  "tedious",
  "sqlite3",
  "pg-native",
  "pg-query-stream",
];

// TanStack Start + the Nitro v3 vite plugin.
//
// The nitro() plugin owns the HTTP server (dev and prod) and mounts the
// TanStack Start fetch handler as the SSR renderer. Nitro server routes
// (./server/routes/**) are matched BEFORE the TanStack handler, and
// WebSocket upgrades are handled by Nitro via crossws when
// features.websocket is enabled. Plain TanStack Start (srvx) cannot do WS
// upgrades — this plugin is mandatory (see PRD #9 section 4, prototype #3).
//
// serverDir defaults to false in the vite plugin; it MUST be set or
// server/routes/** is never scanned.
export default defineConfig({
  plugins: [
    tanstackStart(),
    viteReact(),
    nitro({
      serverDir: "./server",
      features: {
        websocket: true,
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: Object.fromEntries(UNUSED_KNEX_DRIVERS.map((name) => [name, emptyDriver])),
  },
  environments: {
    // TSS server entry lives under src/ to silence the dev warning about the
    // entry doubling as the Vite SSR input.
    ssr: { build: { rollupOptions: { input: "./src/server.ts" } } },
  },
});
