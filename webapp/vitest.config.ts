import { defineConfig } from "vitest/config";

// Standalone Vitest config: deliberately does NOT load the app's vite.config
// (TanStack Start + Nitro plugins). core/ is framework-free, so its tests run
// in a plain Node environment against colocated `*.test.ts` files.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
