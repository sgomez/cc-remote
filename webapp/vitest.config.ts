import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone Vitest config: deliberately does NOT load the app's vite.config
// (TanStack Start + Nitro plugins). core/ is framework-free, so its tests run
// in a plain Node environment against colocated `*.test.ts` files.
//
// The `~` alias mirrors tsconfig `paths` so unit-tested modules (e.g. the pure
// view models in src/ui) can import runtime values from `~/core` the same way
// the app does — without it only type-only `~` imports (erased at compile) work.
export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
