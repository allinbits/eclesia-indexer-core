import {
  defineConfig,
} from "tsdown";

export default defineConfig([
  {
    entry: ["./src/index.ts"],
    unbundle: true,
    attw: true,
    platform: "node",
    fixedExtension: false, // keep dist/index.js, which start, bin and the Dockerfile point at
    nodeProtocol: "strip",
    target: "es2022",
    outDir: "./dist",
    clean: true,
    sourcemap: true,
    dts: true,
    format: ["cjs"],
  },
  {
    entry: ["./src/index.ts"],
    unbundle: true,
    attw: true,
    platform: "node",
    fixedExtension: false, // keep dist/index.js, which start, bin and the Dockerfile point at
    target: "es2022",
    outDir: "./dist",
    clean: true,
    sourcemap: true,
    dts: true,
    format: ["esm"],
  },
]);
