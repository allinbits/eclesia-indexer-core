import {
  defineConfig,
} from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@eclesia/indexer-engine": path.resolve(__dirname, "../packages/indexer-engine/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    benchmark: {
      include: ["**/*.bench.ts"],
    },
  },
});
