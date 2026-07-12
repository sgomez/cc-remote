import { defineConfig } from "vitest/config";

// Integration tests against a REAL Docker daemon. Kept OUT of the default
// `pnpm test` (whose include is src/**/*.test.ts) and out of CI (no Docker on
// runners). Run locally with `pnpm test:docker` — see
// src/adapters/docker/README.md for prerequisites.
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Docker state is shared/global — never run these files in parallel.
    fileParallelism: false,
  },
});
