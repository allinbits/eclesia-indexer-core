import {
  defineConfig,
} from "vitest/config";

export default defineConfig({
  resolve: {
  },
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,
    benchmark: {
      include: ["**/*.bench.ts"],
    },
    // execArgv: ["--cpu-prof", "--cpu-prof-dir=test-runner-profile", "--heap-prof", "--heap-prof-dir=test-runner-profile"],
  },
});
