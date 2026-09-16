import {
  defineConfig,
} from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",             // The CLI
    scaffold: "src/create-indexer.ts", // Programmatic API: scaffold(config, dir)
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["enquirer", "fs-extra", "picocolors"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
