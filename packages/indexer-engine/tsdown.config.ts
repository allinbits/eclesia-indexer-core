/* eslint-disable @stylistic/no-multi-spaces */
import {
  defineConfig,
} from "tsdown";

/**
 * TSDown build configuration for indexer-engine package
 * Builds both CommonJS and ESM formats for compatibility
 */
export default defineConfig([
  {
    entry: ["./src/index.ts"],              // Entry point
    unbundle: true,                         // Keep modules separate (don't bundle)
    attw: true,                            // Run @arethetypeswrong/core checks
    platform: "node",                      // Target Node.js environment
    nodeProtocol: "strip",                 // Remove "node:" protocol prefix
    target: "es2020",                       // Target ES2020 JavaScript
    outDir: "./dist",                       // Output directory
    clean: true,                           // Clean output directory before build
    sourcemap: true,                       // Generate source maps
    dts: true,                             // Generate TypeScript declaration files
    format: ["cjs"],                       // Generate CommonJS format
  },
  {
    entry: ["./src/index.ts"],              // Entry point
    unbundle: true,                         // Keep modules separate (don't bundle)
    attw: true,                            // Run @arethetypeswrong/core checks
    platform: "node",                      // Target Node.js environment
    target: "es2020",                       // Target ES2020 JavaScript
    outDir: "./dist",                       // Output directory
    clean: true,                           // Clean output directory before build
    sourcemap: true,                       // Generate source maps
    dts: true,                             // Generate TypeScript declaration files
    format: ["esm"],                       // Generate ES Module format
  },
]);
