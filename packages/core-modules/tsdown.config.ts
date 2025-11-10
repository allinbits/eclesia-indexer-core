/* eslint-disable @stylistic/no-multi-spaces */
import {
  defineConfig,
} from "tsdown";

/**
 * TSDown build configuration for core-modules package
 * Builds Cosmos SDK indexing modules with external dependencies
 */
export default defineConfig([
  {
    entry: ["./src/index.ts"],                                    // Entry point
    unbundle: true,                                               // Keep modules separate
    attw: true,                                                  // Type checking
    platform: "node",                                            // Node.js target
    nodeProtocol: "strip",                                       // Strip node: prefix
    target: "es2022",                                             // es2022 target
    outDir: "./dist",                                             // Output directory
    clean: true,                                                 // Clean before build
    sourcemap: true,                                             // Generate sourcemaps
    dts: true,                                                   // Generate .d.ts files
    format: ["cjs"],                                             // CommonJS format
    external: ["@eclesia/basic-pg-indexer", "@eclesia/indexer-engine"], // External deps
  },
  {
    entry: ["./src/index.ts"],                                    // Entry point
    unbundle: true,                                               // Keep modules separate
    attw: true,                                                  // Type checking
    platform: "node",                                            // Node.js target
    target: "es2022",                                             // es2022 target
    outDir: "./dist",                                             // Output directory
    clean: true,                                                 // Clean before build
    sourcemap: true,                                             // Generate sourcemaps
    dts: true,                                                   // Generate .d.ts files
    format: ["esm"],                                             // ES Module format
    external: ["@eclesia/basic-pg-indexer", "@eclesia/indexer-engine"], // External deps
  },
]);
