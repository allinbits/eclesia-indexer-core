import {
  defineConfig,
} from "vitest/config";

/**
 * End-to-end suite: needs a PostgreSQL server (E2E_PG_CONNECTION_STRING) and the built
 * workspace packages. Unit tests live next to the sources and run with `pnpm test`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
