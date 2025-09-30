import {
  defineConfig,
} from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["enquirer", "fs-extra", "picocolors"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
