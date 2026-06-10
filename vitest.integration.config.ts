import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests: repositories + Server Actions against a real Postgres
// (started via `supabase start` locally / a Postgres service in CI).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.{test,spec}.ts"],
    // DB tests share a single connection pool; run them serially to avoid
    // cross-test interference until per-test isolation is in place.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
